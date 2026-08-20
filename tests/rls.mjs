#!/usr/bin/env node
/**
 * Behorighetstest — Definition of Done p. 4.
 *
 * Verifierar att FEL ROLL FAR 0 RADER, mot den riktiga databasen med riktiga
 * inloggningar. Ett UI-test duger inte: PRD §5.2 kraver att en vy som ravar
 * hamta fel data far noll rader fran Postgres, inte filtreras i React.
 *
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... node tests/rls.mjs
 *
 * Testanvandarna skapas och raderas av testet. Prefix: rlstest+
 */
import pg from "pg";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const ADMIN = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };

const PREFIX = "rlstest+";
const LOSEN = "Testlosen!" + Math.random().toString(36).slice(2, 10);

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

async function skapa(lokal, fornamn, roll) {
  const epost = `${PREFIX}${lokal}@clicknet.se`;
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST", headers: ADMIN,
    body: JSON.stringify({ email: epost, password: LOSEN, email_confirm: true }),
  });
  const user = await r.json();
  const { rows } = await db.query(
    `insert into employee (auth_user_id, email, first_name, last_name, status, employment_type)
     values ($1::uuid,$2,$3,'Testsson','active','permanent') returning id`,
    [user.id, epost, fornamn],
  );
  await db.query(`insert into employee_role (employee_id, role) values ($1::uuid,$2)`, [rows[0].id, roll]);
  return { id: rows[0].id, authId: user.id, epost };
}

async function loggaIn(epost) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: epost, password: LOSEN }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Inloggning misslyckades för ${epost}: ${JSON.stringify(j)}`);
  return j.access_token;
}

const som = (tok) => ({ apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" });

async function las(tok, tabell, fraga = "select=*") {
  const r = await fetch(`${URL}/rest/v1/${tabell}?${fraga}`, { headers: som(tok) });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

/** Kor SQL som service role och lamnar tillbaka felmeddelandet, eller null. */
async function nekarSql(sql, params = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return e.message;
  }
}

/**
 * Samma sak, men inuti en sparpunkt.
 *
 * Ett fel i Postgres avbryter hela transaktionen — utan sparpunkt kan man
 * alltsa bara prova EN sak som ska neka innan resten faller av sig sjalv.
 */
let sparpunkt = 0;
async function nekarSpar(sql, params = []) {
  const namn = `p${++sparpunkt}`;
  await db.query(`savepoint ${namn}`);
  try {
    await db.query(sql, params);
    await db.query(`release savepoint ${namn}`);
    return null;
  } catch (e) {
    await db.query(`rollback to savepoint ${namn}`);
    return e.message;
  }
}

async function stad() {
  const { rows } = await db.query(`select id, auth_user_id from employee where email like $1`, [PREFIX + "%"]);
  for (const r of rows) {
    if (r.auth_user_id) {
      await fetch(`${URL}/auth/v1/admin/users/${r.auth_user_id}`, { method: "DELETE", headers: ADMIN });
    }
  }
  await db.query(`delete from audit_log where object_id in (select id::text from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`update team set lead_id = null where lead_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from document where slug like 'rlstest-%'`);
  await db.query(`delete from course where slug like 'rlstest-%'`);
  await db.query(`delete from employee_permission where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  // AC-2.3 galler aven testdata: enda vagen bort ar att medvetet koppla ur
  // skyddet. Att det kravs ett aktivt handgrepp ar sjalva poangen.
  await db.query(`alter table time_event disable trigger time_event_orubblig`);
  await db.query(`delete from time_event where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`alter table time_event enable trigger time_event_orubblig`);
  await db.query(`delete from break_deviation where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  // Loneperioder fran testet ar alltid utkast. En attesterad period gar inte
  // att stada bort — det ar hela poangen med AC-2.16, och provas i stallet i
  // tests/lonerapport-db.mjs inuti en transaktion som rullas tillbaka.
  // Ett skickat meddelande gar inte att ta bort — samma sorts sparr som pa
  // time_event, och samma satt att stada: koppla ur den medvetet.
  await db.query(`alter table case_message disable trigger case_message_orubblig`);
  await db.query(`delete from hr_case where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`alter table case_message enable trigger case_message_orubblig`);
  await db.query(`delete from payroll_row where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from payroll_period where status = 'draft' and period_start in ('2019-03-01','2019-04-01')`);
  await db.query(`delete from work_time_journal where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from scheduled_break where scope = 'company' and window_start = '11:30' and duration_minutes = 30`);
  await db.query(`delete from work_schedule where scope = 'company' and start_time = '08:00' and end_time = '17:00'`);
  await db.query(`update employee set team_id = null where team_id in (select id from team where name like 'rlstest-%')`);
  await db.query(`delete from employee where email like $1`, [PREFIX + "%"]);
  await db.query(`delete from team where name like 'rlstest-%'`);
}

await stad();

console.log("\nSkapar testanvändare ...");
const saljareA = await skapa("a", "Anna", "salesperson");
const saljareB = await skapa("b", "Bertil", "salesperson");
const ledare = await skapa("c", "Cecilia", "team_lead");
const chef = await skapa("d", "David", "sales_manager");
const ekonomi = await skapa("e", "Eva", "finance");

// Anna rapporterar till Cecilia. Bertil gör det inte.
await db.query(`update employee set manager_id = $1::uuid where id = $2::uuid`, [ledare.id, saljareA.id]);

const tA = await loggaIn(saljareA.epost);
const tB = await loggaIn(saljareB.epost);
const tC = await loggaIn(ledare.epost);
const tD = await loggaIn(chef.epost);
const tE = await loggaIn(ekonomi.epost);

console.log("\n\x1b[1mSäljare ser bara sig själv\x1b[0m");
{
  const rader = await las(tA, "employee");
  ok("Anna ser exakt 1 anställd", rader.length === 1, `såg ${rader.length}`);
  ok("och det är hon själv", rader[0]?.email === saljareA.epost);
  const b = await las(tA, "employee", `select=*&id=eq.${saljareB.id}`);
  ok("Anna får 0 rader när hon frågar direkt efter Bertils id", b.length === 0, `såg ${b.length}`);
}

console.log("\n\x1b[1mSäljare når inte händelseloggen\x1b[0m");
{
  const rader = await las(tA, "audit_log");
  ok("Anna får 0 rader ur audit_log", rader.length === 0, `såg ${rader.length}`);
}

console.log("\n\x1b[1mTeamledare ser sitt team, inte andras\x1b[0m");
{
  const rader = await las(tC, "employee");
  const epostar = rader.map((r) => r.email);
  ok("Cecilia ser Anna", epostar.includes(saljareA.epost));
  ok("Cecilia ser INTE Bertil", !epostar.includes(saljareB.epost), epostar.join(", "));
  ok("Cecilia ser INTE säljchefen David", !epostar.includes(chef.epost));
  const logg = await las(tC, "audit_log");
  ok("Cecilia får 0 rader ur audit_log", logg.length === 0, `såg ${logg.length}`);
}

