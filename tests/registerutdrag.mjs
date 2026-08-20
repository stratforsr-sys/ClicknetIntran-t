#!/usr/bin/env node
/**
 * AC-12.4, K25: att registerutdraget verkligen tacker allt.
 *
 *   node tests/registerutdrag.mjs
 *
 * Provet ar en jamforelse mot databasens egna framande nycklar. Varje kolumn
 * som pekar pa `employee` maste sta antingen i KALLOR — alltsa folja med i
 * utdraget — eller i UNDANTAG med ett skal.
 *
 * Skalet till att det finns: ett utdrag som saknar en tabell ser exakt likadant
 * ut som ett utdrag dar den tabellen var tom. Den som begar ut sina uppgifter
 * kan alltsa inte se att nagot fattas, och den som byggde tabellen har for
 * lange sedan glomt att utdraget finns. En lista som underhalls for hand
 * slutar stamma, tyst — den har kontrollen ar det enda som marker nar.
 *
 * Kravs DATABASE_URL, eftersom fragan gar mot schemat och inte mot koden.
 */
import pg from "pg";
import { KALLOR, UNDANTAG } from "../src/lib/registerutdrag.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const { rows } = await db.query(`
  select c.conrelid::regclass::text as tabell, a.attname as kolumn
    from pg_constraint c
    join lateral unnest(c.conkey) k(attnum) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.contype = 'f'
     and c.confrelid = 'public.employee'::regclass
   order by 1, 2
`);

const nyckel = (t, k) => `${t}.${k}`;
const iKallor = new Set(KALLOR.map((k) => nyckel(k.tabell, k.kolumn)));
const iUndantag = new Set(UNDANTAG.map((u) => nyckel(u.tabell, u.kolumn)));

console.log("\n\x1b[1mVarje kolumn som pekar pa employee ar redovisad\x1b[0m");
{
  const glomda = rows
    .map((r) => nyckel(r.tabell, r.kolumn))
    .filter((n) => !iKallor.has(n) && !iUndantag.has(n));

  ok(`${rows.length} framande nycklar mot employee, alla redovisade`,
    glomda.length === 0,
    glomda.length ? `saknas: ${glomda.join(", ")}` : "");
}

console.log("\n\x1b[1mListorna beskriver nagot som finns\x1b[0m");
{
  const verkliga = new Set(rows.map((r) => nyckel(r.tabell, r.kolumn)));

  // `employee.id` ar inte en framande nyckel mot sig sjalv, men det ar dar
  // personens egen rad hamtas. Den enda tillatna avvikelsen.
  const spoken = [...iKallor].filter((n) => n !== "employee.id" && !verkliga.has(n));
  ok("ingen kalla pekar pa en kolumn som inte finns", spoken.length === 0, spoken.join(", "));

  const spokUndantag = [...iUndantag].filter((n) => !verkliga.has(n));
  ok("inget undantag pekar pa en kolumn som inte finns", spokUndantag.length === 0,
    spokUndantag.join(", "));

  const bada = [...iKallor].filter((n) => iUndantag.has(n));
  ok("ingen kolumn star i bada listorna", bada.length === 0, bada.join(", "));
}

console.log("\n\x1b[1mVarje kalla har ett andamal\x1b[0m");
{
  const utan = KALLOR.filter((k) => !k.andamal || k.andamal.trim().length < 3);
  ok("alla kallor beskriver varfor uppgiften finns", utan.length === 0,
    utan.map((k) => k.tabell).join(", "));

  const utanSkal = UNDANTAG.filter((u) => !u.skal || u.skal.trim().length < 3);
  ok("alla undantag har ett skal", utanSkal.length === 0, utanSkal.map((u) => u.tabell).join(", "));
}

console.log("\n\x1b[1mTabellerna gar att lasa\x1b[0m");
{
  // En felstavad tabell ger ingen krasch i utdraget — den ger en rad med ett
  // felmeddelande i JSON:en, alltsa nagot som ser ut som data.
  for (const k of KALLOR) {
    const { rows: finns } = await db.query(`select to_regclass($1) as t`, [`public.${k.tabell}`]);
    if (finns[0].t === null) ok(`${k.tabell} finns`, false);
  }
  ok("alla tabeller i KALLOR finns i schemat", true, `${KALLOR.length} tabeller`);
}

await db.end();

console.log(fel === 0
  ? "\n\x1b[32mAlla kontroller godkanda.\x1b[0m\n"
  : `\n\x1b[31m${fel} kontroll(er) underkanda.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
