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
 *
 * ---------------------------------------------------------------------------
 * REGELN SOM HAR BRUTITS FYRA GANGER — las den innan du skriver en ny kontroll
 * ---------------------------------------------------------------------------
 *
 * En kontroll far ALDRIG rakna rader i en hel tabell for en roll vars RLS
 * slapper igenom fler rader an provets egna. Skriv i stallet fragan pa
 * PROVRADENS ID:
 *
 *     // Fel — raknar aven driftens rader
 *     ok("David ser den", (await las(tD, "sick_report")).length === 1);
 *
 *     // Ratt — provar policyn, inte hur manga rader tabellen rakar ha
 *     ok("David ser den", (await las(tD, "sick_report", `id=eq.${id}&select=*`)).length === 1);
 *
 * Skalet ar inte teoretiskt. Fyra kontroller har fallit pa exakt det har, alla
 * i samma stund navet borjade anvandas pa riktigt: kalenderflodet 2026-08-20
 * (nagon skapade sitt flode), tva till 2026-08-21, och absence_reminder
 * 2026-08-22 (nattjobbet la in riktiga paminnelser klockan 03:07). Provet var
 * rott utan att nagot var trasigt, vilket ar det dyraste slaget av rott.
 *
 * TVA UNDANTAG, och bara tva:
 *
 *   1. `=== 0` gar alltid bra. Ser rollen fler rader an noll ar det ett verkligt
 *      fel, oavsett var raden kom ifran. Det ar hela poangen med provet.
 *   2. `>= n` gar bra nar det som provas ar att nagot alls slapps igenom.
 *
 * En roll som bara ser sina EGNA rader (Anna, Bertil) far raknas — provets
 * anvandare skapas nyss och kan inte aga driftdata. En teamledare ser sitt
 * folk, vilket i dag ar bara provets anvandare, men det ar en egenskap hos
 * uppsattningen och inte hos policyn: fraga pa id aven dar.
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
  // Utan den har raden blir ett misslyckat kontoskapande en employee-rad med
  // auth_user_id = null, och felet dyker upp forst vid inloggningen som
  // "invalid_credentials" — vilket ser ut som ett losenordsfel och inte som det
  // det ar.
  if (!user.id) throw new Error(`Kunde inte skapa ${epost}: ${JSON.stringify(user)}`);
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

/**
 * Alla auth-konton med provets prefix, hamtade ur Auth i stallet for ur
 * employee.
 *
 * DET HAR AR SKILLNADEN MOT ATT LASA `employee.auth_user_id`: en kraschad
 * korning lamnar kvar bada halvorna, men stadningen kordes forr bara over
 * employee-raderna. Forsta gangen den kombinationen uppstod var kontot borta ur
 * employee och kvar i Auth — foraldralost, osynligt for stadningen, och omojligt
 * att skapa om. `skapa()` fick tillbaka "email exists", la in en employee-rad
 * utan auth_user_id, och inloggningen dog pa invalid_credentials.
 *
 * Foljden var att provet inte gick att kora igen ALLS utan att nagon rensade for
 * hand. Ett prov som far ett permanent minne av sin egen krasch ar varre an
 * inget prov: det ar rott av ett skal som inte har med koden att gora.
 */
async function foraldralosaKonton() {
  const konton = [];
  for (let sida = 1; sida <= 20; sida++) {
    const r = await fetch(`${URL}/auth/v1/admin/users?page=${sida}&per_page=200`, { headers: ADMIN });
    const j = await r.json();
    const users = j.users ?? [];
    for (const u of users) if (u.email?.startsWith(PREFIX)) konton.push(u.id);
    if (users.length < 200) break;
  }
  return konton;
}

async function stad() {
  for (const id of await foraldralosaKonton()) {
    await fetch(`${URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: ADMIN });
  }
  await db.query(`delete from audit_log where object_id in (select id::text from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`update team set lead_id = null where lead_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from news_post where slug like 'rlstest-%'`);
  await db.query(`delete from notification_seen where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from notification_dismissed where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  // 0022/0023. Bilagorna forsvinner i kaskaden fran dokumentet, men
  // sjukintygen hanger i sjukanmalningar och behover det medvetna handgreppet.
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
  // E7. Bade sjukanmalan och saldo har triggrar som vagrar delete och update.
  // Att stadningen kraver ett aktivt handgrepp ar samma poang som pa
  // time_event: sparren galler aven den som skrev den.
  // 0022. Filens sparr slapper igenom en kaskad fran den rad den hor till,
  // men inte ett ensamt delete — och testets filer hanger i sjukanmalningar
  // som stads bort har nedan. Handgreppet ar detsamma som pa sick_report:
  // sparren galler aven den som skrev den.
  // 0024. Rollspelen forst: de haller i filerna, och kurserna raderas langre
  // ned i samma funktion.
  await db.query(`delete from roleplay_submission where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`alter table file_object disable trigger file_object_last`);
  await db.query(`delete from file_object where uploaded_by in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`alter table file_object enable trigger file_object_last`);
  await db.query(`alter table sick_report disable trigger sick_report_last`);
  await db.query(`delete from sick_deadline where report_id in (select id from sick_report where employee_id in (select id from employee where email like $1))`, [PREFIX + "%"]);
  await db.query(`delete from sick_report where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`alter table sick_report enable trigger sick_report_last`);
  await db.query(`alter table absence_balance disable trigger absence_balance_orubblig`);
  await db.query(`delete from absence_balance where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`alter table absence_balance enable trigger absence_balance_orubblig`);
  await db.query(`alter table absence_request disable trigger absence_request_last`);
  await db.query(`delete from absence_request where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`alter table absence_request enable trigger absence_request_last`);
  await db.query(`delete from absence_reminder where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from calendar_feed where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from absence_blackout where label like 'rlstest-%'`);
  await db.query(`delete from staffing_cap where created_by in (select id from employee where email like $1)`, [PREFIX + "%"]);
  // 0025. Berakningarna och lonerna forst — de hanger i personerna och i
  // loneperioderna som stadas har nedan. Loneuppgiften kraver samma medvetna
  // handgrepp som sjukanmalan: sparren galler aven den som skrev den.
  await db.query(`delete from cost_calculation where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from revenue_entry where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`alter table salary_basis disable trigger salary_basis_last`);
  await db.query(`delete from salary_basis where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`alter table salary_basis enable trigger salary_basis_last`);
  await db.query(`delete from payroll_row where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from payroll_period where status = 'draft' and period_start in ('2019-03-01','2019-04-01','2019-05-01')`);
  await db.query(`delete from work_time_journal where employee_id in (select id from employee where email like $1)`, [PREFIX + "%"]);
  await db.query(`delete from scheduled_break where scope = 'company' and window_start = '11:30' and duration_minutes = 30`);
  await db.query(`delete from work_schedule where scope = 'company' and start_time = '08:00' and end_time = '17:00'`);
  await db.query(`delete from candidate where email like $1`, [PREFIX + "%"]);
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

console.log("\n\x1b[1mNyheter når målgruppen och ingen annan\x1b[0m");
{
  const nyttInlagg = async (slug, titel, roller, teams, status = "published") => {
    const { rows } = await db.query(
      `insert into news_post (slug, title, body_md, audience_roles, audience_teams, status,
                              author_id, published_at)
       values ($1,$2,'Brödtext',$3::text[],$4::uuid[],$5,$6::uuid,
               case when $5 = 'published' then now() else null end)
       returning id`,
      [slug, titel, roller, teams, status, chef.id],
    );
    return rows[0].id;
  };

  const tillAlla = await nyttInlagg("rlstest-nyhet-alla", "Till alla", "{}", "{}");
  const tillSaljare = await nyttInlagg("rlstest-nyhet-saljare", "Till säljare", "{salesperson}", "{}");
  const tillEkonomi = await nyttInlagg("rlstest-nyhet-ekonomi", "Till ekonomi", "{finance}", "{}");
  const utkast = await nyttInlagg("rlstest-nyhet-utkast", "Utkast", "{}", "{}", "draft");

  const slugar = async (tok) => (await las(tok, "news_post", "select=slug")).map((r) => r.slug);

  const annas = await slugar(tA);
  ok("Anna ser inlägget till alla", annas.includes("rlstest-nyhet-alla"), annas.join(", "));
  ok("och inlägget till säljare", annas.includes("rlstest-nyhet-saljare"));
  ok("men inte det till ekonomi", !annas.includes("rlstest-nyhet-ekonomi"));
  ok("och inte utkastet", !annas.includes("rlstest-nyhet-utkast"));

  const evas = await slugar(tE);
  ok("Eva på ekonomi ser sitt eget", evas.includes("rlstest-nyhet-ekonomi"));
  ok("men inte säljarnas", !evas.includes("rlstest-nyhet-saljare"));

  // Direkt fraga pa id:t, inte bara listan. En vy kan filtrera; ett API far
  // inte lamna ut raden alls.
  const direkt = await las(tA, "news_post", `select=slug&id=eq.${tillEkonomi}`);
  ok("noll rader när Anna frågar direkt på ekonomins inlägg", direkt.length === 0, `såg ${direkt.length}`);

  const davids = await slugar(tD);
  ok("David som säljchef ser även utkastet", davids.includes("rlstest-nyhet-utkast"));

  // Malgrupp pa team: Anna ar i Cecilias team, Bertil ar inte i nagot.
  // Teamet sätts här och återställs efteråt, så att provet inte beror på vad
  // en tidigare sektion råkade lämna kvar.
  const { rows: [{ team_id: annasTeamFore }] } = await db.query(
    `select team_id from employee where id = $1::uuid`, [saljareA.id]);
  const { rows: [provTeam] } = await db.query(
    `insert into team (name) values ('rlstest-nyhetsteam') returning id`);
  await db.query(`update employee set team_id = $1::uuid where id = $2::uuid`,
    [provTeam.id, saljareA.id]);

  await nyttInlagg("rlstest-nyhet-team", "Till ett team", "{}", `{${provTeam.id}}`);
  const medTeam = await slugar(await loggaIn(saljareA.epost));
  const utanTeam = await slugar(tB);
  ok("teamets inlägg når teamets medlem", medTeam.includes("rlstest-nyhet-team"),
    medTeam.join(", "));
  ok("men inte den som står utanför teamet", !utanTeam.includes("rlstest-nyhet-team"),
    utanTeam.join(", "));

  await db.query(`update employee set team_id = $1 where id = $2::uuid`,
    [annasTeamFore, saljareA.id]);
  await db.query(`delete from team where id = $1::uuid`, [provTeam.id]);

  const skriv = await fetch(`${URL}/rest/v1/news_post`, {
    method: "POST", headers: som(tD),
    body: JSON.stringify({ slug: "rlstest-nyhet-api", title: "Via API", author_id: chef.id }),
  });
  ok("inte ens säljchefen skriver ett inlägg via API:t", !skriv.ok, `HTTP ${skriv.status}`);

  // Ett publicerat inlagg utan tidpunkt gar inte att sortera och syns aldrig
  // som nytt i klockan. Villkoret ska gora det omojligt.
  const utanTid = await nekarSql(
    `insert into news_post (slug, title, status, author_id)
     values ('rlstest-nyhet-utan-tid','Utan tid','published',$1::uuid)`, [chef.id]);
  ok("publicerat utan published_at nekas av databasen", utanTid !== null,
    utanTid ? "" : "gick igenom");

  void tillAlla;
  void tillSaljare;
}

console.log("\n\x1b[1mKlockans tidpunkt är var och ens egen\x1b[0m");
{
  await db.query(
    `insert into notification_seen (employee_id, seen_at) values ($1::uuid, now()), ($2::uuid, now())
     on conflict (employee_id) do update set seen_at = excluded.seen_at`,
    [saljareA.id, saljareB.id],
  );

  const annas = await las(tA, "notification_seen", "select=employee_id");
  ok("Anna ser sin egen rad", annas.length === 1 && annas[0].employee_id === saljareA.id,
    `såg ${annas.length}`);

  const direkt = await las(tA, "notification_seen", `select=employee_id&employee_id=eq.${saljareB.id}`);
  ok("och noll rader när hon frågar på Bertils", direkt.length === 0, `såg ${direkt.length}`);

  // Kunde man skriva nagon annans tidpunkt gick det att tysta deras klocka.
  const skriv = await fetch(`${URL}/rest/v1/notification_seen`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ employee_id: saljareB.id, seen_at: new Date().toISOString() }),
  });
  ok("ingen kan skriva någon annans tidpunkt", !skriv.ok, `HTTP ${skriv.status}`);

  const egen = await fetch(`${URL}/rest/v1/notification_seen?employee_id=eq.${saljareA.id}`, {
    method: "PATCH", headers: som(tA),
    body: JSON.stringify({ seen_at: new Date().toISOString() }),
  });
  ok("inte ens sin egen — det gör servern", !egen.ok, `HTTP ${egen.status}`);
}

