#!/usr/bin/env node
/**
 * E5.3 / X3: mater startsidan.
 *
 *   node --env-file=$HOME/.clicknet/nav.env scripts/mat-startsidan.mjs
 *
 * ===========================================================================
 * VAD DEN MATER, OCH VAD DEN INTE MATER
 *
 * Den mater tva saker pa riktigt:
 *
 *   1. VAGORNA. Startsidan och (app)-layouten hamtar data i ett antal
 *      SEKVENTIELLA omgangar. Varje omgang ar en rundtur till Supabase som
 *      maste vanta in den forra. Det ar den delen av svarstiden som gar att
 *      gora nagot at i kod, och den enda som vaxer nar navet vaxer.
 *
 *   2. NYTTOLASTEN. Hur manga byte webblasaren maste hamta hem, matt mot
 *      produktionen med samma komprimering en riktig webblasare far.
 *
 *   Den mater INTE den inloggade startsidans TTFB fran produktionen. Sidan
 *   ligger bakom inloggning, och en session gar inte att skapa harifran utan
 *   att gora avkall pa nagot. Den siffran kraver en riktig webblasare med en
 *   riktig session — se docs/ARBETSLOGG.md.
 *
 * Latensen harifran till Supabase ar HOGRE an fran Vercels funktion, som star
 * i samma region som databasen. Antalet vagor ar daremot detsamma, och det ar
 * antalet som ar slutsatsen.
 * ===========================================================================
 */
import pg from "pg";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const ADMIN = { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" };
const PROD = process.env.NAV_URL ?? "https://clicknet-nav.vercel.app";

const EPOST = "mattest+start@clicknet.se";
const LOSEN = "Mattlosen!" + Math.random().toString(36).slice(2, 10);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

async function stad() {
  const { rows } = await db.query(`select id, auth_user_id from employee where email = $1`, [EPOST]);
  for (const r of rows) {
    if (r.auth_user_id) {
      await fetch(`${URL}/auth/v1/admin/users/${r.auth_user_id}`, { method: "DELETE", headers: ADMIN });
    }
    await db.query(`delete from employee where id = $1::uuid`, [r.id]);
  }
}

await stad();

// En saljchef: den roll som ser FLEST koer pa startsidan, alltsa det dyraste
// fallet. En saljare hamtar farre rader men lika manga vagor.
const skapad = await fetch(`${URL}/auth/v1/admin/users`, {
  method: "POST", headers: ADMIN,
  body: JSON.stringify({ email: EPOST, password: LOSEN, email_confirm: true }),
}).then((r) => r.json());

const { rows: [anst] } = await db.query(
  `insert into employee (auth_user_id, email, first_name, last_name, status, employment_type)
   values ($1::uuid,$2,'Matt','Testsson','active','permanent') returning id`,
  [skapad.id, EPOST],
);
await db.query(`insert into employee_role (employee_id, role) values ($1::uuid,'sales_manager')`, [anst.id]);

const token = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EPOST, password: LOSEN }),
}).then((r) => r.json()).then((j) => j.access_token);

const som = { apikey: ANON, Authorization: `Bearer ${token}` };
const idag = new Date().toISOString().slice(0, 10);

const q = (fraga) => fetch(`${URL}/rest/v1/${fraga}`, { headers: som }).then((r) => r.text());

/**
 * Vagorna, i den ordning navet gor dem. Varje `vag` ar ett `await` som maste
 * vanta in den forra — det ar det som gor dem dyra, inte antalet fragor inuti.
 */
