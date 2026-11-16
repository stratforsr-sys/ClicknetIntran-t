#!/usr/bin/env node
/**
 * MÖTEN: VEM SOM HÅLLER MÖTET OCH VILKET MÖTE EN BOKNING FÖLJER PÅ (migration 0313).
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   TZ=UTC node tests/moten-hallare-db.mjs
 *
 * Allt sker i EN transaktion mot den riktiga databasen och rullas ALLTID tillbaka. Migrationsfilen läses från disk
 * och körs två gånger i transaktionen (den ska gå att köra om), så det är filens text som provas, också innan den är
 * körd på riktigt. Provraderna märks `[PROV hallare]`. Inga anställda skapas; provet lånar tre aktiva säljare.
 *
 *   1. `mote_foregaende`: kortets senaste möte, samma kunds avgjorda möte på ett annat kort inom fönstret, och null
 *      utanför fönstret eller med fönstret av. Ett avbokat möte vars tid ligger efter den nya bokningen räknas också.
 *   2. `lk_byt_organisator`: organisatören byts, den nya tas ur deltagarna, den gamla försvinner ur händelsen, kundens
 *      rad och `ics_sequence` rörs inte; en inställd händelse och fel behörighet nekas.
 *   3. Ingen av funktionerna går att anropa som `authenticated` eller `anon`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HAR = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HAR, "..", "supabase", "migrations", "0313_moten_hallare.sql");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL behövs.\n  set -a; . ~/.clicknet/nav.env; set +a; TZ=UTC node tests/moten-hallare-db.mjs");
  process.exit(1);
}

let antal = 0;
let fel = 0;
let sp = 0;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const sektion = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const en = async (sql, arg = []) => (await db.query(sql, arg)).rows[0];

/** En kontroll. `villkor` är ett värde eller en (async) funktion; ett SQL-fel fäller bara den kontrollen. */
async function ok(namn, villkor) {
  antal++;
  const s = `ok${++sp}`;
  let svar = false;
  let info = "";
  await db.query(`savepoint ${s}`);
  try {
    svar = typeof villkor === "function" ? await villkor() : villkor;
    await db.query(`release savepoint ${s}`);
  } catch (e) {
    info = e.message;
    await db.query(`rollback to savepoint ${s}`);
  }
  console.log(`  ${svar === true ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${info ? "  " + info : ""}`);
  if (svar !== true) fel++;
}
/** Ett fel som ska komma: sant om satsen kastar ett fel som innehåller `vantat`. */
async function kastar(sql, arg, vantat) {
  const s = `k${++sp}`;
  await db.query(`savepoint ${s}`);
  try {
    await db.query(sql, arg);
    await db.query(`release savepoint ${s}`);
    return false;
  } catch (e) {
    await db.query(`rollback to savepoint ${s}`);
    return String(e.message).includes(vantat);
  }
}

