#!/usr/bin/env node
/**
 * Startsidans tidslinje. Provas med TZ=UTC just for att bevisa att svaren inte
 * andras — linjen ritas mot svensk vaggtid, aldrig mot serverns zon. Se
 * `klocka.ts` for vad som gick sonder senast nagon glomde det.
 *
 * Det viktigaste provet star sist: linjen ska INTE bedoma nagot. Den ritar en
 * for lang rast och en for tidig start precis som allt annat.
 *
 *   node --experimental-strip-types tests/dagslinje.mjs
 */
import {
  andel,
  DYGNET,
  fonster,
  klockslag,
  kvarTillSlut,
  minuter,
  rastnedrakning,
  segment,
} from "../src/lib/dagslinje.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

// Sommartid, alltsa +02:00. Dagen ar den 17 augusti 2026.
const h = (id, kind, tid, extra = {}) => ({
  id,
  kind,
  occurred_at: `2026-08-17T${tid}:00.000+02:00`,
  source: "app",
  ...extra,
});
const nu = (tid) => new Date(`2026-08-17T${tid}:00.000+02:00`);
const schema = { start_time: "08:00:00", end_time: "17:00:00" };

console.log("\n\x1b[1mSegmenten\x1b[0m");
{
  const dag = [h("1", "in", "08:03"), h("2", "out", "17:02")];
  const s = segment(dag, nu("18:00"));
  ok("en hel dag ger ett segment", s.length === 1, String(s.length));
  ok("som börjar 08:03", s[0].fran === 8 * 60 + 3, String(s[0].fran));
  ok("och slutar 17:02", s[0].till === 17 * 60 + 2, String(s[0].till));
  ok("och är stängt", s[0].oppen === false);
  ok("och är arbete", s[0].typ === "arbete");
}

{
  const dag = [
    h("1", "in", "08:00"),
    h("2", "break_start", "12:00"),
    h("3", "break_end", "12:30"),
    h("4", "out", "17:00"),
  ];
  const s = segment(dag, nu("18:00"));
  ok("en dag med rast ger tre segment", s.length === 3, String(s.length));
  ok("mittensegmentet är rasten", s[1].typ === "rast");
  ok("rasten är 30 minuter", s[1].till - s[1].fran === 30);
  ok("och de två andra är arbete", s[0].typ === "arbete" && s[2].typ === "arbete");
}

console.log("\n\x1b[1mDet som pågår just nu\x1b[0m");
{
  const dag = [h("1", "in", "08:00")];
  const s = segment(dag, nu("11:30"));
  ok("en öppen stämpling ritas fram till nu", s[0].till === 11 * 60 + 30, String(s[0].till));
  ok("och är märkt som öppen", s[0].oppen === true);
}

{
  const dag = [h("1", "in", "08:00"), h("2", "break_start", "12:00")];
  const s = segment(dag, nu("12:20"));
  ok("den som är på rast har ett öppet rastsegment", s[1].typ === "rast" && s[1].oppen);
  ok("som är 20 minuter långt", s[1].till - s[1].fran === 20, String(s[1].till - s[1].fran));
}

console.log("\n\x1b[1mZens öppna stämpling — den som aldrig stängdes\x1b[0m");
{
  // AC-2.3: stamplingen gar inte att radera, sa dagen ligger kvar oppen tills
  // nagon rattar den. Renderas sidan nasta dygn ar `nu` MINDRE an starten.
  const dag = [h("1", "in", "18:08")];
  const s = segment(dag, new Date("2026-08-18T09:00:00.000+02:00"));
  ok("segmentet fylls till dygnets slut, inte till noll", s[0].till === DYGNET, String(s[0].till));
  ok("och får ingen negativ bredd", s[0].till >= s[0].fran);
}

console.log("\n\x1b[1mVäntande rättelser räknas inte\x1b[0m");
{
  // Samma regel som `lageNu`: det som vantar pa chefen ar ett forslag.
  const dag = [
    h("1", "in", "08:00"),
    h("2", "in", "07:00", { supersedes_id: "1", correction_state: "pending" }),
    h("3", "out", "17:00"),
  ];
  const s = segment(dag, nu("18:00"));
  ok("linjen börjar på den gällande tiden", s[0].fran === 8 * 60, String(s[0].fran));

  const beslutad = [
    h("1", "in", "08:00"),
    h("2", "in", "07:00", { supersedes_id: "1", correction_state: "approved" }),
    h("3", "out", "17:00"),
  ];
  const b = segment(beslutad, nu("18:00"));
  ok("en godkänd rättelse flyttar den", b[0].fran === 7 * 60, String(b[0].fran));
}

