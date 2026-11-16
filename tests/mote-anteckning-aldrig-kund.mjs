#!/usr/bin/env node
/**
 * MÖTEN: ANTECKNINGARNA GÅR ALDRIG TILL KUNDEN (0310).
 *
 *   TZ=UTC node tests/mote-anteckning-aldrig-kund.mjs
 *   (med DATABASE_URL provas också databasens funktioner)
 *
 * Beställaren 2026-11-16: "Detta får aldrig gå till kund." Gränsen ska sitta i tekniken, inte i en text
 * (~/CLAUDE.md, Nav och AI, punkt 10). Tråden ligger i en egen tabell, och det här provet fäller den som börjar
 * läsa den någon annanstans:
 *
 *   1. Bara filerna i TILLATNA nämner `mote_anteckning`. En ny fil som läser tråden (en utkorg, ett brev, en
 *      ICS, en export, en AI-prompt) måste stå här med ett skäl, och då syns den i granskningen.
 *   2. Ingen migration utom 0310 nämner tabellen, och (med DATABASE_URL) ingen funktion i databasen läser den.
 *      Det är databasens funktioner som bygger inbjudningarna (calendar_event_ics) och utkorgens rader.
 *   3. I bokningen får bokarens anteckning bara hamna i tråden och i notisen till kollegorna (`bokningsDetalj`,
 *      och bara som `detalj:` i ett notifiera-anrop). Varje rad i rutten som nämner den prövas mot en lista.
 *   4. Klienten skickar anteckningen bara till `boka` och till trådens egen rutt.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
let fel = 0;
let antal = 0;
const ok = (namn, villkor, extra = "") => {
  antal++;
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** Filerna som får nämna tabellen, och varför. */
const TILLATNA = {
  "src/app/nav2/moten/anteckningar/route.ts": "trådens egen rutt: läser och skriver för de anställda på kortet",
  "src/app/nav2/moten/route.ts": "bokningen skriver bokarens anteckning som trådens första inlägg",
  "src/lib/nav2/moten.ts": "tavlan räknar inläggen och de nya per kort (antal, ingen text)",
  "src/lib/registerutdrag.ts": "den anställdes registerutdrag (GDPR): det hen skrivit",
  "src/lib/registerutdrag-ordning.ts": "registerutdragets ordning för sett-tabellen",
};

function filer(d, ut = []) {
  for (const f of readdirSync(d)) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) filer(p, ut);
    else if (/\.(ts|tsx|js|mjs|html|sql)$/.test(f)) ut.push(p);
  }
  return ut;
}

rubrik("Bara de tillåtna filerna läser tråden");
{
  const traffar = filer(join(rot, "src")).filter((p) => readFileSync(p, "utf8").includes("mote_anteckning")).map((p) => relative(rot, p));
  const otillatna = traffar.filter((p) => !TILLATNA[p]);
  ok(`${traffar.length} filer i src nämner mote_anteckning, alla tillåtna`, otillatna.length === 0, otillatna.join(", "));
  const spok = Object.keys(TILLATNA).filter((p) => !traffar.includes(p));
  ok("varje tillåten fil finns och nämner den (listan är inte inaktuell)", spok.length === 0, spok.join(", "));
  const kundvagar = traffar.filter((p) => /utkorg|ics|epost|brev|inbjud|kund|lead|export|chatt|ai/i.test(p.split("/").pop() ?? ""));
  ok("ingen fil som bygger något åt kunden eller en AI är bland dem", kundvagar.length === 0, kundvagar.join(", "));
}

rubrik("Databasen");
{
  const mig = filer(join(rot, "supabase")).filter((p) => readFileSync(p, "utf8").includes("mote_anteckning")).map((p) => relative(rot, p));
  ok("bara 0310 nämner tabellen bland migrationerna", mig.length === 1 && mig[0].endsWith("0310_mote_anteckning.sql"), mig.join(", "));
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect();
    try {
      const { rows } = await db.query(`
        select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname not in ('pg_catalog', 'information_schema') and p.prosrc ilike '%mote_anteckning%'`);
      ok("ingen funktion i databasen läser tråden (inbjudningar och utkorg byggs av funktioner)", rows.length === 0, rows.map((r) => r.f).join(", "));
      const { rows: vyer } = await db.query(`select schemaname || '.' || viewname as v from pg_views where definition ilike '%mote_anteckning%'`);
      ok("ingen vy läser tråden", vyer.length === 0, vyer.map((r) => r.v).join(", "));
    } finally {
      await db.end();
    }
  } else {
    console.log("  (utan DATABASE_URL: databasens funktioner provas inte)");
  }
}