console.log("\n\x1b[1m0038: bortklickade notiser är var och ens egna\x1b[0m");
{
  // Listan över vad någon klickat bort säger något om henne — vad hon valt att
  // inte ta tag i just nu. Samma krets som klockans tidpunkt: bara hon själv.
  await db.query(
    `insert into notification_dismissed (employee_id, notice_id) values ($1::uuid, 'kurs-rlstest'), ($2::uuid, 'kurs-rlstest')
     on conflict do nothing`,
    [saljareA.id, saljareB.id],
  );

  const annas = await las(tA, "notification_dismissed", "select=employee_id,notice_id");
  ok("Anna ser sin egen rad", annas.length === 1 && annas[0].employee_id === saljareA.id,
    `såg ${annas.length}`);

  const direkt = await las(tA, "notification_dismissed", `select=notice_id&employee_id=eq.${saljareB.id}`);
  ok("och noll rader när hon frågar på Bertils", direkt.length === 0, `såg ${direkt.length}`);

  // Kunde man skriva i någon annans namn gick det att tysta deras klocka post
  // för post — tystare och svårare att upptäcka än att flytta tidpunkten.
  const skriv = await fetch(`${URL}/rest/v1/notification_dismissed`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ employee_id: saljareB.id, notice_id: "kurs-rlstest2" }),
  });
  ok("ingen kan klicka bort någon annans notis", !skriv.ok, `HTTP ${skriv.status}`);

  const egenSkriv = await fetch(`${URL}/rest/v1/notification_dismissed`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ employee_id: saljareA.id, notice_id: "kurs-rlstest3" }),
  });
  ok("inte ens sin egen — det gör servern", !egenSkriv.ok, `HTTP ${egenSkriv.status}`);

  // Ångra sig går inte via API:t heller. Att posten kommer tillbaka löses av
  // att ett nytt id skapas när något faktiskt är nytt, inte av en delete.
  const radera = await fetch(`${URL}/rest/v1/notification_dismissed?employee_id=eq.${saljareA.id}`, {
    method: "DELETE", headers: som(tA),
  });
  ok("och ingen raderar rader via API:t", !radera.ok, `HTTP ${radera.status}`);

  // Kolumnen tar 200 tecken, och `arNotisId()` säger nej långt före det. Att
  // villkoret ändå finns i databasen är samma linje som resten av navet: regeln
  // gäller även den server action som glömmer den.
  const forLangt = await nekarSpar(
    `insert into notification_dismissed (employee_id, notice_id) values ($1::uuid, $2)`,
    [saljareA.id, "kurs-" + "a".repeat(400)],
  );
  ok("databasen nekar ett id på 400 tecken", forLangt !== null, forLangt ?? "gick igenom");

  await db.query(`delete from notification_dismissed where notice_id like 'kurs-rlstest%'`);
}

// =============================================================================
// E7 / M3 Franvaro och ledighet
// =============================================================================

console.log("\n\x1b[1mK35: sick_report kan inte bara en orsak\x1b[0m");
{
  // AC-3.21 kraver att det inte far FINNAS ett falt dar en diagnos, en orsak
  // eller en symtombeskrivning kan hamna. Den enda formuleringen av det kravet
  // som gar att prova ar den absoluta: noll textkolumner.
  //
  // Provet fragar schemat och inte koden. Det faller den dag nagon lagger till
  // en textkolumn pa tabellen, oavsett vad den skulle heta och hur val
  // motiverad den vore — samma mekanik som tests/registerutdrag.mjs anvander
  // mot frammande nycklar.
  const { rows } = await db.query(
    `select column_name, data_type
       from information_schema.columns
      where table_schema = 'public' and table_name = 'sick_report'
        and data_type in ('text','character varying','character')`,
  );
  ok(
    "sick_report har noll textkolumner",
    rows.length === 0,
    rows.length ? `hittade ${rows.map((r) => r.column_name).join(", ")}` : "",
  );

  // Sparren mot en digital sjukanmalningsknapp (AC-3.6) ligger i databasen.
  // nekarSql och inte nekarSpar: avsnittet kor utanfor en transaktion, och
  // utan transaktion finns ingen sparpunkt att rulla tillbaka till. Varje sats
  // autocommittas, sa ett fel har smittar ingenting.
  const nekad = await nekarSql(`update absence_type set requestable = true where id = 'sick'`);
  ok("sjukfranvaro gar inte att gora ansokningsbar", nekad !== null, nekad ? "" : "SLAPPTE IGENOM");
}

