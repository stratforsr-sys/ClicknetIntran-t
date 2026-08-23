#!/usr/bin/env node
/**
 * X3: mater sok (kravet 500 ms) och stampling (kravet 2 s).
 *
 *   node --env-file=$HOME/.clicknet/nav.env scripts/mat-sok-och-stampling.mjs
 *
 * Samma metod som startsidan. Allt gemensamt ligger i scripts/lib/matning.mjs,
 * och antagandena star utskrivna dar.
 *
 * ===========================================================================
 * VARFOR BADA MATS SOM MJUKA NAVIGERINGAR, INTE SOM SIDLADDNINGAR
 *
 * Kravet pa startsidan ar 1,5 s och galler nagon som oppnar navet. Kraven har
 * ar 500 ms och 2 s och galler nagon som REDAN AR INNE: hen star pa en sida,
 * skriver i sokrutan eller trycker pa stampelknappen.
 *
 * I Next ar bada en mjuk navigering respektive ett server action-svar. Skalet —
 * (app)-layouten med notisklockans tretton fragor — renderas INTE om i nagot av
 * fallen, och skriptet ar redan hamtat. Att rakna med dem hade matt en helt
 * annan handelse an den kravet handlar om, och gjort bada matten hopplosa av
 * fel skal.
 *
 * Det som daremot RAKNAS med i stamplingen ar omrenderingen av /tid. Den ar
 * inte valfri: `revalidatePath` i actionen gor att svaret bar den nya sidan,
 * och anvandaren ser inget resultat forran den kommit fram.
 * ===========================================================================
 */
import {
  MS_PER_VAG,
  PROD,
  anslut,
  mat,
  matVagor,
  matanvandare,
  uppskatta,
} from "./lib/matning.mjs";

const db = await anslut();

const anv = await matanvandare(db, { epost: "mattest+sok@clicknet.se", roll: "sales_manager" });
const { id, authId, q, rpc } = anv;

// Tva sokord: ett som traffar och ett som garanterat inte gor det. De ar olika
// dyra, och det trafflosa ar dyrast — se vagan langst ned i listan.
const TRAFF = "rutin";
const MISS = "zzz-finns-inte-i-navet";

const sokvagor = (ord) => [
  `document?select=id,title,slug,category_path,body_md&status=neq.archived&search=wfts(swedish).${encodeURIComponent(ord)}&limit=6`,
  `news_post?select=id,title,slug,body_md&search=wfts(swedish).${encodeURIComponent(ord)}&limit=6`,
  `course?select=id,title,slug,description_md&status=eq.published&or=(title.ilike.*${ord}*,description_md.ilike.*${ord}*)&limit=6`,
  `employee?select=id,first_name,last_name,email,status&status=neq.offboarded&or=(first_name.ilike.*${ord}*,last_name.ilike.*${ord}*,email.ilike.*${ord}*)&limit=6`,
  `hr_case?select=id,subject,category,status&subject=ilike.*${ord}*&limit=6`,
];

console.log("\n\x1b[1m======== SOK ========\x1b[0m");
console.log("\nEn traffande sokning. Sidan gor getCurrentUser och sedan sjalva");
console.log("sokningen i EN vaga med fem fragor — kallorna hamtas parallellt.\n");

const SOK_TRAFF = [
  ["getCurrentUser: employee", () => q(`employee?select=*&auth_user_id=eq.${authId}`), 1],
  ["getCurrentUser: roller och behorigheter", () => Promise.all([
    q(`employee_role?select=role&employee_id=eq.${id}`),
    q(`employee_permission?select=permission&employee_id=eq.${id}`),
  ]), 2],
  ["sokningen: fem kallor parallellt", () => Promise.all(sokvagor(TRAFF).map(q)), 5],
  ["rollnamn for personerna i traffen", () => q(`employee_role?select=employee_id,role&employee_id=in.(${id})`), 1],
];

const traff = await matVagor(SOK_TRAFF, { uppvarmning: () => q(`employee?select=id&limit=1`) });

console.log("\x1b[1mEn sokning UTAN traff\x1b[0m");
console.log("\nSamma sak, men rollvagan uteblir (inga personer att sla upp) och en ny");
console.log("vaga tillkommer: E6.5 bokfor den trafflosa sokningen.\n");

const SOK_MISS = [
  ["getCurrentUser: employee", () => q(`employee?select=*&auth_user_id=eq.${authId}`), 1],
  ["getCurrentUser: roller och behorigheter", () => Promise.all([
    q(`employee_role?select=role&employee_id=eq.${id}`),
    q(`employee_permission?select=permission&employee_id=eq.${id}`),
  ]), 2],
  ["sokningen: fem kallor parallellt", () => Promise.all(sokvagor(MISS).map(q)), 5],
  ["E6.5: registrera_sokmiss", () => rpc("registrera_sokmiss", { p_q: MISS }), 1],
];

const miss = await matVagor(SOK_MISS, { uppvarmning: null });
await db.query(`delete from search_miss where q = $1`, [MISS]);

/**
 * En mjuk navigering hamtar en RSC-nyttolast, inte ett helt HTML-dokument, och
 * skalets skript ar redan i minnet. Traffsidan ar liten: en rubrik och hogst
 * trettio rader.
 *
 * Siffran mats inte harifran — den kraver en session — utan sattes till en
 * medvetet TILLTAGEN 30 kB. Traffsidan i produktionen ar mindre an sa.
 */
const SOK_NYTTOLAST = 30 * 1024;

