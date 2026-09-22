#!/usr/bin/env node
/**
 * Uppgiftsmallarna (0066): tolken, rundturen och datumen.
 *
 *   node --experimental-strip-types tests/mallar.mjs
 *
 * INGEN DATABAS. Mallen ar text in och rader ut, och bada andarna gar att prova
 * har.
 *
 * TVA AVDELNINGAR BAR PROVET:
 *
 *   1. DET SOM INTE SKA TOLKAS. Tolken ar den enda delen av modulen dar ett fel
 *      inte syns: en mall som laser "30" som dagar i stallet for minuter ser
 *      fullkomligt riktig ut i listan, och avslojar sig forst nar nagon far en
 *      uppgift en manad bort. Samma avdelning som `tolkaSnabbrad()` har i
 *      tests/uppgifter.mjs, och av samma skal.
 *
 *   2. RUNDTUREN. `momentTillText(tolkaMoment(x))` ska ge tillbaka nagot som
 *      tolkas till samma moment. Utan den kontrollen gar en mall sonder av att
 *      nagon oppnar andringsformularet och sparar utan att rora nagot — det
 *      varsta felet en redigerare kan ha, eftersom ingen misstanker den.
 */
import {
  FALTORDNING,
  MAX_MOMENT,
  forhandsbild,
  mallsammanfattning,
  momentTillText,
  momentdatum,
  tolkaMoment,
} from "../src/lib/mallar.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const START = "2026-09-23";

// -----------------------------------------------------------------------------
rubrik("Formen");

ok("fem falt i ordning", FALTORDNING.length === 5, FALTORDNING.join(" | "));
ok("rubriken star forst", FALTORDNING[0] === "rubrik");
ok("taket ar femtio moment", MAX_MOMENT === 50);

// -----------------------------------------------------------------------------
rubrik("Bara rubriken kravs");

{
  const { moment, fel: f } = tolkaMoment("Ring kunden");
  ok("en ensam rubrik gar igenom", f === null && moment.length === 1);
  ok("dag 0 ar forvalet", moment[0].offset_days === 0);
  ok("ingen uppskattning", moment[0].estimate_minutes === null);
  ok("inget klockslag", moment[0].due_time === null);
  ok("prioritet 3", moment[0].priority === 3);
  ok("sort borjar pa 1", moment[0].sort === 1);
}

{
  const { moment, fel: f } = tolkaMoment("");
  ok("en tom ruta ar inte ett fel", f === null && moment.length === 0);
}

{
  const { moment } = tolkaMoment("  \n\nRing kunden\n   \nSkicka avtalet\n");
  ok("tomma rader hoppas over", moment.length === 2);
  ok("och numreringen blir tat", moment[1].sort === 2);
}

// -----------------------------------------------------------------------------
rubrik("Alla fem falten");

{
  const { moment, fel: f } = tolkaMoment("Välkomstsamtal | 3 | 30 | 09:00 | 2");
  ok("gar igenom", f === null, f ?? "");
  ok("rubrik", moment[0].title === "Välkomstsamtal");
  ok("dagar", moment[0].offset_days === 3);
  ok("minuter", moment[0].estimate_minutes === 30);
  ok("klockslag", moment[0].due_time === "09:00");
  ok("prioritet", moment[0].priority === 2);
}

{
  const { moment } = tolkaMoment("Ring | 1 |  | 9:05");
  ok("ett tomt falt i mitten hoppas over", moment[0].estimate_minutes === null);
  /**
   * `9:05` NORMALISERAS TILL `09:05`. Kolumnen ar `time` och tar emot bada,
   * men raden jamfors mot `due_time` med strangjamforelse pa flera stallen —
   * och "9:00" sorterar EFTER "10:00". Felet syns som en post pa fel plats i
   * dagen, vilket ingen laser som ett formatfel.
   */
  ok("klockslaget nollutfylls", moment[0].due_time === "09:05");
}

// -----------------------------------------------------------------------------
rubrik("Det som INTE ska tolkas");

const avvisas = [
  [" | 3", "en rad utan rubrik"],
  ["Ring | tre", "dagar som ord"],
  ["Ring | 3,5", "dagar med decimal"],
  ["Ring | -1", "negativa dagar"],
  ["Ring | 366", "dagar bortom ett ar"],
  ["Ring | 1 | 0", "noll minuter"],
  ["Ring | 1 | 1441", "mer an ett dygn"],
  ["Ring | 1 | tjugo", "minuter som ord"],
  ["Ring | 1 | 30 | 25:00", "en timme som inte finns"],
  ["Ring | 1 | 30 | 09:60", "en minut som inte finns"],
  ["Ring | 1 | 30 | 0900", "ett klockslag utan kolon"],
  ["Ring | 1 | 30 | 09:00 | 5", "prioritet utanfor skalan"],
  ["Ring | 1 | 30 | 09:00 | 0", "prioritet noll"],
];

for (const [text, vad] of avvisas) {
  const { moment, fel: f } = tolkaMoment(text);
  ok(`${vad} avvisas`, f !== null && moment.length === 0, f ?? "slapptes igenom");
}

{
  const { fel: f } = tolkaMoment("Rad ett\nRad två | 3 | fel");
  /**
   * ETT FEL PA RAD TVA AVVISAR HELA MALLEN, inte bara sin rad. En mall som
   * sparas till halften ser riktig ut i listan, och den som anvander den ett
   * halvar senare far en halv checklista utan att veta om det.
   */
  ok("ett fel pa en rad fäller hela mallen", f !== null && f.includes("Rad 2"), f ?? "");
}

