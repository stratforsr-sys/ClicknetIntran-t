#!/usr/bin/env node
/**
 * 0046: vad `ta_bort_anstalld()` gor, och vad den later vara.
 *
 *   node tests/radering-db.mjs
 *
 * Provet kor mot den RIKTIGA databasen och inte mot en attrapp, eftersom hela
 * funktionen ar en fraga till schemat: den laser pg_constraint, slar av
 * sparrtriggrar och litar pa att de frammande nycklarna sager nej nar de ska.
 * En attrapp hade provat attrappens schema.
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

const nyAnstalld = async (fornamn, epost) => {
  const { rows } = await db.query(
    `insert into employee (email, first_name, last_name, status, employment_type)
     values ($1,$2,'Testsson','active','permanent') returning id`,
    [epost, fornamn],
  );
  return rows[0].id;
};

try {
  // ---------------------------------------------------------------------------
  console.log("\nFall 1 · ingenting pekar pa personen — raden ska forsvinna helt");
  // ---------------------------------------------------------------------------
  const ren = await nyAnstalld("Ren", "radprov+ren@clicknet.se");

  const foreRen = await db.query("select * from referenser_till_anstalld($1)", [ren]);
  ok("forhandsvisningen ar tom", foreRen.rows.length === 0, `${foreRen.rows.length} rader`);

  const svarRen = (await db.query("select ta_bort_anstalld($1) as r", [ren])).rows[0].r;
  ok("raderades_helt = true", svarRen.raderades_helt === true);

  const kvarRen = await db.query("select count(*)::int as n from employee where id=$1", [ren]);
  ok("ingen rad kvar i employee", kvarRen.rows[0].n === 0);

  // ---------------------------------------------------------------------------
  console.log("\nFall 2 · nagot pekar pa personen — raden ska bli en namnskylt");
  // ---------------------------------------------------------------------------
  const skyltad = await nyAnstalld("Skylt", "radprov+skylt@clicknet.se");
  const chef = await nyAnstalld("Chef", "radprov+chef@clicknet.se");

  // En nyhet hen skrivit. `news_post.author_id` ar not null utan on delete-regel
  // — precis den sortens rad som tvingar fram en skylt.
  await db.query(
    `insert into news_post (title, slug, body_md, author_id, status)
     values ('Provnyhet','radprov-nyhet','Text',$1,'draft')`,
    [skyltad],
  );
  // En stampling. Den ska DAREMOT forsvinna: arbetstiden ar personens egen.
  await db.query(
    `insert into time_event (employee_id, kind, occurred_at) values ($1,'in', now())`,
    [skyltad],
  );

  const fore = await db.query(
    "select * from referenser_till_anstalld($1) order by tabell", [skyltad]);
  const stampling = fore.rows.find((r) => r.tabell === "time_event");
  const nyhet = fore.rows.find((r) => r.tabell === "news_post");
  ok("stamplingen listas som 'raderas'", stampling?.atgard === "raderas");
  ok("nyheten listas som 'behalls'", nyhet?.atgard === "behalls");

  const svar = (await db.query("select ta_bort_anstalld($1) as r", [skyltad])).rows[0].r;
  ok("raderades_helt = false", svar.raderades_helt === false);
  ok("kvarvarande > 0", Number(svar.kvarvarande) > 0, `${svar.kvarvarande}`);

  const rad = (await db.query(
    `select first_name, last_name, email, status, removed_at, auth_user_id,
            team_id, manager_id, employee_number, birth_year
       from employee where id=$1`, [skyltad])).rows[0];
  ok("raden finns kvar", Boolean(rad));
  ok("namnet bar tillagget", rad.last_name.endsWith("(borttagen anställd)"), rad.last_name);
  ok("fornamnet ar orort", rad.first_name === "Skylt");
  ok("removed_at ar satt", rad.removed_at !== null);
  ok("status ar offboarded — osynlig i alla valjare", rad.status === "offboarded");
  ok("e-posten ar oatkomlig", rad.email.endsWith("@clicknet.invalid"), rad.email);
  ok(
    "personuppgifterna ar borta",
    [rad.auth_user_id, rad.team_id, rad.manager_id, rad.employee_number, rad.birth_year]
      .every((v) => v === null),
  );

  const stamplingarKvar = await db.query(
    "select count(*)::int as n from time_event where employee_id=$1", [skyltad]);
  ok("stamplingen ar raderad", stamplingarKvar.rows[0].n === 0);

  const nyhetKvar = await db.query(
    "select count(*)::int as n from news_post where author_id=$1", [skyltad]);
  ok("nyheten star kvar och pekar pa skylten", nyhetKvar.rows[0].n === 1);

  // ---------------------------------------------------------------------------
  console.log("\nFall 3 · en skylt gar inte att radera en gang till");
  // ---------------------------------------------------------------------------
  // Savepoint: ett vantat undantag avbryter annars hela transaktionen, och da
  // gar inga kontroller efterat att kora.
  await db.query("savepoint andra_forsoket");
  let vagrade = false;
  try {
    await db.query("select ta_bort_anstalld($1)", [skyltad]);
  } catch {
    vagrade = true;
    await db.query("rollback to savepoint andra_forsoket");
  }
  ok("andra forsoket avvisas", vagrade);

  // ---------------------------------------------------------------------------
  console.log("\nEfterat");
  // ---------------------------------------------------------------------------
  const avslagna = await db.query(
    "select count(*)::int as n from pg_trigger where not tgisinternal and tgenabled='D'");
  ok("inga sparrtriggrar lamnades avslagna", avslagna.rows[0].n === 0, `${avslagna.rows[0].n}`);

  const foraldralosa = await db.query(`
    select count(*)::int as n from news_post np
    left join employee e on e.id = np.author_id where e.id is null`);
  ok("inga foraldralosa rader", foraldralosa.rows[0].n === 0);
} finally {
  await db.query("rollback");
  await db.end();
}

console.log(fel === 0 ? "\nAlla prov gick igenom.\n" : `\n${fel} prov misslyckades.\n`);
process.exit(fel === 0 ? 0 : 1);