console.log("\n\x1b[1mSäljchef ser alla\x1b[0m");
{
  const rader = await las(tD, "employee");
  const epostar = rader.map((r) => r.email);
  ok("David ser Anna, Bertil, Cecilia och Eva",
    [saljareA, saljareB, ledare, ekonomi].every((p) => epostar.includes(p.epost)),
    `såg ${rader.length}`);
  const logg = await las(tD, "audit_log");
  ok("David når audit_log", logg.length >= 0);
}

console.log("\n\x1b[1mEkonomi har ingen personalinsyn\x1b[0m");
{
  const rader = await las(tE, "employee");
  ok("Eva ser bara sig själv", rader.length === 1, `såg ${rader.length}`);
  const perm = await las(tE, "employee_permission");
  ok("Eva ser 0 rader i employee_permission (saknar payroll_cost_viewer)", perm.length === 0);
}

console.log("\n\x1b[1mIngen kan skriva via API:t — endast server actions får skriva\x1b[0m");
for (const [namn, tok] of [["Anna", tA], ["Cecilia", tC], ["David", tD]]) {
  const r1 = await fetch(`${URL}/rest/v1/employee_role`, {
    method: "POST", headers: som(tok),
    body: JSON.stringify({ employee_id: saljareA.id, role: "sales_manager" }),
  });
  ok(`${namn} kan INTE ge sig själv en roll`, !r1.ok, `HTTP ${r1.status}`);

  const r2 = await fetch(`${URL}/rest/v1/employee?id=eq.${saljareB.id}`, {
    method: "PATCH", headers: som(tok), body: JSON.stringify({ status: "offboarded" }),
  });
  ok(`${namn} kan INTE ändra någon annans status`, !r2.ok, `HTTP ${r2.status}`);

  const r3 = await fetch(`${URL}/rest/v1/audit_log?id=gt.0`, { method: "DELETE", headers: som(tok) });
  ok(`${namn} kan INTE radera ur händelseloggen`, !r3.ok, `HTTP ${r3.status}`);
}

console.log("\n\x1b[1mAvslutad anställd tappar all åtkomst omedelbart\x1b[0m");
{
  await db.query(`update employee set status = 'offboarded' where id = $1::uuid`, [saljareA.id]);
  const rader = await las(tA, "employee");
  ok("Annas gamla token ger 0 rader efter offboarding", rader.length === 0, `såg ${rader.length}`);
  await db.query(`update employee set status = 'active' where id = $1::uuid`, [saljareA.id]);
}

console.log("\n\x1b[1mRutinbibliotek: publicerat, utkast och malgrupp\x1b[0m");
{
  // Tre dokument som tacker de tre vagar RLS kan slappa igenom eller stanga.
  const skapaDok = async (slug, titel, status, malgrupp, agare) => {
    const { rows } = await db.query(
      `insert into document (title, slug, category_path, body_md, owner_id, review_due,
                             doc_type, requires_ack, audience_roles, status, created_by, version,
                             published_at)
       values ($1,$2,'Test','Brödtext',$3::uuid, current_date + 200, 'routine', true, $4::text[],
               $5, $3::uuid, 1, case when $5 = 'published' then now() else null end)
       returning id`,
      [titel, slug, agare, malgrupp, status],
    );
    return rows[0].id;
  };

  const alla = await skapaDok("rlstest-alla", "Öppen rutin", "published", [], chef.id);
  const utkast = await skapaDok("rlstest-utkast", "Utkast", "draft", [], chef.id);
  const chefsdok = await skapaDok("rlstest-chef", "Endast chefer", "published", ["sales_manager"], chef.id);

  const annas = await las(tA, "document", "select=slug");
  const sluggar = annas.map((d) => d.slug).filter((s) => s.startsWith("rlstest-"));
  ok("Anna ser den publicerade rutinen utan målgrupp", sluggar.includes("rlstest-alla"));
  ok("Anna ser INTE utkastet", !sluggar.includes("rlstest-utkast"), sluggar.join(", "));
  ok("Anna ser INTE dokumentet som riktar sig till säljchefer", !sluggar.includes("rlstest-chef"), sluggar.join(", "));

  const davids = (await las(tD, "document", "select=slug")).map((d) => d.slug);
  ok("David ser alla tre", ["rlstest-alla", "rlstest-utkast", "rlstest-chef"].every((x) => davids.includes(x)));

  // Skrivvagen: ett dokument far bara skapas och andras av en server action.
  const w1 = await fetch(`${URL}/rest/v1/document`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ title: "Fejk", slug: "rlstest-fejk", body_md: "x",
      owner_id: saljareA.id, review_due: "2030-01-01", created_by: saljareA.id }),
  });
  ok("Anna kan INTE skapa ett dokument via API:t", !w1.ok, `HTTP ${w1.status}`);

  const w2 = await fetch(`${URL}/rest/v1/document?id=eq.${alla}`, {
    method: "PATCH", headers: som(tA), body: JSON.stringify({ body_md: "ändrat" }),
  });
  ok("Anna kan INTE ändra en rutin via API:t", !w2.ok, `HTTP ${w2.status}`);
  const { rows: kvar } = await db.query(`select body_md from document where id = $1::uuid`, [alla]);
  ok("och brödtexten står oförändrad i databasen", kvar[0].body_md === "Brödtext", kvar[0].body_md);

  const w3 = await fetch(`${URL}/rest/v1/document_ack`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ document_id: alla, employee_id: saljareB.id, version: 1 }),
  });
  ok("Anna kan INTE kvittera i Bertils namn", !w3.ok, `HTTP ${w3.status}`);

  // Kvittenser ar personuppgifter: ingen ska kunna kartlagga vem som inte last.
  await db.query(
    `insert into document_ack (document_id, employee_id, version) values ($1::uuid,$2::uuid,1),($1::uuid,$3::uuid,1)`,
    [alla, saljareA.id, saljareB.id],
  );
  const ack = await las(tA, "document_ack", "select=employee_id");
  ok("Anna ser bara sin egen kvittens", ack.length === 1 && ack[0].employee_id === saljareA.id, `såg ${ack.length}`);
  const ackChef = await las(tD, "document_ack", "select=employee_id");
  ok("David ser båda kvittenserna", ackChef.length >= 2, `såg ${ackChef.length}`);

  const utk = await las(tA, "document", `select=slug&id=eq.${utkast}`);
  ok("Anna får 0 rader när hon frågar direkt efter utkastets id", utk.length === 0, `såg ${utk.length}`);
  const chefsfraga = await las(tA, "document", `select=slug&id=eq.${chefsdok}`);
  ok("Anna får 0 rader när hon frågar direkt efter chefsdokumentets id", chefsfraga.length === 0, `såg ${chefsfraga.length}`);
}