{
  const rader = Array.from({ length: MAX_MOMENT + 1 }, (_, i) => `Moment ${i}`).join("\n");
  const { fel: f } = tolkaMoment(rader);
  ok("fler an femtio moment avvisas", f !== null, f ?? "slapptes igenom");
}

{
  const { fel: f } = tolkaMoment(`${"x".repeat(201)}`);
  ok("en rubrik over 200 tecken avvisas", f !== null, f ?? "slapptes igenom");
}

// -----------------------------------------------------------------------------
rubrik("Rundturen genom andringsformularet");

{
  const KALLA = [
    "Välkomstsamtal | 0 | 30 | 09:00 | 2",
    "Lägg upp kunden | 0 | 20",
    "Skicka avtalet | 1 | 15",
    "Stäm av | 3",
    "Uppföljning | 7 | 30 |  | 4",
    "Ring kunden",
  ].join("\n");

  const forsta = tolkaMoment(KALLA);
  ok("kallan tolkas rent", forsta.fel === null, forsta.fel ?? "");

  const andra = tolkaMoment(momentTillText(forsta.moment));
  ok("och tolkas rent en gang till", andra.fel === null, andra.fel ?? "");

  /**
   * DEN KONTROLL SOM RAKNAS I HELA FILEN.
   *
   * Utan den gar en mall sonder av att nagon oppnar andringsformularet och
   * sparar utan att rora nagot — och det ar det varsta felet en redigerare kan
   * ha, eftersom ingen misstanker den handlingen.
   */
  ok(
    "momenten overlever rundturen oforandrade",
    JSON.stringify(forsta.moment) === JSON.stringify(andra.moment),
    momentTillText(forsta.moment).replace(/\n/g, " ⏎ "),
  );

  ok("en rad utan extrafalt blir kort igen", momentTillText(forsta.moment).endsWith("Ring kunden"));
  ok(
    "ett tomt falt i mitten star kvar som tomt",
    momentTillText(forsta.moment).includes("Uppföljning | 7 | 30 |  | 4"),
    momentTillText(forsta.moment).split("\n")[4],
  );
}

{
  // En rubrik med lodstreck i gar INTE att bara genom rundturen. Provet star
  // har for att gransen ska vara utskriven och inte upptackas av en anvandare.
  const { moment } = tolkaMoment("Ring A | B");
  ok("ett lodstreck i rubriken laser resten som falt", moment.length === 0 || moment[0].title === "Ring A");
}

// -----------------------------------------------------------------------------
rubrik("Datumen");

{
  ok("dag 0 ar startdagen", momentdatum(START, { offset_days: 0 }) === START);
  ok("dag 1 ar dagen efter", momentdatum(START, { offset_days: 1 }) === "2026-09-24");
  ok("dag 7 ar en vecka senare", momentdatum(START, { offset_days: 7 }) === "2026-09-30");
  ok("dag 30 gar over manadsskiftet", momentdatum(START, { offset_days: 30 }) === "2026-10-23");

  /**
   * SOMMARTIDEN. 2026-10-25 ar natten da klockan stalls om i Sverige, och en
   * datumrakning som gar via lokala tidpunkter tappar eller vinner ett dygn dar.
   * `datumPlusDagar()` raknar i UTC pa datumstrangar just for att slippa det,
   * och provet star har for att nagon annars rattar "felet" tillbaka.
   */
  ok(
    "ett moment over sommartidsskiftet hamnar ratt",
    momentdatum("2026-10-24", { offset_days: 2 }) === "2026-10-26",
    momentdatum("2026-10-24", { offset_days: 2 }),
  );

  ok("ett skottar klaras", momentdatum("2028-02-28", { offset_days: 2 }) === "2028-03-01");
}

{
  const { moment } = tolkaMoment("A | 0\nB | 7\nC | 30");
  const bild = forhandsbild(moment, START);
  ok("forhandsbilden raknar antalet", bild.antal === 3);
  ok("forsta dagen", bild.forsta === START);
  ok("sista dagen", bild.sista === "2026-10-23");
  ok("en tom mall ger ingen forhandsbild", forhandsbild([], START) === null);
}

{
  // Momenten behover inte sta i dagsordning i texten — den som skriver kan
  // radda en glomd rad genom att lagga den sist. Forhandsbilden ska anda saga
  // ratt spann.
  const { moment } = tolkaMoment("Sista | 30\nForsta | 0");
  const bild = forhandsbild(moment, START);
  ok("spannet sorteras oavsett radordning", bild.forsta === START && bild.sista === "2026-10-23");
}

// -----------------------------------------------------------------------------
rubrik("Sammanfattningen");

{
  const { moment } = tolkaMoment("A | 0 | 30\nB | 7 | 60\nC | 30 | 60");
  const text = mallsammanfattning(moment);
  ok("antalet star med", text.includes("3 moment"), text);
  ok("spannet star med", text.includes("dag 0–30"), text);
  ok("summan star med", text.includes("2 h 30 min"), text);
}

{
  const { moment } = tolkaMoment("A | 5");
  const text = mallsammanfattning(moment);
  ok("en enda dag skrivs utan spann", text.includes("dag 5") && !text.includes("–"), text);
  ok("utan uppskattningar namns ingen tid", !text.includes("min") && !text.includes(" h"), text);
}

ok("en tom mall sager det", mallsammanfattning([]) === "Inga moment");

// -----------------------------------------------------------------------------
console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n" : `\n\x1b[31m${fel} prov foll.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