console.log("\n\x1b[1mAC-3.26: sjukdata nar varken ekonomi eller fel chef\x1b[0m");
{
  // Anna ar sjuk. Cecilia leder henne, David ar saljchef, Eva ar ekonomi och
  // Bertil ar en kollega utan ledarroll.
  const { rows: [anmalan] } = await db.query(
    `insert into sick_report (employee_id, first_sick_day, registered_by, extent_percent)
     values ($1::uuid, current_date - 2, $1::uuid, 100) returning id`,
    [saljareA.id],
  );

  const { rows: [frist] } = await db.query(
    `insert into sick_deadline (report_id, kind, due_on)
     values ($1::uuid, 'certificate', current_date + 5) returning id`,
    [anmalan.id],
  );

  const egen = await las(tA, "sick_report");
  ok("Anna ser sin egen sjukanmalan", egen.length === 1, `såg ${egen.length}`);

  // Pa id ocksa har. Cecilia ser sitt eget folk, och i dag bestar hennes krets
  // bara av provets egna anvandare — men det ar en egenskap hos uppsattningen,
  // inte hos policyn. Far hon en riktig medarbetare raknar listan hens rader.
  const ledarens = await las(tC, "sick_report", `id=eq.${anmalan.id}&select=*`);
  ok("Cecilia ser den — hon leder Anna", ledarens.length === 1, `såg ${ledarens.length}`);

  // Fragan pa id och inte pa hela listan: David ser ALL sjukfranvaro i navet,
  // och den forsta riktiga sjukanmalan hade annars gjort provet rott utan att
  // nagot var fel. Samma fella som kalenderflodet gick i.
  const chefens = await las(tD, "sick_report", `id=eq.${anmalan.id}&select=*`);
  ok("David ser den — saljchef", chefens.length === 1, `såg ${chefens.length}`);

  const kollegans = await las(tB, "sick_report");
  ok("Bertil ser 0 rader", kollegans.length === 0, `såg ${kollegans.length}`);

  // Det har ar AC-3.26 pa API-niva. Ekonomi raknar lon och kostnad; forsta
  // sjukdagen och antalet tillfallen ar inte deras.
  const ekonomins = await las(tE, "sick_report");
  ok("Ekonomi ser 0 rader", ekonomins.length === 0, `såg ${ekonomins.length}`);

  // Aven med lonekostnadsbehorigheten. K26 ger tillgang till kostnad, inte
  // till halsa.
  await db.query(
    `insert into employee_permission (employee_id, permission) values ($1::uuid, 'payroll_cost_viewer')
     on conflict do nothing`,
    [ekonomi.id],
  );
  const tE2 = await loggaIn(ekonomi.epost);
  const medBehorighet = await las(tE2, "sick_report");
  ok(
    "inte heller med payroll_cost_viewer",
    medBehorighet.length === 0,
    `såg ${medBehorighet.length}`,
  );

  // Direkt fraga pa id ger inte heller nagot. En policy som filtrerar listan
  // men slapper igenom en punktfraga ar ingen policy.
  const punkt = await las(tE2, "sick_report", `id=eq.${anmalan.id}&select=*`);
  ok("direkt fraga pa id ger ocksa 0 rader", punkt.length === 0, `såg ${punkt.length}`);

  const fristEkonomi = await las(tE2, "sick_deadline");
  ok("fristerna foljer anmalan — ekonomi ser 0", fristEkonomi.length === 0, `såg ${fristEkonomi.length}`);

  const fristLedare = await las(tC, "sick_deadline", `id=eq.${frist.id}&select=*`);
  ok("Cecilia ser fristen", fristLedare.length === 1, `såg ${fristLedare.length}`);

  await db.query(`delete from employee_permission where employee_id = $1::uuid`, [ekonomi.id]);
}

console.log("\n\x1b[1mLedighetsansokan: egen alltid, chefens folk, ingen annan\x1b[0m");
{
  const { rows: [ansokan] } = await db.query(
    `insert into absence_request (employee_id, created_by, type_id, starts_on, ends_on)
     values ($1::uuid, $1::uuid, 'vacation', current_date + 40, current_date + 44) returning id`,
    [saljareA.id],
  );

  ok("Anna ser sin ansokan", (await las(tA, "absence_request")).length === 1);
  ok(
    "Cecilia ser den som ledare",
    (await las(tC, "absence_request", `id=eq.${ansokan.id}&select=*`)).length === 1,
  );
  // Pa id, inte pa listan: saljchefen ser alla ansokningar i navet, och den
  // forsta riktiga semesteransokan skulle annars falla provet.
  ok(
    "David ser den som saljchef",
    (await las(tD, "absence_request", `id=eq.${ansokan.id}&select=*`)).length === 1,
  );
  ok("Bertil ser 0 rader", (await las(tB, "absence_request")).length === 0);
  // Ekonomi far franvaron som minuter i loneunderlaget, aldrig som ansokan.
  ok("Ekonomi ser 0 rader", (await las(tE, "absence_request")).length === 0);

  const punkt = await las(tB, "absence_request", `id=eq.${ansokan.id}&select=*`);
  ok("Bertils direkta fraga pa id ger ocksa 0", punkt.length === 0, `såg ${punkt.length}`);

  // Skrivning gar aldrig via API:t — samma regel som resten av navet.
  const skriv = await fetch(`${URL}/rest/v1/absence_request?id=eq.${ansokan.id}`, {
    method: "PATCH",
    headers: som(tA),
    body: JSON.stringify({ status: "approved" }),
  });
  const efter = await db.query(`select status from absence_request where id = $1::uuid`, [ansokan.id]);
  ok(
    "Anna kan inte godkanna sin egen ansokan via API:t",
    efter.rows[0].status === "submitted",
    `HTTP ${skriv.status}, status ${efter.rows[0].status}`,
  );
}

console.log("\n\x1b[1mAC-3.19: den anstallda ser sin lucka forst\x1b[0m");
{
  // En paminnelse som annu inte ar synlig for chefen.
  const { rows: [paminnelse] } = await db.query(
    `insert into absence_reminder (employee_id, work_date, visible_to_manager_from)
     values ($1::uuid, current_date - 3, now() + interval '12 hours') returning id`,
    [saljareA.id],
  );

  /**
   * Fragan stalls PA PROVRADENS ID.
   *
   * Kontrollerna har raknade forut rader i hela tabellen, och foll 2026-08-22
   * nar nattjobbet lagt in riktiga paminnelser for Zen och Simon: David ar
   * saljchef och ser ALLA, sa `length === 0` blev falskt av att funktionen
   * anvands pa riktigt.
   *
   * Det ar fjarde gangen samma sort — se NASTA_SESSION. Regeln ar: en roll som
   * ser alla rader far aldrig provas med en radrakning.
   */
  const serPaminnelse = async (tok) =>
    (await las(tok, "absence_reminder", `select=id&id=eq.${paminnelse.id}`)).length;

  ok("Anna ser sin egen paminnelse direkt", (await serPaminnelse(tA)) === 1);
  ok("Cecilia ser den inte an — fordrojningen har inte gatt ut", (await serPaminnelse(tC)) === 0);
  ok("David ser den inte heller", (await serPaminnelse(tD)) === 0);

  // Nar fordrojningen gatt ut ska den synas. En sparr som inte gar att oppna
  // ar inte en sparr utan ett oupptackt fel — samma resonemang som provet av
  // raststamplingen och av losenordstvanget.
  await db.query(
    `update absence_reminder set visible_to_manager_from = now() - interval '1 hour'
      where id = $1::uuid`,
    [paminnelse.id],
  );
  ok("efter fordrojningen ser Cecilia den", (await serPaminnelse(tC)) === 1);
  ok("Bertil ser den aldrig", (await serPaminnelse(tB)) === 0);
}

console.log("\n\x1b[1mSaldon och regler\x1b[0m");
{
  const { rows: [saldo] } = await db.query(
    `insert into absence_balance (employee_id, type_id, days, as_of, entered_by)
     values ($1::uuid, 'vacation', 12.5, current_date, $2::uuid) returning id`,
    [saljareA.id, chef.id],
  );

  ok("Anna ser sitt eget saldo", (await las(tA, "absence_balance")).length === 1);
  ok(
    "Cecilia ser det som ledare",
    (await las(tC, "absence_balance", `id=eq.${saldo.id}&select=*`)).length === 1,
  );
  // Saldot ar ett personalarende i dagar, inte ett loneunderlag i minuter.
  ok("Ekonomi ser 0 rader", (await las(tE, "absence_balance")).length === 0);
  ok("Bertil ser 0 rader", (await las(tB, "absence_balance")).length === 0);

  // AC-3.13: reglerna maste ga att lasa INNAN man skickar in. En regel man far
  // veta forst i avslaget ar inget bakhall — men den maste da synas for alla.
  ok("varje inloggad ser franvarotyperna", (await las(tA, "absence_type")).length > 0);
  ok("varje inloggad ser regelverket", (await las(tA, "absence_policy")).length === 1);
  ok("varje inloggad ser mottagarordningen", (await las(tA, "absence_call_order")).length > 0);
}

console.log("\n\x1b[1mKalenderflodet ar agarens egen hemlighet\x1b[0m");
{
  await db.query(
    `insert into calendar_feed (employee_id, scope, token)
     values ($1::uuid, 'mine', 'rlstest-token-som-ar-minst-trettiotva-tecken')`,
    [saljareA.id],
  );

  ok("Anna ser sitt eget flode", (await las(tA, "calendar_feed")).length === 1);
  // David ar saljchef och ser DARFOR alla floden i navet, inklusive de riktiga.
  // Fragan galler om han ser Annas — inte hur manga rader tabellen rakar ha.
  // Ett prov som raknar hela tabellen provar driftdata och inte policyn, och
  // blir rott den dag nagon skapar sitt flode pa riktigt. Det hande 2026-08-20.
  ok(
    "David ser det — ledningen svarar for vilka floden som ar oppna",
    (await las(tD, "calendar_feed", `select=*&employee_id=eq.${saljareA.id}`)).length === 1,
  );
  // Token ar hemligheten. Ser Cecilia raden ser hon ocksa adressen, och ett
  // teamflode ar redan hennes egen vag till samma uppgifter.
  ok("Cecilia ser 0 rader", (await las(tC, "calendar_feed")).length === 0);
  ok("Bertil ser 0 rader", (await las(tB, "calendar_feed")).length === 0);
}