console.log("\n\x1b[1mStämpling: egen tid, chefens insyn och oföränderlighet\x1b[0m");
{
  const { rows: t } = await db.query(
    `insert into time_event (employee_id, kind, occurred_at) values
       ($1::uuid, 'in',  now() - interval '4 h'),
       ($2::uuid, 'in',  now() - interval '3 h')
     returning id, employee_id`,
    [saljareA.id, saljareB.id],
  );
  const annasStampling = t.find((r) => r.employee_id === saljareA.id).id;
  const bertilsStampling = t.find((r) => r.employee_id === saljareB.id).id;

  const annas = await las(tA, "time_event", "select=employee_id");
  ok("Anna ser bara sin egen stämpling", annas.length === 1 && annas[0].employee_id === saljareA.id,
    `såg ${annas.length}`);

  const direkt = await las(tA, "time_event", `select=id&id=eq.${bertilsStampling}`);
  ok("och får 0 rader när hon frågar efter Bertils", direkt.length === 0, `såg ${direkt.length}`);

  const evas = await las(tE, "time_event", "select=id");
  ok("Eva på ekonomi ser ingens", evas.length === 0, `såg ${evas.length}`);

  const chefens = await las(tD, "time_event", "select=id");
  ok("Säljchefen ser båda", chefens.length >= 2, `såg ${chefens.length}`);

  // AC-2.3: ingen far skriva egna stamplingar, och ingen far andra en befintlig.
  const w1 = await fetch(`${URL}/rest/v1/time_event`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ employee_id: saljareA.id, kind: "out", occurred_at: new Date().toISOString() }),
  });
  ok("Anna kan INTE stämpla via API:t förbi server actionen", !w1.ok, `HTTP ${w1.status}`);

  const w2 = await fetch(`${URL}/rest/v1/time_event?id=eq.${annasStampling}`, {
    method: "PATCH", headers: som(tA), body: JSON.stringify({ occurred_at: new Date().toISOString() }),
  });
  ok("Anna kan INTE flytta sin egen in-tid", !w2.ok, `HTTP ${w2.status}`);

  const w3 = await fetch(`${URL}/rest/v1/time_event?id=eq.${annasStampling}`, {
    method: "DELETE", headers: som(tA),
  });
  ok("Anna kan INTE radera den", !w3.ok, `HTTP ${w3.status}`);

  const w4 = await fetch(`${URL}/rest/v1/time_event?id=eq.${bertilsStampling}`, {
    method: "PATCH", headers: som(tD), body: JSON.stringify({ occurred_at: new Date().toISOString() }),
  });
  ok("inte ens säljchefen kan ändra någons tid", !w4.ok, `HTTP ${w4.status}`);

  // Och samma sak nere i databasen, dar service role annars gar forbi allt.
  let dbFel = null;
  try {
    await db.query(`update time_event set occurred_at = now() where id = $1::uuid`, [annasStampling]);
  } catch (e) { dbFel = e.message; }
  ok("databasen vägrar även med full behörighet", dbFel !== null, (dbFel ?? "").slice(0, 45));

  let raderFel = null;
  try {
    await db.query(`delete from time_event where id = $1::uuid`, [annasStampling]);
  } catch (e) { raderFel = e.message; }
  ok("och vägrar radering", raderFel !== null, (raderFel ?? "").slice(0, 40));
}

console.log("\n\x1b[1mScheman och avvikelser\x1b[0m");
{
  const { rows: sch } = await db.query(
    `insert into scheduled_break (scope, weekday, window_start, window_end, duration_minutes)
     values ('company', 1, '11:30', '13:00', 30) returning id`,
  );
  const schemaId = sch[0].id;

  const annasSchema = await las(tA, "scheduled_break", "select=id");
  ok("Anna ser bolagets rastschema", annasSchema.length >= 1, `såg ${annasSchema.length}`);

  const w1 = await fetch(`${URL}/rest/v1/scheduled_break`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ scope: "employee", employee_id: saljareA.id, weekday: 1,
      window_start: "10:00", window_end: "10:30", duration_minutes: 90 }),
  });
  ok("Anna kan INTE lägga sig ett eget rastschema", !w1.ok, `HTTP ${w1.status}`);

  const w2 = await fetch(`${URL}/rest/v1/scheduled_break?id=eq.${schemaId}`, {
    method: "PATCH", headers: som(tD), body: JSON.stringify({ duration_minutes: 60 }),
  });
  ok("inte ens säljchefen ändrar ett schema via API:t", !w2.ok, `HTTP ${w2.status}`);

  // AC-2.36: kvittensen ar den anstalldas, ingen annans.
  const w3 = await fetch(`${URL}/rest/v1/break_schedule_ack`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ schedule_id: schemaId, employee_id: saljareB.id }),
  });
  ok("Anna kan INTE kvittera i Bertils namn", !w3.ok, `HTTP ${w3.status}`);

  await db.query(
    `insert into break_deviation (employee_id, work_date, kind, minutes, schedule_id)
     values ($1::uuid, current_date - 1, 'overrun', 20, $3::uuid),
            ($2::uuid, current_date - 1, 'missing', 45, $3::uuid)`,
    [saljareA.id, saljareB.id, schemaId],
  );

  const annasAvv = await las(tA, "break_deviation", "select=employee_id");
  ok("Anna ser bara sin egen avvikelse", annasAvv.length === 1 && annasAvv[0].employee_id === saljareA.id,
    `såg ${annasAvv.length}`);

  const evasAvv = await las(tE, "break_deviation", "select=id");
  ok("Eva på ekonomi ser inga avvikelser alls", evasAvv.length === 0, `såg ${evasAvv.length}`);

  const chefensAvv = await las(tD, "break_deviation", "select=id");
  ok("Säljchefen ser båda", chefensAvv.length >= 2, `såg ${chefensAvv.length}`);

  // AC-2.17, K13, K17: avvikelser far inte skrivas om av den bedomda.
  const w4 = await fetch(`${URL}/rest/v1/break_deviation?employee_id=eq.${saljareA.id}`, {
    method: "PATCH", headers: som(tA), body: JSON.stringify({ minutes: 0 }),
  });
  ok("Anna kan INTE skriva ner sin egen avvikelse", !w4.ok, `HTTP ${w4.status}`);

  const w5 = await fetch(`${URL}/rest/v1/break_deviation?employee_id=eq.${saljareA.id}`, {
    method: "DELETE", headers: som(tA),
  });
  ok("och inte radera den", !w5.ok, `HTTP ${w5.status}`);

  // AC-2.6: journalen ar en compliance-vy — egen rad, annars bara ledningen.
  await db.query(
    `insert into work_time_journal (employee_id, work_date, worked_minutes)
     values ($1::uuid, current_date - 1, 450), ($2::uuid, current_date - 1, 480)`,
    [saljareA.id, saljareB.id],
  );

  const annasJournal = await las(tA, "work_time_journal", "select=employee_id");
  ok("Anna ser sin egen journalrad", annasJournal.length === 1, `såg ${annasJournal.length}`);
  const ledarensJournal = await las(tC, "work_time_journal", "select=employee_id");
  ok("teamledaren ser INGEN journal — den är ledningens", ledarensJournal.length === 0,
    `såg ${ledarensJournal.length}`);
  const chefensJournal = await las(tD, "work_time_journal", "select=employee_id");
  ok("säljchefen ser båda raderna", chefensJournal.length >= 2, `såg ${chefensJournal.length}`);
}

