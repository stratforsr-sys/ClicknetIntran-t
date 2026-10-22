#!/usr/bin/env node
/**
 * Nav 2.0: `/nav2?till=…` stannar pa sajten (granskningen B1/G6).
 *
 *   TZ=UTC node --experimental-strip-types tests/nav2-till.mjs
 *
 * Mellanvaran skickar en gammal adress till /nav2?till=/x, och skalet i
 * utkastet oppnar den. `till` ar alltsa styrd utifran: en lank i ett mejl kan
 * innehalla vad som helst. Klienten maste vagra samma saker som inloggningens
 * `sakerNasta` (src/lib/inloggning.ts), annars blir "/\evil.example" en
 * omdirigering till en annan sajt efter inloggningen.
 *
 * Provet plockar `function ndSakerTill` ur src/nav2/utkast.html och jamfor den
 * med `sakerNasta` for varje fall.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { sakerNasta } from "../src/lib/inloggning.ts";

const rot = join(fileURLToPath(import.meta.url), "..", "..");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// Funktionen ur skriptet: fran "function ndSakerTill(" till den klammer som stanger kroppen.
function plocka(html, namn) {
  const i = html.indexOf(`function ${namn}(`);
  if (i < 0) return null;
  let j = html.indexOf("{", i), djup = 0;
  for (; j < html.length; j++) {
    if (html[j] === "{") djup++;
    else if (html[j] === "}" && --djup === 0) break;
  }
  return html.slice(i, j + 1);
}

const html = readFileSync(join(rot, "src/nav2/utkast.html"), "utf8");
const kalla = plocka(html, "ndSakerTill");

rubrik("ndSakerTill finns i utkastet");
ok("function ndSakerTill finns", !!kalla);
if (!kalla) {
  console.log(`\n\x1b[31m${fel} fel\x1b[0m`);
  process.exit(1);
}
const ndSakerTill = new Function(`${kalla}; return ndSakerTill;`)();

rubrik("Vägar ut ur sajten ger null");
for (const s of [
  "/\\evil.example",
  "/\\evil.example/logga-in",
  "//evil.example",
  "https://evil.example",
  "evil.example",
  "/tid\u0000",
  "/\tevil.example",
  "/\t/evil.example",
  "/tid\\x",
  "/x\u007f",
  "",
  null,
]) ok(`${JSON.stringify(s)} → null`, ndSakerTill(s) === null, String(ndSakerTill(s)));

rubrik("Inloggningens egna sidor ger null");
for (const s of ["/logga-in", "/logga-in?nasta=/x", "/auth/callback", "/"]) ok(`${s} → null`, ndSakerTill(s) === null);

rubrik("Vägar inom navet kommer tillbaka oförändrade");
for (const s of ["/franvaro/attest?x=1", "/tid", "/kalender?dag=2026-10-22&handelse=abc", "/sok?q=semester", "/order/123"]) ok(`${s}`, ndSakerTill(s) === s);

rubrik("Samma svar som sakerNasta (src/lib/inloggning.ts)");
const fall = ["/\\a", "//a", "/a", "/a\\b", "/a\nb", "/logga-in", "/auth", "/", "x", "/franvaro?x=1", "/@evil.example", "/%5Cevil.example"];
for (const s of fall) {
  const nasta = sakerNasta(s, "RESERV");
  ok(`${JSON.stringify(s)}`, (nasta === "RESERV" ? null : nasta) === ndSakerTill(s));
}

rubrik("Läsaren och ndGa använder den");
ok("till-läsaren går genom ndSakerTill", /ndSakerTill\(new URLSearchParams\(location\.search\)\.get\('till'\)\)/.test(html));
ok("den gamla svaga regeln är borta", !html.includes("/^\\/(?!\\/)/.test(till)"));

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla gröna\x1b[0m");
process.exit(fel ? 1 : 0);