await db.connect();
try {
  await db.query("begin");
  await db.query(readFileSync(MIGRATION, "utf8"));
  await db.query(readFileSync(MIGRATION, "utf8"));

  let folk = (await db.query(
    `select e.id from employee e
      where e.status = 'active'
        and exists (select 1 from employee_role r where r.employee_id = e.id and r.role = 'salesperson')
      order by e.id limit 3`,
  )).rows.map((r) => r.id);
  // Provdatabasen (nav-prov) har inga säljare: tre skapas i transaktionen och rullas tillbaka med allt annat.
  for (let i = folk.length; i < 3; i++) {
    const id = (await en(`insert into employee (first_name, last_name, email, status) values ('[PROV hallare]', $1, $2, 'active') returning id`, [`Säljare ${i}`, `prov-hallare-${i}@nav-prov.test`])).id;
    await db.query(`insert into employee_role (employee_id, role) values ($1, 'salesperson')`, [id]);
    folk.push(id);
  }
  const [A, B, C] = folk;

  const bolag = async (namn, telefon) => (await en(`insert into mote_bolag (namn, telefon, kalla) values ($1, $2, 'prov') returning id`, [namn, telefon])).id;
  const kedja = async (b, avslut = null) => (await en(`insert into mote_kedja (bolag_id, avslut, avslut_nar) values ($1, $2, case when $2::text is null then null else now() end) returning id`, [b, avslut])).id;
  const mote = async (k, tid, utfall = null, bokat = null) =>
    (await en(
      `insert into mote (kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, kalla, art, utfall, utfall_nar)
       values ($1, $2, $3, coalesce($5::timestamptz, now() - interval '40 days'), $4, 'Kallsamtal', 'ny', $6, case when $6::text is null then null else now() end) returning id`,
      [k, A, B, tid, bokat, utfall],
    )).id;
  const nu = new Date();
  const dagar = (n) => new Date(nu.getTime() + n * 864e5).toISOString();
  const fore = (k, tid, d, utom = null) => en(`select public.mote_foregaende($1, $2, $3, $4) as id`, [k, tid, d, utom]).then((r) => r.id);

  // ---------------------------------------------------------------------------
  sektion("Vilket möte en bokning följer på");

  const b1 = await bolag("[PROV hallare] Uteblev AB", "+46700000901");
  const k1 = await kedja(b1);
  const m1 = await mote(k1, dagar(-3), "uteblev");
  await ok("samma kort: det senaste mötet", async () => (await fore(k1, dagar(2), 90)) === m1);
  await ok("samma kort räknas också med fönstret av", async () => (await fore(k1, dagar(2), 0)) === m1);
  const m1b = await mote(k1, dagar(10), "avbokat", dagar(-1));
  await ok("samma kort: ett avbokat möte vars tid låg efter den nya bokningen räknas (bokningsordningen)", async () => (await fore(k1, dagar(2), 90)) === m1b);

  const b2 = await bolag("[PROV hallare] Tidigare Kort AB", "+46700000902");
  const k2gammal = await kedja(b2, "avbokat");
  const m2 = await mote(k2gammal, dagar(-30), "avbokat");
  const b2b = await bolag("[PROV hallare] Tidigare Kort AB", "+46700000903"); // samma namn, ny telefon: samma kund
  const k2ny = await kedja(b2b);
  await ok("annat kort, samma kund, avbokat för 30 dagar sedan: det mötet", async () => (await fore(k2ny, dagar(1), 90)) === m2);
  await ok("annat kort men fönstret är av: inget", async () => (await fore(k2ny, dagar(1), 0)) === null);
  await ok("annat kort utanför fönstret (20 dagar): inget", async () => (await fore(k2ny, dagar(1), 20)) === null);

  const b3 = await bolag("[PROV hallare] Öppet Annat AB", "+46700000904");
  const k3gammal = await kedja(b3);
  await mote(k3gammal, dagar(5)); // öppet, inget utfall
  const b3b = await bolag("[PROV hallare] Öppet Annat AB", "+46700000905");
  const k3ny = await kedja(b3b);
  await ok("annat kort med ett öppet möte (inget utfall) räknas inte: bara avgjorda möten som inte blev av", async () => (await fore(k3ny, dagar(1), 90)) === null);

  // Annat kort: kunden avbokade nästa veckas möte och bokas om på ett nytt kort till i morgon. Bokningsordningen avgör.
  const b8 = await bolag("[PROV hallare] Senare Avbokat AB", "+46700000911");
  const m8 = await mote(await kedja(b8, "avbokat"), dagar(6), "avbokat", dagar(-2));
  const k8ny = await kedja(await bolag("[PROV hallare] Senare Avbokat AB", "+46700000912"));
  await ok("annat kort: ett avbokat möte vars tid låg efter den nya bokningen räknas", async () => (await fore(k8ny, dagar(1), 90)) === m8);

  const b4 = await bolag("[PROV hallare] Ny Kund AB", "+46700000906");
  const k4 = await kedja(b4);
  await ok("ny kund: inget", async () => (await fore(k4, dagar(1), 90)) === null);

  // Ett befintligt möte som letar efter sitt föregående (jobbet): mötet självt och senare bokade räknas inte.
  const b5 = await bolag("[PROV hallare] Jobbet AB", "+46700000907");
  const k5 = await kedja(b5);
  const m5a = await mote(k5, dagar(-4), "uteblev", dagar(-6));
  const m5ny = await mote(k5, dagar(3), null, dagar(-1));
  await ok("mötet självt räknas inte, bara det som bokades före", async () => (await fore(k5, dagar(3), 90, m5ny)) === m5a);
  await ok("det första mötet har inget föregående", async () => (await fore(k5, dagar(-4), 90, m5a)) === null);

  // ---------------------------------------------------------------------------
  sektion("Jobbet: ett nytt möte som följer på ett tidigare blir en ombokning");

  // m5ny bokades som "ny" (till exempel när databasen inte svarade): jobbet rättar det.
  await db.query(`update mote set foregaende_id = null, art = 'ny' where id = $1`, [m5ny]);
  const b6 = await bolag("[PROV hallare] Helt Ny AB", "+46700000908");
  const m6 = await mote(await kedja(b6), dagar(4));
  const rattade = (await en(`select public.mote_art_ratta() as n`)).n;
  await ok(`jobbet rättar (${rattade})`, rattade >= 1);
  await ok("ny → ombokning med det tidigare mötet som föregående", async () => {
    const r = await en(`select art, foregaende_id from mote where id = $1`, [m5ny]);
    return r.art === "ombokning" && r.foregaende_id === m5a;
  });
  await ok("ett nytt möte för en ny kund rörs inte", async () => (await en(`select art, foregaende_id from mote where id = $1`, [m6])).art === "ny");
  // Jobbet: ett möte på ett annat kort som bokades EFTER det nya är inget föregående (två parallella kort).
  const b9 = await bolag("[PROV hallare] Parallell AB", "+46700000913");
  const m9 = await mote(await kedja(b9), dagar(7), null, dagar(-3));
  await mote(await kedja(await bolag("[PROV hallare] Parallell AB", "+46700000914"), "avbokat"), dagar(9), "avbokat", dagar(-1));
  await db.query(`select public.mote_art_ratta()`);
  await ok("jobbet: ett senare bokat möte på ett annat kort gör inte ett tidigare till ombokning", async () => (await en(`select art from mote where id = $1`, [m9])).art === "ny");
  // Annat kort, samma kund: fönstret läses ur inställningen (0 = av).
  const b7 = await bolag("[PROV hallare] Fönster AB", "+46700000909");
  const k7gammal = await kedja(b7, "avbokat");
  await mote(k7gammal, dagar(-10), "avbokat", dagar(-12));
  const b7b = await bolag("[PROV hallare] Fönster AB", "+46700000910");
  const m7 = await mote(await kedja(b7b), dagar(5), null, dagar(-1));
  await db.query(`insert into nav_setting (key, value) values ('moten.ny-kund-dagar', '0'::jsonb) on conflict (key) do update set value = excluded.value`);
  await db.query(`select public.mote_art_ratta()`);
  await ok("fönstret av: samma kund på ett annat kort förblir ny", async () => (await en(`select art from mote where id = $1`, [m7])).art === "ny");
  await db.query(`update nav_setting set value = '90'::jsonb where key = 'moten.ny-kund-dagar'`);
  await db.query(`select public.mote_art_ratta()`);
  await ok("fönstret 90: samma kund på ett annat kort blir ombokning", async () => (await en(`select art from mote where id = $1`, [m7])).art === "ombokning");

  // ---------------------------------------------------------------------------
  sektion("Kalendern: ny organisatör");

  const ev = (await en(
    `insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, created_by)
     values ('mote', '[PROV hallare] Möte', $1, current_date + 7, '10:00', 30, $1) returning id, ics_sequence`,
    [A],
  ));
  await db.query(`insert into calendar_attendee (event_id, employee_id, response) values ($1, $2, 'vantar')`, [ev.id, B]);
  await db.query(`insert into calendar_attendee (event_id, external_email, response) values ($1, 'kund@prov.example', 'vantar')`, [ev.id]);
  // Kundens rad ger själv en inbjudan i utkorgen (triggern calendar_attendee_ics). Bytet får inte lägga till något.
  const utkorgFore = (await en(`select count(*)::int n from outbox where event_id = $1`, [ev.id])).n;
  await ok("bytet svarar ok", async () => (await en(`select public.lk_byt_organisator($1, $2, $3, $1) as r`, [A, ev.id, B])).r?.ok === true);
  await ok("organisatören är den nya", async () => (await en(`select organizer_id from calendar_event where id = $1`, [ev.id])).organizer_id === B);
  await ok("den nya är inte deltagare (organisatören är aldrig det)", async () => (await en(`select count(*)::int n from calendar_attendee where event_id = $1 and employee_id = $2`, [ev.id, B])).n === 0);
  await ok("den gamla finns inte kvar i händelsen", async () => (await en(`select count(*)::int n from calendar_attendee where event_id = $1 and employee_id = $2`, [ev.id, A])).n === 0);
  await ok("kundens rad står kvar orörd", async () => (await en(`select count(*)::int n from calendar_attendee where event_id = $1 and external_email = 'kund@prov.example' and response = 'vantar'`, [ev.id])).n === 1);
  await ok("ics_sequence rörs inte (kunden får ingen uppdatering)", async () => (await en(`select ics_sequence from calendar_event where id = $1`, [ev.id])).ics_sequence === ev.ics_sequence);
  await ok("bytet lägger inget i utkorgen (ingen ICS, ingen notis)", async () => (await en(`select count(*)::int n from outbox where event_id = $1`, [ev.id])).n === utkorgFore);
  await ok("samma organisatör igen: ok, oförändrad", async () => (await en(`select public.lk_byt_organisator($1, $2, $1, $1) as r`, [B, ev.id])).r?.oforandrad === true);
  await ok("fel behörighet: den som inte är organisatör (eller delegat) nekas", async () => kastar(`select public.lk_byt_organisator($1, $2, $1)`, [C, ev.id], "lk:behorighet"));
  await db.query(`update calendar_event set cancelled_at = now() where id = $1`, [ev.id]);
  await ok("en inställd händelse nekas", async () => kastar(`select public.lk_byt_organisator($1, $2, $3)`, [B, ev.id, A], "lk:installd"));
  await ok("en händelse som inte finns nekas", async () => kastar(`select public.lk_byt_organisator($1, gen_random_uuid(), $2)`, [A, B], "lk:finns_inte"));

  // ---------------------------------------------------------------------------
  sektion("Vem som får anropa");
  await ok("den gamla signaturen mote_foregaende(uuid, timestamptz, integer) finns inte kvar", async () => (await en(`select count(*)::int n from pg_proc where proname = 'mote_foregaende' and pronargs = 3`)).n === 0);
  for (const f of ["lk_byt_organisator(uuid, uuid, uuid, uuid)", "mote_foregaende(uuid, timestamptz, integer, uuid)", "mote_art_ratta()"]) {
    await ok(`${f}: authenticated får inte`, async () => (await en(`select has_function_privilege('authenticated', $1, 'execute') h`, [`public.${f}`])).h === false);
    await ok(`${f}: anon får inte`, async () => (await en(`select has_function_privilege('anon', $1, 'execute') h`, [`public.${f}`])).h === false);
    await ok(`${f}: service_role får`, async () => (await en(`select has_function_privilege('service_role', $1, 'execute') h`, [`public.${f}`])).h === true);
  }
} catch (e) {
  fel++;
  console.error(`\n\x1b[31mProvet avbröts: ${e.message}\x1b[0m`);
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}
console.log(fel === 0 ? `\n\x1b[32mAlla ${antal} prov gick igenom. Inget sparades.\x1b[0m` : `\n\x1b[31m${fel} av ${antal} prov föll. Inget sparades.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
