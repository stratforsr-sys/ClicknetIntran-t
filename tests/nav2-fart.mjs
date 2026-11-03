#!/usr/bin/env node
/**
 * Nav 2.0: fartåtgärderna (beställaren 2026-11-02, "navet är super segt").
 *
 *   node tests/nav2-fart.mjs
 *
 * Planen och mätningarna står i ~/nav2-utkast/delar/fart-nov/PLAN.md och
 * PRESTANDAPROV.md. Provet läser källorna och håller fast det som gjorts, så
 * att en senare ändring inte tyst tar tillbaka väntan:
 *
 *   1. Typsnitten förladdas i huvudet, adressen bär ?v=, next.config.ts cachar
 *      den för alltid, och mellanvaran rör dem inte (F1).
 *   2. Schemat och den första anslutningen startar före inloggningen i /nav2
 *      och /nav2/data (F2), och medPg läser schemat på ett enda ställe.
 *   3. /nav2 och /nav2/data skickar Server-Timing (steg 0), så att varje steg
 *      går att mäta i webbläsarens nätverksflik.
 *   4. Uppgifters ändringar syns direkt (steg 2): raden ändras innan servern
 *      svarat, blir som förut vid ett nej, och står kvar under en omhämtning.
 *      Bara det servern släpper igenom gissas, ett dubbelklick är ett klick
 *      också när raden flyttat, ett nej på Stryk öppnar rutan igen, och efter
 *      tidsgränsen hämtas det som gäller. Det som händer i webbläsaren provas i
 *      ~/nav2-utkast/probe/genast-prov.mjs (headless Chrome med Zens data,
 *      servern svarar efter 1,5 s: 56 rader).
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
const las = (f) => readFileSync(join(rot, f), "utf8");
const sida = las("src/app/nav2/route.ts");
const datarutt = las("src/app/nav2/data/route.ts");
const pgrest = las("src/lib/nav2/pgrest.ts");
const upgData = las("src/lib/nav2/uppgifter.ts");
const upgRegler = las("src/lib/uppgifter.ts");
const konfig = las("next.config.ts");
const mellan = las("src/middleware.ts");
const utkast = las("src/nav2/utkast.html");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

rubrik("Typsnitten");
const filer = readdirSync(join(rot, "public/nav2/fonts")).filter((f) => f.endsWith(".woff2")).map((f) => f.replace(/\.woff2$/, "")).sort();
const lista = sida.slice(sida.indexOf("const TYPSNITTEN"), sida.indexOf("];", sida.indexOf("const TYPSNITTEN")));
const iSidan = [...lista.matchAll(/\["[^"]+", "([a-z-]+)", "\d+ \d+"\]/g)].map((m) => m[1]).sort();
ok("varje fil i public/nav2/fonts står i TYPSNITTEN", JSON.stringify(iSidan) === JSON.stringify(filer), iSidan.join(" "));
// Versionen är filernas innehåll, räknad i bygget: en ny fil får en ny adress utan att någon minns att byta den.
const konfigObj = (await import(pathToFileURL(join(rot, "next.config.ts")).href)).default;
const summa = createHash("sha256"); for (const f of readdirSync(join(rot, "public/nav2/fonts")).filter((f) => f.endsWith(".woff2")).sort()) summa.update(readFileSync(join(rot, "public/nav2/fonts", f)));
const vantad = summa.digest("hex").slice(0, 8);
ok("versionen räknas ur filernas innehåll i next.config.ts", konfigObj.env?.NAV2_TYPSNITT_V === vantad, `${konfigObj.env?.NAV2_TYPSNITT_V} / ${vantad}`);
ok("sidan tar versionen ur bygget", /const TYPSNITT_V = process\.env\.NAV2_TYPSNITT_V \|\| "1";/.test(sida));
ok("förladdas i huvudet med crossorigin", /<link rel="preload" href="\/nav2\/fonts\/\$\{fil\}\.woff2\?v=\$\{TYPSNITT_V\}" as="font" type="font\/woff2" crossorigin>/.test(sida));
ok("@font-face begär samma adress som förladdningen", /src:url\(\/nav2\/fonts\/\$\{fil\}\.woff2\?v=\$\{TYPSNITT_V\}\)/.test(sida));
ok("ingen typsnittsadress utan ?v= kvar i sidan", !/\/nav2\/fonts\/[a-z-]+\.woff2[)"]/.test(sida));
const regel = konfig.slice(konfig.indexOf('source: "/nav2/fonts/:fil"'), konfig.indexOf("}", konfig.indexOf("immutable")));
ok("next.config.ts cachar adresser med ?v= för alltid", /has: \[\{ type: "query", key: "v" \}\]/.test(regel) && /public, max-age=31536000, immutable/.test(regel));

const matcher = mellan.match(/matcher: \["([^"]+)"\]/)?.[1].replace(/\\\\/g, "\\");
const traffar = (p) => new RegExp(`^${matcher}$`).test(p);
ok("mellanvarans matcher går att läsa", Boolean(matcher));
for (const p of ["/nav2/fonts/geist.woff2", "/nav2/fonts/bricolage.woff2"]) ok(`${p} går förbi mellanvaran`, !traffar(p));
for (const p of ["/nav2", "/nav2/data", "/nav2/skript.js", "/nav2/stil.css", "/nav2/uppgifter", "/nav2/manifest.webmanifest", "/", "/logga-in"]) ok(`${p} går genom mellanvaran som förut`, traffar(p));

rubrik("Kall instans");
const fore = (kalla, namn) => kalla.indexOf("forvarmPg();") > -1 && kalla.indexOf("forvarmPg();") < kalla.indexOf("await getCurrentUser()");
ok("/nav2 startar schemat före inloggningen", fore(sida));
ok("/nav2/data startar schemat före inloggningen", fore(datarutt));
// Bara för en inloggning som mellanvaran redan kontrollerat: identitetsrubriken (src/lib/identitet.ts).
for (const [namn, kalla] of [["/nav2", sida], ["/nav2/data", datarutt]]) ok(`${namn} värmer bara upp för en kontrollerad inloggning`, /if \(lasIdentitet\(await headers\(\)\)\) forvarmPg\(\);/.test(kalla));
ok("forvarmPg finns och väntar inte", /export function forvarmPg\(\): void \{[\s\S]*?hamtaSchema\(p\)\.catch\(\(\) => \{\}\);/.test(pgrest));
ok("schemat läses på ett ställe", (pgrest.match(/lasSchema\(p\)/g) ?? []).length === 1 && /schema = await hamtaSchema\(p\);/.test(pgrest));

rubrik("Mätningen");
ok("/nav2 skickar inloggningens tid", /"Server-Timing": `auth;dur=\$\{auth\}`/.test(sida));
ok("/nav2/data skickar inloggning, bygge, kö och databas", /"Server-Timing": timing/.test(datarutt) && /anslut: m\["pg-anslut"\], ko: m\["pg-ko"\], db: m\["pg-db"\]/.test(datarutt));

rubrik("Uppgifter: ändringen syns direkt");
const post = utkast.slice(utkast.indexOf("async function ndUpgPost("), utkast.indexOf("\n}\n", utkast.indexOf("async function ndUpgPost(")));
ok("ndUpgPost ändrar raden före sparningen", /const v = ladda \? ndUpgGenast\(handling, data\) : null;/.test(post) && post.indexOf("ndUpgGenast(") < post.indexOf("ndSkriv("));
ok("ett ja och ett nej avslutar ändringen", /ndUpgSvarat\(v, true\)/.test(post) && (post.match(/ndUpgSvarat\(v, false\)/g) ?? []).length === 2);
ok("samma uppgift sparas i tur och ordning", /ndUpgITur\(v\.id, /.test(post));
ok("bara i skrivläge och för navets egna uppgifter", /ndUpgNav\(t\.id\) && ndUp\(\)\.skriv && ndUpgFar\(t, handling\) \? ndUpgForutse/.test(utkast));
ok("bara det servern släpper igenom gissas: stryka kräver farStryk, resten farRed", /const ndUpgFar = \(t, handling\) => handling === 'avbryt' \? !!t\.ndFarStryk : !!t\.ndFarRed;/.test(utkast) && /t\.ndFarStryk = x\.farStryk;/.test(utkast));
ok("farStryk är serverns farBjudaIn", /farStryk: u\.created_by === mig \|\| u\.assignee_id === mig,/.test(upgData) && /export function farBjudaIn\(k: Krets\): boolean \{\s*return k\.created_by === k\.mig \|\| k\.assignee_id === k\.mig;\s*\}/.test(upgRegler));
for (const h of ["bocka", "ateroppna", "avbryt", "planera", "andra"]) ok(`${h} förutses`, new RegExp(`handling === '${h}'`).test(utkast.slice(utkast.indexOf("function ndUpgForutse("), utkast.indexOf("function ndUpgGenast("))));
ok("väntande ändringar läggs på igen efter en omhämtning", /in:\(\) => \{ ndUpgIgen\(\);/.test(utkast) && /NDUPGVANTAR\.forEach\(v => \{ const t = ndUpgT\(v\.id\); if \(t\) Object\.assign\(t, v\.falt\); \}\);/.test(utkast));
ok("en sparad ändring släpps först av en omhämtning som började efter svaret", /if \(v\.klar && v\.klar < NDOMLASSTART\) NDUPGVANTAR\.delete\(v\)/.test(utkast) && /NDOMLASSTART = Date\.now\(\);\n\s*const s = await ndLas\('\/nav2\/data\?delar='/.test(utkast));
ok("ett dubbelklick på bocken är ett klick", /if \(ladda && \(ndUpgDubbel\(handling, data\) \|\| ndUpgSammaStalle\(k\)\)\) return/.test(post) && /Date\.now\(\) - x\.at < 500/.test(utkast));
ok("ett andra musklick på samma ställe inom en halv sekund görs inte", /e\.isTrusted && e\.detail > 0/.test(utkast) && /k\.at - NDUPGKLICK\.at < 500/.test(utkast) && /if \(v && k\) NDUPGKLICK = k;/.test(post));
ok("ett nej på Stryk öppnar rutan igen", /S\.panel = null; v\.rutan = true;/.test(utkast) && /if \(v\.rutan && !S\.panel && t && t\.lage !== 'avbruten'\) S\.panel = v\.id;/.test(utkast));
ok("efter tidsgränsen hämtas det som gäller, efter ett nätfel inte", /if \(ladda && r\.hangde && r\.fel === NDSKRIVTEXT\.tid\) ndOmlas\('upg'\);/.test(post));
ok("med granskare gissas ingenting", /if \(t\.lage !== 'oppen' \|\| t\.granskare\) return null;/.test(utkast));
ok("ett nej återställer varje fält som ingen senare ändring tagit över", /x\.nr > v\.nr/.test(utkast) && /if \(x\) x\.fore\[k\] = v\.fore\[k\]; else if \(t\) t\[k\] = v\.fore\[k\];/.test(utkast));

console.log(fel ? `\n\x1b[31m${fel} fel.\x1b[0m` : "\n\x1b[32mAlla prov gick igenom.\x1b[0m");
process.exit(fel ? 1 : 0);
