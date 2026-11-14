#!/usr/bin/env node
/**
 * 0294: en gäst som tagits bort ur ett möte och läggs tillbaka får en ny inbjudan (lk_ics_ko).
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   node tests/ics-aterinbjudan-db.mjs          migrationen körs i transaktionen och provas
 *   UTAN=1 node tests/ics-aterinbjudan-db.mjs   provar funktionen som den står i databasen
 *
 * Allt i EN transaktion som ALLTID rullas tillbaka; utkorgen ser bara committade rader, så inget skickas.
 * Provhändelsen heter "PROV 0294".
 */
import { readFileSync } from "node:fs";
import pg from "pg";
const KLON = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
let ok = 0, fel = 0;
const prov = (namn, villkor, info = "") => { if (villkor) { ok++; console.log("  ok  ", namn); } else { fel++; console.log("  FEL ", namn, info); } };
try {
  await db.query("begin");
  await db.query("set local lock_timeout = '3s'");
  if (!process.env.UTAN) await db.query(readFileSync(`${KLON}/supabase/migrations/0294_ics_aterinbjudan.sql`, "utf8"));
  // Organisatören: vilken anställd som helst med e-post (raden finns bara i transaktionen).
  const { rows: [org] } = await db.query("select id from employee where email is not null order by created_at limit 1");
  const { rows: [e] } = await db.query(
    `insert into calendar_event (kind, title, organizer_id, created_by, dag, tid, minuter, plats) values ('mote', 'PROV 0294', $1, $1, current_date + 7, '08:00', 30, 'Telefon') returning id, ics_sequence`, [org.id]);
  const A = "prov-0294@prov.example", B = "annan-0294@prov.example";
  const rader = async () => (await db.query(`select payload->>'epost' epost, payload->>'metod' metod, (payload->>'sekvens')::int sek, idempotency_key k from outbox where event_id = $1 order by id`, [e.id])).rows;
  const bjud = (x) => db.query("select public.lead_bjud_in($1, $2) id", [e.id, x]);
  const ut = async (x) => { await db.query("delete from calendar_attendee where event_id = $1 and external_email = $2", [e.id, x]); return db.query("select public.lk_ics_ko($1, $2, 'CANCEL') id", [e.id, x]); };

  await bjud(A);
  let r = await rader();
  prov("första inbjudan: en rad (triggern och lead_bjud_in köar samma)", r.length === 1 && r[0].metod === "REQUEST" && r[0].k.endsWith(":REQUEST:" + A), JSON.stringify(r));
  await db.query("select public.lk_ics_ko($1, $2, 'REQUEST')", [e.id, A]);
  prov("samma inbjudan igen är en dubblett", (await rader()).length === 1);
  await ut(A);
  r = await rader();
  prov("borttagen: en avbokning", r.length === 2 && r[1].metod === "CANCEL" && r[1].k.endsWith(":CANCEL:" + A), JSON.stringify(r));
  await db.query("select public.lk_ics_ko($1, $2, 'CANCEL')", [e.id, A]);
  prov("samma avbokning igen är en dubblett", (await rader()).length === 2);
  await bjud(A);
  r = await rader();
  prov("TILLBAKA: en ny inbjudan med egen nyckel (felet som hittades)", r.length === 3 && r[2].metod === "REQUEST" && r[2].k === `ics:${e.id}:0:REQUEST:${A}:3`, JSON.stringify(r.map(x => x.k)));
  await bjud(A);
  prov("tillbaka två gånger är en dubblett", (await rader()).length === 3);
  await ut(A);
  r = await rader();
  prov("borttagen igen: ny avbokning", r.length === 4 && r[3].metod === "CANCEL" && r[3].k.endsWith(":CANCEL:" + A + ":4"), JSON.stringify(r.map(x => x.k)));
  await bjud(A);
  r = await rader();
  prov("tillbaka igen: ny inbjudan", r.length === 5 && r[4].k.endsWith(":REQUEST:" + A + ":5"), JSON.stringify(r.map(x => x.k)));
  await bjud(B);
  r = await rader();
  prov("en annan gäst påverkas inte (vanlig nyckel)", r.length === 6 && r[5].k === `ics:${e.id}:0:REQUEST:${B}`, JSON.stringify(r.map(x => x.k)));
  const { rows: [s] } = await db.query("select ics_sequence from calendar_event where id = $1", [e.id]);
  prov("sekvensen höjs inte (ingen ny inbjudan till alla)", s.ics_sequence === e.ics_sequence);
  // Ny tid: sekvensen höjs av kalendern och alla får en rad på den nya sekvensen med vanlig nyckel.
  await db.query("update calendar_event set ics_sequence = ics_sequence + 1, tid = '09:00' where id = $1", [e.id]);
  r = await rader();
  const ny = r.filter((x) => x.sek === 1);
  prov("ny tid: båda gästerna får sekvens 1 med vanlig nyckel", ny.length === 2 && ny.every((x) => x.metod === "REQUEST" && /:1:REQUEST:[^:]+$/.test(x.k)), JSON.stringify(ny));
  await ut(B);
  await bjud(B);
  r = await rader();
  prov("efter ny tid: borttagen och tillbaka fungerar på den nya sekvensen", r.at(-1).k === `ics:${e.id}:1:REQUEST:${B}:3` && r.at(-2).k === `ics:${e.id}:1:CANCEL:${B}`, JSON.stringify(r.slice(-2).map(x => x.k)));
  const { rows: g } = await db.query(`select has_function_privilege('anon', 'public.lk_ics_ko(uuid,text,text)', 'execute') anon, has_function_privilege('authenticated', 'public.lk_ics_ko(uuid,text,text)', 'execute') inloggad, has_function_privilege('service_role', 'public.lk_ics_ko(uuid,text,text)', 'execute') server`);
  prov("bara servern får köra funktionen", !g[0].anon && !g[0].inloggad && g[0].server, JSON.stringify(g[0]));
} catch (e) {
  fel++; console.log("  FEL  undantag:", e.message);
} finally {
  await db.query("rollback").catch(() => {});
  const { rows: [k] } = await db.query("select count(*)::int n from calendar_event where title = 'PROV 0294'");
  prov("inget kvar efter rollback", k.n === 0);
  await db.end();
  console.log(`\n${ok} ok, ${fel} fel (rullat tillbaka)`);
  process.exit(fel ? 1 : 0);
}
