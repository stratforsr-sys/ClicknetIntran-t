#!/usr/bin/env node
/**
 * Provet av chattens modell (designdokumentet, Steg 3, Säkerhet).
 *
 *   node --experimental-strip-types scripts/chatt-prov.mjs                 visar vad som skulle köras. Inget körs.
 *   node --experimental-strip-types scripts/chatt-prov.mjs --kor           kör provet. KOSTAR PENGAR.
 *     --modell claude-sonnet-5-5   bara en modell (annars alla tre)
 *     --varv 3                     hur många gånger varje fråga körs (förvalt 3)
 *
 * KÖRS BARA EFTER BESTÄLLARENS JA. Utan --kor anropas ingenting, varken Anthropic eller databasen.
 *
 * Provet kör de trettio frågorna i tests/chatt-fragor.json mot fixturen i samma fil, aldrig mot
 * produktionens data, med samma slinga som rutten (src/lib/nav2/chatt/samtal.ts). En fråga är rätt bara
 * när varje körning av den är rätt. Resultatet skrivs ut, och med DATABASE_URL satt sparas en rad per
 * modell i nav_chatt_prov med avtrycket av systemtexten och verktygslistan.
 *
 * SKRIPTET GODKÄNNER ALDRIG ETT PROV. Raden sparas som ej godkänd. Godkännandet är en människas beslut
 * och görs för hand, med vem och när. Först då, och med tak och bekräftat avtal, går chatten att slå på.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KANDA_MODELLER, kostnadKr } from "../src/lib/nav2/chatt/chattforma.ts";
import { bedom, fixturKallor, kontrolleraFragor } from "../src/lib/nav2/chatt/prov.ts";
import { fragetur, korSamtal } from "../src/lib/nav2/chatt/samtal.ts";
import { avtryck } from "../src/lib/nav2/chatt/systemtext.ts";

const rot = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv.slice(2);
const flagga = (namn) => { const i = arg.indexOf(namn); return i >= 0 ? arg[i + 1] : null; };
const KOR = arg.includes("--kor");
const varv = Math.max(1, Math.min(10, Number(flagga("--varv") ?? 3) || 3));
const modeller = flagga("--modell") ? [flagga("--modell")] : [...KANDA_MODELLER];
const KR_PER_DOLLAR = 11;

const P = JSON.parse(readFileSync(join(rot, "tests", "chatt-fragor.json"), "utf8"));
const k = kontrolleraFragor(P);
if (k.fel.length) {
  console.error(`Frågefilen är inte hel:\n  ${k.fel.join("\n  ")}`);
  process.exit(1);
}
const okanda = modeller.filter((m) => !KANDA_MODELLER.includes(m));
if (okanda.length) {
  console.error(`Okänd modell: ${okanda.join(", ")}. Kända: ${KANDA_MODELLER.join(", ")}.`);
  process.exit(1);
}

const korningar = P.fragor.length * varv;
console.log(`Provet av chattens modell`);
console.log(`  Avtryck (systemtext och verktyg): ${avtryck()}`);
console.log(`  Frågor: ${P.fragor.length} (${Object.entries(k.fall).map(([f, n]) => `${f} ${n}`).join(", ")})`);
console.log(`  Varje fråga körs ${varv} ${varv === 1 ? "gång" : "gånger"} per modell: ${korningar} körningar per modell.`);
console.log(`  Modeller: ${modeller.join(", ")}`);
console.log(`  Kostnad, ett överslag och inget mätt tal (20 000 intoken och 2 500 uttoken per körning, ${KR_PER_DOLLAR} kr per dollar, utan cache):`);
let summa = 0;
for (const m of modeller) {
  const kr = korningar * kostnadKr(m, { input_tokens: 20000, output_tokens: 2500 }, KR_PER_DOLLAR);
  summa += kr;
  console.log(`    ${m}: ungefär ${Math.round(kr)} kr`);
}
console.log(`    Tillsammans: ungefär ${Math.round(summa)} kr. Provet mäter det verkliga talet.`);

if (!KOR) {
  console.log(`\nInget kördes. Kör med --kor efter beställarens ja.`);
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(`\nANTHROPIC_API_KEY saknas i miljön. Inget kördes.`);
  process.exit(1);
}

const { default: Anthropic } = await import("@anthropic-ai/sdk");
const klient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
  maxRetries: 2,
  timeout: 120_000,
});

const resultat = [];
for (const modell of modeller) {
  console.log(`\n${modell}`);
  let ratt = 0, obelagda = 0, kostnad = 0, cacheLas = 0, intoken = 0;
  const fall = [];
  for (const q of P.fragor) {
    const roll = P.fixtur.roller[q.som];
    const skal = [];
    for (let v = 0; v < varv; v++) {
      const r = await korSamtal({
        klient, modell, sand: () => {},
        ctx: { mig: roll.mig, idag: P.fixtur.idag, kallor: fixturKallor(P.fixtur, q.som) },
        turer: [{ role: "user", content: fragetur({ idag: P.fixtur.idag, klocka: "09.00", fornamn: roll.fornamn, roller: roll.roller, fraga: q.fraga }) }],
      });
      kostnad += r.kostnadUsd * KR_PER_DOLLAR;
      obelagda += r.obelagda;
      cacheLas += r.usage.cache_read_input_tokens;
      intoken += r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens;
      const b = await bedom(q, r, P.fixtur);
      if (!b.ratt) skal.push(`varv ${v + 1}: ${b.skal.join("; ")}${r.ren ? ` | svaret: ${r.ren.slice(0, 200)}` : ""}`);
    }
    if (skal.length) fall.push({ id: q.id, fall: q.fall, skal });
    else ratt++;
    console.log(`  ${skal.length ? "✗" : "✓"} ${q.id} (${q.fall})${skal.length ? `\n      ${skal.join("\n      ")}` : ""}`);
  }
  const perFraga = kostnad / korningar;
  console.log(`  ${ratt} av ${P.fragor.length} frågor rätt i alla ${varv} varv. Obelagda tal: ${obelagda}. Kostnad: ${kostnad.toFixed(2)} kr, ${perFraga.toFixed(3)} kr per körning. Cachade intoken: ${intoken ? Math.round((cacheLas / intoken) * 100) : 0} %.`);
  resultat.push({ modell, ratt, obelagda, perFraga, fall });
}

if (process.env.DATABASE_URL) {
  const { default: pg } = await import("pg");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    for (const r of resultat) {
      // Raden sparas alltid som ej godkänd (kolumnens förval). Godkännandet görs för hand av en människa.
      await db.query(
        `insert into nav_chatt_prov (modell, avtryck, fragor, ratt, obelagda, kostnad_per_fraga_kr, anteckning) values ($1, $2, $3, $4, $5, $6, $7)`,
        [r.modell, avtryck(), P.fragor.length, r.ratt, r.obelagda, r.perFraga, `${varv} varv per fråga. Föll: ${r.fall.map((f) => f.id).join(", ") || "inga"}.`],
      );
    }
    console.log(`\n${resultat.length} ${resultat.length === 1 ? "rad sparad" : "rader sparade"} i nav_chatt_prov, ej godkända.`);
  } finally {
    await db.end();
  }
} else {
  console.log(`\nDATABASE_URL saknas, så inget sparades i nav_chatt_prov.`);
}
console.log(`Kravet är alla frågor rätt och inga obelagda tal. Den billigaste modellen som klarar det väljs, och beställaren godkänner.`);