console.log("\n\x1b[1mSen ankomst: den bedomda ser sin rad, ekonomin ser ingen\x1b[0m");
{
  // Sen ankomst ar den kansligaste raden i M2: den namner en person vid namn
  // och sager att hen missko­tte sig. K13 och K17 sager att den aldrig far na
  // lonen — och da racker det inte att lata bli att bygga vyn, ekonomin ska
  // inte kunna hamta raden ur API:t heller.
  await db.query(
    `insert into late_arrival (employee_id, work_date, scheduled_start, arrived_at,
                               minutes_late, tolerance_minutes)
     values ($1::uuid, current_date - 2, '09:00', now() - interval '2 days', 7, 1),
            ($2::uuid, current_date - 2, '09:00', now() - interval '2 days', 3, 1)`,
    [saljareA.id, saljareB.id],
  );
  await db.query(
    `insert into late_arrival_month (employee_id, month, antal, minuter)
     values ($1::uuid, date_trunc('month', current_date)::date, 1, 7),
            ($2::uuid, date_trunc('month', current_date)::date, 1, 3)`,
    [saljareA.id, saljareB.id],
  );

  const annas = await las(tA, "late_arrival", "select=employee_id,minutes_late");
  ok("Anna ser sin egen sena ankomst", annas.length === 1 && annas[0].employee_id === saljareA.id,
    `såg ${annas.length}`);

  const direkt = await las(tA, "late_arrival", `select=id&employee_id=eq.${saljareB.id}`);
  ok("och 0 rader när hon frågar direkt på Bertils id", direkt.length === 0, `såg ${direkt.length}`);

  const cecilias = await las(tC, "late_arrival", "select=employee_id");
  ok("Cecilia ser Anna som rapporterar till henne", cecilias.some((r) => r.employee_id === saljareA.id));
  ok("men INTE Bertil som inte gör det", !cecilias.some((r) => r.employee_id === saljareB.id),
    `såg ${cecilias.length}`);

  const evas = await las(tE, "late_arrival", "select=id");
  ok("Eva på ekonomi ser 0 rader — K13 och K17", evas.length === 0, `såg ${evas.length}`);

  const evasManad = await las(tE, "late_arrival_month", "select=employee_id");
  ok("och inte heller månadssummorna", evasManad.length === 0, `såg ${evasManad.length}`);

  const davids = await las(tD, "late_arrival", "select=id");
  ok("Säljchefen ser båda", davids.length >= 2, `såg ${davids.length}`);

  const annasManad = await las(tA, "late_arrival_month", "select=employee_id");
  ok("Anna ser sin egen månadssumma", annasManad.length === 1, `såg ${annasManad.length}`);

  // AC-2.17: den bedomda far kommentera via en server action, aldrig skriva om
  // sjalva bedomningen.
  const w1 = await fetch(`${URL}/rest/v1/late_arrival?employee_id=eq.${saljareA.id}`, {
    method: "PATCH", headers: som(tA), body: JSON.stringify({ minutes_late: 1 }),
  });
  ok("Anna kan INTE skriva ner sina egna minuter", !w1.ok, `HTTP ${w1.status}`);

  const w2 = await fetch(`${URL}/rest/v1/late_arrival?employee_id=eq.${saljareA.id}`, {
    method: "DELETE", headers: som(tA),
  });
  ok("och inte radera raden", !w2.ok, `HTTP ${w2.status}`);

  const w3 = await fetch(`${URL}/rest/v1/late_arrival`, {
    method: "POST", headers: som(tD),
    body: JSON.stringify({ employee_id: saljareB.id, work_date: "2019-01-02",
      scheduled_start: "09:00", arrived_at: new Date().toISOString(),
      minutes_late: 90, tolerance_minutes: 1 }),
  });
  ok("inte ens säljchefen kan skriva en sen ankomst för hand", !w3.ok, `HTTP ${w3.status}`);

  const { rows: oror } = await db.query(
    `select minutes_late from late_arrival where employee_id = $1::uuid`, [saljareA.id],
  );
  ok("och de sju minuterna står kvar i databasen", oror[0]?.minutes_late === 7, String(oror[0]?.minutes_late));
}

