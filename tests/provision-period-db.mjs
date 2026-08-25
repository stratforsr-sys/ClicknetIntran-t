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
const [{ forra, denna }] = (
  await c.query(
    "select to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM-DD') forra," +
      " to_char(date_trunc('month', now()), 'YYYY-MM-DD') denna",
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
await prova(
  "en niva gar att lagga in",
  "insert into commission_bonus_level (threshold, amount, unit, valid_from) values (10, 5500, 'amount_fixed', date '2026-08-01')",
  [],
);
await prova(
  "tva OPPNA rader for samma troskel nekas",
  "insert into commission_bonus_level (threshold, amount, unit, valid_from) values (10, 6000, 'amount_fixed', date '2026-09-01')",
  [],
  "commission_bonus_level_oppen_idx",
);
await prova(
  "en stangd rad plus en oppen ar hela versioneringen",
  "update commission_bonus_level set valid_to = date '2026-09-01' where threshold = 10;" +
    " insert into commission_bonus_level (threshold, amount, unit, valid_from) values (10, 6000, 'amount_fixed', date '2026-09-01')",
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
const kvar = (
  await c.query(
    "select (select count(*) from commission_period) p," +
      " (select count(*) from commission_bonus_level where amount in (5500, 6000)) n," +
      " (select count(*) from commission_entry where external_ref like 'prov-0035%') e",
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
