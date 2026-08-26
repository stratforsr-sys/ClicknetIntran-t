#!/usr/bin/env node
/**
 * Volymtrappan och periodstangningen mot den RIKTIGA databasen (0035).
 *
 * Motorn provas i tests/provision-motor.mjs. Det har provet stallet fragan till
 * databasen i stallet: reglerna nedan ligger i triggrar och villkor, inte i
 * koden, och galler darfor aven service role. En regel som bara finns i en
 * server action ar en regel nasta server action inte kanner till.
 *
 * Fyra saker star pa spel:
 *
 *   1. EN PERIOD STANGS EFTER MANADENS SLUT. En manad som stangs den 20:e
 *      stanger ute de order som tecknas den 25:e, och de har ingen vag in igen.
 *   2. EN STANGD PERIOD OPPNAS ALDRIG. Varken genom delete eller genom att
 *      statusen backas.
 *   3. EN TROSKEL HAR EN GALLANDE RAD. Tva oppna rader for niva 10 later
 *      sorteringsordningen avgora vad nagon far betalt.
 *   4. MOTORNS POSTER AR IDEMPOTENTA. En attest som faller halvvags maste ga
 *      att kora om utan att nagon far dubbelt betalt.
 *
 * ALLT RULLAS TILLBAKA. Provet skriver inget bestaende.
 *
 *   node tests/provision-period-db.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL saknas.");
  process.exit(1);
}

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query("begin");

let fel = 0;

const anstalld = (await c.query("select id from employee limit 1")).rows[0]?.id;
if (!anstalld) {
  console.error("Ingen anstalld i databasen — provet behover en rad att peka pa.");
  process.exit(1);
}

/**
 * `vantatFel` ar en bit av felmeddelandet eller villkorsnamnet. Star det null
 * ska kommandot ga igenom.
 */
async function prova(namn, sql, params, vantatFel = null) {
  await c.query("savepoint s");
  try {
    await c.query(sql, params);
    if (vantatFel) {
      console.log(`  \x1b[31m✗\x1b[0m ${namn} — gick igenom men skulle nekats`);
      fel++;
    } else {
      console.log(`  \x1b[32m✓\x1b[0m ${namn}`);
    }
  } catch (e) {
    await c.query("rollback to savepoint s");
    if (vantatFel && e.message.includes(vantatFel)) {
      console.log(`  \x1b[32m✓\x1b[0m ${namn}`);
    } else {
      console.log(`  \x1b[31m✗\x1b[0m ${namn} — ${e.message}`);
      fel++;
    }
  }
}

// Manaderna raknas ur dagens datum. Ett hardkodat datum hade blivit fel
// provsvar den dag nagon kor provet ett halvar senare.
//
// SOM TEXT UR DATABASEN, inte via Date.toISOString(). `pg` ger ett `date` som
// en JS-Date pa lokal midnatt, och toISOString flyttar den till UTC — i svensk
// sommartid tva timmar bakat, alltsa till dagen innan. Den 1 juli blev
// "2026-06-30", och villkoret `commission_period_manad` fallde. Samma falla som
// `svensktDatum()` i klocka.ts finns till for.
//
// FORRA MANADEN ar den SENASTE avslutade manad som inte redan ar faststalld.
//
// Provet hette forr just "forra manaden", rakt av. Det holl sa lange
// `commission_period` var tom, och gick sonder den dag beslutsfattaren stangde
// sin forsta riktiga period: provet forsokte lagga in en rad som redan fanns och
// dog pa primarnyckeln. Rott utan att nagot var trasigt — samma slags fel som
// rubriken i tests/rls.mjs varnar for, fast at skrivhallet.
//
// Vilken avslutad manad som helst provar samma gren i triggern (manadsslutet har
// passerat), sa provet tappar ingenting pa att backa till den narmast
// foregaende lediga. Randen at andra hallet — att INNEVARANDE manad nekas —
// provas fortfarande pa den riktiga manaden nedan, och det ar den randen som
// betyder nagot.
const [{ forra, denna }] = (
  await c.query(
    "select to_char(m, 'YYYY-MM-DD') forra, to_char(date_trunc('month', now()), 'YYYY-MM-DD') denna" +
      " from generate_series(" +
      "   date_trunc('month', now()) - interval '1 month'," +
      "   date_trunc('month', now()) - interval '60 months'," +
      "   interval '-1 month') m" +
      " where not exists (select 1 from commission_period p where p.period_month = m::date)" +
      " limit 1",
  )
).rows;

const forraManaden = forra;
const dennaManaden = denna;

console.log("\n\x1b[1mPerioden stangs efter manadens slut\x1b[0m");
await prova(
  "innevarande manad kan inte faststallas an",
  "insert into commission_period (period_month, closed_by) values ($1, $2)",
  [dennaManaden, anstalld],
  "kan inte faststallas fore",
);
await prova(
  "forra manaden gar att faststalla",
  "insert into commission_period (period_month, closed_by) values ($1, $2)",
  [forraManaden, anstalld],
);
await prova(
  "en period ar en manad, inte ett datum mitt i",
  "insert into commission_period (period_month, closed_by) values (date '2026-07-15', $1)",
  [anstalld],
  "period_month",
);

