#!/usr/bin/env node
/**
 * M2:s logik provas utan databas: laget raknas fram ur handelserna, rattelser
 * ersatter men raderar inte, och arbetad tid drar bort rasterna.
 *
 *   node --experimental-strip-types tests/tid.mjs
 */
import {
  lageNu,
  gallande,
  arbetadeMinuter,
  tillatna,
  tillaten,
  timmarOchMinuter,
  harVantatForLange,
  omprovningSenast,
  NODSTOPP_STAMPLING,
  NODSTOPP_RAST,
} from "../src/lib/tid.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const h = (id, kind, tid, extra = {}) => ({ id, kind, occurred_at: `2026-08-17T${tid}:00.000Z`, source: "app", ...extra });

console.log("\n\x1b[1mLäget räknas fram ur händelserna\x1b[0m");
{
  ok("inga händelser = ute", lageNu([]) === "ute");
  ok("efter in = inne", lageNu([h("1", "in", "08:00")]) === "inne");
  ok("efter ut = ute", lageNu([h("1", "in", "08:00"), h("2", "out", "17:00")]) === "ute");
  ok("efter rastens början = rast",
    lageNu([h("1", "in", "08:00"), h("2", "break_start", "12:00")]) === "rast");
  ok("efter rastens slut = inne igen",
    lageNu([h("1", "in", "08:00"), h("2", "break_start", "12:00"), h("3", "break_end", "12:30")]) === "inne");

  // Ordningen i listan ska inte spela roll — tiden avgor.
  ok("omkastad lista ger samma svar",
    lageNu([h("2", "out", "17:00"), h("1", "in", "08:00")]) === "ute");
}

console.log("\n\x1b[1mRättelser ersätter, men raderar inte\x1b[0m");
{
  const original = h("1", "out", "17:00");
  const begard = h("2", "out", "16:00", { supersedes_id: "1", correction_state: "pending", source: "correction" });

  const vantar = [original, begard];
  ok("en väntande rättelse räknas inte", gallande(vantar).length === 1);
  ok("och originalet är det som gäller", gallande(vantar)[0].occurred_at.includes("17:00"));

  const godkand = { ...begard, correction_state: "approved" };
  const beslutad = [original, godkand];
  ok("en godkänd rättelse tar originalets plats", gallande(beslutad).length === 1);
  ok("och det är den nya tiden som gäller", gallande(beslutad)[0].occurred_at.includes("16:00"));
  ok("men originalet finns kvar i listan att läsa", beslutad.length === 2);

  const avslagen = [original, { ...begard, correction_state: "rejected" }];
  ok("en avslagen rättelse ändrar ingenting", gallande(avslagen)[0].occurred_at.includes("17:00"));
}

console.log("\n\x1b[1mArbetad tid\x1b[0m");
{
  const dag = [h("1", "in", "08:00"), h("2", "out", "16:00")];
  ok("åtta timmar blir 480 minuter", arbetadeMinuter(dag) === 480, String(arbetadeMinuter(dag)));

  const medRast = [h("1", "in", "08:00"), h("2", "break_start", "12:00"), h("3", "break_end", "12:30"), h("4", "out", "16:00")];
  ok("rasten räknas bort", arbetadeMinuter(medRast) === 450, String(arbetadeMinuter(medRast)));

  const oppen = [h("1", "in", "08:00")];
  ok("öppen stämpling räknas fram till nu",
    arbetadeMinuter(oppen, new Date("2026-08-17T09:30:00.000Z")) === 90);

  const rattad = [
    h("1", "out", "17:00"),
    h("0", "in", "08:00"),
    h("2", "out", "16:00", { supersedes_id: "1", correction_state: "approved", source: "correction" }),
  ];
  ok("den godkända rättelsen används i summan", arbetadeMinuter(rattad) === 480, String(arbetadeMinuter(rattad)));

  ok("format med timmar och minuter", timmarOchMinuter(450) === "7 h 30 min", timmarOchMinuter(450));
  ok("jämn timme utan minuter", timmarOchMinuter(480) === "8 h");
  ok("under en timme", timmarOchMinuter(45) === "45 min");
}

console.log("\n\x1b[1mBara giltiga övergångar\x1b[0m");
{
  ok("ute kan bara stämpla in", tillatna("ute", true).join() === "in");
  ok("rast kan bara avslutas", tillatna("rast", true).join() === "break_end");
  ok("dubbel instämpling nekas", tillaten("inne", "in", true) === false);
  ok("utstämpling utan att vara inne nekas", tillaten("ute", "out", true) === false);
  ok("rast avslutas inte när man är ute", tillaten("ute", "break_end", true) === false);
  ok("rastknappen nekas nar rasten ar avstangd", tillaten("inne", "break_start", false) === false);
}

console.log("\n\x1b[1mStrömbrytarna och fristerna\x1b[0m");
{
  // Vad som ar pasla­get avgors av compliance_gate i databasen. I koden finns
  // bara nodstoppen, och de ska sta oanvanda.
  ok("nödstoppet för stämpling är inte draget", NODSTOPP_STAMPLING === false);
  ok("nödstoppet för rast är inte draget", NODSTOPP_RAST === false);
  ok("utan påslagen rast finns ingen rastknapp", tillatna("inne", false).join() === "out");
  ok("med påslagen rast finns den", tillatna("inne", true).join() === "break_start,out");

  const nu = new Date("2026-08-17T12:00:00.000Z");
  ok("en rättelse på två timmar har inte väntat för länge",
    harVantatForLange("2026-08-17T10:00:00.000Z", nu) === false);
  ok("en på tre dygn har det",
    harVantatForLange("2026-08-14T10:00:00.000Z", nu) === true);
  ok("gränsen går vid 48 timmar",
    harVantatForLange("2026-08-15T11:59:00.000Z", nu) === true &&
    harVantatForLange("2026-08-15T12:01:00.000Z", nu) === false);

  ok("utan påslagen rast finns inget omprövningsdatum", omprovningSenast(null) === null);
  ok("sex månader efter påslaget", omprovningSenast("2026-09-01") === "2027-03-01",
    String(omprovningSenast("2026-09-01")));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