console.log("\n\x1b[1mFönstret\x1b[0m");
{
  const s = segment([h("1", "in", "08:00"), h("2", "out", "17:00")], nu("18:00"));
  const f = fonster(s, schema, nu("18:00"));
  ok("rymmer hela schemat", f.fran <= 8 * 60 && f.till >= 17 * 60);
  ok("med luft före", f.fran < 8 * 60, String(f.fran));
}

{
  // Den som borjade en timme fore schemat ska SE den timmen.
  const s = segment([h("1", "in", "06:30"), h("2", "out", "18:30")], nu("19:00"));
  const f = fonster(s, schema, nu("19:00"));
  ok("vidgas till en tidig start", f.fran <= 6 * 60 + 30, String(f.fran));
  ok("och till ett sent slut", f.till >= 18 * 60 + 30, String(f.till));
}

{
  const f = fonster([], null, nu("12:00"));
  ok("utan schema finns ändå en ram", f.till > f.fran);
  ok("och den ryms i dygnet", f.fran >= 0 && f.till <= DYGNET);
}

{
  // Klockan just nu maste rymmas, annars hamnar markoren utanfor linjen.
  const f = fonster([], schema, nu("23:30"));
  ok("nu ryms alltid i fönstret", f.till >= 23 * 60 + 30, String(f.till));
}

console.log("\n\x1b[1mAndelen\x1b[0m");
{
  const f = { fran: 480, till: 1080 }; // 08:00-18:00
  ok("mitten är 50 procent", andel(780, f) === 50, String(andel(780, f)));
  ok("före fönstret klipps till 0", andel(0, f) === 0);
  ok("efter fönstret klipps till 100", andel(1440, f) === 100);
  ok("ett fönster utan bredd kraschar inte", Number.isFinite(andel(10, { fran: 5, till: 5 })));
}

console.log("\n\x1b[1mRastnedräkningen\x1b[0m");
{
  const paRast = [h("1", "in", "08:00"), h("2", "break_start", "12:00")];
  const r = rastnedrakning(paRast, 30, nu("12:20"));
  ok("räknar ner från den schemalagda längden", r?.kvar === 10, String(r?.kvar));
  ok("och säger hur länge rasten pågått", r?.gatt === 20, String(r?.gatt));
  ok("och att den inte dragit över", r?.over === false);

  const over = rastnedrakning(paRast, 30, nu("12:45"));
  ok("över tiden märks", over?.over === true);
  ok("och kvar blir negativt", over?.kvar === -15, String(over?.kvar));
}

{
  const inne = [h("1", "in", "08:00")];
  ok("den som inte är på rast räknar ingenting ner", rastnedrakning(inne, 30, nu("12:00")) === null);

  const paRast = [h("1", "in", "08:00"), h("2", "break_start", "12:00")];
  ok("utan schemalagd längd räknas ingenting ner", rastnedrakning(paRast, null, nu("12:20")) === null);
  ok("och inte mot en längd på noll heller", rastnedrakning(paRast, 0, nu("12:20")) === null);

  const avslutad = [...paRast, h("3", "break_end", "12:30")];
  ok("en avslutad rast räknas inte ner", rastnedrakning(avslutad, 30, nu("13:00")) === null);
}

console.log("\n\x1b[1mKvar till schemats slut\x1b[0m");
ok("mitt på dagen", kvarTillSlut(schema, nu("15:00")) === 120, String(kvarTillSlut(schema, nu("15:00"))));
ok("efter arbetsdagen blir negativt", kvarTillSlut(schema, nu("18:00")) === -60);
ok("utan schema finns inget svar", kvarTillSlut(null, nu("15:00")) === null);

console.log("\n\x1b[1mTidsuppslag\x1b[0m");
ok("08:00 blir 480", minuter("08:00") === 480);
ok("sekunder stör inte", minuter("08:00:00") === 480);
ok("480 blir 08:00", klockslag(480) === "08:00");
ok("dygnets slut blir 00:00", klockslag(DYGNET) === "00:00");

console.log("\n\x1b[1mLinjen bedömer ingenting\x1b[0m");
{
  // En rast pa tva timmar och en start tva timmar fore schemat. Bada hade
  // gett avvikelser i `raster.ts` och i sen ankomst — men linjen ritar dem
  // precis som allt annat. Ingen typ utover 'arbete' och 'rast' finns.
  const slarvig = [
    h("1", "in", "06:00"),
    h("2", "break_start", "10:00"),
    h("3", "break_end", "12:00"),
    h("4", "out", "17:00"),
  ];
  const s = segment(slarvig, nu("18:00"));
  const typer = new Set(s.map((x) => x.typ));
  ok("bara arbete och rast finns som typer", [...typer].every((t) => t === "arbete" || t === "rast"));
  ok("den två timmar långa rasten ritas som en rast", s[1].till - s[1].fran === 120);
  ok("och den tidiga starten ritas utan anmärkning", s[0].fran === 6 * 60);
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
