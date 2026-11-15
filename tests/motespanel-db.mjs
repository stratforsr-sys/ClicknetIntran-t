#!/usr/bin/env node
/**
 * Mötens statistikpanel mot produktionens data: talen ur motespanel.ts (samma rader och kolumner som servern läser)
 * mot samma tal räknade i SQL. Bara läsning: allt i en transaktion som är `read only`.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   TZ=UTC node --experimental-strip-types tests/motespanel-db.mjs
 *
 * Kretsen: en teamledare ser bara sitt team (0264). Att mote_statkrets() ger rätt lista provas i motesstat-db.mjs;
 * här provas att panelen, given en krets, bara räknar och visar kretsen.
 */
import pg from "pg";
import {
  byggPanelSvar, panelMote, panelKedja, PANEL_MOTE_KOLUMNER, PANEL_KEDJA_KOLUMNER,
} from "../src/lib/nav2/motespanel.ts";
import { lasInstallningar } from "../src/lib/nav2/motesflode.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  await db.query("begin read only");
  const nu = new Date((await db.query("select now() as nu")).rows[0].nu);
  const inst = lasInstallningar((await db.query("select key, value from nav_setting where key like 'moten.%'")).rows);
  const tz = inst.tidszon;
  // Samma urval som servern: möten med mötestid de senaste 180 dagarna, plus alla utan utfall, och deras kedjor.
  const moten = (await db.query(
    `select ${PANEL_MOTE_KOLUMNER} from mote where mote_tid >= $1::timestamptz - interval '181 days' or utfall is null`, [nu],
  )).rows.map(panelMote);
  const kedjeIds = [...new Set(moten.map((m) => m.kedja))];
  const kRader = (await db.query(`select ${PANEL_KEDJA_KOLUMNER} from mote_kedja_utfall where kedja_id = any($1::uuid[])`, [kedjeIds])).rows;
  const extra = new Map((await db.query(`select id, uppfoljning_datum::text, inget_svar_i_rad from mote_kedja where id = any($1::uuid[])`, [kedjeIds])).rows.map((r) => [r.id, r]));
  const kedjor = kRader.map((r) => panelKedja(r, extra.get(r.kedja_id)));
  console.log(`  (${moten.length} möten, ${kedjor.length} kedjor, tidszon ${tz})`);

  const svar = byggPanelSvar(moten, kedjor, null, (id) => id.slice(0, 4), inst, nu);
  const storlek = JSON.stringify(svar).length;
  console.log(`  (panelen: ${svar.personer.length} personer, ${Math.round(storlek / 1024)} kB)`);
  ok("svaret är under 300 kB", storlek < 300 * 1024, `${storlek} byte`);

  // SQL: första möten med lokal mötesdag de senaste 90 dagarna (perioden 90 dagar har ingen övre gräns).
  const D90 = `art in ('ny','ombokning') and (mote_tid at time zone $1)::date >= (now() at time zone $1)::date - 90`;
  const tal = async (villkor, krets = null) => Number((await db.query(
    `select count(*)::int as n from mote where ${D90} and ${villkor}${krets ? " and (bokat_av = any($2::uuid[]) or halls_av = any($2::uuid[]))" : ""}`,
    krets ? [tz, krets] : [tz],
  )).rows[0].n);
  const A = svar.tal.d90.alla;
  const avgj = await tal("utfall in ('hallet','uteblev')");
  ok("show rate: avgjorda som i SQL", A.show.av === avgj, `${A.show.av} mot ${avgj}`);
  ok("show rate: hållna som i SQL", A.show.n === await tal("utfall = 'hallet'"), `${A.show.n}`);
  ok("no-show: uteblivna som i SQL", A.noshow.n === await tal("utfall = 'uteblev'"), `${A.noshow.n}`);
  ok("svarade: bekräftade avgjorda som i SQL", A.bekr.n === await tal("utfall in ('hallet','uteblev') and bekraftat_nar is not null"), `${A.bekr.n}`);
  ok("ringdes aldrig som i SQL", A.bekr.aldrig.length === await tal("utfall in ('hallet','uteblev') and bekraftat_nar is null and coalesce(forsok,0) = 0"), `${A.bekr.aldrig.length}`);
  ok("kvalificerade som i SQL", A.kval.n === await tal("utfall = 'hallet' and niva = 'kvalificerat'"), `${A.kval.n} av ${A.kval.av}`);
  ok("obedömda som i SQL", A.kval.obedomda.length === await tal("utfall = 'hallet' and niva is null"), `${A.kval.obedomda.length}`);
  const framat = Number((await db.query(`select count(*)::int as n from mote where art in ('ny','ombokning') and utfall is null and date_trunc('minute', mote_tid) > date_trunc('minute', now())`)).rows[0].n);
  ok("bokade framåt som i SQL", A.kommer.length === framat, `${A.kommer.length} mot ${framat}`);
  ok("varje period och person har en panel", ["vecka", "manad", "d90"].every((p) => svar.personer.every((x) => svar.tal[p][x.id]) && svar.tal[p].alla));
  ok("varje id i panelen finns i kartan", Object.values(svar.tal).every((per) => Object.values(per).every((p) =>
    [...p.show.ids, ...p.kval.ids, ...p.kommer, ...p.attGora.attBekr, ...p.attGora.utan].every((id) => svar.moten[id])
    && [...p.efter.offert, ...p.efter.nytt, ...p.efter.foljsUpp, ...p.efter.dog, ...p.attGora.utanTid, ...p.attGora.uppfNu, ...p.attGora.offSvar].every((id) => svar.kedjor[id]))));

  console.log("\nKretsen begränsar panelen (0264)");
  const vanligast = (await db.query(`select bokat_av as id, count(*) from mote where ${D90} group by 1 order by 2 desc limit 1`, [tz])).rows[0];
  if (!vanligast) {
    console.log("  (inga möten de senaste 90 dagarna: kretsprovet hoppas över)");
  } else {
    const krets = [vanligast.id];
    const team = byggPanelSvar(moten, kedjor, krets, (id) => id.slice(0, 4), inst, nu);
    ok("personlistan är bara kretsen", team.personer.length === 1 && team.personer[0].id === krets[0], JSON.stringify(team.personer.map((p) => p.id.slice(0, 4))));
    const T = team.tal.d90.alla;
    const tAvgj = await tal("utfall in ('hallet','uteblev')", krets);
    ok("alla = kretsens möten (bokade eller hållna av kretsen)", T.show.av === tAvgj, `${T.show.av} mot ${tAvgj}`);
    ok("inga möten utanför kretsen i kartan", Object.values(team.moten).every((m) => krets.includes(m.bokatAv) || krets.includes(m.hallsAv)));
    ok("en tom krets ger tomma tal och inga personer", (() => { const t = byggPanelSvar(moten, kedjor, [], String, inst, nu); return t.personer.length === 0 && t.tal.d90.alla.show.av === 0 && Object.keys(t.moten).length === 0; })());
  }
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla prov gick igenom\x1b[0m");
process.exit(fel ? 1 : 0);
