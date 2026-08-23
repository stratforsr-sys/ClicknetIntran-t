#!/usr/bin/env node
/**
 * E6.5: adoptionsmatten.
 *
 *   node --experimental-strip-types tests/adoption.mjs
 *
 * Tva halvor. Forst den rena raknelogiken, sedan schemat mot riktiga
 * databasen: normaliseringen i `registrera_sokmiss` och — det som verkligen
 * bar hela modulen — att `activity_day` och `search_miss` inte gar att lasa
 * via API:t.
 *
 * Att fel roll far 0 rader ur funktionerna provas dessutom i tests/rls.mjs med
 * riktiga inloggningar. Har provas att sjalva tabellerna ar stangda, vilket ar
 * ett annat pastaende: en funktion gar att skriva om, men en tabell utan
 * select-policy ger noll rader at alla oavsett vad nagon senare bygger ovanpa.
 *
 * Kraver DATABASE_URL.
 */
import pg from "pg";
import { dagarSedan, klibbighet, tackning, toppvarde } from "../src/lib/adoption.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// ---------------------------------------------------------------------------
// Raknelogiken
// ---------------------------------------------------------------------------

rubrik("Klibbighet ar DAU delat med WAU, inte en andel av nagot annat");

const serie = [
  { dag: "2026-08-20", dau: 2, wau: 5 },
  { dag: "2026-08-21", dau: 3, wau: 6 },
  { dag: "2026-08-22", dau: 4, wau: 8 },
];

ok("halva veckans anvandare i dag ger 50 procent", klibbighet(serie) === 50, String(klibbighet(serie)));
ok("skalan foljer hogsta veckotalet", toppvarde(serie) === 8, String(toppvarde(serie)));

// Det har ar skillnaden mellan "ingen anvande navet" och "vi vet inte".
const tomVecka = [{ dag: "2026-08-22", dau: 0, wau: 0 }];
ok("en tom vecka ger null och inte noll procent", klibbighet(tomVecka) === null);
ok("och skalan blir aldrig noll — det hade gett division med noll i vyn", toppvarde(tomVecka) === 1);
ok("en tom serie ger null", klibbighet([]) === null);

rubrik("Tackning ar mot antalet anstallda");

ok("8 av 25 anstallda ar 32 procent", tackning(serie, 25) === 32, String(tackning(serie, 25)));
ok("alla inne ger 100 procent", tackning(serie, 8) === 100);
// Utan antal anstallda finns ingen namnare. En nolla hade sett ut som ett svar.
ok("noll anstallda ger null", tackning(serie, 0) === null);
ok("en tom serie ger null", tackning([], 25) === null);

rubrik("Aldrig oppnad ar ett annat svar an oppnad for lange sedan");

const nu = new Date("2026-08-22T12:00:00Z");
ok("null in ger null ut", dagarSedan(null, nu) === null);
ok("i gar ar en dag sedan", dagarSedan("2026-08-21T12:00:00Z", nu) === 1);
ok("nittio dagar rakas ratt", dagarSedan("2026-05-24T12:00:00Z", nu) === 90, String(dagarSedan("2026-05-24T12:00:00Z", nu)));
ok("skrap ger null och inte NaN", dagarSedan("inte ett datum", nu) === null);

// ---------------------------------------------------------------------------
// Schemat
// ---------------------------------------------------------------------------

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const PROV = "rlstest-adoption-";
const stad = async () => {
  await db.query(`delete from search_miss where q like $1`, [PROV + "%"]);
};
await stad();

rubrik("registrera_sokmiss normaliserar, och gor det i databasen");

