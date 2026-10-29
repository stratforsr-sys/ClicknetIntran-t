#!/usr/bin/env node
/**
 * Appen: webbmanifestet och ikonerna (installera Nav på hemskärmen).
 *
 *   TZ=UTC node --experimental-strip-types tests/app-manifest.mjs
 *
 * scope är "/" och inte "/nav2", annars ligger /logga-in utanför appen och
 * iPhone öppnar inloggningen i ett Safari-lager med egen kakburk. id är
 * "/nav2": samma identitet som det gamla manifestet fick av sin start_url,
 * så den som redan installerat appen får ingen dubblett. Ikonernas mått läses
 * ur PNG-huvudet (bredd och höjd, big-endian, byte 16-23).
 */
import { readFileSync, existsSync } from "node:fs";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const publik = new URL("../public", import.meta.url).pathname;
const m = JSON.parse(readFileSync(`${publik}/nav2/manifest.webmanifest`, "utf8"));
const ikoner = m.icons || [];
const genvagar = m.shortcuts || [];

const ikon = (storlek, syfte) => ikoner.some((i) => i.sizes === `${storlek}x${storlek}` && i.purpose === syfte && i.type === "image/png");
// Ikonens mått ur PNG-huvudet som "BxH", eller null om filen saknas eller inte är en PNG.
const matt = (src) => {
  const fil = `${publik}${src}`;
  if (!src.startsWith("/") || !existsSync(fil)) return null;
  const b = readFileSync(fil);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
};

ok("id är /nav2 (samma app som redan installerats)", m.id === "/nav2");
ok("start_url /nav2", m.start_url === "/nav2");
ok("scope / (inloggningen ligger inne i appen)", m.scope === "/");
ok("display standalone", m.display === "standalone");
ok("lang sv", m.lang === "sv");
ok("192 any finns", ikon(192, "any")); ok("512 any finns", ikon(512, "any")); ok("512 maskable finns", ikon(512, "maskable"));
ok("varje ikonfil finns och har sitt angivna mått", ikoner.length > 0 && ikoner.every((i) => matt(i.src) === i.sizes));
ok("iPhones hemskärmsikon är 180x180", matt("/nav2/ikon/apple-touch-180.png") === "180x180");
ok("tre genvägar", genvagar.length === 3);
ok("genvägarna går via ?till=", genvagar.every((s) => /^\/nav2\?till=\/(kalender|tid|uppgifter)$/.test(s.url)));
ok("genvägarna har 192-ikonen", genvagar.every((s) => s.icons?.[0]?.src === "/nav2/ikon/ikon-192.png"));
ok("en mejllänk återanvänder det öppna appfönstret", JSON.stringify(m.launch_handler) === JSON.stringify({ client_mode: ["navigate-existing", "auto"] }));

console.log(fel ? `\n\x1b[31m${fel} prov foll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