console.log("\n\x1b[1mEn stangd period oppnas aldrig\x1b[0m");
await prova(
  "den raderas inte",
  "delete from commission_period where period_month = $1",
  [forraManaden],
  "oppnas inte igen",
);
await prova(
  "utbetald kraver bade vem och nar",
  "update commission_period set status = 'utbetald' where period_month = $1",
  [forraManaden],
  "commission_period_utbetald",
);
await prova(
  "faststalld -> utbetald gar",
  "update commission_period set status = 'utbetald', paid_by = $2, paid_at = now() where period_month = $1",
  [forraManaden, anstalld],
);
await prova(
  "utbetald -> faststalld nekas",
  "update commission_period set status = 'faststalld', paid_by = null, paid_at = null where period_month = $1",
  [forraManaden],
  "bara ga fran faststalld till utbetald",
);

console.log("\n\x1b[1mTrappan: en gallande rad per troskel\x1b[0m");

// Samma skal som forraManaden ovan: trappan var tom nar provet skrevs, och
// niva 10 var darfor ledig. Den ar det inte langre — bestallaren har fyllt i
// 5/10/15/20. En troskel ovanfor allt som kan bli en riktig niva later provet
// prova indexet i stallet for att krocka med det.
const provTroskel = Number(
  (await c.query("select coalesce(max(threshold), 0) + 1000 t from commission_bonus_level")).rows[0].t,
);

await prova(
  "en niva gar att lagga in",
  "insert into commission_bonus_level (threshold, amount, unit, valid_from) values ($1, 5500, 'amount_fixed', date '2026-08-01')",
  [provTroskel],
);
await prova(
  "tva OPPNA rader for samma troskel nekas",
  "insert into commission_bonus_level (threshold, amount, unit, valid_from) values ($1, 6000, 'amount_fixed', date '2026-09-01')",
  [provTroskel],
  "commission_bonus_level_oppen_idx",
);
// Tva kommandon i ett anrop, och darfor utan platshallare: `pg` vagrar skicka
// flera satser i en forberedd fraga. `provTroskel` ar ett tal raknat ur
// databasen och gar inte att smuggla nagot genom.
await prova(
  "en stangd rad plus en oppen ar hela versioneringen",
  `update commission_bonus_level set valid_to = date '2026-09-01' where threshold = ${provTroskel};` +
    ` insert into commission_bonus_level (threshold, amount, unit, valid_from) values (${provTroskel}, 6000, 'amount_fixed', date '2026-09-01')`,
  [],
);
await prova(
  "noll dagars giltighet nekas",
  "insert into commission_bonus_level (threshold, amount, unit, valid_from, valid_to) values (15, 9000, 'amount_fixed', date '2026-09-01', date '2026-09-01')",
  [],
  "commission_bonus_level_period",
);
await prova(
  "en okand bonusform nekas",
  "insert into commission_bonus_level (threshold, amount, unit, valid_from) values (20, 1, 'gissning', date '2026-09-01')",
  [],
  "unit",
);

console.log("\n\x1b[1mMotorns poster i huvudboken\x1b[0m");
await prova(
  "en motor-post utan referens nekas",
  "insert into commission_entry (employee_id, period_month, amount, source, entered_by) values ($1, $2, 100, 'motor', $1)",
  [anstalld, forraManaden],
  "commission_entry_kalla",
);
await prova(
  "med referens gar den in",
  "insert into commission_entry (employee_id, period_month, amount, source, external_ref, entered_by) values ($1, $2, 100, 'motor', 'prov-0035:1', $1)",
  [anstalld, forraManaden],
);
await prova(
  "samma referens tva ganger nekas — det ar det som gor attesten idempotent",
  "insert into commission_entry (employee_id, period_month, amount, source, external_ref, entered_by) values ($1, $2, 100, 'motor', 'prov-0035:1', $1)",
  [anstalld, forraManaden],
  "commission_entry_extern_idx",
);

await c.query("rollback");

// Kontrollera att ingenting blev kvar. En provsvit som skriver i produktionen
// utan att stada ar varre an ingen provsvit.
//
// FRAGA PA PROVETS EGNA RADER, inte pa hela tabellen. Kontrollen rakande forr
// varenda rad i `commission_period` och krave noll — vilket bara stamde sa lange
// ingen anvant funktionen. Andamalet ar att provets skrivningar ar borta, inte
// att bolaget aldrig stangt en period. Samma regel som star overst i
// tests/rls.mjs, och det ar tredje gangen den bits.
const kvar = (
  await c.query(
    "select (select count(*) from commission_period where period_month = $1) p," +
      " (select count(*) from commission_bonus_level where threshold = $2) n," +
      " (select count(*) from commission_entry where external_ref like 'prov-0035%') e",
    [forraManaden, provTroskel],
  )
).rows[0];

console.log("\n\x1b[1mStadningen\x1b[0m");
const stadat = Number(kvar.p) === 0 && Number(kvar.n) === 0 && Number(kvar.e) === 0;
console.log(
  `  ${stadat ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} allt rullat tillbaka  perioder ${kvar.p}, provnivaer ${kvar.n}, provposter ${kvar.e}`,
);
if (!stadat) fel++;

await c.end();

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkanda.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