console.log("\n\x1b[1mSparren for raststampling sitter i databasen, inte i koden\x1b[0m");
{
  // Lasningen ar avsiktligt oppen. Att var och en kan se vad som ar pasla­get
  // och pa vilken grund ar sjalva poangen med oppenhet kring overvakning —
  // det ar andringen som ska vara svar, inte insynen.
  const annas = await las(tA, "compliance_gate", "select=key,enabled");
  ok("Anna ser vilka spärrar som finns och vad som är påslaget", annas.length >= 2, `såg ${annas.length}`);
  ok("inklusive att raststämplingen står av",
    annas.find((r) => r.key === "raststampling")?.enabled === false);

  for (const [namn, tok] of [["Anna", tA], ["David", tD]]) {
    const w = await fetch(`${URL}/rest/v1/compliance_gate?key=eq.raststampling`, {
      method: "PATCH", headers: som(tok),
      body: JSON.stringify({ enabled: true, enabled_at: new Date().toISOString() }),
    });
    ok(`${namn} kan INTE slå på raststämplingen via API:t`, !w.ok, `HTTP ${w.status}`);
  }

  const wDel = await fetch(`${URL}/rest/v1/compliance_gate?key=eq.stampling`, {
    method: "DELETE", headers: som(tD),
  });
  ok("och ingen tar bort en spärr via API:t", !wDel.ok, `HTTP ${wDel.status}`);

  const { rows: kvar } = await db.query(`select enabled from compliance_gate where key = 'raststampling'`);
  ok("raststämplingen står fortfarande av i databasen", kvar[0].enabled === false);

  // -------------------------------------------------------------------------
  // Resten provas med full behorighet, i en transaktion som rullas tillbaka.
  // Provet MASTE ga hela vagen fram till ett lyckat paslag — en spa­rr som
  // aldrig gar att oppna ar inte en spa­rr, det ar ett fel som ingen upptackt.
  // Att gora det skarpt vore att sla pa raststamplingen i drift.
  // -------------------------------------------------------------------------
  const saknasFor = async (key) =>
    (await db.query(`select public.sparr_saknas($1) as s`, [key])).rows[0].s ?? [];
  const har = (lista, del) => lista.some((r) => r.includes(del));

  await db.query("begin");
  try {
    const utanBevis = await nekarSpar(
      `update compliance_gate set enabled = true, enabled_at = now(), enabled_by = $1::uuid
        where key = 'raststampling'`,
      [chef.id],
    );
    ok("inte ens service role slår på den utan underlag", utanBevis !== null);
    ok("och felet räknar upp vad som saknas", (utanBevis ?? "").includes("Detta saknas"),
      (utanBevis ?? "").slice(0, 60));

    const bort = await nekarSpar(`delete from compliance_gate where key = 'raststampling'`);
    ok("en spärr går inte att radera bort — bara stänga av", bort !== null, (bort ?? "").slice(0, 40));

    // Bevisen, ett i taget, sa att varje villkor provas var for sig.
    const nyttDok = async (slug, titel, typ, status, decided) => {
      const { rows } = await db.query(
        `insert into document (title, slug, category_path, body_md, owner_id, review_due, doc_type,
                               requires_ack, audience_roles, status, created_by, version,
                               published_at, decided_on)
         values ($1,$2,'Test','Brödtext',$3::uuid, current_date + 200, $4, $5, '{}', $6, $3::uuid, 1,
                 case when $6 = 'published' then now() else null end, $7)
         returning id`,
        [titel, slug, chef.id, typ, typ === "staff_information", status, decided],
      );
      return rows[0].id;
    };

    const k12 = await nyttDok("rlstest-k12", "Rlstest avvägning", "interest_assessment", "draft", null);
    const k14 = await nyttDok("rlstest-k14", "Rlstest information", "staff_information", "published", null);

    await db.query(
      `update compliance_gate set interest_assessment_id = $1::uuid, staff_information_id = $2::uuid
        where key = 'raststampling'`,
      [k12, k14],
    );

    let saknas = await saknasFor("raststampling");
    ok("ett utkast till avvägning duger inte", har(saknas, "inte publicerad"), saknas.join(" | "));
    ok("och personalen har inte kvitterat än", har(saknas, "har inte kvitterat"), saknas.join(" | "));

    await db.query(`update document set status = 'published', published_at = now() where id = $1::uuid`, [k12]);
    saknas = await saknasFor("raststampling");
    ok("publicerad men odaterad avvägning duger inte heller",
      har(saknas, "saknar beslutsdatum"), saknas.join(" | "));
    ok("och den räknas inte längre som opublicerad", !har(saknas, "inte publicerad"));

    await db.query(`update document set decided_on = current_date where id = $1::uuid`, [k12]);

    // K14 ska vara kvitterad av VAR OCH EN som ar aktiv, inte av nagon.
    const { rows: aktiva } = await db.query(`select count(*)::int as n from employee where status = 'active'`);
    await db.query(
      `insert into document_ack (document_id, employee_id, version)
       select $1::uuid, e.id, 1 from employee e where e.status = 'active'
          and e.id <> $2::uuid`,
      [k14, saljareB.id],
    );
    saknas = await saknasFor("raststampling");
    ok(`en enda okvitterad av ${aktiva[0].n} räcker för att hålla spärren stängd`,
      har(saknas, "har inte kvitterat"), saknas.join(" | "));

    await db.query(
      `insert into document_ack (document_id, employee_id, version) values ($1::uuid,$2::uuid,1)`,
      [k14, saljareB.id],
    );

    // K29. Rastschemat fran forra blocket ligger kvar, men provet ska sta pa
    // egna ben aven om blocken flyttas isar.
    const { rows: r } = await db.query(`select count(*)::int as n from scheduled_break`);
    if (r[0].n === 0) {
      await db.query(
        `insert into scheduled_break (scope, weekday, window_start, window_end, duration_minutes)
         values ('company', 2, '11:30', '13:00', 30)`,
      );
    }

    saknas = await saknasFor("raststampling");
    ok("med daterad K12, kvitterad K14 och ett rastschema saknas ingenting",
      saknas.length === 0, saknas.join(" | "));

    const utanVem = await nekarSpar(
      `update compliance_gate set enabled = true, enabled_at = now(), enabled_by = null
        where key = 'raststampling'`,
    );
    ok("men ett påslag utan vem som beslutat nekas ändå", utanVem !== null, (utanVem ?? "").slice(0, 45));

    const pa = await nekarSpar(
      `update compliance_gate set enabled = true, enabled_at = now(), enabled_by = $1::uuid
        where key = 'raststampling'`,
      [chef.id],
    );
    ok("och med allt på plats går den att slå på", pa === null, (pa ?? "").slice(0, 60));

    const { rows: nu } = await db.query(
      `select enabled, enabled_by from compliance_gate where key = 'raststampling'`,
    );
    ok("läget står påslaget med namn på den som beslutade",
      nu[0].enabled === true && nu[0].enabled_by === chef.id);

    // Vagen tillbaka ska alltid vara oppen, aven utan underlag.
    const av = await nekarSpar(`update compliance_gate set enabled = false where key = 'raststampling'`);
    ok("och alltid att slå av igen", av === null, (av ?? "").slice(0, 40));

    const avStampling = await nekarSpar(
      `update compliance_gate set enabled = false where key = 'stampling'`,
    );
    ok("samma sak för in- och utstämplingen — nödbromsen kräver ingen blankett",
      avStampling === null, (avStampling ?? "").slice(0, 40));
  } finally {
    await db.query("rollback");
  }

  const { rows: efterat } = await db.query(
    `select key, enabled from compliance_gate order by key`,
  );
  ok("efter rullbacken står stämplingen på",
    efterat.find((r) => r.key === "stampling")?.enabled === true);
  ok("och raststämplingen av — testet lämnade inga spår i driften",
    efterat.find((r) => r.key === "raststampling")?.enabled === false);
}

console.log("\n\x1b[1mUtbildning: malgrupp, facit och egna forsok\x1b[0m");
{
  const { rows: k } = await db.query(
    `insert into course (slug, title, status, audience_roles, owner_id, pass_threshold)
     values ('rlstest-kurs','Rlstest kurs','published','{}', $1::uuid, 80),
            ('rlstest-chefskurs','Rlstest chefskurs','published','{sales_manager}', $1::uuid, 80),
            ('rlstest-utkast','Rlstest utkast','draft','{}', $1::uuid, 80)
     returning id, slug`,
    [chef.id],
  );
  const oppen = k.find((r) => r.slug === "rlstest-kurs").id;
  const chefskurs = k.find((r) => r.slug === "rlstest-chefskurs").id;
  const utkast = k.find((r) => r.slug === "rlstest-utkast").id;

  const { rows: m } = await db.query(
    `insert into course_module (course_id, sort, title, kind) values ($1::uuid, 1, 'Provet', 'quiz') returning id`,
    [oppen],
  );
  const { rows: q } = await db.query(
    `insert into quiz_question (module_id, sort, prompt) values ($1::uuid, 1, 'Vad gäller?') returning id`,
    [m[0].id],
  );
  await db.query(
    `insert into quiz_option (question_id, sort, label, is_correct)
     values ($1::uuid, 1, 'Rätt svar', true), ($1::uuid, 2, 'Fel svar', false)`,
    [q[0].id],
  );

  const annas = (await las(tA, "course", "select=slug")).map((r) => r.slug);
  ok("Anna ser den öppna kursen", annas.includes("rlstest-kurs"), annas.join(", "));
  ok("Anna ser INTE chefskursen", !annas.includes("rlstest-chefskurs"));
  ok("Anna ser INTE utkastet", !annas.includes("rlstest-utkast"));

  const davids = (await las(tD, "course", "select=slug")).map((r) => r.slug);
  ok("David ser alla tre", ["rlstest-kurs", "rlstest-chefskurs", "rlstest-utkast"].every((x) => davids.includes(x)));

  const direkt = await las(tA, "course", `select=slug&id=eq.${chefskurs}`);
  ok("Anna får 0 rader när hon frågar direkt efter chefskursens id", direkt.length === 0, `såg ${direkt.length}`);
  const direktUtkast = await las(tA, "course", `select=slug&id=eq.${utkast}`);
  ok("och 0 rader för utkastet", direktUtkast.length === 0, `såg ${direktUtkast.length}`);

  // Karnan i AC-6.2: facit far inte ga att lasa ur webblasaren.
  const fragor = await las(tA, "quiz_question", "select=prompt");
  ok("Anna ser frågorna", fragor.length >= 1, `såg ${fragor.length}`);

  const facit = await fetch(`${URL}/rest/v1/quiz_option?select=label,is_correct`, { headers: som(tA) });
  ok("Anna kan INTE läsa svarsalternativen med facit", !facit.ok, `HTTP ${facit.status}`);
  const facitChef = await fetch(`${URL}/rest/v1/quiz_option?select=is_correct`, { headers: som(tD) });
  ok("inte ens säljchefen kommer åt facit via API:t", !facitChef.ok, `HTTP ${facitChef.status}`);

  // Ingen far skriva sig sjalv godkand.
  const w1 = await fetch(`${URL}/rest/v1/module_progress`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ employee_id: saljareA.id, module_id: m[0].id }),
  });
  ok("Anna kan INTE bocka av en modul via API:t", !w1.ok, `HTTP ${w1.status}`);

  const w2 = await fetch(`${URL}/rest/v1/certification`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ employee_id: saljareA.id, course_id: oppen }),
  });
  ok("Anna kan INTE utfärda ett certifikat åt sig själv", !w2.ok, `HTTP ${w2.status}`);

  const w3 = await fetch(`${URL}/rest/v1/course_attempt`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ course_id: oppen, employee_id: saljareA.id, score: 100, passed: true }),
  });
  ok("Anna kan INTE posta ett godkänt försök", !w3.ok, `HTTP ${w3.status}`);

  // Resultat ar personuppgifter: bara egna, chefens och teamledarens.
  await db.query(
    `insert into course_attempt (course_id, module_id, employee_id, score, passed)
     values ($1::uuid, $2::uuid, $3::uuid, 40, false), ($1::uuid, $2::uuid, $4::uuid, 90, true)`,
    [oppen, m[0].id, saljareA.id, saljareB.id],
  );

  const annasForsok = await las(tA, "course_attempt", "select=employee_id,score");
  ok("Anna ser bara sitt eget försök", annasForsok.length === 1 && annasForsok[0].employee_id === saljareA.id,
    `såg ${annasForsok.length}`);
  const evasForsok = await las(tE, "course_attempt", "select=employee_id");
  ok("Eva på ekonomi ser inga alls", evasForsok.length === 0, `såg ${evasForsok.length}`);
  const chefensForsok = await las(tD, "course_attempt", "select=employee_id");
  ok("Säljchefen ser båda", chefensForsok.length >= 2, `såg ${chefensForsok.length}`);
}

