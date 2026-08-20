#!/usr/bin/env node
/**
 * E1.8: vad offboardingen gor med oppna arenden.
 *
 *   node tests/offboarding-db.mjs
 *
 * Sjalva beslutet bor i `offboarda()` i personal/actions.ts, men skrivningarna
 * landar i databasen och det ar dar de kan ga fel: `hr_case_avslut` kraver att
 * `resolved_at` sats i samma andetag som status blir 'resolved', och en
 * uppdatering utan `is null`-filtret hade skrivit over en resolution som redan
 * fanns. Provet kor darfor exakt de tva satserna handlingen kor.
 *
 * Allt sker i en transaktion som rullas tillbaka. Ingen driftdata ror sig.
 */
import pg from "pg";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
await db.query("begin");

const { rows: [avslutad] } = await db.query(
  `insert into employee (email, first_name, last_name, status, employment_type)
   values ('offprov+a@clicknet.se','Prov','Testsson','active','permanent') returning id`,
);
const { rows: [chef] } = await db.query(
  `insert into employee (email, first_name, last_name, status, employment_type)
   values ('offprov+chef@clicknet.se','Chef','Testsson','active','permanent') returning id`,
);
const { rows: [kategori] } = await db.query(
  `select id, sla_hours from case_category order by sort limit 1`,
);

const nyttArende = async (agare, tilldelad, status) => {
  const { rows } = await db.query(
    `insert into hr_case (employee_id, created_by, category, subject, status, assigned_to,
                          sla_hours, due_at)
     values ($1::uuid, $1::uuid, $2, 'Provärende', $3, $4::uuid, $5::int,
             now() + ($5::int || ' hours')::interval)
     returning id`,
    [agare, kategori.id, status, tilldelad, kategori.sla_hours],
  );
  return rows[0].id;
};

// Fyra lagen: vantar pa hens svar, pagaende, nagon ANNANS arende som hen
// handlagger, och ett som redan ar avslutat.
await nyttArende(avslutad.id, null, "waiting");
const hosChefen = await nyttArende(avslutad.id, chef.id, "in_progress");
const andrasArende = await nyttArende(chef.id, avslutad.id, "new");
const redanKlart = await nyttArende(avslutad.id, null, "new");
await db.query(
  `update hr_case set status='resolved', resolved_at=now(), resolution='klart' where id=$1::uuid`,
  [redanKlart],
);

const slutdatum = "2026-08-20";

console.log("\n\x1b[1mOppna arenden stangs, och bara de\x1b[0m");
{
  const { rows: oppna } = await db.query(
    `select id from hr_case where employee_id=$1::uuid and resolved_at is null`,
    [avslutad.id],
  );
  ok("de tva oppna hittas, det avslutade raknas inte", oppna.length === 2, `${oppna.length}`);

  const { rowCount: stangda } = await db.query(
    `update hr_case set status='resolved', resolved_at=now(), resolution=$2
      where employee_id=$1::uuid and resolved_at is null`,
    [avslutad.id, `Avslutades automatiskt ${slutdatum} när anställningen avslutades.`],
  );
  ok("villkoret hr_case_avslut slapper igenom stangningen", stangda === 2, `${stangda} rader`);

  const { rows: kvar } = await db.query(
    `select count(*)::int as n from hr_case where employee_id=$1::uuid and resolved_at is null`,
    [avslutad.id],
  );
  ok("inget oppet arende kvar pa den avslutade", kvar[0].n === 0, `${kvar[0].n}`);

  // Utan `is null`-filtret hade den har raden fatt en ny resolution, och
  // motiveringen till ett avslut som skedde i mars hade blivit "anstallningen
  // avslutades i augusti".
  const { rows: klart } = await db.query(
    `select resolution from hr_case where id=$1::uuid`, [redanKlart],
  );
  ok("ett redan avslutat arende skrivs inte over", klart[0].resolution === "klart",
    klart[0].resolution);
}

console.log("\n\x1b[1mTilldelningar gar tillbaka till inkorgen\x1b[0m");
{
  const { rowCount: aterlamnade } = await db.query(
    `update hr_case set assigned_to=null where assigned_to=$1::uuid and resolved_at is null`,
    [avslutad.id],
  );
  ok("arendet hen handlade blir otilldelat", aterlamnade === 1, `${aterlamnade}`);

  // Det ror en annan anstalld. Att stanga det hade tagit bort nagon annans
  // arende for att fel person slutade.
  const { rows: andras } = await db.query(
    `select status, resolved_at, assigned_to from hr_case where id=$1::uuid`, [andrasArende],
  );
  ok("men det stangs inte — det ar nagon annans arende",
    andras[0].status === "new" && andras[0].resolved_at === null && andras[0].assigned_to === null);

  const { rows: chefens } = await db.query(
    `select assigned_to from hr_case where id=$1::uuid`, [hosChefen],
  );
  ok("och andras tilldelningar rors inte", chefens[0].assigned_to === chef.id);
}

await db.query("rollback");
await db.end();

console.log(fel === 0
  ? "\n\x1b[32mAlla kontroller godkanda. Allt rullat tillbaka.\x1b[0m\n"
  : `\n\x1b[31m${fel} kontroll(er) underkanda.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
