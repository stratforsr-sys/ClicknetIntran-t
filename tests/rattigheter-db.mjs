#!/usr/bin/env node
/**
 * INGEN SECURITY DEFINER-FUNKTION BLIR KORBAR FOR ANON ELLER AUTHENTICATED
 * UTAN ATT NAGON BESTAMT DET.
 *
 *   set -a; . ~/.clicknet/nav.env; set +a; node tests/rattigheter-db.mjs
 *
 * ===========================================================================
 * VARFOR PROVET FINNS
 *
 * `pg_default_acl` i public ger anon och authenticated EXECUTE pa VARJE ny
 * funktion. En migration som bara gor `revoke all on function ... from public`
 * lamnar den alltsa korbar via `/rest/v1/rpc/<namn>`.
 *
 * Sa stod `lk_andra_mote` (0088/0091) oppen fran 2026-10-15 till 0205: den ar
 * SECURITY DEFINER, skriver forbi RLS och kontrollerade bara att argumentet
 * `p_aktor` var motets arrangor. Vem som helst med den publika anon-nyckeln och
 * tva id:n kunde skriva om ett mote och skicka notiser i arrangorens namn.
 *
 * Alla skrivningar i navet gar med service role och kontrollerna ligger i
 * TypeScript. Rattigheten pa en DEFINER-funktion ar da hela forsvaret.
 *
 * PROVET LASER KATALOGEN, INTE MIGRATIONSFILERNA. Det listar varje DEFINER-
 * funktion i public som anon eller authenticated far kora och jamfor med
 * TILLATNA. En ny funktion som glomt `revoke ... from public, anon,
 * authenticated` faller har. Ska den verkligen vara oppen (RLS eller appen
 * anropar den med anvandarens klient), lagg till den i listan och skriv varfor
 * i commiten. En sadan funktion tar den inloggade ur `auth.uid()` eller
 * `current_employee_id()`, aldrig ur ett argument.
 *
 * Provet bara laser (`READ ONLY`). Kor det fore varje commit med en migration.
 * ===========================================================================
 */
import pg from "pg";

/**
 * Godkanda 2026-10-22 (granskningen, C17). Signaturen ar `oid::regprocedure`,
 * sa en overlagring med andra argument ar en egen rad.
 */
const TILLATNA = [
  // Behorighetshjalpare om den inloggade sjalv: i policyer eller i appen.
  "can_edit_documents()",
  "can_read_all_employees()",
  "current_employee_id()",
  "far_andra_provisionsregler()",
  "far_bedoma_kv()",
  "far_godkanna_franvaro()",
  "far_godkanna_franvaro_for(uuid)",
  "far_hantera_avtal()",
  "far_hantera_order()",
  "far_hantera_provision()",
  "far_rekrytera()",
  "har_lonekostnadsbehorighet()",
  "has_any_role(text[])",
  "has_role(text)",
  "kraver_losenordsbyte()",
  "leads_employee(uuid)",
  "lk_leverans_krets()",
  "lk_ser_enskilt_innehall(uuid)",
  "lk_ser_leverans(uuid)",
  "matches_audience(text[],uuid[])",
  "matches_audience(text[],uuid[],uuid[])",
  // Laser om andra men kontrollerar anroparen; anropas med anvandarens klient.
  "adoption_aktivitet(integer)",
  "adoption_glomda_dokument(integer)",
  "adoption_sokmissar(integer)",
  "fel_statistik()",
  "kalender_handelser(uuid,date,date)",
  "kalender_poster(uuid,date,date)",
  "kanda_fel()",
  "leverans_kunder(uuid)",
  "palett_obesvarade(integer)",
  // Argument som lasare, anvands i RLS med current_employee_id() (C17, S05).
  "kalender_niva(uuid,uuid)",
  "lk_ser_handelse(uuid,uuid)",
  "lk_ser_serie(uuid,uuid)",
  "projekt_synligt(uuid,uuid)",
  "uppgift_synlig(uuid,uuid)",
  // Skriver bara at den inloggade eller utan person.
  "registrera_aktivitet()",
  "registrera_sokmiss(text)",
  // Triggerfunktioner: gar inte att anropa direkt.
  "candidate_stegbyte_loggas()",
  "coaching_kvittens_vaktas()",
];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL behovs.\n  set -a; . ~/.clicknet/nav.env; set +a; node tests/rattigheter-db.mjs");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("set session characteristics as transaction read only");

const { rows } = await db.query(`
  select p.oid::regprocedure::text as f,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  order by 1`);
await db.end();

const oppna = new Set(rows.map((r) => r.f));
const tillatna = new Set(TILLATNA);
const nya = rows.filter((r) => !tillatna.has(r.f));

console.log(`\n\x1b[1m${rows.length} SECURITY DEFINER-funktioner i public ar korbara for anon eller authenticated\x1b[0m\n`);

for (const f of TILLATNA) {
  if (!oppna.has(f)) console.log(`  \x1b[33m!\x1b[0m inaktuell: ${f} (finns inte langre eller ar stangd; stryk den ur TILLATNA)`);
}

if (nya.length > 0) {
  const roller = (r) => [r.anon && "anon", r.auth && "authenticated"].filter(Boolean).join("+");
  console.log(`  \x1b[31m✗\x1b[0m nya rättigheter: ${nya.map((r) => r.f).join(", ")}`);
  for (const r of nya) console.log(`      ${r.f}  (${roller(r)})`);
  console.log(
    "\n      → revoke all on function public.<f> from public, anon, authenticated;" +
      "\n        grant execute on function public.<f> to service_role;" +
      "\n        eller, om den ska vara oppen: lagg den i TILLATNA och skriv varfor.\n",
  );
  process.exit(1);
}

console.log("  \x1b[32m✓\x1b[0m inga nya rättigheter\n");
process.exit(0);
