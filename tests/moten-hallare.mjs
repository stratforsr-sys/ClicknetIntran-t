#!/usr/bin/env node
/**
 * Möten: vem som håller mötet (2026-11-16). Reglerna utan databas: `hallareByte` och inställningen
 * `moten.ny-kund-dagar` (src/lib/nav2/motenforma.ts, motesflode.ts).
 *
 *   TZ=UTC node --experimental-strip-types tests/moten-hallare.mjs
 *
 * Spec: docs/superpowers/specs/2026-11-16-moten-hallare-utfall-design.md (5.1).
 */
import { HALLARE_EGEN_PROVISION, PENGANYCKLAR, andraIndata, farAndraInstallning, hallareByte, hallareIndata, hallareNotiser, sammaMottagare, utfallIndata } from "../src/lib/nav2/motenforma.ts";
import { INST_NYCKLAR, fyllForegaende, lasInstallningar, ursprungligBokare } from "../src/lib/nav2/motesflode.ts";

let fel = 0;
let antal = 0;
const ok = (namn, villkor) => {
  antal++;
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}`);
  if (!villkor) fel++;
};
const text = (x) => JSON.stringify(x);
const lika = (namn, fas, vantat) => ok(`${namn} (fick ${text(fas)})`, text(fas) === text(vantat));

const MICK = "11111111-1111-4111-8111-111111111111"; // bokaren
const ZEN = "22222222-2222-4222-8222-222222222222"; // står som hållare
const FREDRIK = "33333333-3333-4333-8333-333333333333"; // kollega på mötet
const ANNAN = "44444444-4444-4444-8444-444444444444"; // inte med
const ADMIN = "55555555-5555-4555-8555-555555555555";

const saljare = (id) => ({ id, roller: ["salesperson"] });
const admin = (id) => ({ id, roller: ["admin"] });
const mote = (o = {}) => ({ bokat_av: MICK, halls_av: ZEN, med: [FREDRIK], mote_tid: "2026-11-16T14:00:00.000Z", niva: null, provision_last_nar: null, ...o });
// Förvalet är före mötet. `parter`: den som står som hållare, bokaren och kollegorna på mötet.
const byte = (o) => hallareByte({ aktor: saljare(FREDRIK), m: mote(), ny: FREDRIK, nyKanHalla: true, fore: [MICK], efter: [MICK], efterMotet: false, parter: [ZEN, MICK, FREDRIK], ...o });

console.log("\nVem som får byta");
lika("kollegan på mötet tar över, mottagarna oförändrade", byte({}), { ok: true });
lika("bokaren byter till en kollega, mottagarna oförändrade", byte({ aktor: saljare(MICK) }), { ok: true });
lika("den som inte är med på mötet", byte({ aktor: saljare(ANNAN), ny: ANNAN }), { fel: "Bara de som är med på mötet eller en säljchef byter hållare.", status: 403 });
lika("en admin utanför mötet", byte({ aktor: admin(ADMIN) }), { ok: true });

console.log("\nVem som kan bli hållare");
lika("samma som nu", byte({ ny: ZEN }), { fel: "Det är redan hen som håller mötet.", status: 409 });
lika("en som inte kan hålla möten (slutat eller fel roll)", byte({ nyKanHalla: false }), { fel: "Den du valde kan inte hålla möten.", status: 400 });

console.log("\nPengaspärren");
// Mick bokar och håller själv (ingen bokarprovision: hållaren får aldrig den). Byter han hållare till Fredrik blir han mottagare.
const egen = { aktor: saljare(MICK), m: mote({ halls_av: MICK, med: [FREDRIK] }), ny: FREDRIK, fore: [], efter: [MICK] };
lika("bokaren som skulle få provision av bytet nekas", byte(egen), { fel: HALLARE_EGEN_PROVISION, status: 403 });
lika("den nya hållaren som skulle få provision av bytet nekas", byte({ aktor: saljare(FREDRIK), fore: [FREDRIK], efter: [] }), { fel: HALLARE_EGEN_PROVISION, status: 403 });
lika("en admin som inte påverkas får göra samma byte", byte({ ...egen, aktor: admin(ADMIN) }), { ok: true });
lika("en admin som själv påverkas nekas", byte({ ...egen, aktor: { id: MICK, roller: ["admin"] } }), { fel: HALLARE_EGEN_PROVISION, status: 403 });
lika("mottagare som inte ändras stoppar inget", byte({ aktor: saljare(MICK), fore: [MICK], efter: [MICK] }), { ok: true });
ok("sammaMottagare: ordningen spelar ingen roll", sammaMottagare([MICK, ZEN], [ZEN, MICK]) && !sammaMottagare([MICK], [MICK, ZEN]) && sammaMottagare([], []));

console.log("\nBedömt möte");
lika("kollega på ett bedömt möte", byte({ m: mote({ niva: "kvalificerat" }) }), { fel: "Mötet är redan bedömt, så hållaren kan inte bytas.", status: 403 });
lika("låst provision utan nivå räknas som bedömt", byte({ m: mote({ provision_last_nar: "2026-11-16T15:00:00Z" }) }), { fel: "Mötet är redan bedömt, så hållaren kan inte bytas.", status: 403 });
lika("admin utan egen provision på ett bedömt möte", byte({ aktor: admin(ADMIN), m: mote({ niva: "kvalificerat" }) }), { ok: true });
lika("admin, bedömt möte, bytet ändrar mottagarna: går inte (ingen väg i Nav räknar om mottagarna)", byte({ aktor: admin(ADMIN), m: mote({ niva: "kvalificerat" }), fore: [], efter: [MICK] }), { fel: "Mötet är redan bedömt och bytet skulle ändra vem som får mötesprovision, så hållaren kan inte bytas.", status: 409 });

console.log("\nEfter mötet: den som höll det, och aldrig vald av den som får provision");
lika("kollegan som var med tar över (Make your dream)", byte({ efterMotet: true }), { ok: true });
lika("någon som inte var med kan inte stå som den som höll det", byte({ efterMotet: true, aktor: saljare(ZEN), ny: ANNAN }), { fel: "Bara den som var med på mötet kan stå som den som höll det.", status: 403 });
lika("före mötet går det att ge mötet till vem som helst som kan hålla möten", byte({ aktor: saljare(ZEN), ny: ANNAN }), { ok: true });
lika("bokaren som får provision väljer inte bedömaren efter mötet", byte({ efterMotet: true, aktor: saljare(MICK) }), { fel: "Du får mötesprovision för mötet och väljer inte vem som bedömer det. Den som höll mötet byter.", status: 403 });
lika("inte heller som admin", byte({ efterMotet: true, aktor: { id: MICK, roller: ["admin"] } }), { fel: "Du får mötesprovision för mötet och väljer inte vem som bedömer det. Den som höll mötet byter.", status: 403 });
lika("en admin utan provision på mötet får byta efter mötet", byte({ efterMotet: true, aktor: admin(ADMIN) }), { ok: true });

console.log("\nNotiserna om bytet");
const notis = (o) => hallareNotiser({ jag: "Zen", bolag: "Make your dream AB", nyFornamn: "Fredrik", nar: "mån 16 nov 15:00", efterMotet: false, kalender: true, ...o });
lika("före mötet, med kalender", notis({}), { ny: { rubrik: "Zen gav dig mötet med Make your dream AB", detalj: "mån 16 nov 15:00 · mötet ligger nu i din kalender" }, ovriga: { rubrik: "Fredrik håller mötet med Make your dream AB", detalj: "Zen ändrade det · mån 16 nov 15:00" } });
lika("före mötet utan kalenderhändelse: inget löfte om kalendern", notis({ kalender: false }).ny.detalj, "mån 16 nov 15:00");
lika("efter mötet", notis({ efterMotet: true, kalender: false }), { ny: { rubrik: "Zen satte dig som den som höll mötet med Make your dream AB", detalj: "Sätt utfallet och svara på frågorna." }, ovriga: { rubrik: "Fredrik höll mötet med Make your dream AB", detalj: "Zen ändrade det · mån 16 nov 15:00" } });

console.log("\nIndata");
const MOTE = "66666666-6666-4666-8666-666666666666";
lika("byt hållare", hallareIndata({ mote: MOTE, ny: FREDRIK.toUpperCase() }), { ok: true, varden: { mote: MOTE, ny: FREDRIK } });
lika("byt hållare: inget möte", hallareIndata({ ny: FREDRIK }), { ok: false, fel: "Mötet stämmer inte." });
lika("byt hållare: ny är inget id", hallareIndata({ mote: MOTE, ny: "Fredrik" }), { ok: false, fel: "Välj vem som håller mötet." });
lika("utfall med vem som höll mötet", utfallIndata({ mote: MOTE, utfall: "hallet", holl: FREDRIK }).varden?.inn?.holl, FREDRIK);
lika("utfall utan vem som höll mötet: ingen ändring", utfallIndata({ mote: MOTE, utfall: "hallet" }).varden?.inn?.holl, undefined);
lika("utfall: höll är inget id", utfallIndata({ mote: MOTE, utfall: "hallet", holl: "x" }), { ok: false, fel: "Välj vem som höll mötet." });
lika("utfall: höll hör bara till Hållet", utfallIndata({ mote: MOTE, utfall: "uteblev", holl: FREDRIK }), { ok: false, fel: "Vem som höll mötet hör till Hållet." });
const andra = (o) => andraIndata({ mote: MOTE, fore: "2026-11-20 10:00", ...o });
lika("Ändra med ny hållare", andra({ hallsAv: FREDRIK }).varden?.hallsAv, FREDRIK);
lika("Ändra utan hållare: ingen ändring", andra({}).varden?.hallsAv, undefined);
lika("Ändra: hållaren är inget id", andra({ hallsAv: 7 }), { ok: false, fel: "Välj vem som håller mötet." });

console.log("\nInställningen: samma kund räknas som ny efter så många dagar");
const dagar = (v) => lasInstallningar(v === undefined ? [] : [{ key: INST_NYCKLAR.nyKundDagar, value: v }]).nyKundDagar;
lika("nyckeln", INST_NYCKLAR.nyKundDagar, "moten.ny-kund-dagar");
lika("saknas: 90", dagar(undefined), 90);
lika("30", dagar(30), 30);
lika("0 = av", dagar(0), 0);
lika("365 går", dagar(365), 365);
lika("över 365: förvalet", dagar(400), 90);
lika("negativt: förvalet", dagar(-1), 90);
lika("inte ett heltal: förvalet", dagar(12.5), 90);
ok("fönstret är pengar: bara provisionsrollerna ändrar det", PENGANYCKLAR.includes("moten.ny-kund-dagar") && !farAndraInstallning({ id: ADMIN, roller: ["team_lead"] }, "moten.ny-kund-dagar") && farAndraInstallning(admin(ADMIN), "moten.ny-kund-dagar"));

console.log("\nOmbokning från ett annat kort: provisionen följer kedjan bakåt");
{
  // X bokades av Fredrik på ett nytt kort, som ombokning av Y (Mick, ett annat kort, avbokat).
  const kort1 = new Map([["X", { art: "ombokning", foregaende: "Y", bokatAv: FREDRIK }]]);
  const lasta = [];
  const las = async (ids) => {
    lasta.push([...ids]);
    return ids.includes("Y") ? [{ id: "Y", art: "ny", foregaende: null, bokatAv: MICK }] : [];
  };
  const karta = await fyllForegaende(kort1, las);
  lika("Y läses in från det andra kortet", lasta, [["Y"]]);
  lika("den ursprungliga bokaren är Mick", ursprungligBokare("X", karta), MICK);
  lika("utan påfyllning hade det blivit Fredrik (det som gällde före)", ursprungligBokare("X", kort1), FREDRIK);

  // En kedja i flera led: X → Y → Z, där Z ligger på ett tredje kort.
  const las2 = async (ids) => ids.flatMap((id) => (id === "Y" ? [{ id: "Y", art: "ombokning", foregaende: "Z", bokatAv: ZEN }] : id === "Z" ? [{ id: "Z", art: "ny", foregaende: null, bokatAv: MICK }] : []));
  lika("flera led: Mick", ursprungligBokare("X", await fyllForegaende(kort1, las2)), MICK);

  // En slinga (X → Y → X) läses inte i evighet.
  let anrop = 0;
  const slinga = async (ids) => { anrop++; return ids.includes("Y") ? [{ id: "Y", art: "ombokning", foregaende: "X", bokatAv: ZEN }] : []; };
  await fyllForegaende(kort1, slinga);
  ok(`en slinga stannar (${anrop} läsning)`, anrop === 1);

  // Ett uppföljningsmöte bakom en ombokning: ingen bokarprovision, som förut.
  const las3 = async () => [{ id: "Y", art: "uppfoljning", foregaende: null, bokatAv: MICK }];
  lika("uppföljning bakåt: ingen", ursprungligBokare("X", await fyllForegaende(kort1, las3)), null);

  // Inget saknas: ingen läsning.
  let tomma = 0;
  await fyllForegaende(new Map([["A", { art: "ny", foregaende: null, bokatAv: MICK }]]), async () => { tomma++; return []; });
  ok("inget att fylla på: ingen läsning", tomma === 0);
}

console.log(fel === 0 ? `\n\x1b[32mAlla ${antal} prov gick igenom.\x1b[0m` : `\n\x1b[31m${fel} av ${antal} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