rubrik("Bokarens anteckning i bokningen");
{
  const rad = readFileSync(join(rot, "src/app/nav2/moten/route.ts"), "utf8").split("\n");
  // Varje rad som rör bokarens anteckning (inte tabellnamnet ensamt) ska se ut som en av de här.
  const TILLATET = [
    /^\s*\/\//, // kommentar
    /^\s*\/?\*/, // kommentar i block
    /^import \{ bokningsDetalj, idIndata, textIndata \} from "@\/lib\/nav2\/motesanteckning";$/,
    /^\s*const antIn = b\.anteckning === undefined/,
    /^\s*if \(antIn && !antIn\.ok\) return svar/,
    /^\s*const anteckning = antIn && antIn\.ok \? antIn\.text : null;$/,
    /^\s*const anteckningId = idIndata\(b\.anteckningId\) \?\? randomUUID\(\);$/,
    /^\s*const lagt = await laggMote\(\{ kedja, bolag, v, motetid, varningar, skapadBolag, skapadKedja, stada, anteckning \}\);$/,
    /^\s*if \(!anteckning \|\| !lagt\.kvar\) return lagt\.res;$/,
    /^\s*\.upsert\(\{ id: anteckningId, kedja_id: kedja, mote_id: lagt\.kvar, av: mig, text: anteckning \}/,
    /^\s*await skrivHandelse\(\{ actorId: mig, action: "mote\.anteckning_skriven".*tecken: anteckning\.length/,
    /^\s*const varning = \[j\.varning, "Anteckningen sparades inte\./,
    /^\s*anteckning\?: string \| null;$/,
    /^\s*\.from\("mote_anteckning(_sett)?"\)$/,
    /^\s*await db\.from\("mote_anteckning_sett"\)\.upsert\(/,
    /^\s*detalj: bokningsDetalj\(/,
  ];
  const ror = rad.map((t, i) => ({ t, i: i + 1 })).filter(({ t }) => /anteckning|antIn|bokningsDetalj/i.test(t));
  const okanda = ror.filter(({ t }) => !TILLATET.some((r) => r.test(t)));
  ok(`${ror.length} rader i moten/route.ts rör anteckningen, alla av känt slag`, okanda.length === 0, okanda.map(({ t, i }) => `\n      rad ${i}: ${t.trim().slice(0, 140)}`).join(""));
  // bokningsDetalj bara som detalj i ett notifiera-anrop, aldrig i en rubrik, en agenda, en kalender eller ett brev.
  const detaljer = ror.filter(({ t }) => t.includes("bokningsDetalj(") && !t.startsWith("import"));
  ok(`bokningsDetalj används ${detaljer.length} gånger, bara som notisens detalj`, detaljer.length === 2 && detaljer.every(({ t }) => /^\s*detalj: bokningsDetalj\(/.test(t)));
  const notisBlock = detaljer.every(({ i }) => rad.slice(Math.max(0, i - 8), i).some((t) => /await notifiera(Flera)?\(/.test(t)));
  ok("och båda står i ett notifiera-anrop (bara till anställda)", notisBlock);
}

rubrik("Klienten");
{
  const u = readFileSync(join(rot, "src/nav2/utkast.html"), "utf8");
  const fetchar = [...u.matchAll(/\/nav2\/moten\/anteckningar/g)].length;
  ok("utkastet anropar trådens rutt", fetchar >= 1);
  // Bladets anteckning skickas bara i bokningens data (data.anteckning), aldrig i Ändra eller till kalendern.
  const andraBygg = (u.match(/function moAndraBygg\(D, tid\)\{[\s\S]*?\n\}/) ?? [""])[0];
  ok("Ändra skickar ingen anteckning", andraBygg.length > 0 && !/anteckning/.test(andraBygg));
  const kal = [...u.matchAll(/\/nav2\/kalender[^'"`]*['"`][^\n]*anteckning/gi)];
  ok("ingen anteckning skickas till kalendern", kal.length === 0);
}

console.log(fel === 0 ? `\n\x1b[32mAlla ${antal} prov gick igenom.\x1b[0m` : `\n\x1b[31m${fel} av ${antal} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
