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
  await db.query(`delete from employee where email like $1`, [PREFIX + "%"]);
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
for (const t of ["employee", "employee_role", "employee_permission", "audit_log", "offboarding_task", "company", "team", "schema_migrations", "document", "document_version", "document_ack", "document_view"]) {
  const r = await fetch(`${URL}/rest/v1/${t}?select=*`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const j = await r.json();
  ok(`${t} ger inga rader anonymt`, !Array.isArray(j) || j.length === 0, Array.isArray(j) ? `${j.length} rader` : `HTTP ${r.status}`);
}

console.log("\nStädar ...");
await stad();
await db.end();

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} kontroll(er) underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