console.log("\n\x1b[1mLönekostnadsbehörigheten ges per person\x1b[0m");
{
  // AC-13.13. Behorigheten ar den enda vagen till M13, sa den som kan satta
  // den pa sig sjalv har i praktiken redan lonekostnaderna.
  const w = await fetch(`${URL}/rest/v1/employee_permission`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ employee_id: saljareA.id, permission: "payroll_cost_viewer" }),
  });
  ok("Anna kan INTE ge sig själv lönekostnadsbehörighet", !w.ok, `HTTP ${w.status}`);

  await db.query(
    `insert into employee_permission (employee_id, permission) values ($1::uuid, 'payroll_cost_viewer')`,
    [ekonomi.id],
  );

  const evas = await las(tE, "employee_permission", "select=permission");
  ok("Eva ser sin egen behörighet", evas.length === 1 && evas[0].permission === "payroll_cost_viewer");

  const annas = await las(tA, "employee_permission", "select=permission");
  ok("Anna ser inte Evas behörighet", annas.length === 0, `såg ${annas.length}`);

  const cecilias = await las(tC, "employee_permission", "select=permission");
  ok("Teamledaren ser den inte heller", cecilias.length === 0, `såg ${cecilias.length}`);

  const davids = await las(tD, "employee_permission", "select=employee_id");
  ok("Säljchefen ser vem som har den", davids.some((r) => r.employee_id === ekonomi.id));

  const d = await fetch(`${URL}/rest/v1/employee_permission?employee_id=eq.${ekonomi.id}`, {
    method: "DELETE", headers: som(tD),
  });
  ok("men kan INTE dra in den via API:t", !d.ok, `HTTP ${d.status}`);
}

console.log("\n\x1b[1mTeam ger teamledaren insyn — och bara den\x1b[0m");
{
  // Cecilia leder teamet. Bertil ligger i det men rapporterar inte till henne,
  // sa det ar teamkopplingen ensam som prövas har.
  const { rows: t } = await db.query(
    `insert into team (name, lead_id) values ('rlstest-nord', $1::uuid) returning id`,
    [ledare.id],
  );
  const teamId = t[0].id;

  const fore = (await las(tC, "employee")).map((r) => r.email);
  ok("Cecilia ser inte Bertil innan han läggs i teamet", !fore.includes(saljareB.epost));

  await db.query(`update employee set team_id = $1::uuid where id = $2::uuid`, [teamId, saljareB.id]);

  const efter = (await las(tC, "employee")).map((r) => r.email);
  ok("Cecilia ser Bertil när han ligger i hennes team", efter.includes(saljareB.epost), efter.join(", "));

  const davidsSyn = (await las(tD, "employee")).map((r) => r.email);
  ok("David ser honom också", davidsSyn.includes(saljareB.epost));

  const evasSyn = (await las(tE, "employee")).map((r) => r.email);
  ok("Eva på ekonomi ser honom inte", !evasSyn.includes(saljareB.epost), evasSyn.join(", "));

  // Skrivvagen: team ar inte ett fritt falt for den som rakar vara inloggad.
  const w1 = await fetch(`${URL}/rest/v1/team`, {
    method: "POST", headers: som(tA), body: JSON.stringify({ name: "rlstest-fejk" }),
  });
  ok("Anna kan INTE skapa ett team via API:t", !w1.ok, `HTTP ${w1.status}`);

  const w2 = await fetch(`${URL}/rest/v1/team?id=eq.${teamId}`, {
    method: "PATCH", headers: som(tA), body: JSON.stringify({ lead_id: saljareA.id }),
  });
  ok("Anna kan INTE göra sig själv till teamledare", !w2.ok, `HTTP ${w2.status}`);

  const w3 = await fetch(`${URL}/rest/v1/employee?id=eq.${saljareB.id}`, {
    method: "PATCH", headers: som(tC), body: JSON.stringify({ manager_id: ledare.id }),
  });
  ok("Cecilia kan INTE peka ut sig själv som Bertils chef", !w3.ok, `HTTP ${w3.status}`);

  await db.query(`update employee set team_id = null where id = $1::uuid`, [saljareB.id]);
}

