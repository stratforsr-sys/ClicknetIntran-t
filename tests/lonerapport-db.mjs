/**
 * Provar oforanderligheten i 0012 mot riktig databas — inuti en transaktion
 * som rullas tillbaka. Triggrar utloses anda, och en attesterad provperiod
 * gar med flit inte att stada bort efterat.
 */
import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query("begin");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const nekar = async (sql, params = []) => {
  try {
    await c.query("savepoint s");
    await c.query(sql, params);
    await c.query("release savepoint s");
    return null;
  } catch (e) {
    await c.query("rollback to savepoint s");
    return e.message;
  }
};

const { rows: personer } = await c.query("select id from employee limit 1");
if (personer.length === 0) {
  console.log("Ingen anstalld i databasen — hoppar over.");
  await c.query("rollback");
  await c.end();
  process.exit(0);
}
const anstalld = personer[0].id;

const { rows: p } = await c.query(
  "insert into payroll_period (period_start, period_end) values ('2019-01-01','2019-01-31') returning id",
);
const period = p[0].id;

console.log("\n\x1b[1mUtkast gar att arbeta med\x1b[0m");
{
  const felA = await nekar(
    "insert into payroll_row (period_id, employee_id, worked_minutes) values ($1,$2,600)",
    [period, anstalld],
  );
  ok("underlag kan skrivas i utkast", felA === null, felA ?? "");

  const felB = await nekar("update payroll_row set worked_minutes = 700 where period_id = $1", [period]);
  ok("och andras i utkast", felB === null, felB ?? "");

  const felC = await nekar(
    "insert into payroll_adjustment (period_id, employee_id, minutes, reason, created_by) values ($1,$2,10,'prov',$2)",
    [period, anstalld],
  );
  ok("men justeringspost nekas fore attest", felC !== null);
}

console.log("\n\x1b[1mAC-2.15: attesten kraver en manniska\x1b[0m");
{
  const utan = await nekar("update payroll_period set status = 'attested' where id = $1", [period]);
  ok("attest utan attestant nekas", utan !== null);

  const med = await nekar(
    "update payroll_period set status='attested', attested_at=now(), attested_by=$2 where id = $1",
    [period, anstalld],
  );
  ok("attest med attestant och tidpunkt gar igenom", med === null, med ?? "");
}

console.log("\n\x1b[1mAC-2.16: attesterad period ar oforanderlig\x1b[0m");
{
  const rad = await nekar("update payroll_row set worked_minutes = 999 where period_id = $1", [period]);
  ok("underlaget kan inte skrivas om", rad !== null);

  const bort = await nekar("delete from payroll_row where period_id = $1", [period]);
  ok("och inte raderas", bort !== null);

  const per = await nekar("update payroll_period set period_end = '2019-02-28' where id = $1", [period]);
  ok("perioden kan inte flyttas", per !== null);

  const radera = await nekar("delete from payroll_period where id = $1", [period]);
  ok("perioden kan inte tas bort", radera !== null);

  const just = await nekar(
    "insert into payroll_adjustment (period_id, employee_id, minutes, reason, created_by) values ($1,$2,-30,'ratt sent inlamnad',$2)",
    [period, anstalld],
  );
  ok("men en justeringspost gar in", just === null, just ?? "");

  const andra = await nekar("update payroll_adjustment set minutes = 0 where period_id = $1", [period]);
  ok("justeringen gar inte att skriva om", andra !== null);

  const tabort = await nekar("delete from payroll_adjustment where period_id = $1", [period]);
  ok("och inte att ta bort", tabort !== null);
}

console.log("\n\x1b[1mAC-2.18: exportkolumnerna finns som konfiguration\x1b[0m");
{
  const { rows } = await c.query("select count(*)::int as n from payroll_export_column where active");
  ok("standardkolumner ar seedade", rows[0].n >= 6, `${rows[0].n} kolumner`);

  const dubbel = await nekar(
    "insert into payroll_export_column (sort, header, field) values (1,'Dubblett','name')",
  );
  ok("tva kolumner kan inte dela plats", dubbel !== null);

  const okant = await nekar(
    "insert into payroll_export_column (sort, header, field) values (99,'Lonebelopp','amount')",
  );
  ok("ett faltnamn utanfor listan nekas — inga belopp (AC-2.17)", okant !== null);
}

await c.query("rollback");
await c.end();

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkanda. Allt rullat tillbaka.\x1b[0m\n" : `\n\x1b[31m${fel} underkanda.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
