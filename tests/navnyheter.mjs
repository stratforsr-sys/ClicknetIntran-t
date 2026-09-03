#!/usr/bin/env node
/**
 * Navets slapplista. Ren logik, ingen databas.
 *
 * Det som provas ar de fyra satten en post kan bli tyst pa utan att nagon
 * markar det:
 *
 *   1. EN SLUG SOM INTE GAR ATT KVITTERA. Id:t skickas till `avfardaNotisen`,
 *      som avvisar allt utom `[0-9a-zA-Z-]`. En slug med a, a eller o ger
 *      darfor en knapp som inte gor nagonting — tyst, utan felmeddelande.
 *   2. TVA POSTER MED SAMMA SLUG. Da doljer en kvittering bada, och uppslaget
 *      pa /nyheter/nav/<slug> visar den forsta av dem for alltid.
 *   3. EN ROLL SOM INTE FINNS. Stavfel i rollistan ger en post ingen ser, och
 *      det ar omojligt att skilja fran en post ingen brydde sig om.
 *   4. TVA FILTER SOM GLIDER ISAR. Klockan och /nyheter maste fraga samma
 *      funktion — annars pekar klockan pa en sida dar posten inte syns.
 *
 *   node --experimental-strip-types tests/navnyheter.mjs
 */
import { NAVNYHETER, hamtaNavnyhet, navnyheterFor, tidpunktFor } from "../src/navnyheter/index.ts";
import { arNotisId, notisId } from "../src/lib/notiser.ts";
import { ROLES, PERMISSIONS } from "../src/lib/roles.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

console.log("\n\x1b[1mVarje post gar att visa och att kvittera\x1b[0m");
{
  ok("registret ar inte tomt", NAVNYHETER.length > 0);

  const slugar = NAVNYHETER.map((n) => n.slug);
  ok("alla slugar ar unika", new Set(slugar).size === slugar.length,
    "annars doljer en kvittering tva poster");

  for (const n of NAVNYHETER) {
    ok(`${n.slug}: slug utan aao och versaler`, /^[a-z0-9-]+$/.test(n.slug),
      "arNotisId slapper inte igenom nagot annat");
    ok(`${n.slug}: id:t godkanns av avfardningen`, arNotisId(notisId("navnyhet", n.slug)),
      "en knapp som inte gor nagonting ar samre an ingen knapp");
    ok(`${n.slug}: datum ar ett kalenderdatum`, /^\d{4}-\d{2}-\d{2}$/.test(n.datum));
    ok(`${n.slug}: datumet finns`, !Number.isNaN(Date.parse(`${n.datum}T12:00:00Z`)));
    ok(`${n.slug}: har rubrik, ingress och text`,
      n.rubrik.trim().length > 0 && n.ingress.trim().length > 0 && n.text.trim().length > 20);
    ok(`${n.slug}: ingressen ar en rad`, !n.ingress.includes("\n"),
      "den star i klockan, dar det bara finns en rad");
    ok(`${n.slug}: alla roller finns`, n.roller.every((r) => ROLES.includes(r)),
      "ett stavfel ger en post ingen ser");
    ok(`${n.slug}: behorigheten finns`, !n.behorighet || PERMISSIONS.includes(n.behorighet));
    ok(`${n.slug}: href ar en intern adress`, !n.href || n.href.startsWith("/"));
  }
}

console.log("\n\x1b[1mUppslaget ar det enda sattet in\x1b[0m");
{
  ok("en kand slug hittas", hamtaNavnyhet(NAVNYHETER[0].slug)?.slug === NAVNYHETER[0].slug);
  ok("en okand slug ger null", hamtaNavnyhet("finns-inte") === null,
    "sidan ska ge 404, inte krascha");
  ok("tom strang ger null", hamtaNavnyhet("") === null);
}

console.log("\n\x1b[1mMalgruppen\x1b[0m");
{
  const bas = { slug: "x", rubrik: "R", ingress: "I", text: "T", datum: "2026-01-01" };
  // Samma filter som bade klockan och /nyheter kor. Det ar poangen med att det
  // finns pa ETT stalle: provet nedan galler bada ytorna.
  const prova = (poster, mottagare) => navnyheterFor(mottagare, poster);

  ok("tom rollista betyder alla",
    prova([{ ...bas, roller: [] }], { roller: ["salesperson"] }).length === 1);

  ok("tom rollista galler aven den utan roll",
    prova([{ ...bas, roller: [] }], { roller: [] }).length === 1);

  ok("en riktad post nar sin roll",
    prova([{ ...bas, roller: ["team_lead"] }], { roller: ["team_lead"] }).length === 1);

  ok("en riktad post nar INTE andra roller",
    prova([{ ...bas, roller: ["team_lead"] }], { roller: ["salesperson"] }).length === 0,
    "hela poangen med att den ar rollbaserad");

  ok("en av flera roller racker",
    prova([{ ...bas, roller: ["ceo", "salesperson"] }], { roller: ["salesperson"] }).length === 1);

  ok("behorighet kravs nar den star",
    prova([{ ...bas, roller: [], behorighet: "payroll_cost_viewer" }], { roller: ["finance"] }).length === 0,
    "att beratta om en sida man inte kommer in pa ar samre an tystnad");

  ok("behorigheten slapper igenom den som har den",
    prova([{ ...bas, roller: [], behorighet: "payroll_cost_viewer" }], {
      roller: ["finance"],
      behorigheter: ["payroll_cost_viewer"],
    }).length === 1);
}

console.log("\n\x1b[1mNyanstalld far inte en ko med gamla besked\x1b[0m");
{
  const bas = { slug: "x", rubrik: "R", ingress: "I", text: "T", roller: [] };
  const prova = (poster, mottagare) => navnyheterFor(mottagare, poster);

  ok("slapp fore anstallningen visas inte",
    prova([{ ...bas, datum: "2026-01-01" }], { roller: [], anstalldSedan: "2026-06-01" }).length === 0);

  ok("slapp efter anstallningen visas",
    prova([{ ...bas, datum: "2026-07-01" }], { roller: [], anstalldSedan: "2026-06-01" }).length === 1);

  ok("slapp samma dag som anstallningen visas",
    prova([{ ...bas, datum: "2026-06-01" }], { roller: [], anstalldSedan: "2026-06-01" }).length === 1,
    "forsta dagen ar en arbetsdag som alla andra");

  ok("utan anstallningsdatum visas allt",
    prova([{ ...bas, datum: "2020-01-01" }], { roller: [], anstalldSedan: null }).length === 1);
}

console.log("\n\x1b[1mOrdning och tidpunkt\x1b[0m");
{
  const alla = navnyheterFor({ roller: ROLES.slice(), behorigheter: PERMISSIONS.slice() });
  const datum = alla.map((n) => n.datum);
  ok("nyast forst", datum.every((d, i) => i === 0 || datum[i - 1] >= d), datum.join(" "));

  const n = NAVNYHETER[0];
  const t = tidpunktFor(n);
  ok("tidpunkten ar ISO", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(t), t);
  ok("tidpunkten ligger pa ratt kalenderdag i Sverige",
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date(t)) === n.datum,
    "provet kors med TZ=UTC — en tidpunkt raknad mot serverns zon hade hamnat pa dagen innan");
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkanda.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