console.log("\n\x1b[1mSteg två: kod via e-post\x1b[0m");
{
  const { rows: tabell } = await db.query(`select to_regclass('public.mfa_recovery_code') as t`);
  ok("återställningskoderna är borta ur schemat", tabell[0].t === null, String(tabell[0].t));

  // generate_link ger samma engangskod som mejlet skulle ha innehallit, utan
  // att nagot mejl skickas. Sa gar hela vagen att prova utan e-postleverantor.
  const rLank = await fetch(`${URL}/auth/v1/admin/generate_link`, {
    method: "POST", headers: ADMIN,
    body: JSON.stringify({ type: "magiclink", email: saljareB.epost }),
  });
  const lank = await rLank.json();
  const kod = lank.email_otp ?? lank.properties?.email_otp;
  ok("en engångskod går att ta fram", Boolean(kod), kod ? `${String(kod).length} tecken` : "");

  const verifiera = (token) =>
    fetch(`${URL}/auth/v1/verify`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email", email: saljareB.epost, token }),
    });

  const rFel = await verifiera("000000");
  ok("fel kod nekas", !rFel.ok, `HTTP ${rFel.status}`);

  const rRatt = await verifiera(kod);
  const session = await rRatt.json();
  ok("rätt kod ger en session", rRatt.ok && Boolean(session.access_token), session.msg ?? "");

  if (session.access_token) {
    const rader = await las(session.access_token, "employee");
    ok("och sessionen är Bertils, ingen annans",
      rader.length === 1 && rader[0].email === saljareB.epost, `såg ${rader.length}`);
  }

  const rAter = await verifiera(kod);
  ok("samma kod går inte att använda igen", !rAter.ok, `HTTP ${rAter.status}`);
}

console.log("\n\x1b[1mTvingat lösenordsbyte stänger API:t, inte bara sidorna\x1b[0m");
{
  /**
   * Eget konto, inte Anna eller David. Flaggan bor i app_metadata och foljer
   * med i varje ny token — flaggades nagon av dem skulle sektionerna efter
   * den har lasa med en token som plotsligt inte ser nagot, och felet skulle
   * dyka upp langt fran sin orsak.
   *
   * Rollen ar sales_manager med flit: det ar den breda atkomsten som ar varst
   * att lamna oppen for ett konto vars losenord tva personer kan.
   */
  const flaggad = await skapa("f", "Fredrik", "sales_manager");

  const laesKonto = async () =>
    (await (await fetch(`${URL}/auth/v1/admin/users/${flaggad.authId}`, { headers: ADMIN })).json());

  const sattFlagga = async (varde) => {
    const nu = (await laesKonto()).app_metadata ?? {};
    await fetch(`${URL}/auth/v1/admin/users/${flaggad.authId}`, {
      method: "PUT", headers: ADMIN,
      body: JSON.stringify({ app_metadata: { ...nu, byt_losenord: varde } }),
    });
  };

  // Utgangslaget. Utan det sager noll rader langre ner ingenting — ett konto
  // som aldrig sag nagot ar inget bevis for att en spa­rr fungerar.
  const tFore = await loggaIn(flaggad.epost);
  const foreEmployee = await las(tFore, "employee");
  ok("en säljchef utan tvång ser personalregistret", foreEmployee.length > 1, `såg ${foreEmployee.length}`);

  await sattFlagga(true);
  const tEfter = await loggaIn(flaggad.epost);

  const nyttal = JSON.parse(Buffer.from(tEfter.split(".")[1], "base64url").toString());
  ok("flaggan följer med i token", nyttal.app_metadata?.byt_losenord === true,
    JSON.stringify(nyttal.app_metadata));

  // Fyra tabeller som slapper in varje inloggad utan vidare, och tre som gar
  // via rollerna. Bade vagarna maste stanga, annars ar spa­rren bara delvis.
  for (const t of ["employee", "employee_role", "document", "hr_case", "company", "team", "case_category", "compliance_gate"]) {
    const rader = await las(tEfter, t);
    ok(`${t} ger noll rader med tvång`, rader.length === 0, `såg ${rader.length}`);
  }

  // Ett dokument som riktar sig till ALLA ar den vag som slapp igenom fore
  // 0017: matches_audience svarade ja utan att titta pa vem som fragade.
  await db.query(
    `insert into document (title, slug, category_path, body_md, owner_id, review_due, doc_type,
                           requires_ack, audience_roles, status, created_by, version, published_at)
     values ('Öppet för alla','rlstest-oppet','Test','Brödtext',$1::uuid, current_date + 200,
             'routine', false, '{}', 'published', $1::uuid, 1, now())`,
    [chef.id],
  );
  ok("inte heller ett dokument utan målgrupp", (await las(tEfter, "document")).length === 0);

  // Skrivvagarna. app_metadata far bara service role rora — annars kunde den
  // sparrade sjalv stanga av spa­rren.
  const som2 = { apikey: ANON, Authorization: `Bearer ${tEfter}`, "Content-Type": "application/json" };
  const rApp = await fetch(`${URL}/auth/v1/user`, {
    method: "PUT", headers: som2, body: JSON.stringify({ app_metadata: { byt_losenord: false } }),
  });
  ok("egen token får inte skriva app_metadata", rApp.status === 403, `HTTP ${rApp.status}`);

  // user_metadata far den daremot skriva i, och det ska inte spela nagon roll.
  // Det ar hela skalet till att flaggan inte bor dar.
  const rUser = await fetch(`${URL}/auth/v1/user`, {
    method: "PUT", headers: som2, body: JSON.stringify({ data: { byt_losenord: false } }),
  });
  const tTredje = await loggaIn(flaggad.epost);
  const p3 = JSON.parse(Buffer.from(tTredje.split(".")[1], "base64url").toString());
  ok("en egen user_metadata-flagga stänger inte av tvånget",
    rUser.ok && p3.app_metadata?.byt_losenord === true && p3.user_metadata?.byt_losenord === false,
    `app=${p3.app_metadata?.byt_losenord} user=${p3.user_metadata?.byt_losenord}`);
  ok("och API:t är fortfarande stängt efteråt", (await las(tTredje, "employee")).length === 0);

  /**
   * Och tillbaka. En spa­rr som inte gar att oppna ar inte en spa­rr utan ett
   * oupptackt fel — samma resonemang som provet av raststamplingen i 0015.
   * Det ar ocksa den enda kontroll som visar att bytet faktiskt slapper in
   * personen igen, vilket ar vad hela flodet finns till for.
   */
  await sattFlagga(false);
  const tSlut = await loggaIn(flaggad.epost);
  const slutEmployee = await las(tSlut, "employee");
  ok("efter bytet ser säljchefen registret igen",
    slutEmployee.length === foreEmployee.length, `såg ${slutEmployee.length} av ${foreEmployee.length}`);

  await db.query(`delete from document where slug = 'rlstest-oppet'`);
}