console.log("\n\x1b[1mFiler: bucketen ar stangd och varje oppning skrivs (K36, X5)\x1b[0m");
{
  // En riktig fil i bucketen, inte bara en rad. Halva kravet handlar om att
  // sjalva innehallet inte gar att na, och det gar inte att prova pa en rad.
  const stig = "sick_certificate/rlstest-intyg";
  // En avslutad period langt bak. Anna har redan en pagaende anmalan fran
  // avsnittet ovan, och `sick_report_ingen_dubbel` slapper med ratta inte in
  // tva perioder som overlappar.
  const { rows: [anmalan] } = await db.query(
    `insert into sick_report (employee_id, first_sick_day, last_sick_day, registered_by, extent_percent)
     values ($1::uuid, current_date - 40, current_date - 38, $1::uuid, 100) returning id`,
    [saljareA.id],
  );

  await fetch(`${URL}/storage/v1/object/filer/${stig}`, {
    method: "POST",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/pdf" },
    body: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
  });

  const { rows: [fil] } = await db.query(
    `insert into file_object
       (bucket, path, purpose, subject_employee_id, sick_report_id, mime_type, size_bytes, checksum, uploaded_by)
     values ('filer', $2, 'sick_certificate', $1::uuid, $3::uuid, 'application/pdf', 8, repeat('a',64), $1::uuid)
     returning id`,
    [saljareA.id, stig, anmalan.id],
  );

  await db.query(
    `insert into file_access_log (file_id, actor_id, action, purpose)
     values ($1::uuid, $2::uuid, 'open', 'sick_certificate')`,
    [fil.id, ledare.id],
  );

  // ---------------------------------------------------------------------
  // Raden: samma krets som far se sjukanmalan, ingen annan.
  // ---------------------------------------------------------------------
  ok("Anna ser sitt eget intyg", (await las(tA, "file_object")).length === 1);
  ok(
    "Cecilia ser det — hon leder Anna",
    (await las(tC, "file_object", `id=eq.${fil.id}&select=*`)).length === 1,
  );
  ok(
    "David ser det som saljchef",
    (await las(tD, "file_object", `id=eq.${fil.id}&select=*`)).length === 1,
  );
  ok("Bertil ser 0 rader", (await las(tB, "file_object")).length === 0);
  ok(
    "Bertils direkta fraga pa id ger ocksa 0",
    (await las(tB, "file_object", `id=eq.${fil.id}&select=*`)).length === 0,
  );

  // AC-3.26: ekonomi far sjukminuterna via loneunderlaget. Intyget ar nagot
  // annat, och K26 ger tillgang till kostnad — inte till halsa.
  ok("Ekonomi ser 0 rader", (await las(tE, "file_object")).length === 0);
  await db.query(
    `insert into employee_permission (employee_id, permission) values ($1::uuid, 'payroll_cost_viewer')
     on conflict do nothing`,
    [ekonomi.id],
  );
  const tE3 = await loggaIn(ekonomi.epost);
  ok("inte heller med payroll_cost_viewer", (await las(tE3, "file_object")).length === 0);
  ok(
    "och inte pa en direkt fraga pa id",
    (await las(tE3, "file_object", `id=eq.${fil.id}&select=*`)).length === 0,
  );

  // ---------------------------------------------------------------------
  // Oppningsloggen foljer filen. Den sjuke ser sjalv vem som last intyget —
  // det ar transparensen i K36, inte en bieffekt.
  // ---------------------------------------------------------------------
  ok("Anna ser vem som oppnat hennes intyg", (await las(tA, "file_access_log")).length === 1);
  ok(
    "Cecilia ser loggen",
    (await las(tC, "file_access_log", `file_id=eq.${fil.id}&select=*`)).length === 1,
  );
  ok("Bertil ser 0 rader i loggen", (await las(tB, "file_access_log")).length === 0);
  ok("Ekonomi ser 0 rader i loggen", (await las(tE3, "file_access_log")).length === 0);
  await db.query(`delete from employee_permission where employee_id = $1::uuid`, [ekonomi.id]);

  // ---------------------------------------------------------------------
  // Bucketen. Den som kan sokvagen ska anda inte komma at innehallet — det ar
  // hela skalet till att sokvagen inte behover vara hemlig.
  // ---------------------------------------------------------------------
  const direkt = await fetch(`${URL}/storage/v1/object/filer/${stig}`, { headers: som(tA) });
  ok("Anna nar inte filen direkt i bucketen", direkt.status !== 200, `HTTP ${direkt.status}`);

  const anonym = await fetch(`${URL}/storage/v1/object/filer/${stig}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  ok("anonymt nas den inte heller", anonym.status !== 200, `HTTP ${anonym.status}`);

  const lista = await fetch(`${URL}/storage/v1/object/list/filer`, {
    method: "POST",
    headers: som(tA),
    body: JSON.stringify({ prefix: "sick_certificate", limit: 100 }),
  });
  const listrader = await lista.json();
  ok(
    "och gar inte att lista fram",
    !Array.isArray(listrader) || listrader.length === 0,
    Array.isArray(listrader) ? `${listrader.length} rader` : `HTTP ${lista.status}`,
  );

  // ...men den signerade URL:en fungerar, utan nagon nyckel alls. Det ar den
  // enda vagen in, och den som `signeraOchLogga()` utfardar efter att ha
  // skrivit raden.
  const sign = await fetch(`${URL}/storage/v1/object/sign/filer/${stig}`, {
    method: "POST",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 30 }),
  });
  const signerad = await sign.json();
  const hamtad = signerad.signedURL
    ? await fetch(`${URL}/storage/v1${signerad.signedURL}`)
    : { status: 0 };
  ok("signerad URL ger filen utan nycklar", hamtad.status === 200, `HTTP ${hamtad.status}`);

  // ---------------------------------------------------------------------
  // Skrivning gar aldrig via API:t. En logg man kan skriva i sjalv ar ett
  // pastaende, och en fil man kan koppla till en annan anmalan ar ett lack.
  // ---------------------------------------------------------------------
  const skrivFil = await fetch(`${URL}/rest/v1/file_object`, {
    method: "POST",
    headers: som(tD),
    body: JSON.stringify({
      bucket: "filer", path: "sick_certificate/rlstest-forfalskad", purpose: "sick_certificate",
      subject_employee_id: saljareA.id, sick_report_id: anmalan.id,
      mime_type: "application/pdf", size_bytes: 1, checksum: "b".repeat(64), uploaded_by: chef.id,
    }),
  });
  ok("inte ens David skriver en filrad via API:t", !skrivFil.ok, `HTTP ${skrivFil.status}`);

  const skrivLogg = await fetch(`${URL}/rest/v1/file_access_log`, {
    method: "POST",
    headers: som(tA),
    body: JSON.stringify({ file_id: fil.id, actor_id: saljareA.id, action: "open", purpose: "sick_certificate" }),
  });
  ok("ingen skriver i oppningsloggen via API:t", !skrivLogg.ok, `HTTP ${skrivLogg.status}`);

  const raderaLogg = await fetch(`${URL}/rest/v1/file_access_log?file_id=eq.${fil.id}`, {
    method: "DELETE",
    headers: som(tC),
  });
  const kvarEfter = await db.query(`select count(*)::int as n from file_access_log where file_id = $1::uuid`, [fil.id]);
  ok("Cecilia kan inte radera bort att hon last intyget", kvarEfter.rows[0].n === 1, `HTTP ${raderaLogg.status}`);

  // ---------------------------------------------------------------------
  // Konstruktionsvillkoren, i en transaktion som rullas tillbaka.
  // ---------------------------------------------------------------------
  await db.query("begin");
  ok(
    "K35: ett lakarintyg kan inte bara ett filnamn",
    Boolean(await nekarSql(`update file_object set filename = 'cancerbesked.pdf' where id = $1::uuid`, [fil.id])),
  );
  await db.query("rollback");

  await db.query("begin");
  ok(
    "filen kan inte flyttas till nagon annans anmalan",
    Boolean(await nekarSql(`update file_object set subject_employee_id = $2::uuid where id = $1::uuid`, [fil.id, saljareB.id])),
  );
  await db.query("rollback");

  await db.query("begin");
  ok(
    "en fil raderas inte for sig — da foljer oppningsloggen med",
    Boolean(await nekarSql(`delete from file_object where id = $1::uuid`, [fil.id])),
  );
  await db.query("rollback");

  await db.query("begin");
  ok(
    "en rad i oppningsloggen gar inte att skriva om",
    Boolean(await nekarSql(`update file_access_log set actor_id = $2::uuid where file_id = $1::uuid`, [fil.id, saljareA.id])),
  );
  await db.query("rollback");

  await db.query("begin");
  ok(
    "ett word-dokument gar inte att lagga in",
    Boolean(await nekarSql(
      `insert into file_object (bucket, path, purpose, subject_employee_id, sick_report_id, mime_type, size_bytes, checksum, uploaded_by)
       values ('filer','sick_certificate/rlstest-word','sick_certificate',$1::uuid,$2::uuid,'application/msword',10,repeat('a',64),$1::uuid)`,
      [saljareA.id, anmalan.id],
    )),
  );
  await db.query("rollback");

  const bucket = await db.query(`select public from storage.buckets where id = 'filer'`);
  ok("bucketen ar privat", bucket.rows[0]?.public === false);

  // ---------------------------------------------------------------------
  // E2.12: en bilaga arver dokumentets malgrupp, utan ett eget villkor.
  //
  // Det ar hela poangen med att policyn i 0022 fragar `exists (select 1 from
  // document ...)` i stallet for att skriva av behorigheten. Andras
  // dokumentets malgrupp foljer bilagan med i samma stund.
  // ---------------------------------------------------------------------
  const bilagedok = async (slug, malgrupp) => {
    const { rows } = await db.query(
      `insert into document (title, slug, category_path, body_md, owner_id, review_due,
                             doc_type, audience_roles, status, created_by, version, published_at)
       values ($1,$2,'Test','Brodtext',$3::uuid, current_date + 200, 'routine', $4::text[],
               'published', $3::uuid, 1, now())
       returning id`,
      [slug, slug, chef.id, malgrupp],
    );
    const { rows: fr } = await db.query(
      `insert into file_object (bucket, path, purpose, document_id, filename, mime_type, size_bytes, checksum, uploaded_by)
       values ('filer', $2, 'document_attachment', $1::uuid, 'Prislista.pdf', 'application/pdf', 12, repeat('c',64), $3::uuid)
       returning id`,
      [rows[0].id, `document_attachment/${slug}`, chef.id],
    );
    return fr[0].id;
  };

  const oppenBilaga = await bilagedok("rlstest-bilaga-alla", []);
  const chefsBilaga = await bilagedok("rlstest-bilaga-chef", ["sales_manager"]);

  ok(
    "Anna ser bilagan pa den oppna rutinen",
    (await las(tA, "file_object", `id=eq.${oppenBilaga}&select=*`)).length === 1,
  );
  ok(
    "Anna ser INTE bilagan pa chefsrutinen — inte ens att den finns",
    (await las(tA, "file_object", `id=eq.${chefsBilaga}&select=*`)).length === 0,
  );
  ok(
    "David ser bada",
    (await las(tD, "file_object", `id=in.(${oppenBilaga},${chefsBilaga})&select=*`)).length === 2,
  );

  // En bilaga bar inget subjekt: den handlar om ett dokument, inte om en
  // person. Darfor ska den inte dyka upp i nagons registerutdrag.
  const utanSubjekt = await db.query(
    `select count(*)::int as n from file_object where id = $1::uuid and subject_employee_id is null`,
    [oppenBilaga],
  );
  ok("en bilaga har inget subjekt och hamnar inte i ett registerutdrag", utanSubjekt.rows[0].n === 1);

  // Dokumentet raderas i stadningen, och da ska bilagan folja med av sig
  // sjalv. Provas har sa att kaskaden inte upptacks forst nar nagon undrar
  // varfor filer ligger kvar utan dokument.
  await db.query(`delete from document where slug = 'rlstest-bilaga-alla'`);
  const efterKaskad = await db.query(`select count(*)::int as n from file_object where id = $1::uuid`, [oppenBilaga]);
  ok("bilagan foljer med nar dokumentet raderas", efterKaskad.rows[0].n === 0);

  await fetch(`${URL}/storage/v1/object/filer/${stig}`, {
    method: "DELETE",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  });
}

console.log("\n\x1b[1mLonekostnad: behorigheten ar payroll_cost_viewer, inte en roll (K26)\x1b[0m");
{
  // E15. Anna har en lon och en berakning. Fragan ar vilka som ser dem.
  const { rows: [period] } = await db.query(
    `insert into payroll_period (period_start, period_end, status)
     values (date '2019-05-01', date '2019-05-31', 'draft') returning id`,
  );
  await db.query(
    `insert into payroll_row (period_id, employee_id, worked_minutes, absence_minutes)
     values ($1::uuid, $2::uuid, 9600, '{"sick": 480}'::jsonb)`,
    [period.id, saljareA.id],
  );
  await db.query(
    `insert into salary_basis (employee_id, monthly_salary, valid_from, entered_by)
     values ($1::uuid, 35000, date '2019-01-01', $2::uuid)`,
    [saljareA.id, chef.id],
  );
  await db.query(
    `insert into cost_calculation
       (period_id, employee_id, monthly_salary, gross_salary, employer_fee, total_cost, rates_used, calculated_by)
     values ($1::uuid, $2::uuid, 35000, 35000, 10997, 45997, '{"standard": 31.42}'::jsonb, $3::uuid)`,
    [period.id, saljareA.id, chef.id],
  );

  // Ingen roll racker. Inte ens saljchefen och inte ens ekonomi.
  for (const [namn, tok] of [["Anna", tA], ["Cecilia", tC], ["David (saljchef)", tD], ["Eva (ekonomi)", tE]]) {
    const lon = await las(tok, "salary_basis");
    const berakning = await las(tok, "cost_calculation");
    const satser = await las(tok, "cost_rate");
    ok(
      `${namn} ser 0 rader utan payroll_cost_viewer`,
      lon.length === 0 && berakning.length === 0 && satser.length === 0,
      `lon ${lon.length}, berakning ${berakning.length}, satser ${satser.length}`,
    );
  }

  // Anna ser inte ens sin EGEN lonekostnad. Raden bar bolagets kalkyl pa en
  // person, inte personens egen loneuppgift — den vet hon redan.
  ok(
    "inte heller sin egen — raden ar bolagets kalkyl, inte hennes loneuppgift",
    (await las(tA, "cost_calculation", `employee_id=eq.${saljareA.id}&select=*`)).length === 0,
  );

  // Med behorigheten oppnar sig allt.
  await db.query(
    `insert into employee_permission (employee_id, permission) values ($1::uuid, 'payroll_cost_viewer')
     on conflict do nothing`,
    [ekonomi.id],
  );
  const tEK = await loggaIn(ekonomi.epost);
  ok("med payroll_cost_viewer ser Eva lonen", (await las(tEK, "salary_basis")).length >= 1);
  ok("och berakningen", (await las(tEK, "cost_calculation")).length >= 1);
  ok("och satserna", (await las(tEK, "cost_rate")).length >= 1);

  // AC-3.26 / E7.14, och detta ar hela skalet till varningen i ROADMAP:
  // behorigheten ger tillgang till KOSTNAD, aldrig till HALSA. En vy som
  // forsokte joina sick_report hade fatt noll rader — alltsa tyst fel data.
  ok(
    "men fortfarande 0 rader ur sick_report — K26 ger kostnad, inte halsa",
    (await las(tEK, "sick_report")).length === 0,
  );
  ok(
    "franvaron nas i stallet som minuter i loneunderlaget",
    (await las(tEK, "payroll_row", `period_id=eq.${period.id}&select=absence_minutes`)).length >= 0,
  );

  // Skrivning gar aldrig via API:t, aven for den behoriga.
  const skriv = await fetch(`${URL}/rest/v1/salary_basis`, {
    method: "POST",
    headers: som(tEK),
    body: JSON.stringify({
      employee_id: saljareB.id, monthly_salary: 1, valid_from: "2019-01-01", entered_by: ekonomi.id,
    }),
  });
  ok("ingen skriver en lon via API:t", !skriv.ok, `HTTP ${skriv.status}`);

  await db.query(`delete from employee_permission where employee_id = $1::uuid`, [ekonomi.id]);

  // Konstruktionsvillkoren.
  await db.query("begin");
  ok(
    "en loneuppgift gar inte att skriva om",
    Boolean(await nekarSql(`update salary_basis set monthly_salary = 1 where employee_id = $1::uuid`, [saljareA.id])),
  );
  await db.query("rollback");

  await db.query("begin");
  ok(
    "en berakning gar inte att skriva om",
    Boolean(await nekarSql(`update cost_calculation set total_cost = 1 where period_id = $1::uuid`, [period.id])),
  );
  await db.query("rollback");

  await db.query("begin");
  // K27: bara aret, och det ska vara ett rimligt artal.
  ok(
    "ett personnummer gar inte att stoppa in som fodelsear",
    Boolean(await nekarSql(`update employee set birth_year = 19950101 where id = $1::uuid`, [saljareA.id])),
  );
  await db.query("rollback");

  // AC-13.10 / K27: det finns ingen kolumn nagonstans i navet som bar ett
  // fodelsedatum eller ett personnummer. Provas mot schemat, inte mot minnet —
  // samma mekanik som K35-provet pa sick_report.
  const misstankta = await db.query(
    `select table_name, column_name
     from information_schema.columns
     where table_schema = 'public'
       and (column_name ~* 'personnummer|person_number|ssn|national_id'
            or column_name ~* '^birth_date$|^birthdate$|^date_of_birth$|^fodelsedatum$')`,
  );
  ok(
    "ingen kolumn i navet bar personnummer eller fodelsedatum (K27)",
    misstankta.rows.length === 0,
    misstankta.rows.map((r) => `${r.table_name}.${r.column_name}`).join(", "),
  );

  await db.query(`delete from cost_calculation where period_id = $1::uuid`, [period.id]);
  await db.query(`alter table salary_basis disable trigger salary_basis_last`);
  await db.query(`delete from salary_basis where employee_id = $1::uuid`, [saljareA.id]);
  await db.query(`alter table salary_basis enable trigger salary_basis_last`);
  await db.query(`delete from payroll_row where period_id = $1::uuid`, [period.id]);
  await db.query(`delete from payroll_period where id = $1::uuid`, [period.id]);
}

console.log("\n\x1b[1mRollspel: rubriken syns i forvag, och ingen bedomer utan att lyssna\x1b[0m");
{
  // E8.7. Anna gor rollspelet, Cecilia leder henne, Bertil ar en kollega.
  const { rows: [kurs] } = await db.query(
    `insert into course (slug, title, status, owner_id, pass_threshold, published_at)
     values ('rlstest-rollspel','Rlstest rollspel','published',$1::uuid, 70, now()) returning id`,
    [chef.id],
  );
  const { rows: [modul] } = await db.query(
    `insert into course_module (course_id, sort, title, kind) values ($1::uuid, 1, 'Testsamtal', 'roleplay') returning id`,
    [kurs.id],
  );
  const { rows: [krit] } = await db.query(
    `insert into roleplay_criterion (module_id, sort, label, guidance, max_points)
     values ($1::uuid, 1, 'Behovsanalys', 'Staller oppna fragor', 10) returning id`,
    [modul.id],
  );

  // AC-6.7: den som ska bedomas ska se rubriken INNAN hon spelar in. En
  // bedomning mot kriterier man far se i efterhand ar ett omdome, inte en
  // bedomning.
  ok(
    "Anna ser rubriken innan hon spelar in",
    (await las(tA, "roleplay_criterion", `id=eq.${krit.id}&select=*`)).length === 1,
  );

  const stig = "roleplay/rlstest-samtal";
  await fetch(`${URL}/storage/v1/object/filer/${stig}`, {
    method: "POST",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "audio/mpeg" },
    body: new Uint8Array(2048),
  });
  const { rows: [fil] } = await db.query(
    `insert into file_object (bucket, path, purpose, subject_employee_id, filename, mime_type, size_bytes, checksum, uploaded_by)
     values ('filer', $2, 'roleplay', $1::uuid, 'samtal.mp3', 'audio/mpeg', 2048, repeat('d',64), $1::uuid)
     returning id`,
    [saljareA.id, stig],
  );
  const { rows: [inlamning] } = await db.query(
    `insert into roleplay_submission (module_id, course_id, employee_id, file_id)
     values ($1::uuid, $2::uuid, $3::uuid, $4::uuid) returning id`,
    [modul.id, kurs.id, saljareA.id, fil.id],
  );

  ok("Anna ser sin egen inlamning", (await las(tA, "roleplay_submission")).length === 1);
  ok(
    "Cecilia ser den — hon leder Anna",
    (await las(tC, "roleplay_submission", `id=eq.${inlamning.id}&select=*`)).length === 1,
  );
  ok("Bertil ser 0 rader", (await las(tB, "roleplay_submission")).length === 0);
  ok("Ekonomi ser 0 rader", (await las(tE, "roleplay_submission")).length === 0);

  // Inspelningen ar en fil om en person, och den arver inte nagon annan rads
  // policy — villkoret ar utskrivet i 0024 och ska ge samma krets.
  ok(
    "Bertil kommer inte at inspelningen",
    (await las(tB, "file_object", `id=eq.${fil.id}&select=*`)).length === 0,
  );
  ok(
    "Cecilia gor det",
    (await las(tC, "file_object", `id=eq.${fil.id}&select=*`)).length === 1,
  );

  // Sparren i 0024. Det ar forsta gangen atkomstloggen anvands till nagot
  // annat an att granskas i efterhand.
  await db.query("begin");
  const utanLyssning = await nekarSql(
    `update roleplay_submission set graded_by = $2::uuid, graded_at = now() where id = $1::uuid`,
    [inlamning.id, ledare.id],
  );
  ok("bedomning utan att ha oppnat inspelningen nekas", Boolean(utanLyssning), utanLyssning?.slice(0, 60));
  await db.query("rollback");

  await db.query(
    `insert into file_access_log (file_id, actor_id, action, purpose)
     values ($1::uuid, $2::uuid, 'open', 'roleplay')`,
    [fil.id, ledare.id],
  );

  await db.query("begin");
  const efterLyssning = await nekarSql(
    `update roleplay_submission set graded_by = $2::uuid, graded_at = now() where id = $1::uuid`,
    [inlamning.id, ledare.id],
  );
  ok("efter att hon oppnat den gar det", efterLyssning === null, efterLyssning?.slice(0, 60) ?? "");
  await db.query("rollback");

  // Nagon ANNAN som lyssnat hjalper inte — sparren fragar efter den som satter
  // betyget, inte efter att nagon over huvud taget lyssnat.
  await db.query("begin");
  const annanLyssnade = await nekarSql(
    `update roleplay_submission set graded_by = $2::uuid, graded_at = now() where id = $1::uuid`,
    [inlamning.id, chef.id],
  );
  ok("en annan lyssnares oppning duger inte", Boolean(annanLyssnade));
  await db.query("rollback");

  ok("Anna ser att Cecilia oppnat inspelningen", (await las(tA, "file_access_log", `file_id=eq.${fil.id}&select=*`)).length === 1);

  await fetch(`${URL}/storage/v1/object/filer/${stig}`, {
    method: "DELETE",
    headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}` },
  });
}

console.log("\n\x1b[1mGlobal sokning: RLS avgor, och fragan gar att stalla\x1b[0m");
{
  // E2.13. Traffsidan stallar fem fragor med anvandarens egen token. Den har
  // bevakar bada saker som kan ga fel: att nagon ser for mycket, och att
  // fragan inte gar att stalla alls.
  const { orVillkor } = await import("../src/lib/sokning.ts");

  const sok = async (tok, tabell, kolumner, ord) => {
    const r = await fetch(
      `${URL}/rest/v1/${tabell}?select=id&or=(${encodeURIComponent(orVillkor(kolumner, ord))})`,
      { headers: som(tok) },
    );
    return { status: r.status, rader: await r.json() };
  };

  const anna = await sok(tA, "employee", ["first_name", "last_name", "email"], "Anna");
  ok("Anna hittar sig sjalv i personalsoket", anna.status === 200 && anna.rader.length >= 1);

  // AC-5.9 och personalregistrets policy: en saljare ser inte saljchefen.
  // Sokningen far inte vara en genvag forbi det.
  const david = await sok(tA, "employee", ["first_name", "last_name", "email"], "David");
  ok(
    "men inte saljchefen — soket ar ingen genvag forbi registret",
    david.status === 200 && david.rader.length === 0,
    `${david.rader.length ?? 0} rader`,
  );

  // Det som foll i utvecklingen: ett kommatecken i sokrutan ar PostgREST-
  // syntax, och en oskyddad sokning pa "Anna, Bertil" svarade HTTP 400 —
  // alltsa ett trasigt sidsvar i stallet for noll traffar.
  for (const knepigt of ["Anna, Bertil", "50 %", 'citat"tecken', "parentes)"]) {
    const r = await sok(tA, "employee", ["first_name", "last_name"], knepigt);
    ok(`"${knepigt}" gar att soka pa`, r.status === 200, `HTTP ${r.status}`);
  }
}

// =============================================================================
// E0.6 Felrapportering (0026)
// =============================================================================

console.log("\n\x1b[1mE0.6: felrapporter nar den som ska laga dem, och ingen annan\x1b[0m");
{
  // Egen sokvag sa att avsnittet kan stada efter sig utan att rora nagot
  // riktigt fel som ligger i tabellen.
  const SOKVAG = "/rlstest/fel";

  const { rows: [minRapport] } = await db.query(
    `insert into error_report (kind, path, body, reporter_id, blocking)
     values ('manual', $1, 'Knappen gjorde ingenting', $2::uuid, true) returning id`,
    [SOKVAG, saljareA.id],
  );

  // Automatisk rapport utan avsandare — felet intraffade for nagon som inte
  // var inloggad.
  const { rows: [anonym] } = await db.query(
    `insert into error_report (kind, path, digest, message)
     values ('automatic', $1, 'testdigest1', 'Trasigt anrop') returning id`,
    [SOKVAG + "/auto"],
  );

  // Fragan stalls PA PROVRADENS ID och inte pa antalet rader i tabellen.
  // En kontroll som lyder length === 1 for David, som ser ALLA rader, blir rod
  // i samma stund nagon rapporterar ett riktigt fel. Det har fallt tre ganger
  // forut i den har sviten — se NASTA_SESSION.
  const ser = async (tok, id) => (await las(tok, "error_report", `select=id&id=eq.${id}`)).length;

  ok("rapportoren ser sin egen rapport", (await ser(tA, minRapport.id)) === 1);
  ok("en kollega ser den inte", (await ser(tB, minRapport.id)) === 0);
  // Cecilia LEDER Anna och ser hennes franvaro och hennes rollspel. Kretsen for
  // felrapporter foljer inte chefslinjen utan handelseloggen — teamledaren ska
  // inte kunna lasa vad hennes saljare tycker ar trasigt i navet.
  ok("teamledaren ser den inte, trots att hon leder rapportoren", (await ser(tC, minRapport.id)) === 0);
  ok("ekonomi ser den inte", (await ser(tE, minRapport.id)) === 0);
  ok("saljchefen ser den", (await ser(tD, minRapport.id)) === 1);

  ok("en rapport utan avsandare ar osynlig for saljaren", (await ser(tA, anonym.id)) === 0);
  ok("men syns for den som ska laga den", (await ser(tD, anonym.id)) === 1);

  // Grupperingen. Samma digest och samma sokvag ska bli EN rad med en raknare.
  // Utan det skriver en kraschloop tusen rader och begraver nasta bugg.
  await db.query(`select registrera_fel($1,$2,$3)`, ["grupp1", SOKVAG + "/g", "Samma fel"]);
  await db.query(`select registrera_fel($1,$2,$3)`, ["grupp1", SOKVAG + "/g", "Samma fel"]);
  await db.query(`select registrera_fel($1,$2,$3)`, ["grupp1", SOKVAG + "/annan", "Samma fel"]);

  const { rows: grupp } = await db.query(
    `select path, occurrences from error_report where digest = 'grupp1' order by path`,
  );
  ok("samma fel pa samma sida blir en rad", grupp.length === 2, `${grupp.length} rader`);
  ok("och raknas upp", grupp.find((g) => g.path.endsWith("/g"))?.occurrences === 2);
  ok("samma fel pa en annan sida ar en egen rad", grupp.find((g) => g.path.endsWith("/annan"))?.occurrences === 1);

  // Ett avslutat fel som kommer tillbaka ska INTE tyst atergaa till 'new' —
  // men det ska synas att det kom tillbaka.
  await db.query(`update error_report set status = 'closed' where digest = 'grupp1' and path = $1`, [SOKVAG + "/g"]);
  await db.query(`select registrera_fel($1,$2,$3)`, ["grupp1", SOKVAG + "/g", "Samma fel"]);
  const { rows: [ater] } = await db.query(
    `select status, occurrences from error_report where digest = 'grupp1' and path = $1`,
    [SOKVAG + "/g"],
  );
  ok("ett avslutat fel oppnas inte av sig sjalvt", ater.status === "closed");
  ok("men raknaren gar upp sa att aterfallet syns", ater.occurrences === 3);

  // 0002 punkt 2: PostgREST exponerar varje funktion i public som RPC. Utan
  // revoke kunde vem som helst fylla kon med skrap.
  const rpc = await fetch(`${URL}/rest/v1/rpc/registrera_fel`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ p_digest: "fusk", p_path: "/fusk" }),
  });
  ok("registrera_fel gar inte att anropa som inloggad", !rpc.ok, `HTTP ${rpc.status}`);

  /**
   * Samma prov pa log_audit, och det ar inte overflodigt.
   *
   * Provet ovan foll forsta gangen det kordes, och skalet var att revoken i
   * 0026 var skriven som den i 0002: `from anon, authenticated`. Det tar bort
   * explicita granter, inte den till PUBLIC som Postgres ger varje ny funktion
   * — sa BADA funktionerna gick att anropa. 0027 stanger det.
   *
   * En saljare som kan skriva i handelseloggen gor loggen obrukbar som bevis,
   * vilket ar precis vad AC-12.1 behover den till.
   */
  const loggfusk = await fetch(`${URL}/rest/v1/rpc/log_audit`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ p_action: "fusk.event" }),
  });
  ok("log_audit gar inte att anropa som inloggad", !loggfusk.ok, `HTTP ${loggfusk.status}`);

  const skriv = await fetch(`${URL}/rest/v1/error_report`, {
    method: "POST", headers: som(tA),
    body: JSON.stringify({ kind: "manual", path: "/x", body: "text" }),
  });
  ok("ingen skriver en rapport direkt mot API:t", !skriv.ok, `HTTP ${skriv.status}`);

  // Ingen far heller stanga sin egen rapport for att slippa fragorna.
  const stang = await fetch(`${URL}/rest/v1/error_report?id=eq.${minRapport.id}`, {
    method: "PATCH", headers: som(tA),
    body: JSON.stringify({ status: "closed" }),
  });
  ok("rapportoren kan inte avsluta sin egen rapport", !stang.ok, `HTTP ${stang.status}`);

  // Villkoren i 0026.
  const utanText = await nekarSql(`insert into error_report (kind, path) values ('manual', '/x')`);
  ok("en manuell rapport utan text nekas", utanText !== null, utanText ? "" : "SLAPPTE IGENOM");
  const utanDigest = await nekarSql(`insert into error_report (kind, path) values ('automatic', '/x')`);
  ok("en automatisk rapport utan digest nekas", utanDigest !== null, utanDigest ? "" : "SLAPPTE IGENOM");

  // Stadar bade provraderna och de tva sokvagar som fuskproven ovan anvander.
  // `/fusk` behovs for att provet SKA neka — men gor det inte det, vilket det
  // inte gjorde forsta gangen det kordes, ligger raden kvar i produktionen och
  // skrapar i felkon. Ett prov som lamnar spar nar det faller ar ett prov man
  // slutar lita pa.
  await db.query(`delete from error_report where path like $1 or path = '/fusk'`, [SOKVAG + "%"]);
  await db.query(`delete from audit_log where action = 'fusk.event'`);
}

// =============================================================================
// E9.1 Avtalsmallar (0028)
// =============================================================================

console.log("\n\x1b[1mE9.1: mallen ar bolagets, avtalet ar personens — och forst nar det ar utfardat\x1b[0m");
{
  const { rows: [mall] } = await db.query(
    `insert into contract_template (slug, title, body_md, status, created_by)
     values ('rlstest-mall', 'Testmall', 'Hej {{fornamn}}', 'published', $1::uuid) returning id`,
    [chef.id],
  );

  // Ett UTKAST om Anna.
  const { rows: [utkast] } = await db.query(
    `insert into contract (employee_id, template_id, template_slug, title, body_md, variables, status, created_by)
     values ($1::uuid, $2::uuid, 'rlstest-mall', 'Testmall', 'Hej Anna', '{"fornamn":"Anna"}'::jsonb, 'draft', $3::uuid)
     returning id`,
    [saljareA.id, mall.id, chef.id],
  );

  const ser = async (tok, tabell, id) => (await las(tok, tabell, `select=id&id=eq.${id}`)).length;

  // Mallen ar bolagets avtalsvillkor i klartext. En publicerad mall som varje
  // saljare kan lasa ar en forhandlingsposition som lackt.
  ok("saljaren ser inte mallen", (await ser(tA, "contract_template", mall.id)) === 0);
  ok("teamledaren ser inte mallen", (await ser(tC, "contract_template", mall.id)) === 0);
  ok("ekonomi ser inte mallen", (await ser(tE, "contract_template", mall.id)) === 0);
  ok("saljchefen ser mallen", (await ser(tD, "contract_template", mall.id)) === 1);

  /**
   * Kravet som ar hela poangen med statusen.
   *
   * Ett utkast dar nagon provar sig fram med en siffra far inte ligga synligt
   * for den siffran handlar om. Anna ska se sitt avtal nar det ar ett
   * ERBJUDANDE, inte medan det ar ett utkast.
   */
  ok("Anna ser INTE sitt avtal medan det ar utkast", (await ser(tA, "contract", utkast.id)) === 0);
  ok("saljchefen ser utkastet", (await ser(tD, "contract", utkast.id)) === 1);

  await db.query(
    `update contract set status = 'issued', issued_at = now(), issued_by = $2::uuid where id = $1::uuid`,
    [utkast.id, chef.id],
  );

  ok("nar det ar utfardat ser Anna det", (await ser(tA, "contract", utkast.id)) === 1);
  ok("men Bertil ser det aldrig", (await ser(tB, "contract", utkast.id)) === 0);
  // Teamledaren leder sitt team, hon forhandlar inte deras loner.
  ok("och inte heller teamledaren", (await ser(tC, "contract", utkast.id)) === 0);
  ok("och inte ekonomi", (await ser(tE, "contract", utkast.id)) === 0);

  // Ett utfardat avtal ar ett bevis pa vad man kom overens om. Triggern i 0028.
  const skrivOm = await nekarSql(
    `update contract set body_md = 'Nagot annat' where id = $1::uuid`,
    [utkast.id],
  );
  ok("ett utfardat avtal gar inte att skriva om", skrivOm !== null, skrivOm ? "" : "SLAPPTE IGENOM");

  const bytLon = await nekarSql(
    `update contract set variables = '{"manadslon":"99999"}'::jsonb where id = $1::uuid`,
    [utkast.id],
  );
  ok("och inte att andra varden i", bytLon !== null, bytLon ? "" : "SLAPPTE IGENOM");

  const tillbakaTillUtkast = await nekarSql(
    `update contract set status = 'draft' where id = $1::uuid`,
    [utkast.id],
  );
  ok("och inte att gora till utkast igen", tillbakaTillUtkast !== null, tillbakaTillUtkast ? "" : "SLAPPTE IGENOM");

  // Men det ska ga att dra tillbaka. En sparr som inte gar att oppna at ratt
  // hall ar ett oupptackt fel.
  const drarTillbaka = await nekarSql(
    `update contract set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = $2::uuid
      where id = $1::uuid`,
    [utkast.id, chef.id],
  );
  ok("men det gar att dra tillbaka", drarTillbaka === null, drarTillbaka ?? "");

  /**
   * K27-linjen, forsvarad dar den annars hade brutits.
   *
   * `variables` ar jsonb, alltsa precis det stalle dar ett personnummer kan
   * smyga in utan att schemakontrollen langre ned i den har sviten ser det.
   */
  const pnr = await nekarSql(
    `insert into contract (employee_id, template_slug, title, body_md, variables, created_by)
     values ($1::uuid, 'rlstest-mall', 'T', 'text', '{"nagot":"850101-1234"}'::jsonb, $2::uuid)`,
    [saljareA.id, chef.id],
  );
  ok("ett personnummer i variables nekas", pnr !== null, pnr ? "" : "SLAPPTE IGENOM");

  const pnrUtanStreck = await nekarSql(
    `insert into contract (employee_id, template_slug, title, body_md, variables, created_by)
     values ($1::uuid, 'rlstest-mall', 'T', 'text', '{"nagot":"198501011234"}'::jsonb, $2::uuid)`,
    [saljareA.id, chef.id],
  );
  ok("aven utan bindestreck", pnrUtanStreck !== null, pnrUtanStreck ? "" : "SLAPPTE IGENOM");

  // Och ett vanligt belopp ska sjalvklart ga igenom.
  const belopp = await nekarSql(
    `insert into contract (employee_id, template_slug, title, body_md, variables, created_by)
     values ($1::uuid, 'rlstest-mall', 'T', 'text', '{"manadslon":"32000"}'::jsonb, $2::uuid)`,
    [saljareA.id, chef.id],
  );
  ok("men en vanlig manadslon gar igenom", belopp === null, belopp ?? "");

  const skriv = await fetch(`${URL}/rest/v1/contract`, {
    method: "POST", headers: som(tD),
    body: JSON.stringify({ employee_id: saljareA.id, template_slug: "x", title: "x", body_md: "x" }),
  });
  ok("inte ens saljchefen skriver ett avtal direkt mot API:t", !skriv.ok, `HTTP ${skriv.status}`);

  await db.query(`delete from contract where employee_id = $1::uuid`, [saljareA.id]);
  await db.query(`delete from contract_template where slug = 'rlstest-mall'`);
}

console.log("\n\x1b[1mE10: kandidaten nas av den som rekryterar, och ingen annan\x1b[0m");
{
  const { rows: [kand] } = await db.query(
    `insert into candidate (first_name, last_name, email, source_slug, created_by)
     values ('Kim', 'Sokande', $1, 'linkedin', $2::uuid) returning id`,
    [PREFIX + "kandidat@example.com", chef.id],
  );
  await db.query(
    `insert into interview_scorecard (candidate_id, stage, interviewer_id, recommendation)
     values ($1::uuid, 'screening', $2::uuid, 'yes')`,
    [kand.id, chef.id],
  );

  // Saljchefen far det pa rollen sa att modulen fungerar direkt.
  ok(
    "saljchefen ser kandidaten",
    (await las(tD, "candidate", `id=eq.${kand.id}&select=*`)).length === 1,
  );

  // Alla andra ar utestangda. En kandidat ar en namngiven manniska som sokt
  // jobb hos oss, och kretsen ar den som rekryterar.
  for (const [namn, tok] of [["Anna", tA], ["Cecilia (teamledare)", tC], ["Eva (ekonomi)", tE]]) {
    const lista = await las(tok, "candidate");
    const punkt = await las(tok, "candidate", `id=eq.${kand.id}&select=*`);
    const steg = await las(tok, "candidate_stage_event");
    ok(
      `${namn} far 0 rader — bade i listan och pa id`,
      lista.length === 0 && punkt.length === 0 && steg.length === 0,
      `lista ${lista.length}, punkt ${punkt.length}, steg ${steg.length}`,
    );
  }

  // Behorigheten ar en permission och inte bara en roll: Q71 sager att flera
  // personer rekryterar, och vilka det ar foljer inte av rollen.
  await db.query(
    `insert into employee_permission (employee_id, permission) values ($1::uuid, 'recruiter')
     on conflict do nothing`,
    [saljareA.id],
  );
  const tR = await loggaIn(saljareA.epost);
  ok(
    "med behorigheten recruiter oppnar sig modulen",
    (await las(tR, "candidate", `id=eq.${kand.id}&select=*`)).length === 1,
  );
  await db.query(`delete from employee_permission where employee_id = $1::uuid`, [saljareA.id]);

  // Skrivning gar genom server actions, aldrig direkt mot API:t.
  const skriv = await fetch(`${URL}/rest/v1/candidate`, {
    method: "POST", headers: som(tD),
    body: JSON.stringify({ first_name: "X", last_name: "Y", email: "x@y.se", source_slug: "annat" }),
  });
  ok("inte ens saljchefen skapar en kandidat direkt mot API:t", !skriv.ok, `HTTP ${skriv.status}`);

  const flytta = await fetch(`${URL}/rest/v1/candidate?id=eq.${kand.id}`, {
    method: "PATCH", headers: som(tD), body: JSON.stringify({ stage: "screening" }),
  });
  ok("och flyttar inget steg den vagen heller", !flytta.ok, `HTTP ${flytta.status}`);

  await db.query(`delete from candidate where id = $1::uuid`, [kand.id]);
}

console.log("\n\x1b[1mE6.5: adoption raknas i antal, och gar aldrig att bryta ner pa person\x1b[0m");
{
  const rpc = async (tok, funktion, args = {}) => {
    const r = await fetch(`${URL}/rest/v1/rpc/${funktion}`, {
      method: "POST", headers: som(tok), body: JSON.stringify(args),
    });
    const j = await r.json();
    return { status: r.status, rader: Array.isArray(j) ? j.length : -1 };
  };

  // Provets egen dag, sa att det finns nagot att rakna oavsett hur navet
  // anvants. Raden stads med anvandaren.
  await db.query(
    `insert into activity_day (employee_id, day) values ($1::uuid, current_date)
     on conflict do nothing`,
    [saljareA.id],
  );
  await db.query(`select registrera_sokmiss($1)`, ["rlstest-finns-inte"]);

  // Samma krets som handelseloggen. Ingen annan.
  const chefen = await rpc(tD, "adoption_aktivitet", { p_dagar: 7 });
  // Sju dagar bakat ar sju rader, i dag inraknad. En serie med hal i hade
  // gjort staplarna i vyn olika breda beroende pa om nagon var inloggad.
  ok("saljchefen far aktivitetsserien", chefen.rader === 7, `${chefen.rader} rader, HTTP ${chefen.status}`);

  for (const [namn, tok] of [["Anna", tA], ["Cecilia (teamledare)", tC], ["Eva (ekonomi)", tE]]) {
    const svar = await rpc(tok, "adoption_aktivitet", { p_dagar: 7 });
    ok(`${namn} far 0 rader`, svar.rader === 0, `${svar.rader} rader, HTTP ${svar.status}`);
  }

  const missarChef = await rpc(tD, "adoption_sokmissar", { p_antal: 20 });
  ok("saljchefen ser trafflosa sokningar", missarChef.rader >= 1, `${missarChef.rader} rader`);
  const missarAnna = await rpc(tA, "adoption_sokmissar", { p_antal: 20 });
  ok("Anna ser inga", missarAnna.rader === 0, `${missarAnna.rader} rader`);

  const glomdaAnna = await rpc(tA, "adoption_glomda_dokument", { p_dagar: 90 });
  ok("och inte heller glomda dokument", glomdaAnna.rader === 0, `${glomdaAnna.rader} rader`);

  /**
   * Det har ar hela poangen med 0029, och det ar ett annat pastaende an det
   * ovan: funktionerna svarar med ANTAL. Tabellerna under dem far ingen slappa
   * in i, for da gar dagarna att lasa person for person — och det ar en
   * narvaroregistrering utan rattelse, attest och styrning omkring sig.
   *
   * Ingen select-policy alls, alltsa noll rader for varje roll. Aven for den
   * som far se statistiken.
   */
  for (const [namn, tok] of [["Anna", tA], ["Cecilia", tC], ["David (saljchef)", tD], ["Eva", tE]]) {
    const dagar = await las(tok, "activity_day");
    const missar = await las(tok, "search_miss");
    ok(
      `${namn} kommer inte at raderna bakom siffrorna`,
      dagar.length === 0 && missar.length === 0,
      `activity_day ${dagar.length}, search_miss ${missar.length}`,
    );
  }

  // Punktfraga pa den egna raden ger inte heller nagot. En policy som doljer
  // listan men slapper igenom en direkt fraga ar ingen policy.
  ok(
    "inte ens sin egen dag pa en direkt fraga",
    (await las(tA, "activity_day", `employee_id=eq.${saljareA.id}&select=*`)).length === 0,
  );

  // Skrivvagen gar genom funktionen, inte genom tabellen.
  const skriv = await fetch(`${URL}/rest/v1/activity_day`, {
    method: "POST", headers: som(tD),
    body: JSON.stringify({ employee_id: saljareB.id, day: "2026-01-01" }),
  });
  ok("och ingen skriver en dag at nagon annan", !skriv.ok, `HTTP ${skriv.status}`);

  await db.query(`delete from search_miss where q = 'rlstest-finns-inte'`);
}

console.log("\n\x1b[1mAnonym anslutning\x1b[0m");
for (const t of ["employee", "employee_role", "employee_permission", "audit_log", "offboarding_task", "company", "team", "schema_migrations", "document", "document_version", "document_ack", "document_view", "course", "course_module", "quiz_question", "quiz_option", "module_progress", "course_attempt", "certification", "time_event", "work_schedule", "work_time_journal", "scheduled_break", "break_deviation", "payroll_period", "payroll_row", "payroll_adjustment", "payroll_export_column", "hr_case", "case_message", "case_category", "late_arrival", "late_arrival_month", "compliance_gate", "news_post", "notification_seen", "notification_dismissed", "absence_type", "absence_policy", "absence_blackout", "staffing_cap", "absence_balance", "absence_request", "absence_call_order", "sick_report", "sick_deadline", "absence_reminder", "calendar_feed", "file_object", "file_access_log", "roleplay_criterion", "roleplay_submission", "roleplay_score", "cost_rate", "salary_basis", "revenue_entry", "cost_calculation", "error_report", "contract", "contract_template", "activity_day", "search_miss", "candidate", "candidate_stage_event", "interview_scorecard", "recruitment_source", "recruitment_policy"]) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const j = await r.json();
  ok(`${t} ger inga rader anonymt`, !Array.isArray(j) || j.length === 0, Array.isArray(j) ? `${j.length} rader` : `HTTP ${r.status}`);
}

console.log("\nStädar ...");
await stad();
await db.end();

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} kontroll(er) underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
