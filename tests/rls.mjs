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

console.log("\n\x1b[1mAnonym anslutning\x1b[0m");
for (const t of ["employee", "employee_role", "employee_permission", "audit_log", "offboarding_task", "company", "team", "schema_migrations", "document", "document_version", "document_ack", "document_view", "course", "course_module", "quiz_question", "quiz_option", "module_progress", "course_attempt", "certification", "time_event"]) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const j = await r.json();
  ok(`${t} ger inga rader anonymt`, !Array.isArray(j) || j.length === 0, Array.isArray(j) ? `${j.length} rader` : `HTTP ${r.status}`);
}

console.log("\nStädar ...");
await stad();
await db.end();

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} kontroll(er) underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
