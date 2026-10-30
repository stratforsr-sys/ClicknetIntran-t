#!/usr/bin/env node
/**
 * INGEN SECURITY DEFINER-FUNKTION BLIR KORBAR FOR ANON ELLER AUTHENTICATED
 * UTAN ATT NAGON BESTAMT DET.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   node tests/rattigheter-db.mjs                          (laser katalogen)
 *   node tests/rattigheter-db.mjs supabase/migrations/0240_x.sql   (torrt)
 *
 * ===========================================================================
 * VARFOR PROVET FINNS
 *
 * `pg_default_acl` i public gav anon och authenticated EXECUTE pa VARJE ny
 * funktion, och Postgres globala forval gav PUBLIC samma sak. En migration som
 * bara gjorde `revoke all on function ... from public` lamnade alltsa
 * funktionen korbar via `/rest/v1/rpc/<namn>`.
 *
 * Sa stod `lk_andra_mote` (0088/0091) oppen fran 2026-10-15 till 0205: den ar
 * SECURITY DEFINER, skriver forbi RLS och kontrollerade bara att argumentet
 * `p_aktor` var motets arrangor. Vem som helst med den publika anon-nyckeln och
 * tva id:n kunde skriva om ett mote och skicka notiser i arrangorens namn.
 * 0240 stangde forvalet for rollen som kor migrationerna (postgres).
 *
 * Alla skrivningar i navet gar med service role och kontrollerna ligger i
 * TypeScript. Rattigheten pa en DEFINER-funktion ar da hela forsvaret.
 *
 * PROVET LASER KATALOGEN, INTE MIGRATIONSFILERNA. Det fallerar pa:
 *   1. ett forval som ger PUBLIC, anon eller authenticated EXECUTE pa nya
 *      funktioner i public (for rollen som kor migrationerna),
 *   2. en DEFINER-funktion som anon eller authenticated far kora men som inte
 *      star i TILLATNA, eller som fler roller far kora an posten sager,
 *   3. en godkand funktion vars kropp andrats (`create or replace` behaller
 *      rattigheterna, sa en omskrivning gar annars igenom tyst),
 *   4. en oppen DEFINER-funktion med ett aktorsargument (`p_aktor` och
 *      liknande), oavsett TILLATNA: den inloggade tas ur `auth.uid()` eller
 *      `current_employee_id()`, aldrig ur ett argument,
 *   5. en vy utan `security_invoker` som anon eller authenticated far lasa
 *      och som inte star i TILLATNA_VYER (den kringgar RLS som en DEFINER).
 *
 * Med migrationsfiler som argument kors de forst i en transaktion som rullas
 * tillbaka, och provet svarar for databasen som den blir. apply-sql.mjs kor
 * samma kontroll fore `commit` och vagrar en migration som fallerar.
 *
 * Ska en ny funktion vara oppen (RLS eller appen anropar den med anvandarens
 * klient): `grant execute ... to authenticated` i migrationen, lagg den i
 * TILLATNA med roll och md5 (provet skriver ut dem), och skriv varfor i
 * commiten. Skriver du om en godkand funktion: las igenom den, och byt md5.
 * ===========================================================================
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

/**
 * Godkanda 2026-10-22 (granskningen, C17), roller och md5 2026-10-23 (0240).
 * Nyckeln ar `oid::regprocedure`, sa en overlagring med andra argument ar en
 * egen rad. `md5` ar de 12 forsta tecknen i `md5(pg_get_functiondef(oid))`.
 */
