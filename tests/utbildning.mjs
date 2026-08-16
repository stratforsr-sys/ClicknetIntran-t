#!/usr/bin/env node
/**
 * Ren logik i M6 provas har, utan databas och utan webblasare: fragetolken,
 * lagesberakningen och sparrtiden. Kor med:
 *
 *   node --experimental-strip-types tests/utbildning.mjs
 */
import { tolkaFragor, skrivFragor, kursLage, sparrTill, utgangsdatum } from "../src/lib/utbildning.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

console.log("\n\x1b[1mFrågetolken\x1b[0m");
{
  const r = tolkaFragor("A?\n* Ja\n- Nej\n\nB?\n- Fel\n* Rätt");
  ok("två frågor tolkas", r.fel === null && r.fragor.length === 2, r.fel ?? "");
  ok("rätt svar markeras", r.fragor[1]?.alternativ[1]?.ratt === true);
  ok("stjärnan följer inte med i texten", r.fragor[0]?.alternativ[0]?.label === "Ja");

  ok("saknat rätt svar nekas", tolkaFragor("A?\n- Ja\n- Nej").fel?.includes("saknar rätt svar"));
  ok("ett enda alternativ nekas", tolkaFragor("A?\n* Ja").fel?.includes("minst två"));
  ok("rad utan markör nekas", tolkaFragor("A?\nJa\n- Nej").fel?.includes("* eller -"));
  ok("tomt alternativ nekas", tolkaFragor("A?\n* \n- Nej").fel?.includes("tomt"));
  ok("tom text ger inga frågor", tolkaFragor("   ").fragor.length === 0);
  ok("flera rätta svar tillåts", tolkaFragor("A?\n* Ja\n* Kanske\n- Nej").fel === null);

  const runt = tolkaFragor(skrivFragor(tolkaFragor("A?\n* Ja\n- Nej").fragor));
  ok("skriv och tolka är varandras motsatser", runt.fragor[0]?.alternativ[0]?.ratt === true);
}

console.log("\n\x1b[1mKursläget\x1b[0m");
{
  const bas = { klaraModuler: 0, antalModuler: 3, startDatum: null, fristDagar: null };
  ok("utan progress: ej påbörjad", kursLage({ ...bas, certifikat: null }) === "ej_paborjad");
  ok("med progress: pågår", kursLage({ ...bas, certifikat: null, klaraModuler: 1 }) === "pagar");

  const evigt = { issued_at: "2020-01-01T00:00:00Z", expires_at: null };
  ok("certifikat utan slutdatum gäller", kursLage({ ...bas, certifikat: evigt }) === "certifierad");

  const utgatt = { issued_at: "2020-01-01T00:00:00Z", expires_at: "2021-01-01T00:00:00Z" };
  ok("passerat slutdatum = utgången", kursLage({ ...bas, certifikat: utgatt }) === "utgangen");

  const giltigt = { issued_at: "2020-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z" };
  ok("framtida slutdatum gäller", kursLage({ ...bas, certifikat: giltigt }) === "certifierad");

  // Fristen raknas fran anstallningens start, inte fran ett fast datum.
  const sen = { ...bas, certifikat: null, startDatum: "2020-01-01", fristDagar: 14 };
  ok("passerad frist = försenad", kursLage(sen) === "forsenad");
  ok("men ett giltigt certifikat väger tyngre",
    kursLage({ ...sen, certifikat: giltigt }) === "certifierad");
  ok("och försenad väger tyngre än pågår", kursLage({ ...sen, klaraModuler: 2 }) === "forsenad");

  const iTid = { ...bas, certifikat: null, startDatum: "2099-01-01", fristDagar: 14 };
  ok("frist i framtiden är inte försenad", kursLage(iTid) === "ej_paborjad");
}

console.log("\n\x1b[1mSpärrtid vid omtag\x1b[0m");
{
  const nyss = new Date(Date.now() - 60 * 1000).toISOString();
  ok("färskt underkänt spärrar", sparrTill(nyss, 24) !== null);
  ok("och öppnar efter angiven tid",
    Math.round((sparrTill(nyss, 24).getTime() - Date.parse(nyss)) / 3600000) === 24);

  const gammalt = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  ok("gammalt underkänt spärrar inte", sparrTill(gammalt, 24) === null);
  ok("noll timmar spärrar aldrig", sparrTill(nyss, 0) === null);
  ok("inget försök spärrar inte", sparrTill(null, 24) === null);
}

console.log("\n\x1b[1mCertifikatets giltighet\x1b[0m");
{
  ok("utan månader gäller det tills vidare", utgangsdatum(null) === null);
  const d = utgangsdatum(12, new Date("2026-01-15T00:00:00Z"));
  ok("tolv månader ger nästa år", d?.startsWith("2027-01-15"), String(d));
}

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller godkända.\x1b[0m\n" : `\n\x1b[31m${fel} underkända.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