const rot = await mat("/");
console.log(`  ${String(Math.round(rot.median)).padStart(5)} ms  mellanvarans egen kostnad (HTTP ${rot.kod})\n`);

for (const [namn, resultat] of [["med traff", traff], ["utan traff", miss]]) {
  uppskatta({
    rubrik: `Sok ${namn} pa 4G — kravet ar 500 ms (X3)`,
    servertid: rot.median + resultat.vagor * MS_PER_VAG,
    byteOverNatet: SOK_NYTTOLAST,
    kravMs: 500,
    forstaBesok: false,
  });
}

console.log(
  `  ${traff.vagor} vagor med traff, ${miss.vagor} utan. Uppskattad nyttolast ${SOK_NYTTOLAST / 1024} kB.\n` +
  "  Uppkopplingen raknas INTE — den som soker ar redan inne.\n",
);

// ===========================================================================

console.log("\x1b[1m======== STAMPLING ========\x1b[0m");
console.log("\nActionen `stampla` gor sex sekventiella omgangar innan raden finns.");
console.log("Darefter renderas /tid om, eftersom revalidatePath sager det.\n");

// Raderna stads med anvandaren, men stamplingen far inte lamna nagot i
// audit_log heller — den tabellen ar bevis och ska inte bara matningens spar.
const STAMPEL = [
  ["hamtaLage: compliance_gate", () => q(`compliance_gate?select=*`), 1],
  ["getCurrentUser: employee", () => q(`employee?select=*&auth_user_id=eq.${authId}`), 1],
  ["getCurrentUser: roller och behorigheter", () => Promise.all([
    q(`employee_role?select=role&employee_id=eq.${id}`),
    q(`employee_permission?select=permission&employee_id=eq.${id}`),
  ]), 2],
  ["dagens(): dagens handelser", () => q(`time_event?select=id,kind,occurred_at,source,supersedes_id,correction_state&employee_id=eq.${id}&order=occurred_at`), 1],
  ["insert time_event", async () => {
    await db.query(
      `insert into time_event (employee_id, kind, occurred_at, source)
       values ($1::uuid, 'in', now(), 'app')`,
      [id],
    );
  }, 1],
  ["logga(): rad i audit_log", async () => {
    await db.query(
      `insert into audit_log (actor_id, action, object_type, object_id)
       values ($1::uuid, 'time.in', 'time_event', $1::uuid)`,
      [id],
    );
  }, 1],
];

const stampel = await matVagor(STAMPEL, { uppvarmning: () => q(`employee?select=id&limit=1`) });

console.log("\x1b[1mOmrenderingen av /tid som foljer\x1b[0m");
console.log("\nDen ar inte valfri. Anvandaren ser inget resultat forran den kommit fram.\n");

const TIDSIDAN = [
  ["getCurrentUser: employee", () => q(`employee?select=*&auth_user_id=eq.${authId}`), 1],
  ["getCurrentUser: roller och behorigheter", () => Promise.all([
    q(`employee_role?select=role&employee_id=eq.${id}`),
    q(`employee_permission?select=permission&employee_id=eq.${id}`),
  ]), 2],
  ["hamtaLage: compliance_gate", () => q(`compliance_gate?select=*`), 1],
  ["mina handelser", () => q(`time_event?select=*&employee_id=eq.${id}&order=occurred_at`), 1],
  ["chefens vy: personal, dagens stamplingar, scheman", () => Promise.all([
    q(`employee?select=id,first_name,last_name&status=eq.active`),
    q(`time_event?select=id,employee_id,kind,occurred_at`),
    q(`work_schedule?select=*`),
  ]), 3],
  ["mina rastavvikelser", () => q(`break_deviation?select=*&employee_id=eq.${id}`), 1],
  ["mina sena ankomster", () => q(`late_arrival?select=*&employee_id=eq.${id}`), 1],
  ["rastschema och kvitton", () => Promise.all([
    q(`scheduled_break?select=*`),
    q(`break_schedule_ack?select=schedule_id&employee_id=eq.${id}`),
  ]), 2],
  ["rattelsekon och schemarakning", () => Promise.all([
    q(`time_event?select=*&correction_state=eq.pending`),
    q(`work_schedule?select=id`),
  ]), 2],
];

const omrendering = await matVagor(TIDSIDAN, { uppvarmning: null });

const STAMPEL_NYTTOLAST = 40 * 1024;
const totaltVagor = stampel.vagor + omrendering.vagor;

uppskatta({
  rubrik: "Stampling pa 4G — kravet ar 2 s (X3, AC-2.1)",
  servertid: rot.median + totaltVagor * MS_PER_VAG,
  byteOverNatet: STAMPEL_NYTTOLAST,
  kravMs: 2000,
  forstaBesok: false,
});

console.log(
  `  ${stampel.vagor} vagor i actionen + ${omrendering.vagor} i omrenderingen = ${totaltVagor}.\n` +
  `  Uppskattad nyttolast ${STAMPEL_NYTTOLAST / 1024} kB RSC.\n` +
  "  Uppkopplingen raknas INTE — den som stamplar ar redan inne.\n\n" +
  "  Matt pa riktigt: vagorna och mellanvarans svarstid.\n" +
  `  Uppskattat: ${MS_PER_VAG} ms per vaga inifran Vercel, och nyttolasterna.\n`,
);

// Stamplingen och dess loggrad stads av `stad()`, som ocksa kopplar ur
// AC-2.3-sparren for att kunna gora det. Se scripts/lib/matning.mjs.
await anv.stad();
await db.end();