export const TILLATNA = {
  "mote_samtal_vecka(date,date)": { roller: "authenticated", md5: "f48a652abb95" }, // 0263 (session B, körd): samtal per vecka
  "mote_ar_chef()": { roller: "authenticated", md5: "c77a92a81a70" }, // 0260: Möten, chefens läsrätt i policyerna
  // 0262: Möten, uppslaget mot Lynes för ett givet nummer
  "mote_uppslag(text,text,text)": { roller: "authenticated", md5: "b85fbc91c627" },
  // Behorighetshjalpare om den inloggade sjalv: i policyer eller i appen.
  "can_edit_documents()": { roller: "authenticated", md5: "21a6d32c64c5" },
  "can_read_all_employees()": { roller: "authenticated", md5: "1e7bbf27b48b" },
  "current_employee_id()": { roller: "authenticated", md5: "7bc4d42143f6" },
  "far_andra_provisionsregler()": { roller: "authenticated", md5: "3c9d2edd40e8" },
  "far_bedoma_kv()": { roller: "authenticated", md5: "ccf1a961c04b" },
  "far_godkanna_franvaro()": { roller: "authenticated", md5: "c72804836b11" },
  "far_godkanna_franvaro_for(uuid)": { roller: "authenticated", md5: "406de4bbb869" },
  "far_hantera_avtal()": { roller: "authenticated", md5: "77455d261433" },
  "far_hantera_order()": { roller: "authenticated", md5: "24435ca6ee63" },
  "far_hantera_provision()": { roller: "authenticated", md5: "074616ecb8e1" },
  "far_rekrytera()": { roller: "authenticated", md5: "de486890be60" },
  "har_lonekostnadsbehorighet()": { roller: "authenticated", md5: "90e06f4e09cf" },
  "has_any_role(text[])": { roller: "authenticated", md5: "9d4d61e8a404" },
  "has_role(text)": { roller: "authenticated", md5: "9babce5e672f" },
  "kraver_losenordsbyte()": { roller: "authenticated", md5: "52b6f44d8a53" },
  "leads_employee(uuid)": { roller: "authenticated", md5: "35571b82f44f" },
  "lk_leverans_krets()": { roller: "authenticated", md5: "def05b3a1a6a" },
  "lk_ser_enskilt_innehall(uuid)": { roller: "authenticated", md5: "44bcdd90c8da" },
  "lk_ser_leverans(uuid)": { roller: "authenticated", md5: "a309c5ec7f5e" },
  "matches_audience(text[],uuid[])": { roller: "authenticated", md5: "d250894576ad" },
  "matches_audience(text[],uuid[],uuid[])": { roller: "authenticated", md5: "84e4da34e7fd" },
  // Laser om andra men kontrollerar anroparen; anropas med anvandarens klient.
  "adoption_aktivitet(integer)": { roller: "authenticated", md5: "cb283d9df536" }, // 0241: bara Superadmin (S16, B13)
  "adoption_glomda_dokument(integer)": { roller: "authenticated", md5: "d661c93ac381" }, // 0241
  "adoption_sokmissar(integer)": { roller: "authenticated", md5: "7fb90502f003" }, // 0241
  "fel_statistik()": { roller: "authenticated", md5: "50386f16b3db" },
  "kalender_handelser(uuid,date,date)": { roller: "authenticated", md5: "19f96e2e5e0d" },
  "kalender_poster(uuid,date,date)": { roller: "authenticated", md5: "f73f7bd8b5b2" },
  "kanda_fel()": { roller: "authenticated", md5: "c3a8fffbc29d" },
  "leverans_kunder(uuid)": { roller: "authenticated", md5: "fca84683da0a" },
  // S09 (0223): lamnar inte langre ut nagon tid, bara fragan och antalet. Rollen
  // provas i funktionen (has_any_role), inget aktorsargument.
  "palett_obesvarade(integer)": { roller: "authenticated", md5: "bcbe440c1e02" },
  // Tar lasaren som argument och jamfor inte med den inloggade (C17 punkt 3,
  // S05 ratter dem). lk_ser_*, projekt_synligt och uppgift_synlig anvands i
  // policyer med current_employee_id(); kalender_niva anropas av appen med
  // anvandarens klient (kalender-server.ts, leveranskalender-server.ts) och av
  // kalender_handelser m.fl.
  "kalender_niva(uuid,uuid)": { roller: "authenticated", md5: "080e159137f0" },
  "lk_ser_handelse(uuid,uuid)": { roller: "authenticated", md5: "1ab29c863bfe" },
  "lk_ser_serie(uuid,uuid)": { roller: "authenticated", md5: "084b93123831" },
  "projekt_synligt(uuid,uuid)": { roller: "authenticated", md5: "0411928c948b" },
  "uppgift_synlig(uuid,uuid)": { roller: "authenticated", md5: "03cda14602c3" },
  // Skriver bara at den inloggade eller utan person.
  "registrera_aktivitet()": { roller: "authenticated", md5: "811f6fd8d2ab" },
  "registrera_sokmiss(text)": { roller: "authenticated", md5: "10a8b54ac558" },
};

/**
 * Vyer utan security_invoker som anon eller authenticated far lasa. Nyckeln ar
 * `schema.namn`.
 */
export const TILLATNA_VYER = {
  // Tillaggets egna vyer i `extensions`, som PostgREST inte exponerar. Den som
  // inte ar medlem i pg_read_all_stats ser bara sina egna fragors text.
  "extensions.pg_stat_statements": "pg_stat_statements",
  "extensions.pg_stat_statements_info": "pg_stat_statements",
};

/** Argumentnamn som betyder "den som utfor": far aldrig komma fran anroparen. */
const AKTOR = /^(p_)?(aktor|actor|av|utforare|utfors_av)$/i;

const roller = (r) => [r.anon && "anon", r.auth && "authenticated"].filter(Boolean).join("+");

/**
 * Kor kontrollerna med en ansluten klient. Andrar ingenting. Svarar
 * `{ antal, fel: [rad], varningar: [rad] }`.
 */
