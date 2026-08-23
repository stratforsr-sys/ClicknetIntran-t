#!/usr/bin/env node
/**
 * E5.3 / X3: mater startsidan mot kravet 1,5 s pa 4G.
 *
 *   node --env-file=$HOME/.clicknet/nav.env scripts/mat-startsidan.mjs
 *
 * Metoden och alla antaganden star i scripts/lib/matning.mjs. Det som ar matt
 * pa riktigt: vagorna, nyttolasten och mellanvarans svarstid. Det som ar
 * uppskattat: rundturen inifran Vercel (MS_PER_VAG).
 *
 * Den mater INTE den inloggade startsidans TTFB fran produktionen. Sidan ligger
 * bakom inloggning, och en session gar inte att skapa harifran utan att gora
 * avkall pa nagot — det kraver en riktig webblasare. Se docs/ARBETSLOGG.md.
 */
import {
  MS_PER_VAG,
  PROD,
  anslut,
  mat,
  matVagor,
  matanvandare,
  skaletsByte,
  uppskatta,
} from "./lib/matning.mjs";

const db = await anslut();

// En saljchef: den roll som ser FLEST koer pa startsidan, alltsa det dyraste
// fallet. En saljare hamtar farre rader men lika manga vagor.
const anv = await matanvandare(db, { epost: "mattest+start@clicknet.se", roll: "sales_manager" });
const { id, authId, q } = anv;
const idag = new Date().toISOString().slice(0, 10);

/**
 * Vagorna, i den ordning navet gor dem. Varje vaga ar ett `await` som maste
 * vanta in den forra — det ar det som gor dem dyra, inte antalet fragor inuti.
 */
const LISTOR = [
  ["getCurrentUser: employee", [`employee?select=*&auth_user_id=eq.${authId}`]],
  ["getCurrentUser: roller och behorigheter", [
    `employee_role?select=role&employee_id=eq.${id}`,
    `employee_permission?select=permission&employee_id=eq.${id}`,
  ]],
  ["hamtaLage: compliance_gate", [`compliance_gate?select=*`]],
  ["layout: notisklockan", [
    `notification_seen?select=seen_at&employee_id=eq.${id}`,
    `news_post?select=id,slug,title,published_at,pinned&status=eq.published&order=published_at.desc&limit=15`,
    `document?select=id,slug,title,version,published_at&status=eq.published&requires_ack=eq.true`,
    `document_ack?select=document_id,version&employee_id=eq.${id}`,
    `course?select=id,slug,title,due_days,published_at&status=eq.published`,
    `course_module?select=id,course_id`,
    `module_progress?select=module_id&employee_id=eq.${id}`,
    `certification?select=course_id,issued_at,expires_at&employee_id=eq.${id}&order=issued_at.desc`,
    `case_message?select=id,created_at,author_id,case_id,hr_case(id,subject,employee_id)&author_id=neq.${id}&order=created_at.desc&limit=30`,
    `employee?select=id,first_name,last_name`,
    `absence_type?select=id,label`,
    `roleplay_submission?select=id,employee_id,submitted_at,graded_at&order=submitted_at.desc&limit=15`,
    `error_report?select=id,kind,path,status,blocking,reporter_id,first_seen_at,handled_at&order=last_seen_at.desc&limit=15`,
  ]],
  ["sida vag 1: rutiner och egna arenden", [
    `document?select=id,slug,title,version,review_due&status=eq.published&requires_ack=eq.true&order=review_due`,
    `document_ack?select=document_id,version&employee_id=eq.${id}`,
    `document?select=id,slug,title,review_due&owner_id=eq.${id}&status=eq.published&review_due=lte.${idag}&order=review_due`,
    `hr_case?select=id,subject,status,resolved_at,due_at,sla_hours&employee_id=eq.${id}&status=eq.waiting&resolved_at=is.null&order=due_at`,
  ]],
  ["sida vag 2: kurser", [
    `course?select=id,slug,title,due_days&status=eq.published&order=title`,
    `course_module?select=id,course_id`,
    `module_progress?select=module_id&employee_id=eq.${id}`,
    `certification?select=course_id,issued_at,expires_at&employee_id=eq.${id}&order=issued_at.desc`,
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

const VAGOR = LISTOR.map(([namn, lista]) => [namn, () => Promise.all(lista.map(q)), lista.length]);

const { vagor } = await matVagor(VAGOR, { uppvarmning: () => q(`employee?select=id&limit=1`) });

// ---------------------------------------------------------------------------

console.log(`\x1b[1mNyttolast och svarstid fran produktionen\x1b[0m  ${PROD}\n`);

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

const skal = await skaletsByte();
const total = skal.byte + inloggning.storlek;
console.log(`  ${String(Math.round(skal.byte / 1024)).padStart(5)} kB  ${skal.antal} skript och stilar, komprimerat over natet`);
console.log(`  ${String(Math.round(total / 1024)).padStart(5)} kB  TOTALT over natet\n`);

// ---------------------------------------------------------------------------

const servertid = rot.median + vagor * MS_PER_VAG;
console.log(
  `  Inloggad servertid uppskattas till ${Math.round(rot.median)} ms mellanvara\n` +
  `  + ${vagor} vagor x ${MS_PER_VAG} ms = ${Math.round(servertid)} ms.\n`,
);

uppskatta({
  rubrik: "Startsidan pa 4G — kravet ar 1,5 s (X3, AC-11.3)",
  servertid,
  byteOverNatet: total,
  kravMs: 1500,
});

console.log(
  "  Uppkopplingen raknas som ett forsta besok. En andra sidvisning slipper de\n" +
  "  tre rundturerna och har dessutom skripten i cachen — da ar det bara svaret\n" +
  "  som kostar.\n\n" +
  "  Det som INTE ar uppskattat: vagorna, nyttolasten och mellanvarans svarstid.\n" +
  "  Det som ar uppskattat: " + MS_PER_VAG + " ms per vaga inifran Vercel. En matning med\n" +
  "  riktig session ersatter den siffran — se docs/ARBETSLOGG.md.\n",
);

await anv.stad();
await db.end();
