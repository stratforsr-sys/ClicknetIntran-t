#!/usr/bin/env node
/**
 * Bron (K6 del 1): i produktionen visas en vy i Nav 2.0 forst nar den far spara.
 *
 *   TZ=UTC node --experimental-strip-types tests/bro.mjs
 *
 * `BRO` laggs nar modulen laddas, sa varje lage kors i en egen barnprocess med
 * NAV2_BRO och VERCEL_ENV satta. Barnet skriver svaren som JSON, och provet har
 * jamfor. Ingen databas, inga natanrop.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const rot = join(fileURLToPath(import.meta.url), "..", "..");

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// Barnet: laddar modulerna med miljon satt och svarar pa fragorna.
const BARN = `
const s = await import(${JSON.stringify(join(rot, "src/lib/nav2/skrivlage.ts"))});
const v = await import(${JSON.stringify(join(rot, "src/lib/nav2/vagar.ts"))});
const adresser = JSON.parse(process.env.ADRESSER);
console.log(JSON.stringify({
  bro: s.BRO,
  visas: Object.fromEntries([...Object.keys(s.SKRIVLAGE), "logg", "adoption", "sok", "installningar", "kv"].map((k) => [k, s.visasINav2(k)])),
  skrivlage: s.SKRIVLAGE,
  iNuvarande: s.iNuvarande(),
  lasvyer: Object.keys(s.SKRIVLAGE).filter((k) => !s.SKRIVLAGE[k]),
  adress: Object.fromEntries(adresser.map((a) => [a, v.nav2Adress(a, "")])),
  sjalv: (v.SJALV ?? []).map(([vy, m]) => [vy, String(m)]),
}));
`;

const ADRESSER = [
  "/", "/tid", "/tid/lonerapport", "/franvaro/attest", "/kalender", "/logg", "/adoption", "/sok", "/personal", "/personal/ny",
  "/lonekostnad", "/lonekostnad/satser", "/order", "/provision", "/avtal", "/leads", "/nyheter", "/profil", "/coachning/uppgift/x",
  "/rekrytering", "/rekrytering/ny", "/arenden", "/arenden/statistik", "/fel/nytt", "/uppgifter", "/rutiner/x/kvittenser", "/utbildning", "/okand",
];

function lage(env) {
  const ut = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", BARN], {
    env: { ...process.env, NAV2_BRO: "", VERCEL_ENV: "", ...env, ADRESSER: JSON.stringify(ADRESSER) },
    encoding: "utf8",
  });
  return JSON.parse(ut.trim().split("\n").pop());
}

const lika = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// Det väntade räknas ur SKRIVLAGE, aldrig ur en lista här: S10 slår på vyer en i taget (B7), och provet ska förbli grönt.
rubrik("Bron på (NAV2_BRO=1)");
const pa = lage({ NAV2_BRO: "1" });
const SKRIV = pa.skrivlage;
const LAS = Object.keys(SKRIV).filter((k) => !SKRIV[k]);
const SPARAR = Object.keys(SKRIV).filter((k) => SKRIV[k]);
const v = LAS[0];
ok("BRO är sann", pa.bro === true);
if (v) ok(`en vy i läsläge (${v}) visas inte i Nav 2.0`, pa.visas[v] === false);
else console.log("  (ingen vy i läsläge kvar: varje vy sparar)");
ok("varje vy i läsläge visas inte", LAS.every((k) => pa.visas[k] === false));
ok("varje vy som sparar visas", SPARAR.every((k) => pa.visas[k] === true));
ok("Kalendern visas (sparar)", pa.visas.kalender === SKRIV.kalender);
for (const k of ["logg", "hem", "adoption", "sok", "installningar", "kv"]) ok(`${k} utan SKRIVLAGE-nyckel påverkas inte`, k === "hem" ? pa.visas.hem === SKRIV.hem : pa.visas[k] === true);
ok("iNuvarande() är exakt nycklarna med false", lika(pa.iNuvarande, LAS), JSON.stringify(pa.iNuvarande));

rubrik("Bron av (NAV2_BRO=0)");
const av = lage({ NAV2_BRO: "0", VERCEL_ENV: "production" });
ok("BRO är falsk också i produktionen", av.bro === false);
ok("varje vy visas i Nav 2.0", Object.keys(SKRIV).every((k) => av.visas[k] === true));
ok("iNuvarande() är tom", Array.isArray(av.iNuvarande) && av.iNuvarande.length === 0);

rubrik("Utan NAV2_BRO avgör VERCEL_ENV");
ok("production: bron på", lage({ VERCEL_ENV: "production" }).bro === true);
const prev = lage({ VERCEL_ENV: "preview" });
ok("preview: bron av, allt visas som i dag", prev.bro === false && Object.keys(SKRIV).every((k) => prev.visas[k] === true) && prev.iNuvarande.length === 0);
ok("lokalt (ingen VERCEL_ENV): bron av", lage({}).bro === false);

rubrik("vagar.ts: SJALV vet vyn för varje mönster");
const NDVY = ["hem", "uppgifter", "rutiner", "utbildning", "tid", "kalender", "arenden", "franvaro", "fel", "order", "provision", "coachning", "anstallda", "rekrytering", "leads", "nyheter", "avtal", "kv", "logg", "adoption"];
const VYER = new Set([...NDVY, "sok", "profil", "satser"]);
ok("SJALV är par [vy, mönster]", Array.isArray(pa.sjalv) && pa.sjalv.length > 0);
ok("SJALV har 31 mönster", pa.sjalv.length === 31, String(pa.sjalv.length));
ok("varje mönster har en känd vy", pa.sjalv.every(([vy]) => VYER.has(vy)), JSON.stringify(pa.sjalv.filter(([vy]) => !VYER.has(vy))));
const vyFor = (m) => (pa.sjalv.find(([, r]) => r.includes(m)) ?? [])[0];
ok("/personal hör till anstallda", vyFor("personal") === "anstallda");
ok("/sok hör till sok", vyFor("sok") === "sok");
ok("/lonekostnad hör till satser (Inställningar → Satser och löner)", vyFor("lonekostnad") === "satser");
ok("/profil hör till profil", vyFor("profil") === "profil");

// Vyn en adress hör till, ur SJALV som barnet skrev ut (null = inget mönster).
const vyForAdress = (a) => { const t = pa.sjalv.find(([, r]) => new RegExp(r.slice(1, r.lastIndexOf("/"))).test(a)); return t ? t[0] : null; };
const vantat = (a) => {
  if (a === "/") return "/nav2";
  const vy = vyForAdress(a);
  return vy && !LAS.includes(vy) ? "/nav2?till=" + encodeURIComponent(a) : null;
};

rubrik("vagar.ts med bron på");
for (const a of ADRESSER) ok(`${a} → ${vantat(a) ?? "stannar"}${vyForAdress(a) ? ` (${vyForAdress(a)}${LAS.includes(vyForAdress(a)) ? ", läsläge" : ""})` : ""}`, pa.adress[a] === vantat(a), String(pa.adress[a]));
ok("/kalender går till Nav 2.0", pa.adress["/kalender"] === "/nav2?till=%2Fkalender");
ok("/logg går till Nav 2.0", String(pa.adress["/logg"]).startsWith("/nav2?till="));
ok("/ går till /nav2", pa.adress["/"] === "/nav2");
const a = ADRESSER.find((x) => LAS.includes(vyForAdress(x)));
if (a) ok(`en adress till en vy i läsläge (${a}) stannar`, pa.adress[a] === null);

rubrik("vagar.ts med bron av: som i dag");
ok("/tid går till /nav2?till=%2Ftid", av.adress["/tid"] === "/nav2?till=%2Ftid");
ok("/personal går till Nav 2.0", av.adress["/personal"] === "/nav2?till=%2Fpersonal");
ok("bara /okand, /arenden/statistik och /rekrytering/ny stannar", lika(ADRESSER.filter((a) => av.adress[a] === null), ["/okand", "/arenden/statistik", "/rekrytering/ny"]));

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAlla gröna\x1b[0m");
process.exit(fel ? 1 : 0);