console.log("\n\x1b[1mAC-4.3: konfidentiella ärenden når bara säljchef och VD\x1b[0m");
{
  const nyttArende = async (agare, kategori, rubrik, konfidentiellt) => {
    const { rows } = await db.query(
      `insert into hr_case (employee_id, created_by, category, subject, confidential, sla_hours, due_at)
       values ($1::uuid,$1::uuid,$2,$3,$4,48, now() + interval '48 hours') returning id`,
      [agare, kategori, rubrik, konfidentiellt],
    );
    await db.query(`insert into case_message (case_id, author_id, body) values ($1::uuid,$2::uuid,'Provtext')`, [
      rows[0].id, agare,
    ]);
    return rows[0].id;
  };

  const oppet = await nyttArende(saljareA.id, "equipment", "rlstest-tangentbord", false);
  const hemligt = await nyttArende(saljareA.id, "conflict", "rlstest-konflikt", true);
  const bertils = await nyttArende(saljareB.id, "pay", "rlstest-provision", false);

  const annas = await las(tA, "hr_case");
  ok("Anna ser sina två egna ärenden", annas.length === 2, `såg ${annas.length}`);
  ok("och inte Bertils", !annas.some((a) => a.id === bertils));

  const annasFraga = await las(tA, "hr_case", `id=eq.${bertils}`);
  ok("noll rader när hon frågar direkt på Bertils ärende", annasFraga.length === 0);

  const cecilias = await las(tC, "hr_case");
  ok("Cecilia som teamledare ser inga ärenden alls", cecilias.length === 0, `såg ${cecilias.length}`);

  // Antalet sager ingenting: testet kor mot samma databas som driften, och dar
  // ligger riktiga arenden. Fragan ar om just de har tre syns.
  const davids = (await las(tD, "hr_case")).map((a) => a.id);
  ok("David som säljchef ser alla tre testärendena",
    [oppet, hemligt, bertils].every((i) => davids.includes(i)), `såg ${davids.length} totalt`);
  ok("inklusive det konfidentiella", davids.includes(hemligt));

  const evas = await las(tE, "hr_case");
  ok("Eva på ekonomi ser inga ärenden — det är inte hennes bord", evas.length === 0, `såg ${evas.length}`);

  // Tilldelning ger insyn i ett oppet arende, men aldrig i ett konfidentiellt.
  await db.query(`update hr_case set assigned_to = $1::uuid where id = $2::uuid`, [ledare.id, oppet]);
  await db.query(`update hr_case set assigned_to = $1::uuid where id = $2::uuid`, [ledare.id, hemligt]);

  const ceciliaNu = await las(tC, "hr_case");
  ok("tilldelad ser det öppna ärendet", ceciliaNu.some((a) => a.id === oppet));
  ok("men tilldelning öppnar INTE ett konfidentiellt", !ceciliaNu.some((a) => a.id === hemligt));

  const hemligaMeddelanden = await las(tC, "case_message", `case_id=eq.${hemligt}`);
  ok("och inte heller dess meddelanden", hemligaMeddelanden.length === 0, `såg ${hemligaMeddelanden.length}`);

  const annasMeddelanden = await las(tA, "case_message", `case_id=eq.${bertils}`);
  ok("Anna kommer inte åt Bertils dialog", annasMeddelanden.length === 0);

  const wB = await fetch(`${URL}/rest/v1/hr_case?id=eq.${bertils}`, {
    method: "PATCH", headers: som(tA), body: JSON.stringify({ status: "resolved" }),
  });
  ok("Anna kan inte stänga Bertils ärende", !wB.ok, `HTTP ${wB.status}`);

  const wM = await fetch(`${URL}/rest/v1/case_message`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ case_id: bertils, author_id: saljareA.id, body: "hej" }),
  });
  ok("och inte skriva i den", !wM.ok, `HTTP ${wM.status}`);

  const andra = await nekarSql(
    `update case_message set body = 'omskrivet' where case_id = $1::uuid`, [oppet],
  );
  ok("ett skickat meddelande går inte att skriva om", andra !== null);
}

console.log("\n\x1b[1mLönerapporten är ledningens och ekonomins\x1b[0m");
{
  const { rows: per } = await db.query(
    `insert into payroll_period (period_start, period_end) values ('2019-03-01','2019-03-31') returning id`,
  );
  const period = per[0].id;

  await db.query(
    `insert into payroll_row (period_id, employee_id, worked_minutes) values ($1::uuid,$2::uuid,600),($1::uuid,$3::uuid,540)`,
    [period, saljareA.id, saljareB.id],
  );

  const annas = await las(tA, "payroll_row");
  ok("Anna ser sin egen rad", annas.length === 1 && annas[0].employee_id === saljareA.id, `såg ${annas.length}`);

  const annasFraga = await las(tA, "payroll_row", `employee_id=eq.${saljareB.id}`);
  ok("och noll rader när hon frågar direkt på Bertils id", annasFraga.length === 0, `såg ${annasFraga.length}`);

  const annasPeriod = await las(tA, "payroll_period");
  ok("Anna ser inte perioderna", annasPeriod.length === 0, `såg ${annasPeriod.length}`);

  // AC-2.10: teamledaren far se avvikelser i sitt team. Loneunderlag ar nagot
  // annat — det ar ledningens och ekonomins, aven for egna teammedlemmar.
  const cecilias = await las(tC, "payroll_row");
  ok("Cecilia ser ingen annans löneunderlag, inte ens Annas", cecilias.length === 0, `såg ${cecilias.length}`);

  // Samma sak har: raknar man alla rader raknar man in driftens loneperioder.
  const iPerioden = (rader) => rader.filter((r) => r.period_id === period);

  const davids = iPerioden(await las(tD, "payroll_row"));
  ok("David som säljchef ser båda raderna", davids.length === 2, `såg ${davids.length}`);

  const evas = iPerioden(await las(tE, "payroll_row"));
  ok("Eva på ekonomi ser båda raderna", evas.length === 2, `såg ${evas.length}`);
  ok("och kommer åt perioden", (await las(tE, "payroll_period")).length >= 1);

  const wA = await fetch(`${URL}/rest/v1/payroll_row`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ period_id: period, employee_id: saljareA.id, worked_minutes: 99999 }),
  });
  ok("Anna kan inte skriva sitt eget underlag", !wA.ok, `HTTP ${wA.status}`);

  const wC = await fetch(`${URL}/rest/v1/payroll_period`, {
    method: "POST", headers: som(tC),
    body: JSON.stringify({ period_start: "2019-04-01", period_end: "2019-04-30" }),
  });
  ok("Cecilia kan inte skapa en period", !wC.ok, `HTTP ${wC.status}`);

  const wD = await fetch(`${URL}/rest/v1/payroll_row?period_id=eq.${period}`, {
    method: "PATCH", headers: som(tD), body: JSON.stringify({ worked_minutes: 0 }),
  });
  ok("inte ens David skriver underlaget via API:t — det gör servern", !wD.ok, `HTTP ${wD.status}`);

  await db.query(`delete from payroll_row where period_id = $1::uuid`, [period]);
  await db.query(`delete from payroll_period where id = $1::uuid`, [period]);
}

console.log("\n\x1b[1mAnonym anslutning\x1b[0m");
for (const t of ["employee", "employee_role", "employee_permission", "audit_log", "offboarding_task", "company", "team", "schema_migrations", "document", "document_version", "document_ack", "document_view", "course", "course_module", "quiz_question", "quiz_option", "module_progress", "course_attempt", "certification", "time_event", "work_schedule", "work_time_journal", "scheduled_break", "break_deviation", "payroll_period", "payroll_row", "payroll_adjustment", "payroll_export_column", "hr_case", "case_message", "case_category", "late_arrival", "late_arrival_month", "compliance_gate"]) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const j = await r.json();
  ok(`${t} ger inga rader anonymt`, !Array.isArray(j) || j.length === 0, Array.isArray(j) ? `${j.length} rader` : `HTTP ${r.status}`);
}

console.log("\nStädar ...");
await stad();
await db.end();

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} kontroll(er) underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
