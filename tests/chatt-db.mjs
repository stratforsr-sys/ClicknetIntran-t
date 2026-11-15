#!/usr/bin/env node
/**
 * Chatten (0304 och 0305) i databasen: loggen, proven, spärren och gränserna.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   node tests/chatt-db.mjs
 *
 * Provet visar:
 *   1. Spärren: `chatt.pa` går inte att sätta till sant utan ett bekräftat
 *      avtal och ett godkänt prov för modellen. Är chatten på går avtalet inte
 *      att ta bort, och modellen inte att byta till en utan godkänt prov.
 *   2. Spärren rör inga andra inställningar.
 *   3. RLS: personen läser bara sina egna rader i loggen, och ingen inloggad
 *      får skriva. Proven läses bara av servern.
 *   4. Gränserna (0305): dollar per person och för företaget, varje
 *      kalendermånad och per miljö. En fråga reserverar sin högsta kostnad
 *      innan Claude anropas, så att många frågor samtidigt inte kan gå förbi.
 *   5. En person som tas bort: hens rader i loggen försvinner.
 *
 * Migrationerna läses från disk och körs i transaktionen (de är omkörbara), så provet
 * går lika bra före som efter att migrationen körts på riktigt. Allt rullas
 * tillbaka: ingen inställning ändras, och chatten slås aldrig på.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MAPP = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase/migrations");
const FILER = ["chatt", "chatt_tak"].map((n) => readdirSync(MAPP).find((f) => new RegExp(`^\\d{4}_${n}\\.sql$`).test(f)));

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra && !villkor ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
if (FILER.some((f) => !f)) {
  console.error("Migrationerna NNNN_chatt.sql och NNNN_chatt_tak.sql ska finnas båda.");
  process.exit(1);
}
const sql = FILER.map((f) => readFileSync(join(MAPP, f), "utf8")).join("\n");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const ett = async (q, p = []) => (await db.query(q, p)).rows[0];
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
  } catch (e) {
    return { fel: e.code };
  } finally {
    await db.query("rollback to savepoint s");
  }
};
const satt = (nyckel, varde) => felkod(`insert into nav_setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [nyckel, JSON.stringify(varde)]);

try {
  await db.query("begin");
  const fore = await ett(`select count(*)::int as n from nav_setting where key like 'chatt.%'`);
  console.log(`  (före provet: ${fore.n} chatt-inställningar; ${FILER.join(" och ")} körs i transaktionen)`);
  await db.query(sql);
  await db.query(sql);
  ok("migrationerna går att köra två gånger", true);
  await db.query(`delete from nav_setting where key like 'chatt.%'`);

  const nyAnstalld = async (etikett) =>
    ett(
      `insert into employee (email, first_name, last_name, status, employment_type, auth_user_id)
       values ($1, 'Chatt', $2, 'active', 'permanent', gen_random_uuid()) returning id, auth_user_id`,
      [`chatt-prov-${etikett}@example.invalid`, `Prov${etikett}`],
    );
  const a = await nyAnstalld("a");
  const b = await nyAnstalld("b");

  console.log("\n\x1b[1mSpärren: chatten går inte att slå på utan avtal och godkänt prov\x1b[0m");
  {
    ok("ensam nekas chatt.pa = sant", (await satt("chatt.pa", true)) === "P0001");
    ok("chatt.pa = falskt går alltid", (await satt("chatt.pa", false)) === null);
    ok("avtalet går att sätta medan chatten är av", (await satt("chatt.avtal", true)) === null);
    ok("med avtal men utan prov: nekas", (await satt("chatt.pa", true)) === "P0001");
    await db.query(`insert into nav_chatt_prov (modell, avtryck, fragor, ratt) values ('claude-sonnet-5-5', 'prov-db', 30, 30)`);
    ok("ett prov som inte är godkänt räcker inte", (await satt("chatt.pa", true)) === "P0001");
    ok("ett prov kan inte godkännas utan vem och när", (await felkod(`update nav_chatt_prov set godkand = true where avtryck = 'prov-db'`)) === "23514");
    await db.query(`update nav_chatt_prov set godkand = true, godkand_av = $1, godkand_nar = now() where avtryck = 'prov-db'`, [a.id]);
    ok("med avtal och godkänt prov går den att slå på, utan något tak i inställningarna", (await satt("chatt.pa", true)) === null);
    ok("påslagen: avtalet går inte att ta tillbaka", (await satt("chatt.avtal", false)) === "P0001" && (await felkod(`delete from nav_setting where key = 'chatt.avtal'`)) === "P0001");
    ok("påslagen: modellen går inte att byta till en utan godkänt prov", (await satt("chatt.modell", "claude-opus-5-5")) === "P0001");
    ok("påslagen: modellen med godkänt prov går att välja", (await satt("chatt.modell", "claude-sonnet-5-5")) === null);
    ok("den går att stänga av, och då går avtalet att ta bort", (await satt("chatt.pa", false)) === null && (await felkod(`delete from nav_setting where key = 'chatt.avtal'`)) === null);
    ok("spärren rör inga andra inställningar", (await satt("prov.chatt-db", 1)) === null && (await felkod(`delete from nav_setting where key = 'prov.chatt-db'`)) === null);
  }

  console.log("\n\x1b[1mLoggen: bara personen läser sin egen text\x1b[0m");
  {
    const rad = (vem, o = {}) => db.query(
      `insert into nav_chatt_logg (employee_id, miljo, modell, stop_reason, kostnad_usd, fraga, svar, prov, nar) values ($1, $2, 'claude-sonnet-5-5', 'end_turn', $3, 'PROV fråga', 'PROV svar', $4, coalesce($5::timestamptz, now()))`,
      [vem, o.miljo ?? "prov-db", o.usd ?? 0.5, o.prov ?? false, o.nar ?? null],
    );
    await rad(a.id); await rad(a.id); await rad(b.id, { usd: 2 });
    await rad(a.id, { miljo: "annan-miljo", usd: 100 });
    await rad(a.id, { nar: "2020-01-01T10:00:00Z", usd: 100 });
    const minaA = await somAnvandare(a.auth_user_id, `select employee_id from nav_chatt_logg where miljo in ('prov-db', 'annan-miljo')`);
    ok("personen ser sina egna rader", Array.isArray(minaA) && minaA.length === 4 && minaA.every((r) => r.employee_id === a.id), JSON.stringify(minaA));
    const minaB = await somAnvandare(b.auth_user_id, `select employee_id from nav_chatt_logg where miljo in ('prov-db', 'annan-miljo')`);
    ok("och inte någon annans", Array.isArray(minaB) && minaB.length === 1 && minaB[0].employee_id === b.id, JSON.stringify(minaB));
    const skriv = await somAnvandare(a.auth_user_id, `insert into nav_chatt_logg (employee_id, miljo, modell, stop_reason) values ($1, 'prov-db', 'x', 'x') returning id`, [a.id]);
    ok("ingen inloggad får skriva i loggen", skriv.fel === "42501", JSON.stringify(skriv));
    const andra = await somAnvandare(a.auth_user_id, `update nav_chatt_logg set svar = 'x' where employee_id = $1 returning id`, [a.id]);
    ok("eller ändra i den", andra.fel === "42501", JSON.stringify(andra));
    const proven = await somAnvandare(a.auth_user_id, `select id from nav_chatt_prov`);
    ok("proven läses bara av servern", proven.fel === "42501", JSON.stringify(proven));

    console.log("\n\x1b[1mGränserna: dollar per person och för företaget, varje kalendermånad\x1b[0m");
    const utr = async (vem, miljo = "prov-db") => (await ett(`select public.nav_chatt_utrymme($2, $1) as u`, [vem, miljo])).u;
    const reservera = async (vem, max, miljo = "prov-db") => (await ett(`select public.nav_chatt_reservera($2, $1, 'claude-sonnet-5-5', $3, 'PROV fråga') as r`, [vem, miljo, max])).r;
    const nara = (x, y) => Math.abs(x - y) < 1e-9;
    await db.query(`delete from nav_chatt_tak`);
    const u0 = await utr(a.id);
    ok("utan en rad i nav_chatt_tak gäller standardvärdena: 10 dollar per person, 50 för företaget", u0.tak_person_usd === 10 && u0.tak_foretag_usd === 50, JSON.stringify(u0));
    ok("personens förbrukning är månadens dollar i miljön, bara hens egna rader", nara(u0.person_usd, 1), JSON.stringify(u0));
    ok("företagets är allas i miljön", nara(u0.foretag_usd, 3), JSON.stringify(u0));
    const tom = await utr(a.id, "ingen-miljo");
    ok("en annan miljö räknas för sig, och en tom ger noll", tom.person_usd === 0 && tom.foretag_usd === 0, JSON.stringify(tom));
    ok("gränserna är data: en rad per installation", (await felkod(`insert into nav_chatt_tak (person_usd, foretag_usd) values (14, 85)`)) === null && (await utr(a.id)).tak_person_usd === 14 && (await utr(a.id)).tak_foretag_usd === 85);
    ok("det går inte att lägga in en andra rad", (await felkod(`insert into nav_chatt_tak (person_usd, foretag_usd) values (1, 2)`)) === "23505");
    ok("en gräns kan inte vara noll, och företagets inte lägre än personens", (await felkod(`update nav_chatt_tak set person_usd = 0`)) === "23514" && (await felkod(`update nav_chatt_tak set foretag_usd = 5`)) === "23514");

    const r1 = await reservera(a.id, 0.12);
    const rad1 = await ett(`select employee_id, miljo, modell, stop_reason, kostnad_usd::float8 as usd, fraga from nav_chatt_logg where id = $1`, [r1.id]);
    ok("en fråga reserverar sin högsta kostnad innan Claude anropas", r1.ok === true && rad1?.employee_id === a.id && rad1.miljo === "prov-db" && rad1.stop_reason === "pagar" && nara(rad1.usd, 0.12) && rad1.fraga === "PROV fråga", JSON.stringify({ r1, rad1 }));
    ok("reservationen räknas direkt mot utrymmet", nara((await utr(a.id)).person_usd, 1.12) && nara((await utr(b.id)).foretag_usd, 3.12));
    await db.query(`update nav_chatt_tak set person_usd = 1.3, foretag_usd = 50`);
    const fore = (await ett(`select count(*)::int as n from nav_chatt_logg`)).n;
    const r2 = await reservera(a.id, 0.24);
    ok("ryms inte frågans högsta kostnad under personens gräns blir det nej, med skälet", r2.ok === false && r2.skal === "person" && !r2.id, JSON.stringify(r2));
    ok("och ingen rad skrivs", (await ett(`select count(*)::int as n from nav_chatt_logg`)).n === fore);
    const r3 = await reservera(a.id, 0.18);
    ok("precis upp till gränsen går", r3.ok === true, JSON.stringify(r3));
    await db.query(`update nav_chatt_tak set person_usd = 3, foretag_usd = 3.4`);
    const r4 = await reservera(b.id, 0.12);
    ok("företagets gräns stoppar också den som har eget utrymme kvar", r4.ok === false && r4.skal === "foretag", JSON.stringify(r4));
    ok("en annan miljö har sitt eget utrymme", (await reservera(b.id, 0.12, "prov-db-preview")).ok === true);
    ok("utan en högsta kostnad reserveras ingenting", (await felkod(`select public.nav_chatt_reservera('prov-db', $1, 'x', 0, 'PROV')`, [a.id])) === "P0001" && (await felkod(`select public.nav_chatt_reservera('prov-db', $1, 'x', null, 'PROV')`, [a.id])) === "P0001");

    const alla = (await ett(`select public.nav_chatt_forbrukning_alla('prov-db') as l`)).l;
    const radA = alla.find((x) => x.employee_id === a.id), radB = alla.find((x) => x.employee_id === b.id);
    ok("allas förbrukning i månaden, per person, med antal frågor", nara(radA?.usd ?? -1, 1.3) && radA.fragor === 4 && nara(radB?.usd ?? -1, 2) && radB.fragor === 1 && radA.namn === "Chatt Prova", JSON.stringify(alla));
    const rattigheter = await ett(`select
      bool_or(has_function_privilege(r, f, 'execute')) filter (where r <> 'service_role') as andra,
      bool_and(has_function_privilege(r, f, 'execute')) filter (where r = 'service_role') as server
      from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['public.nav_chatt_utrymme(text, uuid)', 'public.nav_chatt_reservera(text, uuid, text, numeric, text)', 'public.nav_chatt_forbrukning_alla(text)']) f`);
    ok("gränsernas funktioner får bara köras av servern", rattigheter.andra === false && rattigheter.server === true, JSON.stringify(rattigheter));
    const taket = await somAnvandare(a.auth_user_id, `select person_usd from nav_chatt_tak`);
    ok("och tabellen med gränserna läses bara av servern", taket.fel === "42501", JSON.stringify(taket));
    ok("den gamla räkningen i kronor och frågor per dag är borta", (await ett(`select to_regprocedure('public.nav_chatt_forbrukning(text,uuid)') is null as borta`)).borta === true);

    await db.query(`delete from employee where id = $1`, [b.id]);
    ok("en person som tas bort: raderna i loggen försvinner", (await ett(`select count(*)::int as n from nav_chatt_logg where employee_id = $1`, [b.id])).n === 0);
    await db.query(`delete from employee where id = $1`, [a.id]);
    ok("den som godkände ett prov kan tas bort, och provet står kvar", (await ett(`select count(*)::int as n from nav_chatt_prov where avtryck = 'prov-db' and godkand_av is null`)).n === 1);
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