const VAGOR = [
  ["getCurrentUser: employee", [`employee?select=*&auth_user_id=eq.${skapad.id}`]],
  ["getCurrentUser: roller och behorigheter", [
    `employee_role?select=role&employee_id=eq.${anst.id}`,
    `employee_permission?select=permission&employee_id=eq.${anst.id}`,
  ]],
  ["hamtaLage: compliance_gate", [`compliance_gate?select=*`]],
  ["layout: notisklockan", [
    `notification_seen?select=seen_at&employee_id=eq.${anst.id}`,
    `news_post?select=id,slug,title,published_at,pinned&status=eq.published&order=published_at.desc&limit=15`,
    `document?select=id,slug,title,version,published_at&status=eq.published&requires_ack=eq.true`,
    `document_ack?select=document_id,version&employee_id=eq.${anst.id}`,
    `course?select=id,slug,title,due_days,published_at&status=eq.published`,
    `course_module?select=id,course_id`,
    `module_progress?select=module_id&employee_id=eq.${anst.id}`,
    `certification?select=course_id,issued_at,expires_at&employee_id=eq.${anst.id}&order=issued_at.desc`,
    `case_message?select=id,created_at,author_id,case_id,hr_case(id,subject,employee_id)&author_id=neq.${anst.id}&order=created_at.desc&limit=30`,
    `employee?select=id,first_name,last_name`,
    `absence_type?select=id,label`,
    `roleplay_submission?select=id,employee_id,submitted_at,graded_at&order=submitted_at.desc&limit=15`,
    `error_report?select=id,kind,path,status,blocking,reporter_id,first_seen_at,handled_at&order=last_seen_at.desc&limit=15`,
  ]],
  ["sida vag 1: rutiner och egna arenden", [
    `document?select=id,slug,title,version,review_due&status=eq.published&requires_ack=eq.true&order=review_due`,
    `document_ack?select=document_id,version&employee_id=eq.${anst.id}`,
    `document?select=id,slug,title,review_due&owner_id=eq.${anst.id}&status=eq.published&review_due=lte.${idag}&order=review_due`,
    `hr_case?select=id,subject,status,resolved_at,due_at,sla_hours&employee_id=eq.${anst.id}&status=eq.waiting&resolved_at=is.null&order=due_at`,
  ]],
  ["sida vag 2: kurser", [
    `course?select=id,slug,title,due_days&status=eq.published&order=title`,
    `course_module?select=id,course_id`,
    `module_progress?select=module_id&employee_id=eq.${anst.id}`,
    `certification?select=course_id,issued_at,expires_at&employee_id=eq.${anst.id}&order=issued_at.desc`,
  ]],
  ["sida vag 3: chefens koer", [
    `hr_case?select=id,due_at,sla_hours,resolved_at&resolved_at=is.null&status=in.(new,in_progress)`,
    `absence_request?select=id,employee_id,starts_on,rules_broken&status=eq.submitted`,
    `sick_report?select=id,employee_id&confirmed_at=is.null&cancelled_at=is.null`,
  ]],
  ["sida vag 4: rollspel", [`roleplay_submission?select=id,employee_id,submitted_at&graded_at=is.null`]],
  ["sida vag 5: personalrakning", [
    `employee?select=id&status=eq.active`,
    `employee?select=id&status=eq.onboarding`,
  ]],
];

console.log(`\n\x1b[1mVagorna\x1b[0m  (${VAGOR.length} sekventiella omgangar)\n`);

// En uppvarmning som inte raknas: forsta anropet betalar for uppkoppling och
// TLS, och den kostnaden finns inte i en varm serverlos funktion.
await q(`employee?select=id&limit=1`);

let summa = 0;
let fragor = 0;
for (const [namn, lista] of VAGOR) {
  const t0 = performance.now();
  await Promise.all(lista.map(q));
  const ms = performance.now() - t0;
  summa += ms;
  fragor += lista.length;
  console.log(`  ${String(Math.round(ms)).padStart(5)} ms  ${namn}  (${lista.length} ${lista.length > 1 ? "frågor" : "fråga"})`);
}

console.log(`\n  ${String(Math.round(summa)).padStart(5)} ms  SUMMA  ${fragor} frågor i ${VAGOR.length} vågor`);
console.log(
  `\n  Latensen harifran ar hogre an fran Vercels funktion, som star i samma\n` +
  `  region som databasen. Det som ar jamforbart ar ANTALET vagor: ${VAGOR.length}.\n`,
);

// ---------------------------------------------------------------------------

console.log(`\x1b[1mNyttolast och svarstid fran produktionen\x1b[0m  ${PROD}\n`);