{
  await db.query(`select registrera_sokmiss($1)`, [`  ${PROV}SEMESTER  `]);
  await db.query(`select registrera_sokmiss($1)`, [`${PROV}semester`]);

  const { rows } = await db.query(`select q, occurrences from search_miss where q like $1`, [
    PROV + "%",
  ]);
  ok("versaler och blanksteg blir samma rad", rows.length === 1, `${rows.length} rader`);
  ok("och raknaren gar upp i stallet", rows[0]?.occurrences === 2, String(rows[0]?.occurrences));
  ok("raden ar normaliserad", rows[0]?.q === `${PROV}semester`, rows[0]?.q);
}

{
  const fore = await db.query(`select count(*)::int n from search_miss`);
  await db.query(`select registrera_sokmiss($1)`, ["    "]);
  await db.query(`select registrera_sokmiss($1)`, [null]);
  const efter = await db.query(`select count(*)::int n from search_miss`);
  ok("tom strang bokfors inte — det ar ingen sokning", fore.rows[0].n === efter.rows[0].n);
}

{
  // Kapningen far inte kunna falla pa tabellvillkoret. En strang som ar precis
  // sa lang att den kapas mitt i ett blanksteg ar det fall som brister om den
  // yttre btrim tas bort.
  const lang = PROV + "a".repeat(97 - PROV.length) + "   svans";
  await db.query(`select registrera_sokmiss($1)`, [lang]);
  const { rows } = await db.query(
    `select q, length(q) len from search_miss where q like $1 and length(q) > 50`,
    [PROV + "%"],
  );
  ok("en for lang sokning kapas i stallet for att falla", rows.length === 1, `${rows.length} rader`);
  ok("och far inget avslutande blanksteg", rows[0] && rows[0].q === rows[0].q.trimEnd(), rows[0]?.q);
  ok("kapad till hogst 100 tecken", (rows[0]?.len ?? 0) <= 100, String(rows[0]?.len));
}

rubrik("Tabellerna gar inte att lasa via API:t — inte for nagon");

if (!URL || !ANON) {
  ok("SUPABASE_URL och anon-nyckel saknas, hoppar over", true, "ej provat");
} else {
  for (const tabell of ["activity_day", "search_miss"]) {
    const svar = await fetch(`${URL}/rest/v1/${tabell}?select=*`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    const kropp = await svar.json();
    const rader = Array.isArray(kropp) ? kropp.length : -1;
    ok(`${tabell} ger 0 rader utan session`, rader === 0, `HTTP ${svar.status}, ${rader} rader`);
  }
}

rubrik("Aktivitetsdagen bar en dag och ingenting mer");

{
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'activity_day'
      order by column_name`,
  );
  const kolumner = rows.map((r) => r.column_name);
  ok(
    "exakt employee_id och day",
    kolumner.length === 2 && kolumner.includes("employee_id") && kolumner.includes("day"),
    kolumner.join(", "),
  );

  // Det har ar hela gransen i 0029. En tidpunkt eller en sokvag gor tabellen
  // till ett spar over vad varje anstalld gor, och navet har redan en
  // narvaroregistrering med styrning omkring sig.
  const forbjudna = kolumner.filter((k) => /time|path|url|page|agent|ip/.test(k));
  ok("ingen tidpunkt, sokvag eller enhet har smugit sig in", forbjudna.length === 0, forbjudna.join(", "));
}

{
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'search_miss'`,
  );
  const kolumner = rows.map((r) => r.column_name);
  // Inte en policy som doljer vem som sokte — ingen kolumn att dolja.
  ok(
    "search_miss har ingen koppling till en person",
    !kolumner.some((k) => /employee|user|actor|author/.test(k)),
    kolumner.join(", "),
  );
}

rubrik("Dagen bokfors en gang, inte en gang per begaran");

{
  const { rows } = await db.query(
    `select count(*)::int n from information_schema.table_constraints
      where table_schema = 'public' and table_name = 'activity_day'
        and constraint_type = 'PRIMARY KEY'`,
  );
  ok("primarnyckeln finns och gor andra skrivningen ofarlig", rows[0].n === 1);
}

await stad();
await db.end();

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n" : `\n\x1b[31m${fel} prov föll.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