export async function kontrollera(db) {
  const fel = [];
  const varningar = [];

  // 1. Forvalet: Postgres globala forval (PUBLIC=X om ingen global rad finns)
  //    plus raden for schemat public, for rollen som kor migrationerna.
  const { rows: forval } = await db.query(`
    with r as (select oid from pg_roles where rolname = current_user),
    acl as (
      select coalesce((select defaclacl from pg_default_acl d, r
                        where d.defaclrole = r.oid and d.defaclnamespace = 0 and d.defaclobjtype = 'f'),
                      acldefault('f', (select oid from r))) as a
      union all
      select defaclacl from pg_default_acl d, r
       where d.defaclrole = r.oid and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'f')
    select distinct case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as roll
    from acl, aclexplode(acl.a) x
    where x.privilege_type = 'EXECUTE'
      and (x.grantee = 0 or pg_get_userbyid(x.grantee) in ('anon', 'authenticated'))
    order by 1`);
  if (forval.length > 0) {
    fel.push(
      `forvalet ger ${forval.map((r) => r.roll).join(", ")} EXECUTE pa nya funktioner i public` +
        " (alter default privileges ... revoke execute on functions, se 0240)",
    );
  }

  // 2-4. Oppna DEFINER-funktioner i alla scheman utom systemets.
  const { rows } = await db.query(`
    select n.nspname as s, p.oid::regprocedure::text as f,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
           left(md5(pg_get_functiondef(p.oid)), 12) as md5,
           coalesce(p.proargnames, '{}') as argument
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    order by 2`);

  const oppna = new Set();
  for (const r of rows) {
    const namn = r.s === "public" ? r.f : `${r.s}.${r.f}`;
    oppna.add(namn);
    const godkand = TILLATNA[namn];
    const aktor = r.argument.filter((a) => AKTOR.test(a));
    if (aktor.length > 0) {
      fel.push(`aktorsargument: ${namn} (${roller(r)}) tar ${aktor.join(", ")} fran anroparen`);
    }
    if (!godkand) {
      fel.push(`nya rättigheter: ${namn} (${roller(r)})  → { roller: "${roller(r)}", md5: "${r.md5}" }`);
      continue;
    }
    const tillatet = new Set(godkand.roller.split("+"));
    const extra = [r.anon && "anon", r.auth && "authenticated"].filter((x) => x && !tillatet.has(x));
    if (extra.length > 0) fel.push(`fler roller: ${namn} far koras av ${extra.join("+")}, godkant ar ${godkand.roller}`);
    else if (roller(r) !== godkand.roller) varningar.push(`farre roller: ${namn} ar ${roller(r)}, posten sager ${godkand.roller}`);
    if (r.md5 !== godkand.md5) {
      fel.push(`ändrad: ${namn} har en ny kropp (md5 ${r.md5}, godkant ${godkand.md5}); las igenom den och byt md5`);
    }
  }
  for (const f of Object.keys(TILLATNA)) {
    if (!oppna.has(f)) varningar.push(`inaktuell: ${f} (finns inte langre eller ar stangd; stryk den ur TILLATNA)`);
  }

  // 5. Vyer som kringgar RLS.
  const { rows: vyer } = await db.query(`
    select n.nspname || '.' || c.relname as v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v', 'm') and n.nspname not in ('pg_catalog', 'information_schema')
      and not coalesce((select bool_or(o in ('security_invoker=true', 'security_invoker=on', 'security_invoker=1'))
                        from unnest(c.reloptions) o), false)
      and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))
    order by 1`);
  for (const { v } of vyer) {
    if (!TILLATNA_VYER[v]) fel.push(`vy utan security_invoker: ${v} kan lasas av anon eller authenticated och kringgar RLS`);
  }

  return { antal: rows.length, fel, varningar };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL behovs.\n  set -a; . ~/.clicknet/nav.env; set +a; node tests/rattigheter-db.mjs");
    process.exit(1);
  }
  const filer = process.argv.slice(2);
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let svar;
  if (filer.length === 0) {
    await db.query("set session characteristics as transaction read only");
    svar = await kontrollera(db);
  } else {
    await db.query("begin");
    try {
      for (const f of filer) await db.query(readFileSync(f, "utf8"));
      svar = await kontrollera(db);
    } finally {
      await db.query("rollback");
    }
  }
  await db.end();

  const dar = filer.length ? ` efter ${filer.join(", ")} (rullat tillbaka)` : "";
  console.log(`\n\x1b[1m${svar.antal} SECURITY DEFINER-funktioner ar korbara for anon eller authenticated${dar}\x1b[0m\n`);
  for (const v of svar.varningar) console.log(`  \x1b[33m!\x1b[0m ${v}`);
  if (svar.fel.length > 0) {
    for (const f of svar.fel) console.log(`  \x1b[31m✗\x1b[0m ${f}`);
    console.log(
      "\n      → revoke all on function public.<f> from public, anon, authenticated;" +
        "\n        grant execute on function public.<f> to service_role;" +
        "\n        eller, om den ska vara oppen: grant till authenticated, lagg den i TILLATNA och skriv varfor.\n",
    );
    process.exit(1);
  }
  console.log("  \x1b[32m✓\x1b[0m inga nya rättigheter\n");
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