/**
 * Storleken mats med curl, inte med fetch.
 *
 * Nodes fetch (undici) satter sin egen `accept-encoding` och packar upp svaret
 * at en. Bade `arrayBuffer().byteLength` och `content-length` blev darfor den
 * UPPACKADE storleken — tre ganger sa stor som det som faktiskt gar over natet,
 * och en 4G-uppskattning byggd pa den blir tre ganger for pessimistisk.
 *
 * Bada varianterna provades och gav 513 kB dar curl ger 162 kB. curl rapporterar
 * `size_download` som de byte som verkligen togs emot, alltsa komprimerade, och
 * det ar den siffran en telefon pa 4G betalar for.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const kor = promisify(execFile);

async function overNatet(vag, forsok = 3) {
  for (let i = 1; ; i++) {
    try {
      const { stdout } = await kor("curl", [
        "-s", "-o", "/dev/null",
        "-H", "accept-encoding: br, gzip",
        "-w", "%{size_download} %{http_code} %{time_starttransfer}",
        `${PROD}${vag}`,
      ]);
      const [storlek, kod, ttfb] = stdout.trim().split(" ");
      if (Number(kod) === 0) throw new Error("inget svar");
      return { storlek: Number(storlek), kod: Number(kod), ttfb: Number(ttfb) * 1000 };
    } catch (e) {
      // Manga snabba anrop i rad ger ibland ett TLS-handslag som inte gar
      // igenom. Det ar matningens eget problem och inte navets, sa den provar
      // igen i stallet for att avbryta hela korningen pa den sista filen.
      if (i >= forsok) throw e;
      await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
}

async function mat(vag, gangar = 5) {
  const tider = [];
  let sista;
  for (let i = 0; i < gangar; i++) {
    sista = await overNatet(vag);
    tider.push(sista.ttfb);
  }
  tider.sort((a, b) => a - b);
  return { median: tider[Math.floor(tider.length / 2)], ...sista };
}

const inloggning = await mat("/logga-in");
console.log(
  `  ${String(Math.round(inloggning.median)).padStart(5)} ms  /logga-in  ` +
  `${(inloggning.storlek / 1024).toFixed(1)} kB HTML  (HTTP ${inloggning.kod})`,
);

// Startsidan utan session gar bara genom mellanvaran och omdirigerar. Det ar
// alltsa mellanvarans egen kostnad — inklusive dess anrop till Supabase — och
// den kostnaden betalar aven en INLOGGAD begaran, innan sidan ens borjar.
const rot = await mat("/");
console.log(
  `  ${String(Math.round(rot.median)).padStart(5)} ms  /  utan session — bara mellanvaran  (HTTP ${rot.kod})`,
);

// Skalets skript och stilar. Den inloggade startsidan lagger till sin egen
// sidchunk ovanpa dessa.
const html = await fetch(`${PROD}/logga-in`).then((r) => r.text());
const filer = [...new Set(html.match(/\/_next\/static\/[^"']*?\.(?:js|css)/g) ?? [])];

let byte = 0;
for (const f of filer) {
  byte += (await overNatet(f)).storlek;
}

const total = byte + inloggning.storlek;
console.log(`  ${String(Math.round(byte / 1024)).padStart(5)} kB  ${filer.length} skript och stilar, komprimerat over natet`);
console.log(`  ${String(Math.round(total / 1024)).padStart(5)} kB  TOTALT over natet\n`);

// ---------------------------------------------------------------------------
// Vad det blir pa 4G
//
// Tva profiler, bada utskrivna sa att siffran gar att ifragasatta. Den forsta
// ar ett normalt svenskt 4G-natt, den andra ett trangt — en telefon pa ett tag
// eller i ett kontorslandskap klockan atta.

console.log("\x1b[1mUppskattning pa 4G\x1b[0m\n");

const PROFILER = [
  { namn: "4G, normalt", mbit: 10, rtt: 50 },
  { namn: "4G, trangt", mbit: 3, rtt: 100 },
];

/**
 * Den inloggade sidans egen servertid gar inte att mata harifran, men den gar
 * att rakna fram ur det vi VET: antalet vagor.
 *
 * Vercels funktion och Supabase star bada i eu-north-1, sa en rundtur dar ar
 * en brakdel av den harifran. 20 ms per vaga ar en medvetet PESSIMISTISK
 * uppskattning for tva tjanster i samma region — talet star som en konstant
 * har for att det ska ga att ifragasatta och andra pa ett stalle.
 *
 * Blir det for optimistiskt syns det direkt nar nagon mater med en riktig
 * session, och da ar det den siffran som galler.
 */
const MS_PER_VAG = 20;
const serverInloggad = rot.median + VAGOR.length * MS_PER_VAG;

console.log(
  `  Inloggad servertid uppskattas till ${Math.round(rot.median)} ms mellanvara\n` +
  `  + ${VAGOR.length} vagor x ${MS_PER_VAG} ms = ${Math.round(serverInloggad)} ms.\n`,
);

for (const p of PROFILER) {
  const byteS = (p.mbit * 1000 * 1000) / 8;
  const uppkoppling = 3 * p.rtt;            // DNS+TCP+TLS, forsta besoket
  const hamtning = (total / byteS) * 1000;
  const summa = uppkoppling + p.rtt + serverInloggad + hamtning;

  console.log(
    `  ${p.namn.padEnd(12)} ${p.mbit} Mbit/s, ${p.rtt} ms RTT\n` +
    `    uppkoppling ${Math.round(uppkoppling)} ms + svar ${Math.round(p.rtt + serverInloggad)} ms + ` +
    `hamtning ${Math.round(hamtning)} ms\n` +
    `    = ${Math.round(summa)} ms  ${summa < 1500 ? "\x1b[32munder 1,5 s\x1b[0m" : "\x1b[31mover 1,5 s\x1b[0m"}` +
    `   (marginal ${Math.round(1500 - summa)} ms)\n`,
  );
}

console.log(
  "  Uppkopplingen raknas som ett forsta besok. En andra sidvisning slipper de\n" +
  "  tre rundturerna och har dessutom skripten i cachen — da ar det bara svaret\n" +
  "  som kostar.\n\n" +
  "  Det som INTE ar uppskattat: vagorna, nyttolasten och mellanvarans svarstid.\n" +
  "  Det som ar uppskattat: " + MS_PER_VAG + " ms per vaga inifran Vercel. En matning med\n" +
  "  riktig session ersatter den siffran — se docs/ARBETSLOGG.md.\n",
);

await stad();
await db.end();
