#!/usr/bin/env node
/**
 * Appens filer svarar utan inloggning, allt annat kraver den fortfarande.
 *
 *   node --experimental-strip-types tests/app-vagar.mjs
 *
 * Manifestet och service workerna maste kunna hamtas av den som inte ar
 * inloggad: ett manifest bakom inloggning gor att man inte kan installera, och
 * en service worker-uppdatering som far en omdirigering avvisas. Provet laser
 * exakt vilka vagar som oppnas, och att /nav2, /nav2/version och / kraver
 * session. Modulen ar ren TS och importeras direkt.
 */
import { arPublik, APPFILER } from "../src/lib/publikavagar.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

console.log("\nAppens filer är öppna");
for (const p of ["/nav2/manifest.webmanifest", "/nav2/sw.js", "/app-sw.js", "/nav2/fonts/geist.woff2", "/.well-known/assetlinks.json", "/nav2/ikon/ikon-512.png"]) ok(`${p} är öppen`, arPublik(p));

console.log("\nAllt annat kräver inloggning");
for (const p of ["/nav2", "/nav2/hem", "/nav2/version", "/nav2/sw.js.map", "/nav2/manifest.webmanifestx", "/app-sw.jsx", "/.well-known/annat.json", "/"]) ok(`${p} kräver inloggning`, !arPublik(p));
for (const p of ["/nav2/fonts", "/nav2/fontsx/a", "/nav2/ikon", "/nav2/ikonx/a.png", "/nav2/sw.jsx", "/nav2/sw.js/x", "/app-sw.js/x", "/app-sw.js.map", "/nav2/version/x", "/nav2/manifest.webmanifest/x", "/.well-known", "/.well-known/", "/.well-known/assetlinks.json/x", "/.well-known/assetlinks.jsonx", "/nav2/", "/nav2/kalender", "/nav2/api/x"]) ok(`${p} kräver inloggning`, !arPublik(p));

console.log("\nDet som var öppet förut är det fortfarande");
for (const p of ["/logga-in", "/logga-in/verifiera", "/api/x", "/salesboard"]) ok(`${p} som förut`, arPublik(p));
for (const p of ["/auth", "/auth/callback", "/uppstart", "/api", "/salesboard/tavla"]) ok(`${p} som förut`, arPublik(p));
for (const p of ["/logga-inx", "/apix", "/salesboardx", "/authx", "/uppstartx"]) ok(`${p} är inte öppen bara för prefixet`, !arPublik(p));

console.log("\nAPPFILER är exakt fyra filer");
ok("fyra poster", APPFILER.length === 4);
ok("inga jokertecken eller snedstreck sist", APPFILER.every((f) => !f.includes("*") && !f.endsWith("/")));
ok("alla börjar med snedstreck", APPFILER.every((f) => f.startsWith("/")));
ok("alla är öppna", APPFILER.every((f) => arPublik(f)));

console.log(fel ? `\n\x1b[31m${fel} prov föll.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
