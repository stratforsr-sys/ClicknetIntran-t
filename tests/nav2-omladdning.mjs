#!/usr/bin/env node
/**
 * Nav 2.0: en sparning laddar inte om sidan (beställaren 2026-11-02).
 *
 *   node tests/nav2-omladdning.mjs
 *
 * Förut laddades hela sidan om efter varje sparning: all data på nytt (418
 * frågor, 5–9 s), och vyns tur startade om. Nu hämtar ndOmlas i utkastet
 * bara delarna som sparningen kan ha ändrat från /nav2/data
 * (byggNav2Delar i src/lib/nav2/data.ts). Provet läser källorna och håller
 * ihop de två halvorna:
 *
 *   1. Varje del en vy begär (delar, laser) finns i serverns DELAR, annars
 *      svarar /nav2/data 400 och sidan laddas om som förut.
 *   2. Varje ndOmlas('x') har en vy som anmält sig, annars laddas sidan om.
 *   3. location.reload() finns bara där det är meningen: reserven, Säljtavlans
 *      knapp Ladda om, profilens återställning efter ett fel och appens
 *      omladdningar. En ny sparväg som laddar om sidan blir röd här.
 *   4. Vyns tur minns i sessionStorage att den startat, så att den inte
 *      startar om efter en omladdning i samma flik.
 *
 * Det som händer i webbläsaren provas i ~/nav2-utkast/probe/omladdning-prov.mjs
 * (headless Chrome med riktig data: 80 rader).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
const html = readFileSync(join(rot, "src/nav2/utkast.html"), "utf8");
const data = readFileSync(join(rot, "src/lib/nav2/data.ts"), "utf8");
const rutt = readFileSync(join(rot, "src/app/nav2/data/route.ts"), "utf8");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Serverns delar");
const delarKalla = data.slice(data.indexOf("const DELAR = {"), data.indexOf("} satisfies"));
const DELAR = new Set([...delarKalla.matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]));
ok("DELAR finns och har grund", DELAR.has("grund"), [...DELAR].join(" "));
const typ = data.slice(data.indexOf("export type Nav2Data = {"), data.indexOf("\n};", data.indexOf("export type Nav2Data = {")));
for (const d of DELAR) if (d !== "grund") ok(`${d} är en nyckel i Nav2Data`, new RegExp(`^\\s{2}${d}:`, "m").test(typ));
ok("rutten släpper bara igenom kända delar", /filter\(arNav2Del\)/.test(rutt) && /status: 400/.test(rutt));
ok("rutten läser med pg-vägen som /nav2", /lasIdentitet\(h\)/.test(rutt) && /byggNav2Delar\(user, delar, pg[,)]/.test(rutt));

rubrik("Vyerna i utkastet");
const anmalda = new Map();
for (const m of html.matchAll(/ndOmlasAnmal\('([a-z]+)', \{delar:\[([^\]]*)\](?:, laser:\[([^\]]*)\])?/g)) {
  const lista = (s) => (s ? [...s.matchAll(/'([a-z]+)'/g)].map((x) => x[1]) : []);
  anmalda.set(m[1], [...lista(m[2]), ...lista(m[3])]);
}
ok("vyer har anmält sig", anmalda.size >= 15, [...anmalda.keys()].join(" "));
for (const [vy, delar] of anmalda) {
  const okanda = delar.filter((d) => !DELAR.has(d));
  ok(`${vy}: varje del finns på servern`, okanda.length === 0, okanda.join(" "));
}
const anrop = new Set([...html.matchAll(/ndOmlas\('([a-z]+)'/g)].map((m) => m[1]));
for (const vy of anrop) ok(`ndOmlas('${vy}') har en anmäld vy`, anmalda.has(vy));

rubrik("Ingen sparning laddar om sidan");
const TILLATNA = [
  /if \(!NDOMLAS\[vy\]\)\{ setTimeout\(\(\) => location\.reload\(\), 700\)/,
  /^\s*setTimeout\(\(\) => location\.reload\(\), 300\);$/,
  /if \(d\.sbladda !== undefined\)\{ klart\(\); location\.reload\(\); return; \}/,
  /ndPrfPost\('konto', fore\)\.then\(r => \{ if \(r\.fel\) setTimeout\(\(\) => location\.reload\(\), 1200\)/,
  /ndPrfPost\('bild-angra'\)\.then\(s => \{ if \(s\.fel\)\{ setTimeout\(\(\) => location\.reload\(\), 1200\)/,
  /ring\(\)\.classList\.add\('laddar'\); location\.reload\(\);/,
  /const ndAppLaddaOm = \(\) => \{ location\.reload\(\); \};/,
  /toast\('Nav har uppdaterats\.', \(\) => location\.reload\(\), 'Ladda om'\)/,
];
const rader = html.split("\n").map((r, i) => [i + 1, r]).filter(([, r]) => r.includes("location.reload("));
for (const [nr, r] of rader) ok(`rad ${nr} är en tillåten omladdning`, TILLATNA.some((t) => t.test(r)), TILLATNA.some((t) => t.test(r)) ? "" : r.trim().slice(0, 140));
ok("alla tillåtna finns kvar, ingen mer", rader.length === TILLATNA.length, `${rader.length} av ${TILLATNA.length}`);

rubrik("Vyns tur");
ok("visad läses ur sessionStorage", /visad:ndGuVisad\(\)/.test(html) && /sessionStorage\.getItem\('nd-gu-visad'/.test(html));
ok("visad sparas när turen startar", /NDGU\.visad\.add\(slug\); try \{ sessionStorage\.setItem\('nd-gu-visad'/.test(html));

console.log(fel ? `\n\x1b[31m${fel} fel.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
