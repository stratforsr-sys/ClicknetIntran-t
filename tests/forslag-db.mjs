#!/usr/bin/env node
/**
 * Hemvyn, steg 1 (0303): förslagsloggen i databasen.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   node tests/forslag-db.mjs
 *
 * Provet visar:
 *   1. Loggen tar bara emot nya rader: ingen ändring, ingen radering, ingen
 *      tömning. Undantaget är provdata (`prov`), som får raderas.
 *   2. Regel och nyckel är unika, så att ett jobb kan köras om utan dubbletter.
 *   3. Ett val per förslag, tvingat i databasen: det andra anropet ger null.
 *      Ångra öppnar förslaget igen, men inte efter domen.
 *   4. Vyn visar det senaste som gäller, och en händelse som pekats ut av en
 *      `ogiltig` räknas inte.
 *   5. RLS: personen ser sitt eget, teamledaren sitt lags, och en rad för hela
 *      företaget ses bara av säljchef, vd och administratör. Ingen inloggad
 *      får skriva.
 *   6. En sparad inställning ger en rad i audit_log med gammalt och nytt värde.
 *   7. "Jag ringer själv": den öppna bekräftelseuppgiften lämnas över och
 *      bokaren står kvar; utan uppgift läggs en ny upp; Ångra tar tillbaka.
 *   8. Avidentifieringen tar bort personen men lämnar talen.
 *   9. Funktionerna får bara köras av servern.
 *  10. En person som tas bort: raderna om hen försvinner, det hen gjorde i
 *      andras förslag står kvar, och loggen är låst igen efteråt.
 *
 * 0303 läses från disk och körs alltid inne i transaktionen (den är omkörbar),
 * så provet går lika bra före som efter att migrationen körts på riktigt, och
 * det är filens text som prövas. Allt sker i en transaktion som rullas
 * tillbaka. Ingen driftdata ändras, och varje provrad är märkt `prov`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MAPP = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase/migrations");
const FIL = readdirSync(MAPP).find((f) => /^\d{4}_forslagslogg\.sql$/.test(f));

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
if (!FIL) {
  console.error("Migrationen NNNN_forslagslogg.sql saknas.");
  process.exit(1);
}
const sql = readFileSync(join(MAPP, FIL), "utf8");

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const ett = async (q, p = []) => (await db.query(q, p)).rows[0];
// Felkoden för en sats som ska nekas, utan att transaktionen dör.
const felkod = async (q, p = []) => {
  await db.query("savepoint f");
  try {
    await db.query(q, p);
    await db.query("release savepoint f");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint f");
    return e.code ?? String(e.message);
  }
};
const somAnvandare = async (sub, q, p = []) => {
  await db.query("savepoint s");
  try {
    await db.query("set local role authenticated");
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: "authenticated" })]);
    return (await db.query(q, p)).rows;
  } finally {
    await db.query("rollback to savepoint s");
  }
};

try {
  await db.query("begin");
  const { rows: [fore] } = await db.query(`select to_regclass('public.nav_forslag') is not null as finns`);
  console.log(`  (före provet: nav_forslag ${fore.finns ? "finns" : "saknas"}; ${FIL} körs i transaktionen)`);
  await db.query(sql);

  const nyAnstalld = async (etikett, roll = null) => {
    const e = await ett(
      `insert into employee (email, first_name, last_name, status, employment_type, auth_user_id)
       values ($1, 'Forslag', $2, 'active', 'permanent', gen_random_uuid()) returning id, auth_user_id`,
      [`forslag-prov-${etikett}@example.invalid`, `Prov${etikett}`],
    );
    if (roll) await db.query(`insert into employee_role (employee_id, role) values ($1::uuid, $2)`, [e.id, roll]);
    return e;
  };
  const a = await nyAnstalld("a");
  const b = await nyAnstalld("b");
  const tl = await nyAnstalld("tl", "team_lead");
  const chef = await nyAnstalld("chef", "sales_manager");
  const team = await ett(`insert into team (company_id, name, lead_id) select id, 'Forslag-prov', $1::uuid from company limit 1 returning id`, [tl.id]);
  await db.query(`update employee set team_id = $2::uuid where id = $1::uuid`, [a.id, team.id]);

  const nytt = async (nyckel, o = {}) =>
    ett(
      `insert into nav_forslag (sort, regel, nyckel, kalla, om, lag, doms_dag, prov, val, trodde, belagg)
       values ('forslag', 'prov.forslag-db', $1, 'regel', $2, $3, $4, $5, array['ringer-sjalv','flytta','lat-sta'], '{"n":1,"av":4}', $6)
       returning id`,
      [nyckel, o.om ?? null, o.lag ?? null, o.dom ?? null, o.prov ?? true, JSON.stringify(o.belagg ?? {})],
    );
  const f1 = await nytt("a", { om: a.id });
  const f2 = await nytt("b", { om: b.id });
  const f3 = await nytt("laget", { lag: team.id });
  const f4 = await nytt("alla");

  console.log("\n\x1b[1mBara nya rader\x1b[0m");
  ok("en ändring nekas", (await felkod(`update nav_forslag set text = 'omskriven' where id = $1`, [f1.id])) === "42501");
  const skarp = await nytt("skarp", { om: a.id, prov: false });
  ok("en radering av en riktig rad nekas", (await felkod(`delete from nav_forslag where id = $1`, [skarp.id])) === "42501");
  ok("tömning nekas", (await felkod(`truncate nav_forslag cascade`)) === "42501");
  ok("samma regel och nyckel två gånger nekas", (await felkod(`insert into nav_forslag (sort, regel, nyckel, kalla, prov) values ('forslag', 'prov.forslag-db', 'a', 'regel', true)`)) === "23505");
  ok("en okänd sort nekas", (await felkod(`insert into nav_forslag (sort, regel, nyckel, kalla, prov) values ('annat', 'prov.forslag-db', 'x', 'regel', true)`)) === "23514");
  {
    const h = await ett(`insert into nav_forslag_handelse (forslag, sort, data) values ($1, 'matning', '{"utfall":"hallet"}') returning id, prov`, [f1.id]);
    ok("en händelse är provdata när förslaget är det", h.prov === true);
    ok("en händelse går inte att ändra", (await felkod(`update nav_forslag_handelse set data = '{}' where id = $1`, [h.id])) === "42501");
    const hs = await ett(`insert into nav_forslag_handelse (forslag, sort, data) values ($1, 'matning', '{}') returning id, prov`, [skarp.id]);
    ok("en riktig händelse går inte att radera", hs.prov === false && (await felkod(`delete from nav_forslag_handelse where id = $1`, [hs.id])) === "42501");
    ok("en kommentar över 200 tecken nekas", (await felkod(`insert into nav_forslag_handelse (forslag, sort, data) values ($1, 'kommentar', $2)`, [f1.id, JSON.stringify({ text: "x".repeat(201) })])) === "23514");
    ok("en tom kommentar nekas", (await felkod(`insert into nav_forslag_handelse (forslag, sort, data) values ($1, 'kommentar', '{}')`, [f1.id])) === "23514");
    ok("ogiltig utan utpekad händelse nekas", (await felkod(`insert into nav_forslag_handelse (forslag, sort) values ($1, 'ogiltig')`, [f1.id])) === "23514");
    const p = await nytt("raderas");
    await db.query(`insert into nav_forslag_handelse (forslag, sort, data) values ($1, 'matning', '{}')`, [p.id]);
    ok("provdata får raderas, med sina händelser", (await felkod(`delete from nav_forslag where id = $1`, [p.id])) === null
      && (await ett(`select count(*)::int as n from nav_forslag_handelse where forslag = $1`, [p.id])).n === 0);
  }

  console.log("\n\x1b[1mEtt val per förslag\x1b[0m");
  {
    const v1 = await ett(`select nav_forslag_valj($1, $2, '{"val":"ringer-sjalv"}') as id`, [f1.id, a.id]);
    const v2 = await ett(`select nav_forslag_valj($1, $2, '{"val":"lat-sta"}') as id`, [f1.id, a.id]);
    ok("första valet sparas", !!v1.id);
    ok("andra valet ger null", v2.id === null);
    let lage = await ett(`select beslut, beslut_av from nav_forslag_lage where id = $1`, [f1.id]);
    ok("vyn visar valet", lage.beslut?.val === "ringer-sjalv" && lage.beslut_av === a.id);
    await db.query(`insert into nav_forslag_handelse (forslag, sort, av, data) values ($1, 'atgard', $2, '{"task":"t1"}')`, [f1.id, a.id]);
    lage = await ett(`select atgard from nav_forslag_lage where id = $1`, [f1.id]);
    ok("vyn visar vad valet skapade", lage.atgard?.task === "t1");
    const an = await ett(`select nav_forslag_angra($1, $2, '{}') as id`, [f1.id, a.id]);
    ok("ångra ger det ångrade beslutets id", an.id === v1.id);
    lage = await ett(`select beslut, atgard from nav_forslag_lage where id = $1`, [f1.id]);
    ok("efter ångra är förslaget öppet igen", lage.beslut === null && lage.atgard === null);
    ok("ångra utan val ger null", (await ett(`select nav_forslag_angra($1, $2, '{}') as id`, [f1.id, a.id])).id === null);
    const v3 = await ett(`select nav_forslag_valj($1, $2, '{"val":"lat-sta"}') as id`, [f1.id, a.id]);
    ok("efter ångra går det att välja igen", !!v3.id);
    ok("ett förslag som inte finns ger null", (await ett(`select nav_forslag_valj(gen_random_uuid(), $1, '{}') as id`, [a.id])).id === null);

    const d1 = await ett(`insert into nav_forslag_handelse (forslag, sort, data) values ($1, 'dom', '{"utfall":"uteblev"}') returning id`, [f1.id]);
    ok("efter domen går valet inte att ångra", (await ett(`select nav_forslag_angra($1, $2, '{}') as id`, [f1.id, a.id])).id === null);
    // Utfallet rättas efter domen: en ny dom, och den senaste gäller.
    const d2 = await ett(`insert into nav_forslag_handelse (forslag, sort, data) values ($1, 'dom', '{"utfall":"hallet"}') returning id`, [f1.id]);
    ok("en rättad dom: den senaste gäller", (await ett(`select dom from nav_forslag_lage where id = $1`, [f1.id])).dom?.utfall === "hallet");
    // Jobbet dömde fel: den senaste domen ogiltigförklaras, och den förra gäller igen.
    await db.query(`insert into nav_forslag_handelse (forslag, sort, ogiltigar, data) values ($1, 'ogiltig', $2, '{"skal":"prov"}')`, [f1.id, d2.id]);
    ok("en ogiltigförklarad dom räknas inte", (await ett(`select dom from nav_forslag_lage where id = $1`, [f1.id])).dom?.utfall === "uteblev");
    ok("och syns inte bland de giltiga", (await ett(`select count(*)::int as n from nav_forslag_giltig where id = any($1::uuid[])`, [[d1.id, d2.id]])).n === 1);
  }

  console.log("\n\x1b[1mVem som får läsa\x1b[0m");
  {
    const ids = [f1.id, f2.id, f3.id, f4.id];
    const ser = async (vem) => (await somAnvandare(vem.auth_user_id, `select id from nav_forslag where id = any($1::uuid[])`, [ids])).map((r) => r.id);
    const har = (l, ...v) => l.length === v.length && v.every((x) => l.includes(x.id));
    ok("personen ser bara sin egen rad", har(await ser(a), f1));
    ok("en annan säljare ser bara sin", har(await ser(b), f2));
    ok("teamledaren ser sin säljares rad och lagets, inte hela företagets", har(await ser(tl), f1, f3));
    ok("säljchefen ser allt", har(await ser(chef), f1, f2, f3, f4));
    const h = await somAnvandare(b.auth_user_id, `select count(*)::int as n from nav_forslag_handelse where forslag = $1`, [f1.id]);
    ok("händelserna följer förslaget: en annan säljare ser inga", h[0].n === 0);
    const hl = await somAnvandare(tl.auth_user_id, `select count(*)::int as n from nav_forslag_lage where id = any($1::uuid[])`, [ids]);
    ok("vyn läses med läsarens egen behörighet", hl[0].n === 2);
    const skriv = async (q, p) => { try { await somAnvandare(a.auth_user_id, q, p); return null; } catch (e) { return e.code; } };
    ok("ingen inloggad får lägga in ett förslag", (await skriv(`insert into nav_forslag (sort, regel, nyckel, kalla) values ('forslag', 'prov.forslag-db', 'egen', 'person')`, [])) === "42501");
    ok("ingen inloggad får lägga in en händelse", (await skriv(`insert into nav_forslag_handelse (forslag, sort, data) values ($1, 'matning', '{}')`, [f1.id])) === "42501");
    ok("facit och takt läses bara av servern", (await skriv(`select 1 from nav_facit_dom limit 1`, [])) === "42501" && (await skriv(`select 1 from nav_takt_dag limit 1`, [])) === "42501");
  }

  console.log("\n\x1b[1mBara servern kör funktionerna\x1b[0m");
  for (const f of ["nav_forslag_valj(uuid,uuid,jsonb)", "nav_forslag_angra(uuid,uuid,jsonb)", "nav_forslag_avidentifiera(date)", "mote_bekrafta_overta(uuid,uuid,date,text,text)", "mote_bekrafta_aterlamna(uuid,uuid,boolean,uuid)"]) {
    const r = await ett(
      `select has_function_privilege('anon', $1::regprocedure, 'execute') as anon,
              has_function_privilege('authenticated', $1::regprocedure, 'execute') as inloggad,
              has_function_privilege('service_role', $1::regprocedure, 'execute') as server`, [`public.${f}`]);
    ok(`${f}`, !r.anon && !r.inloggad && r.server);
  }

  console.log("\n\x1b[1mInställningarnas historik\x1b[0m");
  {
    const logg = async () => (await db.query(`select meta from audit_log where action = 'installning' and object_id = 'prov.forslag-db' order by id`)).rows.map((r) => r.meta);
    await db.query(`insert into nav_setting (key, value, updated_by) values ('prov.forslag-db', '2', $1)`, [chef.id]);
    let l = await logg();
    ok("en ny inställning skrivs i loggen", l.length === 1 && l[0].fore === null && l[0].efter === 2);
    await db.query(`update nav_setting set value = '3' where key = 'prov.forslag-db'`);
    l = await logg();
    ok("en ändring sparar gammalt och nytt värde", l.length === 2 && l[1].fore === 2 && l[1].efter === 3);
    await db.query(`update nav_setting set value = '3', updated_at = now() where key = 'prov.forslag-db'`);
    ok("samma värde igen ger ingen ny rad", (await logg()).length === 2);
    await db.query(`insert into nav_setting (key, value) values ('prov.forslag-db', '4') on conflict (key) do update set value = excluded.value`);
    ok("en upsert, som rutterna skriver, loggas också", (await logg()).length === 3);
  }

  console.log("\n\x1b[1mJag ringer själv\x1b[0m");
  {
    const bolag = await ett(`insert into mote_bolag (namn, telefon, kalla) values ('PROV forslag AB', '+46700000077', 'prov') returning id`);
    const kedja = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bolag.id]);
    const mote = await ett(
      `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art) values ($1, $2, $3, date_trunc('second', now() + interval '1 day'), 'prov', 'ny') returning id, mote_tid`,
      [kedja.id, b.id, a.id],
    );
    // Bokaren har redan en öppen uppgift (som jobbet lägger upp). Tiden är hela
    // sekunder: pg ger tillbaka en Date utan mikrosekunder, och funktionen
    // nekar en tid som inte är mötets.
    const forsta = await ett(`select mote_uppgift_skapa($1, $2, $3, 'Bekräfta mötet med PROV forslag AB', '', current_date) as id`, [mote.id, mote.mote_tid, b.id]);
    ok("bokarens uppgift finns", !!forsta.id);
    const svar = (await ett(`select mote_bekrafta_overta($1, $2, current_date, 'Bekräfta mötet med PROV forslag AB', '') as s`, [mote.id, a.id])).s;
    ok("uppgiften lämnas över, ingen ny skapas", svar?.task === forsta.id && svar.ny === false && svar.fran === b.id);
    const t = await ett(`select assignee_id from task where id = $1`, [forsta.id]);
    ok("den som håller mötet har uppgiften", t.assignee_id === a.id);
    ok("bokaren står kvar i uppgiften", (await ett(`select count(*)::int as n from task_member where task_id = $1 and employee_id = $2`, [forsta.id, b.id])).n === 1);
    ok("historiken säger vem som tog den", (await ett(`select count(*)::int as n from task_event where task_id = $1 and type = 'tilldelad' and by_employee_id = $2`, [forsta.id, a.id])).n === 1);
    ok("mötet har fortfarande en enda uppgift", (await ett(`select count(*)::int as n from mote_uppgift where mote_id = $1`, [mote.id])).n === 1);
    ok("ångra lämnar tillbaka uppgiften", (await ett(`select mote_bekrafta_aterlamna($1, $2, false, $3) as ok`, [forsta.id, b.id, a.id])).ok === true
      && (await ett(`select assignee_id from task where id = $1`, [forsta.id])).assignee_id === b.id);

    // Bokaren stryker sin uppgift utan att mötet blev bekräftat: en ny uppgift till den som håller mötet.
    // (Att bocka av den bekräftar mötet, 0291, och då finns inget kvar att ta över.)
    await db.query(`insert into task_event (task_id, type, by_employee_id, at) values ($1, 'avbruten', $2, clock_timestamp())`, [forsta.id, b.id]);
    const ny = (await ett(`select mote_bekrafta_overta($1, $2, current_date, 'Bekräfta mötet med PROV forslag AB', '') as s`, [mote.id, a.id])).s;
    ok("struken uppgift: en ny läggs upp", ny?.ny === true && ny.task !== forsta.id);
    ok("den nya ligger hos den som håller mötet", (await ett(`select assignee_id from task where id = $1`, [ny.task])).assignee_id === a.id);
    ok("ångra tar bort en uppgift som valet lade upp", (await ett(`select mote_bekrafta_aterlamna($1, null, true, $2) as ok`, [ny.task, a.id])).ok === true
      && (await ett(`select count(*)::int as n from task where id = $1`, [ny.task])).n === 0);

    await db.query(`update mote set bekraftat_nar = now(), bekraftat_av = $2 where id = $1`, [mote.id, b.id]);
    ok("ett bekräftat möte ger ingenting", (await ett(`select mote_bekrafta_overta($1, $2, current_date, 'x', '') as s`, [mote.id, a.id])).s === null);

    ok("offertens belopp finns på kedjan", (await felkod(`update mote_kedja set offert_belopp = 212000 where id = $1`, [kedja.id])) === null);
    ok("ett negativt belopp nekas", (await felkod(`update mote_kedja set offert_belopp = -1 where id = $1`, [kedja.id])) === "23514");
  }

  console.log("\n\x1b[1mAvidentifieringen\x1b[0m");
  {
    const gammal = await nytt(`m1@2024-01-10@${a.id}`, { om: a.id, dom: "2024-01-11", belagg: { n: 1, av: 4, rader: ["m1"], mote: "m1" } });
    await db.query(`insert into nav_forslag_handelse (forslag, sort, av, data) values ($1, 'kommentar', $2, '{"text":"Kunden bad om ny tid."}')`, [gammal.id, a.id]);
    await db.query(`insert into nav_forslag_handelse (forslag, sort, data) values ($1, 'dom', '{"utfall":"hallet"}')`, [gammal.id]);
    const n = (await ett(`select nav_forslag_avidentifiera('2024-06-01') as n`)).n;
    ok("en gammal rad avidentifieras", n === 1, `${n}`);
    const r = await ett(`select om, nyckel, belagg, avidentifierad from nav_forslag where id = $1`, [gammal.id]);
    ok("personen och raderna bakom är borta, talen kvar", r.om === null && !r.nyckel.includes(a.id) && r.belagg.n === 1 && r.belagg.rader === undefined && r.avidentifierad !== null);
    const hh = (await db.query(`select sort, av, data from nav_forslag_handelse where forslag = $1 order by nar`, [gammal.id])).rows;
    ok("kommentaren är borta, domen kvar", hh.find((x) => x.sort === "kommentar").data.text === "(borttagen)" && hh.every((x) => x.av === null) && hh.find((x) => x.sort === "dom").data.utfall === "hallet");
    ok("nya rader rörs inte", (await ett(`select om from nav_forslag where id = $1`, [f2.id])).om === b.id);
    ok("efteråt är loggen låst igen", (await felkod(`update nav_forslag set text = 'x' where id = $1`, [f2.id])) === "42501");
  }

  console.log("\n\x1b[1mFacit och takt\x1b[0m");
  {
    const q = `insert into nav_facit_dom (regel, krets, vid, hog_n, hog_av, lag_n, lag_av, sort, prov) values ('prov.forslag-db', 'alla', 10, 5, 5, 0, 5, 'utslag', true)`;
    ok("en dom sparas", (await felkod(q)) === null);
    ok("samma dom två gånger nekas", (await felkod(q)) === "23505");
    const t = `insert into nav_takt_dag (krets, manad, gatt, netto, prognos) values ('prov', '2026-11-01', 10, 19, 40)`;
    ok("ett morgonvärde sparas", (await felkod(t)) === null);
    ok("samma morgon två gånger nekas", (await felkod(t)) === "23505");
    ok("månaden måste vara den första", (await felkod(`insert into nav_takt_dag (krets, manad, gatt, netto) values ('prov', '2026-11-15', 1, 0)`)) === "23514");
  }

  console.log("\n\x1b[1mPersonen tas bort\x1b[0m");
  {
    // Rader OM personen försvinner med hen (också ur en logg som annars bara tar
    // emot nya rader). Det hen gjorde i andras förslag står kvar.
    const x = await nyAnstalld("x");
    const omX = await nytt("om-x", { om: x.id, prov: false });
    await db.query(`insert into nav_forslag_handelse (forslag, sort, av, data) values ($1, 'beslut', $2, '{"val":"lat-sta"}')`, [omX.id, x.id]);
    const omA = await nytt("om-a-av-x", { om: a.id, prov: false });
    const hx = await ett(`insert into nav_forslag_handelse (forslag, sort, av, data) values ($1, 'kommentar', $2, '{"text":"Jag tar den."}') returning id`, [omA.id, x.id]);
    const svar = (await ett(`select ta_bort_anstalld($1) as r`, [x.id])).r;
    ok("raderingen går igenom", !!svar);
    ok("förslaget om personen är borta, med sina händelser",
      (await ett(`select count(*)::int as n from nav_forslag where id = $1`, [omX.id])).n === 0
        && (await ett(`select count(*)::int as n from nav_forslag_handelse where forslag = $1`, [omX.id])).n === 0);
    ok("det hen gjorde i en annans förslag står kvar", (await ett(`select count(*)::int as n from nav_forslag_handelse where id = $1`, [hx.id])).n === 1);
    ok("loggen är låst igen efter raderingen", (await felkod(`update nav_forslag set text = 'x' where id = $1`, [omA.id])) === "42501"
      && (await felkod(`delete from nav_forslag_handelse where id = $1`, [hx.id])) === "42501");
  }
} catch (e) {
  console.error(e);
  fel++;
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m\n` : "\n\x1b[32mAllt stämmer\x1b[0m\n");
process.exit(fel ? 1 : 0);
