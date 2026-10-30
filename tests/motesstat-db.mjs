#!/usr/bin/env node
/**
 * Möten-statistiken, B1: vad ett "samtal" är, och vem som får se räkningen.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   TZ=UTC node --experimental-strip-types tests/motesstat-db.mjs
 *
 * `mote_samtal_vecka(p_fran, p_till)` (0263) är en SECURITY DEFINER-funktion och
 * ger en rad per säljare och vecka: `employee_id`, `vecka` (måndagen, svensk
 * tid) och `antal`. Ett samtal är ett utgående samtal (`direction = 'ut'`),
 * oavsett taltid (DESIGN §4). Fönstret är [p_fran, p_till] på svenska dygn,
 * båda inräknade.
 *
 * Provet visar:
 *   1. Veckan räknas på svensk tid, också över båda omställningarna: söndag
 *      23:59 CEST (21:59 UTC) är veckan före, måndag 00:00 CEST (22:00 UTC)
 *      den nya. Efter höstens omställning (25 okt 2026, 01:00 UTC) gäller
 *      UTC+1 och gränsen flyttar till 23:00 UTC.
 *   2. Bara utgående räknas (taltid 0 räknas, inkommande och samtal utan
 *      säljare gör det inte).
 *   3. Fönstret: ett samtal måndag 00:30 svensk tid på dagen p_fran pekar ut
 *      kommer med, ett söndag 23:30 dagen före gör det inte, och p_till är
 *      inräknad hela svenska dygnet.
 *   4. En säljare ser bara sin egen rad. B, som är manager_id för A men saknar
 *      chefsroll, SER A:s samtal i `phone_call` (RLS släpper igenom via
 *      leads_employee) men inte i funktionen.
 *   5. Var och en av rollerna admin, team_lead, ceo och sales_manager ser
 *      båda säljarnas rader. Admin ensam är beslutets poäng: policyn
 *      `phone_call_read` ger inte admin kollegors samtal.
 *   6. Anon och PUBLIC har inte EXECUTE, authenticated har. Utan inloggad
 *      anställd kastas felet.
 *   7. Prestanda: en chefsläsning av två veckor tar under 200 ms (som vy mot
 *      `phone_call_read` tog den cirka 2 s).
 *
 * 0263 läses från disk och körs inne i transaktionen (`create or replace`, så
 * provet går lika bra efter att migrationen körts på riktigt). Allt sker i en
 * transaktion som rullas tillbaka, ingen driftdata ändras, och frågorna går
 * alltid på de provanställdas id, aldrig på antalet rader i hela resultatet.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "supabase/migrations/0263_motesstat_samtal.sql",
);

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

// Läses först: saknas filen är provet rött innan databasen rörs.
const sql = readFileSync(MIGRATION, "utf8");

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

try {
  await db.query("begin");
  await db.query(sql);

  const nyAnstalld = async (etikett, roll = null) => {
    const { rows: [e] } = await db.query(
      `insert into employee (email, first_name, last_name, status, employment_type, auth_user_id)
       values ($1, 'Motesstat', $2, 'active', 'permanent', gen_random_uuid())
       returning id, auth_user_id`,
      [`motesstat-prov-${etikett}@example.invalid`, `Prov${etikett}`],
    );
    if (roll) {
      await db.query(`insert into employee_role (employee_id, role) values ($1::uuid, $2)`, [e.id, roll]);
    }
    return e;
  };
  const a = await nyAnstalld("a");
  const b = await nyAnstalld("b");
  const c = await nyAnstalld("c", "sales_manager");
  const chefer = {
    sales_manager: c,
    admin: await nyAnstalld("admin", "admin"),
    team_lead: await nyAnstalld("teamlead", "team_lead"),
    ceo: await nyAnstalld("ceo", "ceo"),
  };
  // B är A:s chef i organisationsträdet men har ingen chefsroll.
  await db.query(`update employee set manager_id = $2::uuid where id = $1::uuid`, [a.id, b.id]);

  let antalA = 0;
  const samtal = async (emp, riktning, startad, talk = 30) => {
    await db.query(
      `insert into phone_call (employee_id, direction, started_at, talk_seconds, duration_seconds)
       values ($1::uuid, $2, $3::timestamptz, $4::int, 60)`,
      [emp, riktning, startad, talk],
    );
    if (emp === a.id) antalA++;
  };

  // Januari 2027 (UTC+1). Måndag 2027-01-11 är veckostart.
  await samtal(a.id, "ut", "2027-01-11T10:00:00Z");
  await samtal(a.id, "ut", "2027-01-11T14:00:00Z", 0); // taltid 0 räknas
  await samtal(a.id, "ut", "2027-01-10T23:30:00Z"); // söndag kväll UTC = måndag 00:30 svensk tid
  await samtal(a.id, "ut", "2027-01-10T22:30:00Z"); // söndag 23:30 svensk tid: veckan före
  await samtal(a.id, "in", "2027-01-11T11:00:00Z"); // inkommande räknas inte
  await samtal(a.id, "ut", "2027-01-11T22:59:00Z"); // måndag 23:59 svensk tid
  await samtal(a.id, "ut", "2027-01-11T23:00:00Z"); // tisdag 00:00 svensk tid
  await samtal(c.id, "ut", "2027-01-12T09:00:00Z");
  await samtal(b.id, "ut", "2027-01-12T09:00:00Z");
  await db.query(
    `insert into phone_call (employee_id, direction, started_at, talk_seconds, duration_seconds)
     values (null, 'ut', '2027-01-11T09:00:00Z', 30, 60)`,
  ); // ingen säljare: räknas inte

  // Omställningarna. Vecka som text, så att datumet inte flyttas av tidszon.
  await samtal(a.id, "ut", "2026-03-28T23:30:00Z"); // lördag 23:30 UTC = söndag 00:30 CET, före 02:00-omställningen: veckan 03-23
  await samtal(a.id, "ut", "2026-06-14T21:59:00Z"); // söndag 23:59 CEST: veckan 06-08
  await samtal(a.id, "ut", "2026-06-14T22:00:00Z"); // måndag 00:00 CEST: veckan 06-15
  await samtal(a.id, "ut", "2026-10-25T22:30:00Z"); // söndag 23:30 CET (efter omställningen): veckan 10-19
  await samtal(a.id, "ut", "2026-10-25T23:30:00Z"); // måndag 00:30 CET: veckan 10-26

  const FUNK = `select employee_id::text, vecka::text, antal from public.mote_samtal_vecka($1::date, $2::date)
                 where employee_id = any($3::uuid[]) order by employee_id, vecka`;

  /** Kör som inloggad (auth_user_id eller okänt sub), i en savepoint som alltid rullas tillbaka. */
  const somAnvandare = async (sub, fraga, params) => {
    await db.query("savepoint s");
    try {
      await db.query("set local role authenticated");
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub, role: "authenticated" }),
      ]);
      return (await db.query(fraga, params)).rows;
    } finally {
      await db.query("rollback to savepoint s"); // återställer också rollen
    }
  };
  const tabell = (rader) => rader.map((r) => `${r.vecka}:${r.antal}`).join(" ");

  console.log("\n\x1b[1mVecka och antal, sedda av en chef\x1b[0m");
  {
    const rader = await somAnvandare(c.auth_user_id, FUNK, ["2027-01-04", "2027-01-17", [a.id]]);
    ok("A: söndag 22:30 UTC i veckan före (01-04:1), söndag 23:30 UTC = måndag 00:30 svensk tid i veckan 01-11 (:5)", tabell(rader) === "2027-01-04:1 2027-01-11:5", tabell(rader));
    const ingen = await somAnvandare(c.auth_user_id,
      `select count(*)::int as n from public.mote_samtal_vecka('2027-01-04', '2027-01-17') where employee_id is null`, []);
    ok("samtal utan säljare ger ingen rad", ingen[0].n === 0, `${ingen[0].n}`);
    const dst = await somAnvandare(c.auth_user_id, FUNK, ["2026-03-01", "2026-10-31", [a.id]]);
    ok("sommar- och vintertid: 03-23, 06-08, 06-15, 10-19 och 10-26, ett samtal var",
      tabell(dst) === "2026-03-23:1 2026-06-08:1 2026-06-15:1 2026-10-19:1 2026-10-26:1", tabell(dst));
  }

  console.log("\n\x1b[1mFönstret [p_fran, p_till]\x1b[0m");
  {
    const fran = await somAnvandare(c.auth_user_id, FUNK, ["2027-01-11", "2027-01-11", [a.id]]);
    ok("måndag 00:30 svensk tid på p_fran kommer med; p_till räknas hela dygnet (23:59 med, 00:00 nästa dygn ut)",
      tabell(fran) === "2027-01-11:4", tabell(fran));
    const fore = await somAnvandare(c.auth_user_id, FUNK, ["2027-01-04", "2027-01-10", [a.id]]);
    ok("söndag 23:30 svensk tid är med i fönstret som slutar söndagen, måndag 00:30 är det inte",
      tabell(fore) === "2027-01-04:1", tabell(fore));
    const utanfor = await somAnvandare(c.auth_user_id, FUNK, ["2027-02-01", "2027-02-28", [a.id]]);
    ok("fönster utan samtal ger inga rader", utanfor.length === 0, `${utanfor.length}`);
  }

  console.log("\n\x1b[1mEn säljare ser bara sin egen rad\x1b[0m");
  {
    const egna = await somAnvandare(a.auth_user_id, FUNK, ["2027-01-04", "2027-01-17", [a.id, b.id, c.id]]);
    ok("A ser bara sina egna två veckor", egna.length === 2 && egna.every((r) => r.employee_id === a.id), tabell(egna));
  }

  console.log("\n\x1b[1mRuling 1: policyn släpper igenom, funktionen gör det inte\x1b[0m");
  {
    const iTabellen = await somAnvandare(
      b.auth_user_id,
      `select count(*)::int as n from public.phone_call where employee_id = $1::uuid`,
      [a.id],
    );
    ok("B ser A:s samtal i phone_call (leads_employee)", iTabellen[0].n === antalA, `${iTabellen[0].n} av ${antalA}`);
    const iFunktionen = await somAnvandare(b.auth_user_id, FUNK, ["2027-01-04", "2027-01-17", [a.id, b.id]]);
    ok("men funktionen ger B bara B:s egen rad, ingen för A",
      iFunktionen.length === 1 && iFunktionen[0].employee_id === b.id, tabell(iFunktionen));
  }

  console.log("\n\x1b[1mVarje chefsroll ensam ser båda\x1b[0m");
  for (const [roll, person] of Object.entries(chefer)) {
    const rader = await somAnvandare(person.auth_user_id, FUNK, ["2027-01-04", "2027-01-17", [a.id, c.id]]);
    const perPerson = (id) => tabell(rader.filter((r) => r.employee_id === id));
    ok(`${roll}: A (01-04:1 01-11:5) och C (01-11:1)`,
      perPerson(a.id) === "2027-01-04:1 2027-01-11:5" && perPerson(c.id) === "2027-01-11:1",
      `A ${perPerson(a.id)} | C ${perPerson(c.id)}`);
  }

  console.log("\n\x1b[1mRättigheter och inloggning\x1b[0m");
  {
    const SIG = "public.mote_samtal_vecka(date,date)";
    const { rows: [r] } = await db.query(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('public', $1, 'execute') as public,
              has_function_privilege('authenticated', $1, 'execute') as authenticated`,
      [SIG],
    );
    ok("anon har inte EXECUTE", r.anon === false);
    ok("PUBLIC har inte EXECUTE", r.public === false);
    ok("authenticated har EXECUTE", r.authenticated === true);

    await db.query("savepoint s");
    let felet = null;
    try {
      await db.query("set local role authenticated");
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: "00000000-0000-4000-8000-000000000000", role: "authenticated" }),
      ]);
      await db.query(`select * from public.mote_samtal_vecka('2027-01-04', '2027-01-17')`);
    } catch (e) {
      felet = e;
    }
    await db.query("rollback to savepoint s");
    ok("utan inloggad anställd kastas felet (42501)",
      felet?.code === "42501" && /inloggad/.test(felet.message), felet ? `${felet.code} ${felet.message}` : "inget fel");
  }

  console.log("\n\x1b[1mPrestanda\x1b[0m");
  {
    const plan = await somAnvandare(
      c.auth_user_id,
      `explain (analyze, format json) select * from public.mote_samtal_vecka('2026-10-12', '2026-10-25')`,
      [],
    );
    const ms = plan[0]["QUERY PLAN"][0]["Execution Time"];
    console.log(`  Execution Time: ${ms} ms`);
    ok("en chefsläsning av två veckor tar under 200 ms", ms < 200, `${ms} ms`);
  }
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla prov gick igenom\x1b[0m");
process.exit(fel ? 1 : 0);
