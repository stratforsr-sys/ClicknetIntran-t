#!/usr/bin/env node
/**
 * Chattens gränser: hur mycket AI:n får kosta per kalendermånad, i dollar.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   node scripts/chatt-tak.mjs                 visar gränserna som gäller
 *   node scripts/chatt-tak.mjs 14 85           per person, för företaget
 *
 * Gränserna är data i `nav_chatt_tak` (0305), en rad per installation, och
 * ingen inställning i Nav: beställaren säger dem. Utan rad gäller
 * standardvärdena, 10 dollar per person och 50 för företaget.
 *
 * Skriptet slår inte på något. Det yttersta taket sätts i Anthropics Console,
 * av den som äger kontot.
 */
import pg from "pg";

const arg = process.argv.slice(2);
if (arg.length !== 0 && arg.length !== 2) {
  console.error("Ange två tal i dollar: per person och för företaget. Utan tal visas gränserna som gäller.");
  process.exit(1);
}
const [person, foretag] = arg.map((a) => Number(String(a).replace(",", ".")));
if (arg.length === 2 && !(Number.isFinite(person) && Number.isFinite(foretag) && person > 0 && foretag >= person)) {
  console.error("Gränserna ska vara tal i dollar över noll, och företagets får inte vara lägre än en persons.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL saknas. Läs in ~/.clicknet/nav.env först.");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  const visa = async (rubrik) => {
    const r = (await db.query(`select person_usd::float8 as person, foretag_usd::float8 as foretag, satt_nar from public.nav_chatt_tak`)).rows[0];
    console.log(r ? `${rubrik}: ${r.person} dollar per person och ${r.foretag} dollar för företaget, per kalendermånad (satt ${new Date(r.satt_nar).toISOString().slice(0, 10)}).` : `${rubrik}: ingen rad, så standardvärdena gäller: 10 dollar per person och 50 för företaget.`);
  };
  await visa(arg.length ? "Före" : "Gränserna");
  if (arg.length) {
    await db.query(
      `insert into public.nav_chatt_tak (person_usd, foretag_usd) values ($1, $2)
       on conflict (en) do update set person_usd = excluded.person_usd, foretag_usd = excluded.foretag_usd, satt_nar = now()`,
      [person, foretag],
    );
    await visa("Efter");
  }
} finally {
  await db.end();
}
