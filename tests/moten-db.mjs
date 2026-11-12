#!/usr/bin/env node
/**
 * MOTENS TABELLER, FUNKTIONER, RLS OCH TRIGGRAR (migration 0260-0262).
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   TZ=UTC node tests/moten-db.mjs
 *
 * Allt sker i EN transaktion mot den riktiga databasen och rullas ALLTID
 * tillbaka. Finns inte `public.mote` an, laser provet och kor de migrationsfiler
 * 0260-0262 som finns (../supabase/migrations/ relativt provfilen) inuti
 * transaktionen. Saknade filer hoppas over. Inget skrivs utanfor transaktionen.
 *
 * Provrader marks `PROV moten`. Anstallda som behovs laggs in i transaktionen.
 *
 * UNDANTAG, bara for A5 (lasningen moten.ts, srv/kor.mjs ser inte en
 * transaktion som rullas tillbaka):
 *   TZ=UTC node tests/moten-db.mjs --behall   committar provrader (Moten, tre tabeller)
 *   TZ=UTC node tests/moten-db.mjs --stada    raderar alla bolag med namn 'PROV moten%' OCH kalla = 'prov'
 *   TZ=UTC node tests/moten-db.mjs --inget-svar-prov   (A8) kor efter --behall: Inget svar mot SQL_INGET_SVAR
 *   TZ=UTC node tests/moten-db.mjs --flytt-prov        (Fixrunda 1) flytt nollstaller Bekraftat; ny bokning nollstaller Inget svar. Stada med --stada
 * Se `behall()` och `stada()` langst ner. Utan flagga ar provet som ovan.
 *
 * Varje vantat fel (23505/23514) fangas med SAVEPOINT per kontroll, sa att
 * transaktionen lever vidare. Uppgift A2 och A3 lagger till egna sektioner:
 * ny `sektion("A2: ...")` + `await ok(namn, villkor)`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const HAR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONER = join(HAR, "..", "supabase", "migrations");
const FILER = ["0260_moten.sql", "0261_moten_kolumn.sql", "0262_moten_uppslag.sql"];
// V6a: mote_radera. Läses alltid från disk och körs inne i transaktionen (create or replace), så att det är filens text som provas.
const MIGRATION_0268 = join(MIGRATIONER, "0268_moten_radera.sql");
// Uppgift 6 (fixvarv 1): låsningen, ändringen och rättelsen i en transaktion. Läses från disk och körs i transaktionen.
const MIGRATION_0288 = join(MIGRATIONER, "0288_moten_provision_bokforing.sql");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL behovs.\n  set -a; . ~/.clicknet/nav.env; set +a; TZ=UTC node tests/moten-db.mjs");
  process.exit(1);
}

let antal = 0;
let fel = 0;
let sp = 0;

function sektion(rubrik) {
  console.log(`\n\x1b[1m${rubrik}\x1b[0m`);
}

/** Skriv en kontroll. `villkor` ar ett varde eller en (async) funktion. */
async function ok(namn, villkor) {
  antal++;
  let svar = false;
  let info = "";
  // En SAVEPOINT per kontroll: ett SQL-fel i en kontroll fäller bara den, inte resten.
  const namn_sp = `ok${++sp}`;
  await db.query(`savepoint ${namn_sp}`);
  try {
    svar = typeof villkor === "function" ? await villkor() : villkor;
    await db.query(`release savepoint ${namn_sp}`);
  } catch (e) {
    info = ` (${e.code ?? ""} ${e.message})`;
    await db.query(`rollback to savepoint ${namn_sp}`);
  }
  if (svar) console.log(`  \x1b[32m✓\x1b[0m ${namn}`);
  else {
    fel++;
    console.log(`  \x1b[31m✗\x1b[0m ${namn}${info}`);
  }
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/** Kor SQL i en SAVEPOINT och lamnar tillbaka SQLSTATE (eller null om det gick). */
async function felkod(sql, args = []) {
  const namn = `sp${++sp}`;
  await db.query(`savepoint ${namn}`);
  try {
    await db.query(sql, args);
    await db.query(`release savepoint ${namn}`);
    return null;
  } catch (e) {
    await db.query(`rollback to savepoint ${namn}`);
    return e.code ?? "?";
  }
}

async function ett(sql, args = []) {
  const r = await db.query(sql, args);
  return r.rows[0];
}

/** Kor `fn` som en inloggad anstalld (authenticated + jwt-krav), sedan tillbaka. */
async function somAnstalld(authUserId, fn) {
  const namn = `sp${++sp}`;
  await db.query(`savepoint ${namn}`);
  await db.query("set local role authenticated");
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: authUserId, role: "authenticated" })]);
  try {
    return await fn();
  } finally {
    // Forst tillbaka till savepointen (det klarar aven en avbruten transaktion, och
    // rollen och jwt-kraven var satta efter den), sedan rensa for sakerhets skull.
    await db.query(`rollback to savepoint ${namn}`).catch(() => {});
    await db.query("reset role").catch(() => {});
    await db.query(`select set_config('request.jwt.claims', '', true)`).catch(() => {});
  }
}

async function anstalld(roll, namn) {
  const authId = randomUUID();
  const e = await ett(
    `insert into employee (auth_user_id, email, first_name, last_name, status)
     values ($1, $2, 'PROV moten', $3, 'active') returning id`,
    [authId, `prov-moten-${randomUUID()}@example.invalid`, namn],
  );
  if (roll) await db.query(`insert into employee_role (employee_id, role) values ($1, $2)`, [e.id, roll]);
  return { id: e.id, authId };
}

async function main() {
  if (process.argv.includes("--stada")) return stada();
  if (process.argv.includes("--behall")) return behall();
  if (process.argv.includes("--inget-svar-prov")) return ingetSvarProv();
  if (process.argv.includes("--flytt-prov")) return flyttProv();
  await db.connect();
  await db.query("begin");
  try {
    const finns = (await ett(`select to_regclass('public.mote') as t`)).t;
    if (!finns) {
      for (const f of FILER) {
        const sokvag = join(MIGRATIONER, f);
        if (!existsSync(sokvag)) {
          console.log(`  (hoppar over ${f}: finns inte)`);
          continue;
        }
        console.log(`  kor ${f} i transaktionen`);
        await db.query(readFileSync(sokvag, "utf8"));
      }
    }
    if (!(await ett(`select to_regclass('public.mote') as t`)).t) {
      throw new Error("public.mote finns inte: 0260_moten.sql saknas eller skapar inte tabellen");
    }

    // ---- Provdata -----------------------------------------------------------
    const X = await anstalld("salesperson", "X");
    const Y = await anstalld("salesperson", "Y");
    const Z = await anstalld("salesperson", "Z");
    const CHEF = await anstalld("team_lead", "Chef");

    const bolag = await ett(
      `insert into mote_bolag (namn, telefon, kalla) values ('PROV moten AB', '+46700000001', 'prov') returning id, senast_handelse`,
    );
    await db.query(`update mote_bolag set senast_handelse = now() - interval '10 days' where id = $1`, [bolag.id]);
    const kedja = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bolag.id]);
    const FRAMTID = "now() + interval '2 days'";
    const nyttMote = (kedjaId, bokat, halls) =>
      db.query(
        `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art)
         values ($1, $2, $3, ${FRAMTID}, 'prov', 'ny')`,
        [kedjaId, bokat, halls],
      );

    // ---- A1: tabeller, villkor, index, triggrar ----------------------------
    sektion("A1: villkor och unika index");

    await ok("en andra oppen kedja pa samma bolag ger 23505", async () =>
      (await felkod(`insert into mote_kedja (bolag_id) values ($1)`, [bolag.id])) === "23505");

    await ok("en stangd kedja pa samma bolag ar tillaten", async () =>
      (await felkod(`insert into mote_kedja (bolag_id, avslut, avslut_nar) values ($1, 'nej', now())`, [bolag.id])) === null);

    await ok("avslut utan avslut_nar ger 23514", async () => {
      const b = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten Avslut AB', 'prov') returning id`);
      return (await felkod(`insert into mote_kedja (bolag_id, avslut) values ($1, 'nej')`, [b.id])) === "23514";
    });

    await ok("avslut_nar utan avslut ger 23514", async () => {
      const b = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten Avslut2 AB', 'prov') returning id`);
      return (await felkod(`insert into mote_kedja (bolag_id, avslut_nar) values ($1, now())`, [b.id])) === "23514";
    });

    await ok("okant avslutsvarde ger 23514", async () => {
      const b = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten Avslut3 AB', 'prov') returning id`);
      return (await felkod(`insert into mote_kedja (bolag_id, avslut, avslut_nar) values ($1, 'kanske', now())`, [b.id])) === "23514";
    });

    await ok("tomt bolagsnamn ger 23514", async () =>
      (await felkod(`insert into mote_bolag (namn, kalla) values ('  ', 'prov')`)) === "23514");

    await ok("negativt inget_svar_i_rad ger 23514", async () => {
      const b = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten Neg AB', 'prov') returning id`);
      return (await felkod(`insert into mote_kedja (bolag_id, inget_svar_i_rad) values ($1, -1)`, [b.id])) === "23514";
    });

    // Forsta motet: bokat av X, hallet av Y.
    await nyttMote(kedja.id, X.id, Y.id);
    const m1 = await ett(`select id from mote where kedja_id = $1`, [kedja.id]);

    await ok("ett andra mote med utfall null i samma kedja ger 23505", async () =>
      (await felkod(
        `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art)
         values ($1, $2, $3, now() + interval '3 days', 'prov', 'ombokning')`,
        [kedja.id, X.id, Y.id],
      )) === "23505");

    await ok("resultat='affar' med utfall null ger 23514 (villkoret ger inte NULL)", async () =>
      (await felkod(`update mote set resultat = 'affar', resultat_nar = now() where id = $1`, [m1.id])) === "23514");

    await ok("resultat='affar' med utfall='uteblev' ger 23514", async () =>
      (await felkod(`update mote set utfall = 'uteblev', utfall_nar = now(), resultat = 'affar' where id = $1`, [m1.id])) === "23514");

    await ok("utfall utan utfall_nar ger 23514", async () =>
      (await felkod(`update mote set utfall = 'hallet' where id = $1`, [m1.id])) === "23514");

    await ok("utfall_nar utan utfall ger 23514", async () =>
      (await felkod(`update mote set utfall_nar = now() where id = $1`, [m1.id])) === "23514");

    await ok("okant utfall ger 23514", async () =>
      (await felkod(`update mote set utfall = 'sovit', utfall_nar = now() where id = $1`, [m1.id])) === "23514");

    await ok("hallet med resultat='affar' ar tillatet", async () =>
      (await felkod(`update mote set utfall = 'hallet', utfall_nar = now(), resultat = 'affar', resultat_nar = now() where id = $1`, [m1.id])) === null);

    await ok("nar forsta motet fatt utfall ar ett nytt oppet mote (uppfoljning) i samma kedja tillatet", async () =>
      (await felkod(
        `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art, foregaende_id)
         values ($1, $2, $3, now() + interval '5 days', 'prov', 'uppfoljning', $4)`,
        [kedja.id, X.id, Y.id, m1.id],
      )) === null);

    sektion("A1: triggrar");

    await ok("deltagare ar exakt {bokat_av, halls_av}", async () => {
      const r = await ett(`select deltagare from mote_kedja where id = $1`, [kedja.id]);
      return r.deltagare.length === 2 && r.deltagare.includes(X.id) && r.deltagare.includes(Y.id);
    });

    await ok("samma person tva ganger lagger inte till dubbletter (bokat_av = halls_av)", async () => {
      const b = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten Dubbel AB', 'prov') returning id`);
      const k = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [b.id]);
      await nyttMote(k.id, Z.id, Z.id);
      const r = await ett(`select deltagare from mote_kedja where id = $1`, [k.id]);
      return r.deltagare.length === 1 && r.deltagare[0] === Z.id;
    });

    await ok("ett nytt mote med en tredje person lagger till honom, de tva forsta star kvar", async () => {
      const b = await ett(`select bolag_id from mote_kedja where id = $1`, [kedja.id]);
      await db.query(`update mote set utfall = 'hallet', utfall_nar = now() where kedja_id = $1 and utfall is null`, [kedja.id]);
      await nyttMote(kedja.id, Z.id, Y.id);
      const r = await ett(`select deltagare from mote_kedja where id = $1`, [kedja.id]);
      return b.bolag_id === bolag.id && r.deltagare.length === 3 && [X.id, Y.id, Z.id].every((p) => r.deltagare.includes(p));
    });

    await ok("bolagets senast_handelse har flyttats fram av motet", async () => {
      const r = await ett(`select senast_handelse > now() - interval '1 minute' as ny from mote_bolag where id = $1`, [bolag.id]);
      return r.ny === true;
    });

    await ok("en uppdatering av kedjan flyttar fram senast_handelse och rör inte deltagare", async () => {
      await db.query(`update mote_bolag set senast_handelse = now() - interval '10 days' where id = $1`, [bolag.id]);
      const fore = await ett(`select deltagare from mote_kedja where id = $1`, [kedja.id]);
      await db.query(`update mote_kedja set uppfoljning_text = 'ring' where id = $1`, [kedja.id]);
      const efter = await ett(`select deltagare, (select senast_handelse > now() - interval '1 minute' from mote_bolag where id = $2) as ny
                               from mote_kedja where id = $1`, [kedja.id, bolag.id]);
      return efter.ny === true && JSON.stringify(efter.deltagare) === JSON.stringify(fore.deltagare);
    });

    await ok("en uppdatering av ett mote flyttar fram senast_handelse aven nar deltagare redan har bada", async () => {
      await db.query(`update mote_bolag set senast_handelse = now() - interval '10 days' where id = $1`, [bolag.id]);
      const fore = await ett(`select deltagare from mote_kedja where id = $1`, [kedja.id]);
      await db.query(`update mote set mal = 'x' where id = $1`, [m1.id]);
      const efter = await ett(
        `select deltagare, (select senast_handelse > now() - interval '1 minute' from mote_bolag where id = $2) as ny
           from mote_kedja where id = $1`,
        [kedja.id, bolag.id],
      );
      return efter.ny === true && JSON.stringify(efter.deltagare) === JSON.stringify(fore.deltagare);
    });

    await ok("triggerfunktionerna ar inte korbara for anon eller authenticated", async () => {
      const r = await ett(
        `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('mote_efter_andring','mote_kedja_efter_andring')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
      );
      return r.n === 0;
    });

    sektion("A1: RLS");

    // En kedja som bara X och Y syns i; Z och en chef provas mot den.
    const bolagR = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten RLS AB', 'prov') returning id`);
    const kedjaR = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bolagR.id]);
    await nyttMote(kedjaR.id, X.id, Y.id);
    const moteR = await ett(`select id from mote where kedja_id = $1`, [kedjaR.id]);

    const ser = (anst) =>
      somAnstalld(anst.authId, async () => ({
        kedja: (await db.query(`select 1 from mote_kedja where id = $1`, [kedjaR.id])).rowCount,
        mote: (await db.query(`select 1 from mote where id = $1`, [moteR.id])).rowCount,
        bolag: (await db.query(`select 1 from mote_bolag where id = $1`, [bolagR.id])).rowCount,
      }));

    await ok("RLS: bokaren X ser kedja, mote och bolag", async () => {
      const r = await ser(X);
      return r.kedja === 1 && r.mote === 1 && r.bolag === 1;
    });
    await ok("RLS: den som haller motet, Y, ser kedja, mote och bolag", async () => {
      const r = await ser(Y);
      return r.kedja === 1 && r.mote === 1 && r.bolag === 1;
    });
    await ok("RLS: en saljare utan del i kedjan, Z, ser ingenting", async () => {
      const r = await ser(Z);
      return r.kedja === 0 && r.mote === 0 && r.bolag === 0;
    });
    await ok("RLS: en chef (team_lead) ser allt", async () => {
      const r = await ser(CHEF);
      return r.kedja === 1 && r.mote === 1 && r.bolag === 1;
    });
    await ok("RLS: authenticated kan inte skriva (ingen skrivpolicy)", async () =>
      somAnstalld(X.authId, async () =>
        (await felkod(`insert into mote_bolag (namn, kalla) values ('PROV moten Skriv AB', 'prov')`)) !== null));
    await ok("RLS: inloggad utan anstalld (anon-lik) ser ingenting", async () =>
      somAnstalld(randomUUID(), async () =>
        (await db.query(`select 1 from mote_kedja where id = $1`, [kedjaR.id])).rowCount === 0));
    await ok("mote_ar_chef(): sant for team_lead, falskt for saljare", async () => {
      const a = await somAnstalld(CHEF.authId, async () => (await ett(`select mote_ar_chef() as c`)).c);
      const b = await somAnstalld(X.authId, async () => (await ett(`select mote_ar_chef() as c`)).c);
      return a === true && b === false;
    });
    await ok("mote_ar_chef() ar SECURITY DEFINER, stable, och stangd for anon", async () => {
      const r = await ett(
        `select p.prosecdef, p.provolatile, has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as auth
           from pg_proc p where p.oid = 'public.mote_ar_chef()'::regprocedure`,
      );
      return r.prosecdef === true && r.provolatile === "s" && r.anon === false && r.auth === true;
    });
    await ok("RLS ar paslaget pa alla tre tabellerna", async () => {
      const r = await ett(
        `select count(*)::int as n from pg_class where relname in ('mote_bolag','mote_kedja','mote') and relnamespace = 'public'::regnamespace and relrowsecurity`,
      );
      return r.n === 3;
    });
    await ok("indexen finns", async () => {
      const r = await ett(
        `select count(*)::int as n from (values
           ('mote','(halls_av)'),('mote','(bokat_av)'),('mote','(mote_tid)'),
           ('mote_bolag','(telefon)'),('mote_bolag','(doman)'),('mote_bolag','(lower(namn))')
         ) v(t, kol)
         where exists (select 1 from pg_indexes i where i.schemaname = 'public' and i.tablename = v.t
                         and i.indexdef like '%' || v.kol)`,
      );
      return r.n === 6;
    });
    await ok("unika indexen har ratt villkor", async () => {
      const r = await ett(
        `select count(*)::int as n from pg_indexes
          where schemaname = 'public'
            and ((indexname = 'mote_kedja_en_oppen' and indexdef like '%UNIQUE%(bolag_id)%WHERE (avslut IS NULL)')
              or (indexname = 'mote_ett_oppet' and indexdef like '%UNIQUE%(kedja_id)%WHERE (utfall IS NULL)'))`,
      );
      return r.n === 2;
    });

    // ---- A2: kolumnregeln och vyerna (0261) ---------------------------------
    sektion("A2: mote_kolumn");

    const NU = "2026-11-02 12:00+00";
    const kol = async (oppet, langd, bekr, uppf, ingetSvar, nu = NU) =>
      (await ett(
        `select mote_kolumn($1::timestamptz, $2::int, $3::boolean, $4::date, $5::int, $6::timestamptz) as k`,
        [oppet, langd, bekr, uppf, ingetSvar, nu],
      )).k;

    await ok("mote om 1 h, ej bekraftat: bokat", async () =>
      (await kol("2026-11-02 13:00+00", 30, false, null, 0)) === "bokat");
    await ok("mote om 1 h, bekraftat: bekraftat", async () =>
      (await kol("2026-11-02 13:00+00", 30, true, null, 0)) === "bekraftat");
    await ok("startat for 10 min sedan, 30 min langt: bokat (pagar)", async () =>
      (await kol("2026-11-02 11:50+00", 30, false, null, 0)) === "bokat");
    await ok("startat for 10 min sedan och bekraftat: bekraftat (pagar)", async () =>
      (await kol("2026-11-02 11:50+00", 30, true, null, 0)) === "bekraftat");
    await ok("slutar exakt nu: utfall_saknas (grans, > inte >=)", async () =>
      (await kol("2026-11-02 11:30+00", 30, false, null, 0)) === "utfall_saknas");
    await ok("startat for 31 min sedan, 30 min langt: utfall_saknas", async () =>
      (await kol("2026-11-02 11:29+00", 30, false, null, 0)) === "utfall_saknas");
    await ok("utfall_saknas galler aven om motet var bekraftat", async () =>
      (await kol("2026-11-02 08:00+00", 30, true, "2026-11-02", 5)) === "utfall_saknas");
    await ok("inget oppet mote, uppf idag, 2 Inget svar: folj_upp", async () =>
      (await kol(null, null, null, "2026-11-02", 2)) === "folj_upp");
    await ok("3 Inget svar i rad: tyst", async () =>
      (await kol(null, null, null, "2026-11-02", 3)) === "tyst");
    await ok("uppf = idag - 21: folj_upp", async () =>
      (await kol(null, null, null, "2026-10-12", 0)) === "folj_upp");
    await ok("uppf = idag - 22: tyst", async () =>
      (await kol(null, null, null, "2026-10-11", 0)) === "tyst");
    await ok("uppf i framtiden, 0 Inget svar: folj_upp", async () =>
      (await kol(null, null, null, "2026-11-20", 0)) === "folj_upp");
    await ok("allt null: folj_upp (golvet, kortet forsvinner aldrig)", async () =>
      (await kol(null, null, null, null, null)) === "folj_upp");
    await ok("3 Inget svar utan uppfoljningsdatum: folj_upp (tyst kraver datum)", async () =>
      (await kol(null, null, null, null, 3)) === "folj_upp");
    await ok("ett oppet mote vinner over tyst: 3 Inget svar men mote om 1 h = bokat", async () =>
      (await kol("2026-11-02 13:00+00", 30, false, "2026-10-01", 3)) === "bokat");
    await ok("midnatt: p_nu 23:30 UTC (00:30 svensk tid den 3:e), uppf 3:e: folj_upp", async () =>
      (await kol(null, null, null, "2026-11-03", 0, "2026-11-02 23:30+00")) === "folj_upp");

    sektion("A2: stockholmsdag och mote_ar_idag");

    await ok("stockholmsdag(23:30 UTC i november) ar nasta dag", async () =>
      String((await ett(`select stockholmsdag('2026-11-02 23:30+00'::timestamptz)::text as d`)).d) === "2026-11-03");
    await ok("stockholmsdag(22:30 UTC i juli) ar nasta dag (sommartid)", async () =>
      (await ett(`select stockholmsdag('2026-07-01 22:30+00'::timestamptz)::text as d`)).d === "2026-07-02");
    await ok("stockholmsdag(21:30 UTC i juli) ar samma dag", async () =>
      (await ett(`select stockholmsdag('2026-07-01 21:30+00'::timestamptz)::text as d`)).d === "2026-07-01");

    const idag = async (k, tid, uppf, nu) =>
      (await ett(`select mote_ar_idag($1, $2::timestamptz, $3::date, $4::timestamptz) as i`, [k, tid, uppf, nu])).i;
    const MIDNATT = "2026-11-02 23:30+00";
    await ok("midnatt: folj_upp med uppf 3:e ar idag kl 00:30 svensk tid", async () =>
      (await idag("folj_upp", null, "2026-11-03", MIDNATT)) === true);
    await ok("midnatt: folj_upp med uppf 4:e ar inte idag", async () =>
      (await idag("folj_upp", null, "2026-11-04", MIDNATT)) === false);
    await ok("midnatt: folj_upp med uppf 2:a (forsenad) ar idag", async () =>
      (await idag("folj_upp", null, "2026-11-02", MIDNATT)) === true);
    await ok("folj_upp utan datum ar inte idag", async () =>
      (await idag("folj_upp", null, null, MIDNATT)) === false);
    await ok("midnatt: bokat 3:e kl 10 svensk tid ar idag", async () =>
      (await idag("bokat", "2026-11-03 09:00+00", null, MIDNATT)) === true);
    await ok("midnatt: bokat 4:e ar i morgon, alltsa idag", async () =>
      (await idag("bokat", "2026-11-04 09:00+00", null, MIDNATT)) === true);
    await ok("midnatt: bokat 5:e ar inte idag", async () =>
      (await idag("bokat", "2026-11-05 09:00+00", null, MIDNATT)) === false);
    await ok("bekraftat mote i overmorgon ar inte idag", async () =>
      (await idag("bekraftat", "2026-11-05 09:00+00", null, NU)) === false);
    await ok("utfall_saknas ar alltid idag", async () =>
      (await idag("utfall_saknas", "2026-10-01 09:00+00", null, NU)) === true);
    await ok("tyst ar aldrig idag", async () =>
      (await idag("tyst", null, "2026-11-02", NU)) === false);

    await ok("funktionerna: mote_kolumn stable, stockholmsdag immutable, bada stangda for anon men oppna for authenticated", async () => {
      const r = await db.query(
        `select p.proname, p.provolatile, p.prosecdef,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as auth
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.proname in ('mote_kolumn','stockholmsdag','mote_ar_idag')`,
      );
      const per = Object.fromEntries(r.rows.map((x) => [x.proname, x]));
      return r.rows.length === 3
        && per.mote_kolumn.provolatile === "s" && per.stockholmsdag.provolatile === "i"
        && r.rows.every((x) => x.prosecdef === false && x.anon === false && x.auth === true);
    });

    sektion("A2: vyerna mote_kort och mote_kedja_utfall");

    // Kedjan V: forsta motet (bokat X, tankt hallas av Y) uteblev; ombokningen
    // (bokat Y, hallen av Z) hoills med resultat 'affar'; kedjan avslutad som affar.
    const bolagV = await ett(`insert into mote_bolag (namn, telefon, kalla) values ('PROV moten Vy AB', '+46700000002', 'prov') returning id`);
    const kedjaV = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bolagV.id]);
    const v1 = await ett(
      `insert into mote (kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, kalla, art, utfall, utfall_nar)
       values ($1, $2, $3, now() - interval '9 days', now() - interval '7 days', 'lynes', 'ny', 'uteblev', now() - interval '7 days') returning id, mote_tid`,
      [kedjaV.id, X.id, Y.id],
    );
    const v2 = await ett(
      `insert into mote (kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, kalla, art, foregaende_id, utfall, utfall_nar, resultat, resultat_nar)
       values ($1, $2, $3, now() - interval '6 days', now() - interval '4 days', 'prov', 'ombokning', $4, 'hallet', now() - interval '4 days', 'affar', now() - interval '4 days') returning id, mote_tid`,
      [kedjaV.id, Y.id, Z.id, v1.id],
    );
    await db.query(`update mote_kedja set avslut = 'affar', avslut_nar = now() where id = $1`, [kedjaV.id]);

    const vy = await ett(`select * from mote_kedja_utfall where kedja_id = $1`, [kedjaV.id]);
    await ok("kedja_utfall: en rad for den stangda kedjan, bolag_id och avslut stammer", async () =>
      vy && vy.bolag_id === bolagV.id && vy.avslut === "affar" && vy.avslut_nar !== null);
    await ok("kedja_utfall: forsta_bokat_av ar det forsta motets bokare (X)", async () => vy.forsta_bokat_av === X.id);
    await ok("kedja_utfall: forsta_mote_tid ar det forsta motets tid", async () =>
      new Date(vy.forsta_mote_tid).getTime() === new Date(v1.mote_tid).getTime());
    await ok("kedja_utfall: forsta_hallna_halls_av ar ombokningens hallare (Z)", async () => vy.forsta_hallna_halls_av === Z.id);
    await ok("kedja_utfall: forsta_hallna_tid ar ombokningens tid", async () =>
      new Date(vy.forsta_hallna_tid).getTime() === new Date(v2.mote_tid).getTime());
    await ok("kedja_utfall: affar_forsta_mote = true (forsta HALLNA motet gav affaren)", async () => vy.affar_forsta_mote === true);
    await ok("kedja_utfall: kolumn ar null for stangd kedja", async () => vy.kolumn === null);
    await ok("kedja_utfall: antal_moten = 2, kalla fran forsta motet", async () => vy.antal_moten === 2 && vy.kalla === "lynes");
    await ok("kedja_utfall: deltagare har X, Y och Z", async () =>
      [X.id, Y.id, Z.id].every((p) => vy.deltagare.includes(p)));
    await ok("mote_kort har ingen rad for den stangda kedjan", async () =>
      (await db.query(`select 1 from mote_kort where kedja_id = $1`, [kedjaV.id])).rowCount === 0);

    // Affar pa ett senare hallet mote: affar_forsta_mote ska vara false.
    const bolagW = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten Vy2 AB', 'prov') returning id`);
    const kedjaW = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bolagW.id]);
    const w1 = await ett(
      `insert into mote (kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, kalla, art, utfall, utfall_nar, resultat, resultat_nar)
       values ($1, $2, $3, now() - interval '9 days', now() - interval '7 days', 'prov', 'ny', 'hallet', now() - interval '7 days', 'uppfoljning', now() - interval '7 days') returning id`,
      [kedjaW.id, X.id, Y.id],
    );
    await db.query(
      `insert into mote (kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, kalla, art, foregaende_id, utfall, utfall_nar, resultat, resultat_nar)
       values ($1, $2, $3, now() - interval '6 days', now() - interval '3 days', 'prov', 'uppfoljning', $4, 'hallet', now() - interval '3 days', 'affar', now() - interval '3 days')`,
      [kedjaW.id, X.id, Y.id, w1.id],
    );
    await db.query(`update mote_kedja set avslut = 'affar', avslut_nar = now() where id = $1`, [kedjaW.id]);
    await ok("kedja_utfall: affar pa andra hallna motet ger affar_forsta_mote = false", async () =>
      (await ett(`select affar_forsta_mote as a from mote_kedja_utfall where kedja_id = $1`, [kedjaW.id])).a === false);

    // En oppen kedja O: ett bekraftat mote om 2 dagar.
    const bolagO = await ett(
      `insert into mote_bolag (namn, kontakt, telefon, epost, doman, kalla) values ('PROV moten Oppen AB', 'Kim', '+46700000003', 'kim@prov.invalid', 'prov.invalid', 'prov') returning id`,
    );
    const kedjaO = await ett(
      `insert into mote_kedja (bolag_id, uppfoljning_datum, uppfoljning_text, inget_svar_i_rad, offert_nar) values ($1, (now() + interval '9 days')::date, 'ring', 1, now()) returning id`,
      [bolagO.id],
    );
    const o1 = await ett(
      `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, langd_min, kalla, art, mal, nulage, bekraftat_nar, bekraftat_av, antal_flyttningar)
       values ($1, $2, $3, now() + interval '2 days', 45, 'prov', 'ny', 'SEO', 'byra', now(), $2, 1) returning id`,
      [kedjaO.id, X.id, Y.id],
    );
    const ko = await ett(`select * from mote_kort where kedja_id = $1`, [kedjaO.id]);
    await ok("mote_kort: en rad for den oppna kedjan med bolag, kedja och motets falt", async () =>
      ko && ko.bolag_id === bolagO.id && ko.namn === "PROV moten Oppen AB" && ko.kontakt === "Kim" && ko.telefon === "+46700000003"
      && ko.epost === "kim@prov.invalid" && ko.doman === "prov.invalid" && ko.mote_id === o1.id && ko.langd_min === 45
      && ko.halls_av === Y.id && ko.bokat_av === X.id && ko.antal_flyttningar === 1 && ko.mal === "SEO" && ko.nulage === "byra");
    await ok("mote_kort: bekraftat = true, offert = true, uppfoljning och Inget svar fran kedjan", async () =>
      ko.bekraftat === true && ko.offert === true && ko.uppfoljning_text === "ring" && ko.inget_svar_i_rad === 1
      && ko.uppfoljning_andrad === null && ko.deltagare.includes(X.id) && ko.deltagare.includes(Y.id));
    await ok("mote_kort: kolumn = bekraftat och idag = false for mote om 2 dagar", async () =>
      ko.kolumn === "bekraftat" && ko.idag === false);

    // Samma kedja utan oppet mote, uppfoljning idag: folj_upp och idag.
    await db.query(`update mote set utfall = 'hallet', utfall_nar = now(), resultat = 'offert', resultat_nar = now() where id = $1`, [o1.id]);
    await db.query(`update mote_kedja set uppfoljning_datum = stockholmsdag(now()) where id = $1`, [kedjaO.id]);
    const ko2 = await ett(`select * from mote_kort where kedja_id = $1`, [kedjaO.id]);
    await ok("mote_kort: utan oppet mote ar mote_id null, kolumn folj_upp, idag true for uppfoljning idag", async () =>
      ko2.mote_id === null && ko2.mote_tid === null && ko2.bekraftat === false && ko2.kolumn === "folj_upp" && ko2.idag === true);
    await ok("mote_kedja_utfall: oppen kedja har samma kolumn som mote_kort", async () => {
      const u = await ett(`select kolumn, avslut, antal_moten from mote_kedja_utfall where kedja_id = $1`, [kedjaO.id]);
      return u.kolumn === ko2.kolumn && u.avslut === null && u.antal_moten === 1;
    });
    await db.query(`update mote_kedja set uppfoljning_datum = stockholmsdag(now()) - 22, inget_svar_i_rad = 0 where id = $1`, [kedjaO.id]);
    await ok("mote_kort: uppfoljning for 22 dagar sedan ger kolumn tyst och idag false", async () => {
      const k = await ett(`select kolumn, idag from mote_kort where kedja_id = $1`, [kedjaO.id]);
      return k.kolumn === "tyst" && k.idag === false;
    });
    await db.query(`update mote_kedja set uppfoljning_datum = null where id = $1`, [kedjaO.id]);
    await ok("mote_kort: utan mote och utan datum visas kortet anda (folj_upp)", async () =>
      (await ett(`select kolumn from mote_kort where kedja_id = $1`, [kedjaO.id])).kolumn === "folj_upp");

    await ok("vyerna ar security_invoker", async () => {
      const r = await ett(
        `select count(*)::int as n from pg_class
          where relnamespace = 'public'::regnamespace and relname in ('mote_kort','mote_kedja_utfall')
            and 'security_invoker=true' = any (reloptions)`,
      );
      return r.n === 2;
    });
    await ok("vyerna: select for authenticated, inte for anon", async () => {
      const r = await ett(
        `select bool_and(has_table_privilege('authenticated', c.oid, 'select')) as auth,
                bool_or(has_table_privilege('anon', c.oid, 'select')) as anon
           from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('mote_kort','mote_kedja_utfall')`,
      );
      return r.auth === true && r.anon === false;
    });
    await ok("RLS galler genom vyn: Z (utanfor kedjan) ser inget i mote_kort eller mote_kedja_utfall", async () =>
      somAnstalld(Z.authId, async () =>
        (await db.query(`select 1 from mote_kort where kedja_id = $1`, [kedjaO.id])).rowCount === 0
        && (await db.query(`select 1 from mote_kedja_utfall where kedja_id = $1`, [kedjaO.id])).rowCount === 0));
    await ok("RLS galler genom vyn: X (deltagare) ser kortet", async () =>
      somAnstalld(X.authId, async () =>
        (await db.query(`select 1 from mote_kort where kedja_id = $1`, [kedjaO.id])).rowCount === 1
        && (await db.query(`select 1 from mote_kedja_utfall where kedja_id = $1`, [kedjaO.id])).rowCount === 1));
    await ok("RLS galler genom vyn: chef (team_lead) ser kortet", async () =>
      somAnstalld(CHEF.authId, async () =>
        (await db.query(`select 1 from mote_kort where kedja_id = $1`, [kedjaO.id])).rowCount === 1));

    // ---- A2-rattning: "idag" genom vyn for passerat oppet mote och mote i morgon ----
    sektion("A2: mote_kort.idag for passerat oppet mote och mote i morgon (Stockholm)");

    const bolagP = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten Passerat AB', 'prov') returning id`);
    const kedjaP = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bolagP.id]);
    await db.query(
      `insert into mote (kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, langd_min, kalla, art)
       values ($1, $2, $3, now() - interval '1 day', now() - interval '2 hours', 30, 'prov', 'ny')`,
      [kedjaP.id, X.id, Y.id],
    );
    await ok("mote_kort: passerat oppet mote ger kolumn utfall_saknas och idag = true", async () => {
      const k = await ett(`select kolumn, idag from mote_kort where kedja_id = $1`, [kedjaP.id]);
      return k.kolumn === "utfall_saknas" && k.idag === true;
    });

    const bolagM = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten Imorgon AB', 'prov') returning id`);
    const kedjaM = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bolagM.id]);
    // Kl 12:00 svensk tid i morgon (Stockholm), oavsett sessionens tidszon.
    await db.query(
      `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art)
       values ($1, $2, $3, ((stockholmsdag(now()) + 1)::timestamp + time '12:00') at time zone 'Europe/Stockholm', 'prov', 'ny')`,
      [kedjaM.id, X.id, Y.id],
    );
    await ok("mote_kort: bokat mote i morgon (Stockholm) ger kolumn bokat och idag = true", async () => {
      const k = await ett(`select kolumn, idag from mote_kort where kedja_id = $1`, [kedjaM.id]);
      return k.kolumn === "bokat" && k.idag === true;
    });

    // ---- A3: RLS genom mote_kort med flera rader -----------------------------
    sektion("A3: RLS, mote_kort visar bara kedjor dar saljaren ar deltagare");

    // X star i deltagare for kedjorna P och M (bokat_av), Z star i ingen av dem.
    const kortFor = (anst) =>
      somAnstalld(anst.authId, async () =>
        (await db.query(`select kedja_id from mote_kort where kedja_id = any ($1::uuid[]) order by kedja_id`, [[kedjaP.id, kedjaM.id, kedjaO.id]]))
          .rows.map((r) => r.kedja_id).sort());
    await ok("RLS: X ser via mote_kort bara kedjor dar X finns i deltagare (P, M, O)", async () => {
      const r = await kortFor(X);
      return r.length === 3 && [kedjaP.id, kedjaM.id, kedjaO.id].every((id) => r.includes(id));
    });
    await ok("RLS: Z (i ingen deltagarlista) ser 0 rader i mote_kort for samma tre kedjor", async () =>
      (await kortFor(Z)).length === 0);
    // Kedjan Q: Y bokade, Z haller. Z star i deltagare for Q men inte for P eller M.
    const bolagQ = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten Delad AB', 'prov') returning id`);
    const kedjaQ = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bolagQ.id]);
    await nyttMote(kedjaQ.id, Y.id, Z.id);
    await ok("RLS: Z ser via mote_kort kedjan Q (dar Z haller), men inte P eller M", async () =>
      somAnstalld(Z.authId, async () => {
        const r = (await db.query(`select kedja_id from mote_kort where kedja_id = any ($1::uuid[])`, [[kedjaP.id, kedjaM.id, kedjaQ.id]]))
          .rows.map((x) => x.kedja_id);
        return r.length === 1 && r[0] === kedjaQ.id;
      }));
    await ok("RLS: chef (team_lead) ser alla fyra kedjorna via mote_kort", async () =>
      somAnstalld(CHEF.authId, async () =>
        (await db.query(`select 1 from mote_kort where kedja_id = any ($1::uuid[])`, [[kedjaP.id, kedjaM.id, kedjaO.id, kedjaQ.id]])).rowCount === 4));

    // ---- A3: mote_uppslag (0262) ---------------------------------------------
    sektion("A3: mote_uppslag");

    // Samtal: tre till +46701234567 (X, Y och ett utan kopplad anstalld), ett till annat nummer,
    // och ett vars nummer ar skrivet nationellt (ogiltigt for uppslaget).
    const samtal = (num, anst, minAgo, sek, rikt) =>
      db.query(
        `insert into phone_call (direction, counterpart_e164, employee_id, started_at, talk_seconds)
         values ($4, $1, $2, now() - ($3 || ' minutes')::interval, $5)`,
        [num, anst, String(minAgo), rikt, sek],
      );
    await samtal("+46701234567", X.id, 30, 120, "ut");
    await samtal("+46701234567", Y.id, 10, 45, "in");
    await samtal("+46701234567", null, 20, 0, "ut");
    await samtal("+46709999999", X.id, 5, 60, "ut");
    await samtal("0701234567", X.id, 1, 60, "ut");
    // 22 samtal till ett tredje nummer: bara 20 ska komma tillbaka.
    for (let i = 0; i < 22; i++) await samtal("+46702222222", X.id, 100 + i, 10, "ut");

    const uppslag = (anst, tel, doman, namn) =>
      somAnstalld(anst.authId, async () =>
        (await ett(`select mote_uppslag($1, $2, $3) as r`, [tel, doman, namn])).r);

    const u1 = await uppslag(Z, "+46701234567", null, null);
    await ok("uppslag: tre samtal till numret, de senaste forst (Y, null, X)", async () =>
      u1.samtal.length === 3 && u1.samtal[0].vem === "PROV moten Y" && u1.samtal[1].vem === null && u1.samtal[2].vem === "PROV moten X");
    await ok("uppslag: samtalsradens falt ar vem, nar, sek och riktning", async () => {
      const s = u1.samtal[0];
      return Object.keys(s).sort().join() === "nar,riktning,sek,vem" && s.sek === 45 && s.riktning === "in"
        && !Number.isNaN(Date.parse(s.nar)) && u1.samtal[2].sek === 120 && u1.samtal[2].riktning === "ut";
    });
    await ok("uppslag: svaret har nycklarna samtal, bokat och kund", async () =>
      Object.keys(u1).sort().join() === "bokat,kund,samtal" && Array.isArray(u1.bokat) && u1.kund === false);
    await ok("uppslag: samtal till ett annat nummer kommer inte med", async () =>
      !u1.samtal.some((s) => s.sek === 60));
    await ok("uppslag: hogst 20 samtal", async () =>
      (await uppslag(Z, "+46702222222", null, null)).samtal.length === 20);
    await ok("uppslag: ogiltigt nummer (0701234567, nationellt format) ger samtal: [] utan fel", async () => {
      const r = await uppslag(Z, "0701234567", null, null);
      return Array.isArray(r.samtal) && r.samtal.length === 0;
    });
    await ok("uppslag: ogiltiga nummer (for kort, bokstaver, 16 siffror, tomt) ger samtal: []", async () => {
      for (const t of ["+4670", "+46abc12345", "+4670123456789012", "", "   "]) {
        const r = await uppslag(Z, t, null, null);
        if (r.samtal.length !== 0) return false;
      }
      return true;
    });

    // Bolag med oppen kedja och kommande mote, plus ett med passerat mote, ett utan mote och ett avslutat.
    const bU = await ett(
      `insert into mote_bolag (namn, telefon, doman, kalla) values ('PROV moten Uppslag AB', '+46701234567', 'uppslag.invalid', 'prov') returning id`,
    );
    const kU = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bU.id]);
    const mU = await ett(
      `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art)
       values ($1, $2, $3, now() + interval '3 days', 'prov', 'ny') returning mote_tid`,
      [kU.id, X.id, Y.id],
    );
    const u2 = await uppslag(Z, "+46701234567", null, null);
    await ok("uppslag: bokat traffar pa telefon och ger namn, mote_tid och halls_av_namn", async () => {
      const b = u2.bokat.find((r) => r.namn === "PROV moten Uppslag AB");
      return u2.bokat.length === 1 && b && b.halls_av_namn === "PROV moten Y"
        && Date.parse(b.mote_tid) === new Date(mU.mote_tid).getTime()
        && Object.keys(b).sort().join() === "halls_av_namn,mote_tid,namn";
    });
    await ok("uppslag: saljare utanfor kedjan (Z, som RLS doljer den for) far anda se bokningen", async () =>
      u2.bokat.length === 1);
    await ok("uppslag: bokat traffar pa doman nar telefonen saknas", async () => {
      const r = await uppslag(Z, null, "uppslag.invalid", null);
      return r.bokat.length === 1 && r.samtal.length === 0;
    });
    await ok("uppslag: bokat traffar pa namn utan hansyn till versaler", async () => {
      const r = await uppslag(Z, null, null, "prov MOTEN uppslag ab");
      return r.bokat.length === 1;
    });
    await ok("uppslag: tre traffar pa samma bolag ger en rad (ingen dubblett)", async () => {
      const r = await uppslag(Z, "+46701234567", "uppslag.invalid", "PROV moten Uppslag AB");
      return r.bokat.length === 1;
    });
    await ok("uppslag: kort namn ('AB') matchar inget, aven nar ett bolag heter AB", async () => {
      const bAB = await ett(`insert into mote_bolag (namn, kalla) values ('AB', 'prov') returning id`);
      const kAB = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bAB.id]);
      await nyttMote(kAB.id, X.id, Y.id);
      const r = await uppslag(Z, null, null, "AB");
      const r2 = await uppslag(Z, null, null, "  ");
      return r.bokat.length === 0 && r.kund === false && r2.bokat.length === 0;
    });
    await ok("uppslag: tre tecken racker for namn (ABC traffar)", async () => {
      const bABC = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten ABC', 'prov') returning id`);
      const kABC = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bABC.id]);
      await nyttMote(kABC.id, X.id, Y.id);
      return (await uppslag(Z, null, null, "prov moten abc")).bokat.length === 1;
    });
    await ok("uppslag: null- och tomma argument ger tomma listor och kund: false", async () => {
      const r = await uppslag(Z, null, null, null);
      const r2 = await uppslag(Z, "", "", "");
      return r.samtal.length === 0 && r.bokat.length === 0 && r.kund === false
        && r2.samtal.length === 0 && r2.bokat.length === 0 && r2.kund === false;
    });
    await ok("uppslag: kedja med passerat oppet mote ar inte bokat", async () => {
      const r = await uppslag(Z, "+46700000099", null, null);
      const b = await ett(`insert into mote_bolag (namn, telefon, kalla) values ('PROV moten Passerat Uppslag AB', '+46700000099', 'prov') returning id`);
      const k = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [b.id]);
      await db.query(
        `insert into mote (kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, kalla, art)
         values ($1, $2, $3, now() - interval '1 day', now() - interval '2 hours', 'prov', 'ny')`,
        [k.id, X.id, Y.id],
      );
      const r2 = await uppslag(Z, "+46700000099", null, null);
      return r.bokat.length === 0 && r2.bokat.length === 0;
    });
    await ok("uppslag: oppen kedja utan mote ar inte bokat", async () => {
      const b = await ett(`insert into mote_bolag (namn, telefon, kalla) values ('PROV moten Utan Mote AB', '+46700000098', 'prov') returning id`);
      await db.query(`insert into mote_kedja (bolag_id) values ($1)`, [b.id]);
      return (await uppslag(Z, "+46700000098", null, null)).bokat.length === 0;
    });
    await ok("uppslag: kommande mote i en avslutad kedja ar inte bokat", async () => {
      const b = await ett(`insert into mote_bolag (namn, telefon, kalla) values ('PROV moten Stangd AB', '+46700000097', 'prov') returning id`);
      const k = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [b.id]);
      await nyttMote(k.id, X.id, Y.id);
      await db.query(`update mote_kedja set avslut = 'avbokat', avslut_nar = now() where id = $1`, [k.id]);
      return (await uppslag(Z, "+46700000097", null, null)).bokat.length === 0;
    });
    await ok("uppslag: kund = true for avslut affar, false for nej och avbokat", async () => {
      const mk = async (tel, avslut) => {
        const b = await ett(`insert into mote_bolag (namn, telefon, kalla) values ($2, $1, 'prov') returning id`, [tel, `PROV moten Kund ${avslut}`]);
        await db.query(`insert into mote_kedja (bolag_id, avslut, avslut_nar) values ($1, $2, now())`, [b.id, avslut]);
      };
      await mk("+46700000091", "affar");
      await mk("+46700000092", "nej");
      await mk("+46700000093", "avbokat");
      const a = await uppslag(Z, "+46700000091", null, null);
      const n = await uppslag(Z, "+46700000092", null, null);
      const v = await uppslag(Z, "+46700000093", null, null);
      return a.kund === true && a.bokat.length === 0 && n.kund === false && v.kund === false;
    });
    await ok("uppslag: kund traffar ocksa pa doman och namn", async () => {
      const b = await ett(`insert into mote_bolag (namn, doman, kalla) values ('PROV moten Kund Doman AB', 'kund-doman.invalid', 'prov') returning id`);
      await db.query(`insert into mote_kedja (bolag_id, avslut, avslut_nar) values ($1, 'affar', now())`, [b.id]);
      const a = await uppslag(Z, null, "kund-doman.invalid", null);
      const n = await uppslag(Z, null, null, "prov moten kund doman ab");
      return a.kund === true && n.kund === true;
    });
    await ok("uppslag: oppen kedja plus tidigare affar ger bade bokat och kund", async () => {
      const b = await ett(`insert into mote_bolag (namn, telefon, kalla) values ('PROV moten Aterkund AB', '+46700000090', 'prov') returning id`);
      await db.query(`insert into mote_kedja (bolag_id, avslut, avslut_nar) values ($1, 'affar', now() - interval '30 days')`, [b.id]);
      const k = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [b.id]);
      await nyttMote(k.id, X.id, Y.id);
      const r = await uppslag(Z, "+46700000090", null, null);
      return r.kund === true && r.bokat.length === 1;
    });
    await ok("uppslag: anon far 42501", async () => {
      await db.query("savepoint a3anon");
      await db.query("set local role anon");
      const kod = await felkod(`select mote_uppslag('+46701234567', null, null)`);
      await db.query("reset role");
      await db.query("rollback to savepoint a3anon");
      return kod === "42501";
    });
    await ok("uppslag: inloggad utan anstalld (current_employee_id() null) ger fel 42501", async () =>
      somAnstalld(randomUUID(), async () => (await felkod(`select mote_uppslag('+46701234567', null, null)`)) === "42501"));
    await ok("uppslag: SECURITY DEFINER, search_path satt, authenticated kan, anon kan inte", async () => {
      const r = await ett(
        `select p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as auth
           from pg_proc p where p.oid = 'public.mote_uppslag(text,text,text)'::regprocedure`,
      );
      return r.prosecdef === true && (r.proconfig ?? []).some((c) => c.startsWith("search_path=")) && r.anon === false && r.auth === true;
    });

    // ---- V6a: mote_radera (0268) -------------------------------------------
    sektion("V6a: mote_radera (0268)");
    if (!existsSync(MIGRATION_0268)) throw new Error("0268_moten_radera.sql saknas");
    const sql0268 = readFileSync(MIGRATION_0268, "utf8");
    await db.query(sql0268);
    console.log("  (0268 körd i transaktionen)");

    const radera = async (mote, bara) => (await ett(`select public.mote_radera($1, $2) as r`, [mote, bara])).r;
    const nyttBolag = async (namn) => (await ett(`insert into mote_bolag (namn, kalla) values ($1, 'prov') returning id`, [namn])).id;
    const nyKedja = async (bolagId, stangd = false) =>
      (await ett(
        stangd
          ? `insert into mote_kedja (bolag_id, avslut, avslut_nar) values ($1, 'nej', now()) returning id`
          : `insert into mote_kedja (bolag_id) values ($1) returning id`,
        [bolagId],
      )).id;
    /** Ett möte; med `utfall` sätts utfall och utfall_nar (villkoret mote_utfall_par kräver båda). */
    const moteMed = async (kedjaId, bokat, halls, utfall = null) =>
      (await ett(
        `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art, utfall, utfall_nar)
         values ($1, $2, $3, now() + interval '3 days', 'prov', 'ny', $4::text, case when $4::text is null then null else now() end) returning id`,
        [kedjaId, bokat, halls, utfall],
      )).id;
    const radFinns = async (tabell, id) => (await ett(`select count(*)::int as n from ${tabell} where id = $1`, [id])).n === 1;

    const RA = await anstalld("salesperson", "RA");
    const RB = await anstalld("salesperson", "RB");
    const RC = await anstalld("salesperson", "RC");

    await ok("(a) kedjans enda möte: möte, kedja och bolag försvinner, och svaret säger det", async () => {
      const b = await nyttBolag("PROV moten Radera a AB");
      const k = await nyKedja(b);
      const m = await moteMed(k, RA.id, RB.id);
      const r = await radera(m, true);
      return r && r.kedja === k && r.bolag === b && r.kedja_borta === true && r.bolag_borta === true
        && !(await radFinns("mote", m)) && !(await radFinns("mote_kedja", k)) && !(await radFinns("mote_bolag", b));
    });

    await ok("(b) bolaget har en annan, stängd kedja: kedjan försvinner men bolaget blir kvar", async () => {
      const b = await nyttBolag("PROV moten Radera b AB");
      await nyKedja(b, true);
      const k = await nyKedja(b);
      const m = await moteMed(k, RA.id, RB.id);
      const r = await radera(m, true);
      return r && r.kedja === k && r.bolag === b && r.kedja_borta === true && r.bolag_borta === false
        && !(await radFinns("mote", m)) && !(await radFinns("mote_kedja", k)) && (await radFinns("mote_bolag", b));
    });

    await ok("(c) kedjan har två möten: bara det andra försvinner, och deltagare blir {A}", async () => {
      const b = await nyttBolag("PROV moten Radera c AB");
      const k = await nyKedja(b);
      const m1 = await moteMed(k, RA.id, RA.id, "uteblev");
      const m2 = await moteMed(k, RB.id, RC.id);
      const fore = (await ett(`select deltagare from mote_kedja where id = $1`, [k])).deltagare;
      const r = await radera(m2, true);
      const efter = (await ett(`select deltagare from mote_kedja where id = $1`, [k])).deltagare;
      return fore.length === 3 && r && r.kedja === k && r.kedja_borta === false && r.bolag_borta === false
        && (await radFinns("mote", m1)) && !(await radFinns("mote", m2)) && (await radFinns("mote_kedja", k)) && (await radFinns("mote_bolag", b))
        && efter.length === 1 && efter[0] === RA.id;
    });

    await ok("(c2) deltagare räknas om till bokat_av och halls_av, distinkta, också när de skiljer sig åt", async () => {
      const b = await nyttBolag("PROV moten Radera c2 AB");
      const k = await nyKedja(b);
      await moteMed(k, RA.id, RB.id, "hallet");
      const m2 = await moteMed(k, RC.id, RC.id);
      const r = await radera(m2, false);
      const efter = (await ett(`select deltagare from mote_kedja where id = $1`, [k])).deltagare;
      return r && r.kedja_borta === false && efter.length === 2 && efter.includes(RA.id) && efter.includes(RB.id) && !efter.includes(RC.id);
    });

    await ok("(c3) en radering flyttar inte bolagets senast_handelse (gallringen)", async () => {
      const b = await nyttBolag("PROV moten Radera c3 AB");
      const k = await nyKedja(b);
      await moteMed(k, RA.id, RB.id, "hallet");
      const m2 = await moteMed(k, RC.id, RC.id);
      await db.query(`update mote_bolag set senast_handelse = now() - interval '30 days' where id = $1`, [b]);
      const fore = (await ett(`select senast_handelse from mote_bolag where id = $1`, [b])).senast_handelse;
      await radera(m2, true);
      const efter = (await ett(`select senast_handelse, now() as nu from mote_bolag where id = $1`, [b]));
      return efter.senast_handelse.getTime() === fore.getTime() && efter.senast_handelse < efter.nu;
    });

    await ok("(d) p_bara_oppet = true på ett möte med utfall: svaret är null och raden finns kvar", async () => {
      const b = await nyttBolag("PROV moten Radera d AB");
      const k = await nyKedja(b);
      const m = await moteMed(k, RA.id, RB.id, "hallet");
      const r = await radera(m, true);
      return r === null && (await radFinns("mote", m)) && (await radFinns("mote_kedja", k)) && (await radFinns("mote_bolag", b));
    });

    await ok("(d2) p_bara_oppet = false raderar ett möte med utfall (säljchefens väg)", async () => {
      const b = await nyttBolag("PROV moten Radera d2 AB");
      const k = await nyKedja(b);
      const m = await moteMed(k, RA.id, RB.id, "avbokat");
      const r = await radera(m, false);
      return r && r.kedja_borta === true && r.bolag_borta === true && !(await radFinns("mote", m));
    });

    await ok("(e) ett okänt id ger null och rör ingenting", async () => {
      const fore = (await ett(`select count(*)::int as n from mote_bolag where namn like 'PROV moten%'`)).n;
      const r = await radera(randomUUID(), true);
      const efter = (await ett(`select count(*)::int as n from mote_bolag where namn like 'PROV moten%'`)).n;
      return r === null && fore === efter;
    });

    await ok("(f) anon och authenticated får permission denied (42501)", async () => {
      const b = await nyttBolag("PROV moten Radera f AB");
      const k = await nyKedja(b);
      const m = await moteMed(k, RA.id, RB.id);
      const koda = {};
      for (const roll of ["anon", "authenticated"]) {
        const namn = `sp${++sp}`;
        await db.query(`savepoint ${namn}`);
        await db.query(`set local role ${roll}`);
        try {
          await db.query(`select public.mote_radera($1, true)`, [m]);
          koda[roll] = null;
        } catch (e) {
          koda[roll] = e.code ?? "?";
        }
        await db.query(`rollback to savepoint ${namn}`); // återställer också rollen
      }
      return koda.anon === "42501" && koda.authenticated === "42501" && (await radFinns("mote", m));
    });

    await ok("(g) bara service_role har execute; funktionen är security definer med search_path", async () => {
      const r = await ett(
        `select p.prosecdef, p.proconfig,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('service_role', p.oid, 'execute') as service
           from pg_proc p where p.oid = 'public.mote_radera(uuid,boolean)'::regprocedure`,
      );
      return r.prosecdef === true && (r.proconfig ?? []).some((c) => c.startsWith("search_path=")) && !r.anon && !r.auth && r.service === true;
    });

    await ok("(h) service_role kan anropa funktionen", async () => {
      const b = await nyttBolag("PROV moten Radera h AB");
      const k = await nyKedja(b);
      const m = await moteMed(k, RA.id, RB.id);
      const namn = `sp${++sp}`;
      await db.query(`savepoint ${namn}`);
      await db.query("set local role service_role");
      let r;
      try {
        r = (await db.query(`select public.mote_radera($1, true) as r`, [m])).rows[0].r;
      } finally {
        await db.query(`rollback to savepoint ${namn}`);
      }
      return r && r.kedja_borta === true;
    });

    // ---- 0287: bekräftelse, nivå och mötesprovision -----------------------
    {
    sektion("0287: villkoren på mote");
    const bolagP = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten 0287 AB', 'prov') returning id`);
    const kedjaP = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bolagP.id]);
    const BOK = await anstalld("salesperson", "Bokare");
    const HALL = await anstalld("salesperson", "Hallare");
    const EKO = await anstalld("finance", "Ekonomi");
    const moteP = await ett(
      `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art)
       values ($1, $2, $3, now() - interval '2 hours', 'prov', 'ny') returning id`,
      [kedjaP.id, BOK.id, HALL.id],
    );
    await ok("forsok börjar på 0", async () => (await ett(`select forsok from mote where id = $1`, [moteP.id])).forsok === 0);
    await ok("forsok = -1 ger 23514", async () =>
      (await felkod(`update mote set forsok = -1 where id = $1`, [moteP.id])) === "23514");
    await ok("nivå på ett möte utan utfall ger 23514", async () =>
      (await felkod(`update mote set niva = 'kvalificerat', niva_nar = now() where id = $1`, [moteP.id])) === "23514");
    await ok("okänd nivå ger 23514", async () =>
      (await felkod(`update mote set utfall = 'hallet', utfall_nar = now(), niva = 'toppen', niva_nar = now() where id = $1`, [moteP.id])) === "23514");
    await ok("nivå utan niva_nar ger 23514", async () =>
      (await felkod(`update mote set utfall = 'hallet', utfall_nar = now(), niva = 'hallet' where id = $1`, [moteP.id])) === "23514");
    await ok("nivå på ett uteblivet möte ger 23514", async () =>
      (await felkod(`update mote set utfall = 'uteblev', utfall_nar = now(), niva = 'hallet', niva_nar = now() where id = $1`, [moteP.id])) === "23514");
    await ok("nivå på ett hållet möte går (villkoret avvisar inte allt)", async () =>
      (await felkod(`update mote set utfall = 'hallet', utfall_nar = now(), niva = 'kvalificerat', niva_nar = now() where id = $1`, [moteP.id])) === null);
    await ok("moten.galler-fran finns och är en tid", async () => {
      const r = await ett(`select value from nav_setting where key = 'moten.galler-fran'`);
      return r && typeof r.value === "string" && !Number.isNaN(Date.parse(r.value));
    });

    sektion("0287: mote_provision");
    const rad = (o = {}) => ({
      mote_id: moteP.id, employee_id: BOK.id, niva: "kvalificerat", belopp: 600, mojligt: 600, skal: null,
      satser: { kvalificerat: 600, hallet: 300 }, delat_med: null, manad: "2026-11-01", del: "hel", ...o,
    });
    const laggIn = (r) => felkod(
      `insert into mote_provision (mote_id, employee_id, niva, belopp, mojligt, skal, satser, delat_med, manad, del)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [r.mote_id, r.employee_id, r.niva, r.belopp, r.mojligt, r.skal, JSON.stringify(r.satser), r.delat_med, r.manad, r.del],
    );
    await ok("en giltig rad går in", async () => (await laggIn(rad())) === null);
    await ok("både nivå och skäl ger 23514", async () => (await laggIn(rad({ employee_id: HALL.id, skal: "Avbokat" }))) === "23514");
    await ok("varken nivå eller skäl ger 23514", async () => (await laggIn(rad({ employee_id: HALL.id, niva: null }))) === "23514");
    await ok("manad som inte är den 1:a ger 23514", async () => (await laggIn(rad({ employee_id: HALL.id, manad: "2026-11-02" }))) === "23514");
    await ok("negativt belopp ger 23514", async () => (await laggIn(rad({ employee_id: HALL.id, belopp: -1 }))) === "23514");
    await ok("okänd del ger 23514", async () => (await laggIn(rad({ employee_id: HALL.id, del: "tredjedel" }))) === "23514");
    await ok("samma möte och person två gånger ger 23505", async () => (await laggIn(rad())) === "23505");

    sektion("0287: RLS på mote_provision");
    // En rad för hållaren också, så att bokaren har något att inte se.
    await laggIn(rad({ employee_id: HALL.id, niva: null, skal: "Avbokat", belopp: 0 }));
    const antalRader = (anst) => somAnstalld(anst.authId, async () =>
      (await db.query(`select employee_id from mote_provision where mote_id = $1`, [moteP.id])).rows.map((r) => r.employee_id));
    await ok("bokaren ser bara sin egen rad", async () => {
      const r = await antalRader(BOK);
      return r.length === 1 && r[0] === BOK.id;
    });
    await ok("ekonomi ser alla rader", async () => (await antalRader(EKO)).length === 2);
    await ok("bokaren kan inte skriva", async () =>
      somAnstalld(BOK.authId, async () => (await laggIn(rad({ employee_id: EKO.id }))) !== null));
    await ok("ekonomi kan inte skriva", async () =>
      somAnstalld(EKO.authId, async () => (await laggIn(rad({ employee_id: EKO.id }))) !== null));

    sektion("0287/0288: mote_las_provision");
    if (!existsSync(MIGRATION_0288)) throw new Error("0288_moten_provision_bokforing.sql saknas");
    await db.query(readFileSync(MIGRATION_0288, "utf8"));
    console.log("  (0288 körd i transaktionen)");
    const moteL = await ett(
      `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art, utfall, utfall_nar)
       values ($1, $2, $3, now() - interval '3 hours', 'prov', 'ny', 'hallet', now()) returning id`,
      [kedjaP.id, BOK.id, HALL.id],
    );
    const raderL = JSON.stringify([{ employee_id: BOK.id, niva: "kvalificerat", belopp: 600, mojligt: 600, skal: null,
      satser: { kvalificerat: 600, hallet: 300 }, delat_med: null, manad: "2026-11-01", del: "hel" }]);
    const svarL = JSON.stringify([{ id: "beslutsfattare", text: "Var rätt beslutsfattare med?", ja: true }]);
    const las = () => felkod(`select public.mote_las_provision($1, 'kvalificerat', $2::jsonb, $3, $4::jsonb, null, null)`, [moteL.id, svarL, HALL.id, raderL]);
    await ok("första låsningen går", async () => (await las()) === null);
    await ok("mötet har nivå, svar och låstid", async () => {
      const r = await ett(`select niva, niva_svar, niva_av, provision_last_nar from mote where id = $1`, [moteL.id]);
      return r.niva === "kvalificerat" && Array.isArray(r.niva_svar) && r.niva_av === HALL.id && r.provision_last_nar !== null;
    });
    await ok("raden finns med beloppet", async () => {
      const r = await ett(`select belopp, del from mote_provision where mote_id = $1`, [moteL.id]);
      return Number(r.belopp) === 600 && r.del === "hel";
    });
    await ok("andra låsningen ger P0409", async () => (await las()) === "P0409");
    await ok("och inga nya rader", async () =>
      (await ett(`select count(*)::int as n from mote_provision where mote_id = $1`, [moteL.id])).n === 1);
    await ok("ett tappat möte låses utan nivå", async () => {
      const t = await ett(
        `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art, utfall, utfall_nar)
         values ($1, $2, $3, now() - interval '4 hours', 'prov', 'ny', 'uteblev', now()) returning id`,
        [kedjaP.id, BOK.id, HALL.id],
      );
      const rader = JSON.stringify([{ employee_id: BOK.id, niva: null, belopp: 0, mojligt: 600, skal: "Inte bekräftat före mötet",
        satser: { kvalificerat: 600, hallet: 300 }, delat_med: null, manad: "2026-11-01", del: "hel" }]);
      const kod = await felkod(`select public.mote_las_provision($1, null, null, $2, $3::jsonb, null, null)`, [t.id, HALL.id, rader]);
      const m = await ett(`select niva, provision_last_nar from mote where id = $1`, [t.id]);
      return kod === null && m.niva === null && m.provision_last_nar !== null;
    });
    await ok("nivå på ett möte som inte hölls ger P0409", async () => {
      const t = await ett(
        `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art, utfall, utfall_nar)
         values ($1, $2, $3, now() - interval '5 hours', 'prov', 'ny', 'avbokat', now()) returning id`,
        [kedjaP.id, BOK.id, HALL.id],
      );
      return (await felkod(`select public.mote_las_provision($1, 'hallet', '[]'::jsonb, $2, '[]'::jsonb, null, null)`, [t.id, HALL.id])) === "P0409";
    });
    await ok("authenticated får inte anropa funktionen", async () =>
      somAnstalld(HALL.authId, async () => (await las()) === "42501"));
    const rattighet = (sig) => ett(
      `select p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as service
         from pg_proc p where p.oid = $1::regprocedure`, [sig]);
    for (const sig of ["public.mote_las_provision(uuid,text,jsonb,uuid,jsonb,date,text)", "public.mote_andra_provision(uuid,text,timestamptz,text,text,jsonb,uuid,jsonb,date,text)"]) {
      await ok(`${sig.split("(")[0]}: security definer, search_path, bara service_role`, async () => {
        const r = await rattighet(sig);
        return r.prosecdef === true && (r.proconfig ?? []).some((c) => c.startsWith("search_path=")) && !r.anon && !r.auth && r.service === true;
      });
    }
    await ok("mote_bokfor_rattelse: ingen utifrån får köra den (bara funktionerna ovan)", async () => {
      const r = await rattighet("public.mote_bokfor_rattelse(uuid,uuid,date,int,numeric,date,text,uuid)");
      return !r.anon && !r.auth && !r.service && (r.proconfig ?? []).some((c) => c.startsWith("search_path="));
    });
    await ok("0287:s version med fem argument finns inte kvar (en väg)", async () =>
      (await ett(`select count(*)::int as n from pg_proc where proname = 'mote_las_provision'`)).n === 1);

    }

    // ---- Uppgift 6: utfallet med nivån, och låsningen ------------------------
    // motesprovision-server.ts körs på riktigt mot databasen, i provets transaktion, genom
    // `pgSupabase` nedan (de anrop modulen gör, översatta till SQL med samma svar som PostgREST).
    {
    const MF = await import("../src/lib/nav2/motesflode.ts");
    const MFo = await import("../src/lib/nav2/motenforma.ts");
    const MP = await import("../src/lib/nav2/motesprovision-server.ts");
    const sb = pgSupabase(db);
    const B6 = await anstalld("salesperson", "Bokare6");
    const R6 = await anstalld("salesperson", "Ombokare6");
    const U6 = await anstalld("salesperson", "Omarkerad6");
    const H6 = await anstalld("salesperson", "Hallare6");
    const K6 = await anstalld("salesperson", "Kollega6");
    const A6 = await anstalld("admin", "Admin6");
    // En öppen kedja per bolag (mote_kedja_en_oppen): varje provkedja får ett eget bolag med samma namn.
    const nyKedja6 = async () => {
      const bo = await ett(`insert into mote_bolag (namn, kalla) values ('PROV moten u6 AB', 'prov') returning id`);
      return (await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [bo.id])).id;
    };
    const kedja6 = await nyKedja6();
    const S6 = { kvalificerat: 600, hallet: 300 };
    const inst6 = { ...structuredClone(MF.INST_FORVAL), satser: S6, mottagare: [B6.id, R6.id], ombokning: "ny", gallerFran: "2026-01-01T00:00:00Z" };
    const TZ6 = inst6.tidszon;
    const JA6 = [{ id: "beslutsfattare", ja: true }, { id: "syfte", ja: true }];
    const NEJ6 = [{ id: "beslutsfattare", ja: true }, { id: "syfte", ja: false }];
    const innevarande6 = MF.manadFor(new Date().toISOString(), TZ6);
    const nyttMote6 = async (o = {}) => {
      const v = { bokat: B6.id, halls: H6.id, tid: "now() - interval '2 hours'", art: "ny", foregaende: null, utfall: "hallet", bekraftat: true, kedja: kedja6, ...o };
      const r = await ett(
        `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art, foregaende_id, utfall, utfall_nar, bekraftat_nar)
         values ($1, $2, $3, ${v.tid}, 'prov', $4, $5, $6::text, case when $6::text is null then null else now() end,
                 case when $7::boolean then now() - interval '3 days' end)
         returning id, kedja_id, bokat_av, halls_av, mote_tid, bekraftat_nar`,
        [v.kedja, v.bokat, v.halls, v.art, v.foregaende, v.utfall, v.bekraftat],
      );
      return { ...r, mote_tid: r.mote_tid.toISOString(), bekraftat_nar: r.bekraftat_nar ? r.bekraftat_nar.toISOString() : null };
    };
    const moteRad6 = (id) => ett(`select utfall, niva, niva_svar, niva_av, provision_last_nar from mote where id = $1`, [id]);
    const rader6 = async (id) => (await db.query(
      `select employee_id, niva, belopp::float8 as belopp, mojligt::float8 as mojligt, skal, satser, delat_med, del, manad::text as manad, version,
              ifragasatt_nar, beslut_nar, beslut_av
         from mote_provision where mote_id = $1 order by del, employee_id`, [id])).rows;
    const poster6 = async (anst, manad) => (await db.query(
      `select amount::float8 as amount, kind, source, external_ref, note, entered_by from commission_entry
        where employee_id = $1 and period_month = $2::date order by entered_at, external_ref`, [anst, manad])).rows;
    const kastar6 = async (f) => { try { await f(); return null; } catch (e) { return e; } };
    // Oktober 2026 fastställd i transaktionen (rullas tillbaka). Finns raden redan står den kvar.
    await db.query(`insert into commission_period (period_month, status, closed_by) values ('2026-10-01', 'faststalld', $1) on conflict do nothing`, [A6.id]);

    sektion("Uppgift 6: Hållet med nivån");
    const m1 = await nyttMote6();
    const b1 = MFo.nivaVidHallet({ farBedoma: MFo.farBedoma({ id: H6.id, roller: ["salesperson"] }, { ...m1, med: [] }), fragor: inst6.fragor, svar: JA6 });
    await ok("hållaren med två ja: nivån kvalificerat", b1.niva === "kvalificerat");
    await MP.lasProvision(sb, m1, inst6, b1, H6.id);
    await ok("mötet: niva kvalificerat, svaren med frågornas text, låst", async () => {
      const r = await moteRad6(m1.id);
      return r.niva === "kvalificerat" && r.niva_svar.length === 2 && r.niva_svar[0].text === "Var rätt beslutsfattare med?" && r.niva_av === H6.id && r.provision_last_nar !== null;
    });
    await ok("en rad: bokaren, belopp = kvalificerat-satsen, hel, satserna sparade", async () => {
      const r = await rader6(m1.id);
      return r.length === 1 && r[0].employee_id === B6.id && r[0].belopp === 600 && r[0].mojligt === 600 && r[0].del === "hel"
        && r[0].satser.kvalificerat === 600 && r[0].satser.hallet === 300 && r[0].manad === MF.manadFor(m1.mote_tid, TZ6) && r[0].version === 1;
    });
    await ok("öppen månad: ingen post i huvudboken", async () => (await poster6(B6.id, innevarande6)).length === 0);

    const m2 = await nyttMote6();
    const b2 = MFo.nivaVidHallet({ farBedoma: MFo.farBedoma({ id: K6.id, roller: ["salesperson"] }, { ...m2, med: [K6.id] }), fragor: inst6.fragor, svar: null });
    await ok("kollegan (0286) sätter Hållet utan svar: väntar på bedömning", b2.vantar === true);

    sektion("Uppgift 6: bedöm två gånger");
    const m3 = await nyttMote6();
    await MP.lasProvision(sb, m3, inst6, { niva: "kvalificerat", svar: MF.nivaSvar(inst6.fragor, JA6) }, H6.id);
    const e3 = await kastar6(() => MP.lasProvision(sb, m3, inst6, { niva: "hallet", svar: MF.nivaSvar(inst6.fragor, NEJ6) }, H6.id));
    await ok("andra bedömningen ger ProvisionKonflikt (rutten svarar 409)", e3 instanceof MP.ProvisionKonflikt);
    await ok("nivån och raden står kvar från första", async () => (await moteRad6(m3.id)).niva === "kvalificerat" && (await rader6(m3.id)).map((r) => r.belopp).join() === "600");

    sektion("Uppgift 6: fastställd månad");
    const m4 = await nyttMote6({ tid: "'2026-10-15 10:00+02'" });
    await MP.lasProvision(sb, m4, inst6, { niva: "kvalificerat", svar: MF.nivaSvar(inst6.fragor, JA6) }, H6.id);
    await ok("hållarens första bedömning: raden i oktober", async () => (await rader6(m4.id))[0]?.manad === "2026-10-01");
    await ok("och en rättelse på hela beloppet i innevarande månad (gammalt 0)", async () => {
      const p = await poster6(B6.id, innevarande6);
      return p.length === 1 && p[0].amount === 600 && p[0].kind === "rattelse" && p[0].source === "motor"
        && p[0].external_ref === `${innevarande6}:${B6.id}:rattelse:mote:${m4.id}:v1`
        && p[0].note === "Rättelse möte PROV moten u6 AB 2026-10-15" && p[0].entered_by === H6.id;
    });
    await ok("ingen post i den fastställda månaden", async () => (await poster6(B6.id, "2026-10-01")).length === 0);

    sektion("Uppgift 6: vem som får rader");
    const m5 = await nyttMote6({ bokat: U6.id });
    await MP.lasProvision(sb, m5, inst6, { niva: "kvalificerat", svar: MF.nivaSvar(inst6.fragor, JA6) }, H6.id);
    await ok("bokare utan markering: noll rader, men låst och med nivå", async () => {
      const r = await moteRad6(m5.id);
      return (await rader6(m5.id)).length === 0 && r.provision_last_nar !== null && r.niva === "kvalificerat";
    });
    const kU = await nyKedja6();
    const mUa = await nyttMote6({ kedja: kU });
    const mUb = await nyttMote6({ kedja: kU, art: "uppfoljning", utfall: "uteblev" });
    const mUc = await nyttMote6({ kedja: kU, art: "ombokning", foregaende: mUb.id, bokat: R6.id });
    await ok("ombokning av ett uppföljningsmöte: ingen ursprunglig bokare", async () => (await MP.ursprungligBokare(sb, mUc.id)) === null);
    await MP.lasProvision(sb, mUc, inst6, { niva: "kvalificerat", svar: MF.nivaSvar(inst6.fragor, JA6) }, H6.id);
    await ok("och noll rader", async () => (await rader6(mUc.id)).length === 0 && (await moteRad6(mUc.id)).provision_last_nar !== null);
    await ok("det första mötet i en ombokad kedja är den ursprungliga bokarens", async () => {
      const kO = await nyKedja6();
      const a = await nyttMote6({ kedja: kO, utfall: "uteblev" });
      const b = await nyttMote6({ kedja: kO, art: "ombokning", foregaende: a.id, bokat: H6.id });
      return (await MP.ursprungligBokare(sb, b.id)) === B6.id && mUa.id !== null;
    });
    await ok("möte före moten.galler-fran: inga rader och ingen låsning", async () => {
      const m = await nyttMote6();
      const svar = await MP.lasProvision(sb, m, { ...inst6, gallerFran: new Date(Date.now() + 60_000).toISOString() }, { niva: "kvalificerat", svar: [] }, H6.id);
      const r = await moteRad6(m.id);
      return svar.last === false && r.niva === null && r.provision_last_nar === null && (await rader6(m.id)).length === 0;
    });

    sektion("Uppgift 6: tappade möten");
    const m8 = await nyttMote6({ utfall: "uteblev", bekraftat: false });
    await MP.lasProvision(sb, m8, inst6, { tappat: "uteblev" }, K6.id);
    await ok("uteblev på obekräftat möte: skälet, belopp 0, möjligt = kvalificerat", async () => {
      const r = await rader6(m8.id);
      return r.length === 1 && r[0].skal === "Inte bekräftat före mötet" && r[0].belopp === 0 && r[0].mojligt === 600 && r[0].niva === null;
    });
    await ok("mötet: ingen nivå, men låst", async () => { const r = await moteRad6(m8.id); return r.niva === null && r.provision_last_nar !== null; });
    await ok("en andra låsning av det tappade mötet ger ProvisionKonflikt", async () =>
      (await kastar6(() => MP.lasProvision(sb, m8, inst6, { tappat: "uteblev" }, K6.id))) instanceof MP.ProvisionKonflikt);

    sektion("Uppgift 6: dela, och omräkning ur raden");
    const kD = await nyKedja6();
    const mD = await nyttMote6({ kedja: kD, utfall: "uteblev" });
    const mE = await nyttMote6({ kedja: kD, art: "ombokning", foregaende: mD.id, bokat: R6.id });
    const instDela = { ...inst6, ombokning: "dela", satser: { kvalificerat: 600.01, hallet: 300 } };
    await MP.lasProvision(sb, mE, instDela, { niva: "kvalificerat", svar: MF.nivaSvar(inst6.fragor, JA6) }, H6.id);
    await ok("ombokning av en annan markerad bokare, dela: två rader som summerar till satsen", async () => {
      const r = await rader6(mE.id);
      const b = r.find((x) => x.employee_id === B6.id);
      const o = r.find((x) => x.employee_id === R6.id);
      return r.length === 2 && b.del === "forsta_halvan" && b.belopp === 300 && b.delat_med === R6.id
        && o.del === "andra_halvan" && o.belopp === 300.01 && o.delat_med === B6.id && Math.round((b.belopp + o.belopp) * 100) === 60001;
    });
    // Markeringen och regeln ändras (och satserna): omräkningen tar ändå radens del och satser.
    await db.query(`insert into nav_setting (key, value) values ('moten.provision', '{"kvalificerat": 9999, "hallet": 1}'::jsonb)
                    on conflict (key) do update set value = excluded.value`);
    await db.query(`insert into nav_setting (key, value) values ('moten.ombokning-provision', '"ny"'::jsonb), ('moten.mottagare', '[]'::jsonb)
                    on conflict (key) do update set value = excluded.value`);
    await ok("ändrad sats efter låsningen ändrar inte raden", async () => {
      const inst = MF.lasInstallningar((await db.query(`select key, value from nav_setting where key like 'moten.%'`)).rows);
      const r = await rader6(m1.id);
      return inst.satser.kvalificerat === 9999 && r[0].belopp === 600 && r[0].satser.kvalificerat === 600;
    });
    await MP.andraProvision(sb, mE.id, { niva: "hallet", svar: MF.nivaSvar(inst6.fragor, NEJ6) }, A6.id, TZ6);
    await ok("admin bedömer om efter att markeringen och regeln ändrats: radens del och satser", async () => {
      const r = await rader6(mE.id);
      const b = r.find((x) => x.employee_id === B6.id);
      const o = r.find((x) => x.employee_id === R6.id);
      return r.length === 2 && b.belopp === 150 && o.belopp === 150 && b.niva === "hallet" && b.version === 2 && o.version === 2 && b.satser.kvalificerat === 600.01;
    });
    await ok("mötet har den nya nivån och adminens svar", async () => { const r = await moteRad6(mE.id); return r.niva === "hallet" && r.niva_av === A6.id && r.niva_svar[1].ja === false; });
    await MP.andraProvision(sb, m1.id, { niva: "kvalificerat", svar: MF.nivaSvar(inst6.fragor, JA6) }, A6.id, TZ6);
    await ok("samma nivå efter ändrad sats: beloppet står kvar (radens satser)", async () => (await rader6(m1.id))[0].belopp === 600);

    sektion("Uppgift 6: ändring i en fastställd månad");
    await db.query(`insert into commission_entry (employee_id, period_month, amount, source, note, entered_by) values ($1, '2026-10-01', 1234, 'manual', 'PROV moten u6', $2)`, [B6.id, A6.id]);
    const okt6 = JSON.stringify(await poster6(B6.id, "2026-10-01"));
    await MP.andraProvision(sb, m4.id, { niva: "hallet", svar: MF.nivaSvar(inst6.fragor, NEJ6) }, A6.id, TZ6);
    await ok("admin sänker nivån: rättelse ny − gammal (−300) i innevarande, v2", async () => {
      const p = (await poster6(B6.id, innevarande6)).filter((x) => x.external_ref?.includes(m4.id));
      return p.length === 2 && p[1].amount === -300 && p[1].external_ref === `${innevarande6}:${B6.id}:rattelse:mote:${m4.id}:v2` && p[1].entered_by === A6.id;
    });
    await ok("den fastställda månadens poster är oförändrade", async () => JSON.stringify(await poster6(B6.id, "2026-10-01")) === okt6);
    await ok("raden: hållet, 300, version 2", async () => { const r = (await rader6(m4.id))[0]; return r.belopp === 300 && r.niva === "hallet" && r.version === 2; });
    await MP.andraProvision(sb, m4.id, { tappat: "uteblev" }, A6.id, TZ6);
    await ok("admin rättar Hållet till Uteblev: mötet utan nivå, raden 0 med skälet", async () => {
      const m = await moteRad6(m4.id);
      const r = (await rader6(m4.id))[0];
      return m.utfall === "uteblev" && m.niva === null && r.belopp === 0 && r.niva === null && r.skal === "Uteblev trots bekräftelse" && r.version === 3;
    });
    await ok("och en rättelse på −300 (v3); oktober fortfarande orörd", async () => {
      const p = (await poster6(B6.id, innevarande6)).filter((x) => x.external_ref?.includes(m4.id));
      return p.length === 3 && p[2].amount === -300 && p[2].external_ref.endsWith(":v3") && JSON.stringify(await poster6(B6.id, "2026-10-01")) === okt6;
    });
    await ok("summan av rättelserna är det nya beloppet (600 − 300 − 300 = 0)", async () =>
      (await poster6(B6.id, innevarande6)).filter((x) => x.external_ref?.includes(m4.id)).reduce((s, x) => s + x.amount, 0) === 0);

    sektion("Uppgift 6 (0288): en transaktion, en gång per version");
    const rattelse = (anst, version, innevarande) => ett(
      `select public.mote_bokfor_rattelse($1, $2, '2026-10-01', $3, 50, $4::date, 'PROV', $5) as m`, [m4.id, anst, version, innevarande, A6.id]);
    await ok("samma version körd om en senare månad: ingen andra post", async () => {
      const a = await rattelse(R6.id, 9, innevarande6);
      const b = await rattelse(R6.id, 9, MF.manadFor(new Date(Date.now() + 40 * 864e5).toISOString(), TZ6));
      const n = (await ett(`select count(*)::int as n from commission_entry where employee_id = $1 and external_ref like '%:rattelse:mote:' || $2 || ':v9'`, [R6.id, m4.id])).n;
      return a.m !== null && b.m === null && n === 1;
    });
    await ok("version 1 och version 10 är olika rättelser (mönstret slutar på versionen)", async () => {
      await rattelse(R6.id, 1, innevarande6);
      return (await rattelse(R6.id, 10, innevarande6)).m !== null;
    });
    await ok("innevarande månad också fastställd: P0422, inget bokfört", async () =>
      (await felkod(`select public.mote_bokfor_rattelse($1, $2, '2026-10-01', 11, 50, '2026-10-01', 'PROV', $3)`, [m4.id, R6.id, A6.id])) === "P0422"
      && (await poster6(R6.id, "2026-10-01")).length === 0);
    await ok("nollskillnad bokförs inte", async () => (await ett(
      `select public.mote_bokfor_rattelse($1, $2, '2026-10-01', 13, 0, $3::date, 'PROV', $4) as m`, [m4.id, R6.id, innevarande6, A6.id])).m === null);
    await ok("låsning i fastställd månad när innevarande också är fastställd: kastar, mötet är olåst och utan rader", async () => {
      const m = await nyttMote6({ tid: "'2026-10-16 10:00+02'" });
      const e = await kastar6(() => MP.lasProvision(sb, m, inst6, { niva: "kvalificerat", svar: [] }, H6.id, new Date("2026-10-20T12:00:00Z")));
      const r = await moteRad6(m.id);
      return e instanceof Error && !(e instanceof MP.ProvisionKonflikt) && r.niva === null && r.provision_last_nar === null && (await rader6(m.id)).length === 0;
    });
    await ok("fel efter mötesskrivningen i låsningen (negativt belopp): inget skrivet", async () => {
      const m = await nyttMote6({ tid: "'2026-10-17 10:00+02'" });
      const rader = JSON.stringify([
        { employee_id: B6.id, niva: "kvalificerat", belopp: 600, mojligt: 600, skal: null, satser: S6, delat_med: null, manad: "2026-10-01", del: "hel" },
        { employee_id: R6.id, niva: "kvalificerat", belopp: -1, mojligt: 600, skal: null, satser: S6, delat_med: null, manad: "2026-10-01", del: "hel" },
      ]);
      const fore = (await poster6(B6.id, innevarande6)).length;
      const kod = await felkod(`select public.mote_las_provision($1, 'kvalificerat', '[]'::jsonb, $2, $3::jsonb, $4::date, 'PROV')`, [m.id, H6.id, rader, innevarande6]);
      const r = await moteRad6(m.id);
      return kod === "23514" && r.niva === null && r.provision_last_nar === null && (await rader6(m.id)).length === 0 && (await poster6(B6.id, innevarande6)).length === fore;
    });
    await ok("fel efter mötesskrivningen i ändringen (negativt belopp): mötet, raderna och huvudboken orörda", async () => {
      const m = await nyttMote6({ tid: "'2026-10-18 10:00+02'" });
      await MP.lasProvision(sb, m, inst6, { niva: "kvalificerat", svar: [] }, H6.id);
      const fore = await moteRad6(m.id);
      const foreNar = (await ett(`select niva_nar::text as t from mote where id = $1`, [m.id])).t;
      const forePoster = JSON.stringify(await poster6(B6.id, innevarande6));
      const kod = await felkod(
        `select public.mote_andra_provision($1, 'hallet', $2::timestamptz, 'hallet', 'hallet', '[]'::jsonb, $3, $4::jsonb, $5::date, 'PROV')`,
        [m.id, foreNar, A6.id, JSON.stringify([{ employee_id: B6.id, version: 1, niva: "hallet", belopp: -5, mojligt: 600, skal: null }]), innevarande6]);
      const efter = await moteRad6(m.id);
      const r = (await rader6(m.id))[0];
      return kod === "23514" && efter.niva === fore.niva && efter.niva === "kvalificerat" && r.belopp === 600 && r.version === 1
        && JSON.stringify(await poster6(B6.id, innevarande6)) === forePoster;
    });
    await ok("ändringen med en gammal version: P0409, inget skrivet", async () => {
      const t = (await ett(`select niva_nar::text as t from mote where id = $1`, [m4.id])).t;
      const kod = await felkod(
        `select public.mote_andra_provision($1, 'uteblev', $2::timestamptz, 'avbokat', null, null, $3, $4::jsonb, $5::date, 'PROV')`,
        [m4.id, t, A6.id, JSON.stringify([{ employee_id: B6.id, version: 1, niva: null, belopp: 0, mojligt: 600, skal: "Avbokat" }]), innevarande6]);
      return kod === "P0409" && (await moteRad6(m4.id)).utfall === "uteblev" && (await rader6(m4.id))[0].version === 3;
    });
    await ok("ändringen utan alla rader: P0409", async () => {
      const kod = await felkod(
        `select public.mote_andra_provision($1, 'hallet', $2::timestamptz, 'hallet', 'kvalificerat', '[]'::jsonb, $3, '[]'::jsonb, $4::date, 'PROV')`,
        [mE.id, (await ett(`select niva_nar::text as t from mote where id = $1`, [mE.id])).t, A6.id, innevarande6]);
      return kod === "P0409";
    });

    sektion("Uppgift 6: vem som får provision (ingen sätter nivån på sin egen)");
    await ok("olåst möte: mottagarna är de fordela ger med dagens inställning", async () => {
      const m = await nyttMote6({ utfall: "hallet" });
      const mott = await MP.provisionsmottagare(sb, { ...m, provision_last_nar: null }, inst6);
      return mott.length === 1 && mott[0] === B6.id && !MFo.farSattaNiva(B6.id, mott) && MFo.farSattaNiva(A6.id, mott);
    });
    await ok("låst möte: mottagarna är raderna (dela: båda)", async () => {
      const mott = await MP.provisionsmottagare(sb, { ...mE, provision_last_nar: "x" }, { ...inst6, mottagare: [] });
      return mott.length === 2 && mott.includes(B6.id) && mott.includes(R6.id);
    });
    await ok("en admin som bokade mötet får det som mottagare (rutten svarar 403)", async () => {
      const m = await nyttMote6({ bokat: A6.id, utfall: "hallet" });
      const mott = await MP.provisionsmottagare(sb, { ...m, provision_last_nar: null }, { ...inst6, mottagare: [A6.id] });
      return !MFo.farSattaNiva(A6.id, mott);
    });

    sektion("Slutfix: radering och ombokning");
    await ok("mote_radera tar mote_provision med sig (on delete cascade): därför spärren", async () =>
      (await ett(`select confdeltype from pg_constraint where conrelid = 'public.mote_provision'::regclass and contype = 'f' and confrelid = 'public.mote'::regclass`)).confdeltype === "c");
    await ok("möte med låst belopp över noll: harLastProvision ja (rutten svarar 409)", async () => (await MP.harLastProvision(sb, m1.id)) === true);
    await ok("tappat möte (belopp 0): harLastProvision nej, går att radera", async () => (await MP.harLastProvision(sb, m8.id)) === false);
    await ok("olåst möte utan rader: nej", async () => (await MP.harLastProvision(sb, m2.id)) === false);
    await ok("uteblivet möte som bokats om: harOmbokning ja, och rättat till Hållet är ett hinder", async () =>
      (await MP.harOmbokning(sb, mD.id)) === true && typeof MFo.ombokatHinder("hallet", await MP.harOmbokning(sb, mD.id)) === "string");
    await ok("det senare mötet (inget pekar på det): harOmbokning nej", async () => (await MP.harOmbokning(sb, mE.id)) === false);

    sektion("Uppgift 6: Ifrågasätt");
    const m6 = await nyttMote6();
    await MP.lasProvision(sb, m6, inst6, { niva: "hallet", svar: MF.nivaSvar(inst6.fragor, NEJ6) }, H6.id);
    await ok("bokaren ifrågasätter ett hållet möte", async () => (await MP.ifragasattProvision(sb, m6.id, B6.id)) === "ok");
    await ok("en gång till: redan ifrågasatt (409)", async () => (await MP.ifragasattProvision(sb, m6.id, B6.id)) === "redan");
    await ok("ett kvalificerat möte går inte att ifrågasätta", async () => (await MP.ifragasattProvision(sb, m1.id, B6.id)) === "ingen");
    await ok("den som inte har en rad kan inte ifrågasätta", async () => (await MP.ifragasattProvision(sb, m6.id, K6.id)) === "ingen");
    await MP.andraProvision(sb, m6.id, { niva: "hallet", svar: MF.nivaSvar(inst6.fragor, NEJ6) }, A6.id, TZ6);
    await ok("admin låter svaren stå: beslutet loggas på raden, beloppet oförändrat", async () => {
      const r = (await rader6(m6.id))[0];
      return r.beslut_nar !== null && r.belopp === 300 && r.version === 2;
    });

    sektion("Uppgift 8: Låt stå");
    const mLat = await nyttMote6();
    await MP.lasProvision(sb, mLat, inst6, { niva: "hallet", svar: MF.nivaSvar(inst6.fragor, NEJ6) }, H6.id);
    await ok("inte ifrågasatt: Låt stå ger inget att besluta", async () => (await MP.latStaProvision(sb, mLat.id, A6.id)) === 0);
    await MP.ifragasattProvision(sb, mLat.id, B6.id);
    await ok("ifrågasatt: Låt stå sätter beslutet på raden, beloppet och versionen oförändrade", async () => {
      const fore = (await rader6(mLat.id))[0];
      const n = await MP.latStaProvision(sb, mLat.id, A6.id);
      const efter = (await rader6(mLat.id))[0];
      return n === 1 && efter.beslut_nar !== null && efter.beslut_av === A6.id && efter.belopp === fore.belopp && efter.version === fore.version;
    });
    await ok("en gång till: redan beslutat (409)", async () => (await MP.latStaProvision(sb, mLat.id, A6.id)) === 0);

    sektion("Uppgift 8: reparationens möten");
    // Gamla oreparerade möten ska inte stå i vägen: räknas bara de vi själva lägger in (mote_tid långt fram i tiden är fel, så nu() - 2 h).
    const galler8 = new Date(Date.now() - 864e5).toISOString();
    const utf8 = async (utfall, minSedan) => {
      const m = await nyttMote6({ utfall: null });
      await db.query(`update mote set utfall = $2::text, utfall_nar = now() - ($3::int * interval '1 minute'), utfall_av = $4 where id = $1`, [m.id, utfall, minSedan, H6.id]);
      return m;
    };
    const rH = await utf8("hallet", 60), rU = await utf8("uteblev", 30), rA = await utf8("avbokat", 90), rNy = await utf8("avbokat", 1);
    await ok("kandidaterna är de olåsta, inte hållna, äldst utfall först, och inte de allra nyaste", async () => {
      const k = (await MP.reparationsKandidater(sb, galler8, new Date(), 1000)).map((x) => x.id).filter((id) => [rH.id, rU.id, rA.id, rNy.id].includes(id));
      return JSON.stringify(k) === JSON.stringify([rA.id, rU.id]);
    });
    await ok("ett hållet möte utan lås kommer aldrig med, hur högt limit står", async () => {
      const k = await MP.reparationsKandidater(sb, galler8, new Date(), 1000);
      return !k.some((x) => x.id === rH.id) && k.every((x) => x.utfall !== "hallet");
    });
    await ok("limit tar de äldsta först (inget hållet möte fyller listan)", async () => {
      const k = await MP.reparationsKandidater(sb, galler8, new Date(), 1);
      return k.length === 1 && k[0].utfall !== "hallet";
    });
    }

    // ---- B lagger till sina sektioner har ----
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }

  console.log(`\n${antal - fel}/${antal} kontroller grona${fel ? `, \x1b[31m${fel} fel\x1b[0m` : ""} (rullat tillbaka)`);
  process.exit(fel ? 1 : 0);
}

/**
 * Uppgift 6: en supabase-js-klient över provets pg-anslutning, med just de anrop motesprovision-server.ts gör
 * (`from().select/insert/update().eq/is/in/limit/maybeSingle()`, `rpc()`). Svaren har PostgREST:s form:
 * numeric som tal, date som "YYYY-MM-DD", timestamptz som ISO-sträng, jsonb tolkat, fel som { code, message }.
 * Varje anrop går i en egen SAVEPOINT, så att ett väntat fel inte avbryter provets transaktion.
 */
function pgSupabase(klient) {
  const typer = {
    getTypeParser(oid, format) {
      if (oid === 1700) return (s) => Number(s);
      if (oid === 1082) return (s) => s;
      if (oid === 1184 || oid === 1114) return (s) => s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
      return pg.types.getTypeParser(oid, format);
    },
  };
  const kor = async (text, values) => {
    const namn = `sb${++sp}`;
    await klient.query(`savepoint ${namn}`);
    try {
      const r = await klient.query({ text, values, types: typer });
      await klient.query(`release savepoint ${namn}`);
      return { rows: r.rows, error: null };
    } catch (e) {
      await klient.query(`rollback to savepoint ${namn}`);
      return { rows: null, error: { code: e.code, message: e.message } };
    }
  };
  const json = (v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);
  const fraga = (tabell) => {
    const st = { typ: "select", cols: "*", retur: null, filter: [], limit: null, en: false, rader: null, lapp: null };
    const b = {
      select(cols = "*") { if (st.typ === "select") st.cols = cols; else st.retur = cols; return b; },
      insert(r) { st.typ = "insert"; st.rader = Array.isArray(r) ? r : [r]; return b; },
      update(l) { st.typ = "update"; st.lapp = l; return b; },
      eq(c, v) { st.filter.push({ c, op: "=", v }); return b; },
      neq(c, v) { st.filter.push({ c, op: "<>", v }); return b; },
      in(c, v) { st.filter.push({ c, op: "in", v }); return b; },
      is(c, v) { st.filter.push({ c, op: "is", v }); return b; },
      gte(c, v) { st.filter.push({ c, op: ">=", v }); return b; },
      lte(c, v) { st.filter.push({ c, op: "<=", v }); return b; },
      order(c, o = {}) { st.sortering = `${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
      not(c, op, v) { st.filter.push({ c, op: op === "is" ? "is not" : "<>", v }); return b; },
      limit(n) { st.limit = n; return b; },
      maybeSingle() { st.en = true; return b; },
      then(ja, nej) { return utfor().then(ja, nej); },
    };
    const utfor = async () => {
      const varden = [];
      const p = (v) => { varden.push(v); return `$${varden.length}`; };
      let sql;
      if (st.typ === "insert") {
        const kol = Object.keys(st.rader[0]);
        sql = `insert into public.${tabell} (${kol.join(", ")}) values ${st.rader.map((r) => `(${kol.map((k) => p(json(r[k] ?? null))).join(", ")})`).join(", ")}`;
      } else if (st.typ === "update") {
        sql = `update public.${tabell} set ${Object.entries(st.lapp).map(([k, v]) => `${k} = ${p(json(v))}`).join(", ")}`;
      } else {
        sql = `select ${st.cols} from public.${tabell}`;
      }
      const villkor = st.filter.map((f) => (f.op === "is" || f.op === "is not" ? `${f.c} ${f.op} ${f.v === null ? "null" : f.v}` : f.op === "in" ? `${f.c} = any(${p(f.v)})` : `${f.c} ${f.op} ${p(f.v)}`));
      if (villkor.length && st.typ !== "insert") sql += ` where ${villkor.join(" and ")}`;
      if (st.typ !== "select" && st.retur) sql += ` returning ${st.retur}`;
      if (st.typ === "select" && st.sortering) sql += ` order by ${st.sortering}`;
      if (st.typ === "select" && st.limit) sql += ` limit ${Number(st.limit)}`;
      const r = await kor(sql, varden);
      if (r.error) return { data: null, error: r.error };
      if (st.typ !== "select" && !st.retur) return { data: null, error: null };
      return { data: st.en ? (r.rows[0] ?? null) : r.rows, error: null };
    };
    return b;
  };
  return {
    from: fraga,
    async rpc(namn, args = {}) {
      const nycklar = Object.keys(args);
      const r = await kor(`select public.${namn}(${nycklar.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`, nycklar.map((k) => json(args[k])));
      return r.error ? { data: null, error: r.error } : { data: r.rows[0]?.r ?? null, error: null };
    },
  };
}

/* ------------------------------------------------------------------------ */
/* A5: provrader som BEHALLS (kor.mjs laser utanfor provets transaktion)      */
/* ------------------------------------------------------------------------ */

const PROV_SALJARE_AUTH = process.env.PROV_SALJARE_AUTH ?? "322408d6-7667-4811-a1c0-23e02c8abf51"; // Fredrik
const PROV_CHEF_AUTH = process.env.PROV_CHEF_AUTH ?? "703536da-8813-4c7b-b2e7-a3a070ab14a8"; // Zen

/**
 * Lagger in en provkedja per kolumn (bokat, bekraftat, utfall_saknas, folj_upp, tyst)
 * plus tva stangda kedjor (affar, nej) i innevarande vecka, och COMMITTAR.
 * Ror bara mote_bolag, mote_kedja och mote; aldrig kalenderhandelser eller andra tabeller.
 * Alla bolag heter 'PROV moten ...'. Stada med --stada.
 */
async function behall() {
  await db.connect();
  try {
    const finns = await ett(`select count(*)::int as n from mote_bolag where namn like 'PROV moten%'`);
    if (finns.n) throw new Error(`${finns.n} provbolag finns redan: kor --stada forst`);
    const p = async (auth) => (await ett(`select id from employee where auth_user_id = $1`, [auth]))?.id;
    const F = await p(PROV_SALJARE_AUTH);
    const Z = await p(PROV_CHEF_AUTH);
    if (!F || !Z) throw new Error("saljaren eller chefen hittas inte (PROV_SALJARE_AUTH / PROV_CHEF_AUTH)");

    await db.query("begin");
    // Svenska tidpunkter som SQL-uttryck (dygnsgransen ar svensk, inte UTC).
    const STHLM_IDAG = `(now() at time zone 'Europe/Stockholm')::date`;
    const sthlm = (dagar, tid) => `((${STHLM_IDAG} + ${dagar} + time '${tid}') at time zone 'Europe/Stockholm')`;
    let nr = 0;
    const bolag = async (namn) =>
      (await ett(
        `insert into mote_bolag (namn, kontakt, telefon, epost, doman, kalla, skapad_av)
         values ($1, $2, $3, $4, $5, 'prov', $6) returning id`,
        [`PROV moten ${namn}`, `Kontakt ${namn}`, `+4670000010${++nr}`, `info@prov-moten-${nr}.example.invalid`, `prov-moten-${nr}.example.invalid`, F],
      )).id;
    const kedja = async (bolagId, extra = "") => {
      // extra: kolumnlista och varden som "uppfoljning_datum = ..." ar fel form, sa vi tar tva delar.
      const [kol, val] = extra ? extra : ["", ""];
      return (await ett(`insert into mote_kedja (bolag_id${kol}) values ($1${val}) returning id`, [bolagId])).id;
    };
    /** Ett mote. utfall/resultat satts for avslutade; tid ar ett SQL-uttryck. */
    const mote = (kedjaId, o) =>
      db.query(
        `insert into mote (kedja_id, bokat_av, halls_av, bokat_nar, mote_tid, langd_min, kalla, art, mal, nulage,
                           bekraftat_nar, bekraftat_av, antal_flyttningar, utfall, utfall_nar, utfall_av, resultat, resultat_nar, resultat_av)
         values ($1, $2, $3, ${o.bokatNar ?? "now() - interval '3 days'"}, ${o.tid}, ${o.langd ?? 30}, 'prov', $4, $5, $6,
                 ${o.bekraftat ? "now() - interval '1 hour'" : "null"}, ${o.bekraftat ? "$2" : "null"}, ${o.flytt ?? 0},
                 $7, ${o.utfall ? `${o.tid} + interval '40 minutes'` : "null"}, ${o.utfall ? "$3" : "null"},
                 $8, ${o.resultat ? `${o.tid} + interval '45 minutes'` : "null"}, ${o.resultat ? "$3" : "null"})`,
        [kedjaId, o.bokat ?? F, o.halls ?? F, o.art ?? "ny", o.mal ?? null, o.nulage ?? null, o.utfall ?? null, o.resultat ?? null],
      );

    // 1. Bokat: imorgon 10:00 svensk tid, obekraftat (idag-markerat: hogst imorgon).
    let k = await kedja(await bolag("Bokat AB"));
    await mote(k, { tid: sthlm("1", "10:00"), mal: "Ga igenom SEO-lage", nulage: "ingen" });

    // 2. Bekraftat: om tre dagar 14:00, bekraftat, hallet av chefen (saljaren ar bokare).
    k = await kedja(await bolag("Bekraftat AB"));
    await mote(k, { tid: sthlm("3", "14:00"), halls: Z, bekraftat: true, nulage: "byra", langd: 45 });

    // 3. Utfall saknas: motet var for tva timmar sedan, ingen har satt utfall.
    k = await kedja(await bolag("Utfall saknas AB"));
    await mote(k, { tid: "now() - interval '2 hours'", nulage: "sjalv", flytt: 1 });

    // 4. Folj upp, idag: tva avslutade mote (Uteblev, sedan Hallet + Offert) och uppfoljning i dag.
    k = await kedja(await bolag("Folj upp AB"), [
      ", uppfoljning_datum, uppfoljning_text, offert_nar, offert_av, inget_svar_i_rad, uppfoljning_andrad",
      `, ${STHLM_IDAG}, 'Ring om offerten', now() - interval '2 days', '${F}', 1, now() - interval '2 days'`,
    ]);
    await mote(k, { tid: "now() - interval '8 days'", bokatNar: "now() - interval '12 days'", utfall: "uteblev" });
    await mote(k, { tid: "now() - interval '3 days'", bokatNar: "now() - interval '7 days'", art: "uppfoljning", utfall: "hallet", resultat: "offert" });

    // 5. Tyst: tre Inget svar i rad.
    k = await kedja(await bolag("Tyst AB"), [
      ", uppfoljning_datum, uppfoljning_text, inget_svar_i_rad, uppfoljning_andrad",
      `, ${STHLM_IDAG} - 5, 'Inget svar tre ganger', 3, now() - interval '5 days'`,
    ]);
    await mote(k, { tid: "now() - interval '10 days'", bokatNar: "now() - interval '14 days'", utfall: "hallet", resultat: "uppfoljning" });

    // 6. Stangd kedja, affar, i veckan (raknas i vecka.affar).
    k = await kedja(await bolag("Affar AB"), [", avslut, avslut_nar, avslut_av", `, 'affar', now(), '${F}'`]);
    await mote(k, { tid: "now() - interval '1 hour'", bokatNar: "now() - interval '5 days'", utfall: "hallet", resultat: "affar" });

    // 7. Stangd kedja, nej, i veckan (raknas i vecka.nej).
    k = await kedja(await bolag("Nej AB"), [", avslut, avslut_nar, avslut_av, nej_skal", `, 'nej', now(), '${F}', 'Ingen tid'`]);
    await mote(k, { tid: "now() - interval '2 hours'", bokatNar: "now() - interval '6 days'", utfall: "hallet", resultat: "nej" });

    await db.query("commit");
    const n = await ett(`select count(*)::int as n from mote_bolag where namn like 'PROV moten%'`);
    console.log(`behall: ${n.n} provbolag inlagda och committade (saljare ${F}, chef ${Z}). Stada med --stada.`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

/**
 * A8 steg 1: Inget svar ar villkorat pa `fore`. Kor EFTER `--behall` (committade PROV-rader) och FORE `--stada`.
 * Lagger in en egen provkedja (bolag 'PROV moten Inget svar AB', kalla 'prov', utan mote), kor
 * SQL_INGET_SVAR (samma uppdatering som rutten, ur motenforma.ts) tva ganger med samma `fore` och visar att
 * den andra ger 0 rader, sedan tva till med nya `fore` sa att kedjan har tre i rad, och att vyn mote_kort
 * da sager kolumn 'tyst'. Prova igen nollstaller. Allt med pg direkt; stadas av --stada.
 */
async function ingetSvarProv() {
  const { SQL_INGET_SVAR } = await import("../src/lib/nav2/motenforma.ts");
  await db.connect();
  let fel = 0;
  const kol = (namn, villkor, info = "") => {
    console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${info ? "  " + info : ""}`);
    if (!villkor) fel++;
  };
  try {
    const finns = await ett(`select count(*)::int as n from mote_bolag where namn = 'PROV moten Inget svar AB'`);
    if (finns.n) throw new Error("PROV moten Inget svar AB finns redan: kor --stada forst");
    const bolag = await ett(`insert into mote_bolag (namn, telefon, kalla) values ('PROV moten Inget svar AB', '+46700000111', 'prov') returning id`);
    const kedja = await ett(`insert into mote_kedja (bolag_id, uppfoljning_datum, uppfoljning_text) values ($1, (now() at time zone 'Europe/Stockholm')::date, 'Prov') returning id, uppfoljning_andrad::text as andrad, inget_svar_i_rad`, [bolag.id]);
    const vy = async () => (await ett(`select kolumn, inget_svar_i_rad from mote_kort where kedja_id = $1`, [kedja.id])) ?? null;
    /** Det rutten gor: las raden, sen uppdatera pa det lasta versionen. */
    const steg = async (fore) => {
      const k = await ett(`select inget_svar_i_rad from mote_kedja where id = $1`, [kedja.id]);
      const r = await db.query(SQL_INGET_SVAR, [kedja.id, fore, "2026-11-03", k.inget_svar_i_rad + 1]);
      return r.rows[0] ?? null;
    };

    console.log("\n\x1b[1mA8: Inget svar, dubbelklick\x1b[0m");
    kol("kedjan startar utan version (fore = null) och utan Inget svar", kedja.andrad === null && kedja.inget_svar_i_rad === 0);
    const fore0 = kedja.andrad;
    const f1 = await steg(fore0);
    kol("forsta Inget svar (fore = null) uppdaterar 1 rad, raknaren 1", f1?.inget_svar_i_rad === 1, JSON.stringify(f1));
    const f1b = await steg(fore0);
    kol("andra Inget svar med SAMMA fore ger 0 rader (dubbelklick)", f1b === null);
    kol("raknaren ar fortfarande 1", (await vy()).inget_svar_i_rad === 1);
    const f2 = await steg(f1.uppfoljning_andrad);
    kol("nytt fore (versionen fran forra svaret) ger 2", f2?.inget_svar_i_rad === 2, JSON.stringify(f2));
    kol("fore med gammal version avvisas efter andringen", (await steg(f1.uppfoljning_andrad)) === null);
    kol("tva i rad ar annu inte Tyst", (await vy()).kolumn === "folj_upp", JSON.stringify(await vy()));
    const f3 = await steg(f2.uppfoljning_andrad);
    kol("tredje lyckade ger 3 i rad", f3?.inget_svar_i_rad === 3);
    const v3 = await vy();
    kol("tre lyckade: mote_kort.kolumn = 'tyst'", v3?.kolumn === "tyst", JSON.stringify(v3));

    // Prova igen nollstaller (samma villkor).
    const ra = await db.query(
      `update mote_kedja set uppfoljning_datum = (now() at time zone 'Europe/Stockholm')::date, inget_svar_i_rad = 0, uppfoljning_andrad = now()
        where id = $1 and avslut is null and uppfoljning_andrad is not distinct from $2::timestamptz returning inget_svar_i_rad`,
      [kedja.id, f3.uppfoljning_andrad],
    );
    kol("Prova igen med ratt fore nollstaller och kortet gar tillbaka till Folj upp", ra.rowCount === 1 && (await vy()).kolumn === "folj_upp");
  } finally {
    await db.end();
  }
  console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m (kor --stada)` : "\n\x1b[32mAlla ✓\x1b[0m (kor --stada)");
  process.exit(fel ? 1 : 0);
}

/**
 * Fixrunda 1: (a) en flytt nollstaller Bekraftat, sa att mote_kort gar fran 'bekraftat' till 'bokat'
 * (SQL_FLYTTA_MOTE, samma uppdatering som rutten); (b) en ny bokning i en befintlig kedja nollstaller
 * Inget svar (efterBokning som SQL), sa att en Inget svar-knapp med gammal `fore` ger 0 rader.
 * Egna provrader ('PROV moten Flytt AB', 'PROV moten Bokning AB', kalla 'prov'), committade; stada med --stada.
 */
async function flyttProv() {
  const { SQL_FLYTTA_MOTE, SQL_INGET_SVAR } = await import("../src/lib/nav2/motenforma.ts");
  await db.connect();
  let fel = 0;
  const kol = (namn, villkor, info = "") => {
    console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${info ? "  " + info : ""}`);
    if (!villkor) fel++;
  };
  try {
    const finns = await ett(`select count(*)::int as n from mote_bolag where namn in ('PROV moten Flytt AB', 'PROV moten Bokning AB')`);
    if (finns.n) throw new Error("flyttprovets rader finns redan: kor --stada forst");
    const F = (await ett(`select id from employee where auth_user_id = $1`, [PROV_SALJARE_AUTH]))?.id;
    if (!F) throw new Error("saljaren hittas inte (PROV_SALJARE_AUTH)");

    console.log("\n\x1b[1mFixrunda 1: flytt nollstaller Bekraftat\x1b[0m");
    const b1 = await ett(`insert into mote_bolag (namn, telefon, kalla) values ('PROV moten Flytt AB', '+46700000112', 'prov') returning id`);
    const k1 = await ett(`insert into mote_kedja (bolag_id) values ($1) returning id`, [b1.id]);
    const m1 = await ett(
      `insert into mote (kedja_id, bokat_av, halls_av, mote_tid, kalla, art, bekraftat_nar, bekraftat_av, antal_flyttningar)
       values ($1, $2, $2, now() + interval '2 days', 'prov', 'ny', now(), $2, 0) returning id, mote_tid::text as tid`,
      [k1.id, F],
    );
    const kolumn = async () => (await ett(`select kolumn from mote_kort where kedja_id = $1`, [k1.id]))?.kolumn;
    kol("bekraftat mote om tva dagar star i 'bekraftat'", (await kolumn()) === "bekraftat");
    const ny = (await ett(`select (now() + interval '3 days')::text as t`)).t;
    const r1 = await db.query(SQL_FLYTTA_MOTE, [m1.id, ny, 1, m1.tid]);
    kol("flytten uppdaterar 1 rad", r1.rowCount === 1);
    const rad = await ett(`select bekraftat_nar, bekraftat_av, antal_flyttningar from mote where id = $1`, [m1.id]);
    kol("bekraftat_nar och bekraftat_av ar null, flyttningsraknaren 1", rad.bekraftat_nar === null && rad.bekraftat_av === null && rad.antal_flyttningar === 1, JSON.stringify(rad));
    kol("mote_kort.kolumn gar fran 'bekraftat' till 'bokat'", (await kolumn()) === "bokat");
    const r2 = await db.query(SQL_FLYTTA_MOTE, [m1.id, ny, 2, m1.tid]);
    kol("en andra flytt fran den gamla tiden (dubbelklick) ger 0 rader", r2.rowCount === 0);

    console.log("\n\x1b[1mFixrunda 1: ny bokning nollstaller Inget svar\x1b[0m");
    const b2 = await ett(`insert into mote_bolag (namn, telefon, kalla) values ('PROV moten Bokning AB', '+46700000113', 'prov') returning id`);
    const k2 = await ett(
      `insert into mote_kedja (bolag_id, uppfoljning_datum, inget_svar_i_rad, uppfoljning_andrad) values ($1, (now() at time zone 'Europe/Stockholm')::date, 3, now() - interval '1 day')
       returning id, uppfoljning_andrad::text as andrad`,
      [b2.id],
    );
    const kol2 = async () => (await ett(`select kolumn, inget_svar_i_rad from mote_kort where kedja_id = $1`, [k2.id]));
    kol("kedjan med tre Inget svar star i 'tyst'", (await kol2()).kolumn === "tyst");
    // efterBokning: inget_svar_i_rad = 0, uppfoljning_andrad = nu
    await db.query(`update mote_kedja set inget_svar_i_rad = 0, uppfoljning_andrad = now() where id = $1 and avslut is null`, [k2.id]);
    kol("efter bokningen ar raknaren 0", (await kol2()).inget_svar_i_rad === 0);
    const gammal = await db.query(SQL_INGET_SVAR, [k2.id, k2.andrad, "2026-11-03", 4]);
    kol("Inget svar med fore fran fore bokningen ger 0 rader (409)", gammal.rowCount === 0);
  } finally {
    await db.end();
  }
  console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m (kor --stada)` : "\n\x1b[32mAlla ✓\x1b[0m (kor --stada)");
  process.exit(fel ? 1 : 0);
}

/** Raderar alla bolag med namn 'PROV moten%'; kaskaden tar kedjor och mote. Skriver ut antal. */
async function stada() {
  await db.connect();
  try {
    await db.query("begin");
    // Både namnet och källan måste vara provets: ett riktigt bolag som råkar heta 'PROV moten…' raderas aldrig.
    const fore = await ett(
      `select (select count(*) from mote_bolag where namn like 'PROV moten%' and kalla = 'prov')::int as bolag,
              (select count(*) from mote_kedja k join mote_bolag b on b.id = k.bolag_id where b.namn like 'PROV moten%' and b.kalla = 'prov')::int as kedjor,
              (select count(*) from mote m join mote_kedja k on k.id = m.kedja_id join mote_bolag b on b.id = k.bolag_id where b.namn like 'PROV moten%' and b.kalla = 'prov')::int as moten`,
    );
    const r = await db.query(`delete from mote_bolag where namn like 'PROV moten%' and kalla = 'prov'`);
    await db.query("commit");
    const kvar = await ett(`select count(*)::int as n from mote_bolag where namn like 'PROV moten%' and kalla = 'prov'`);
    console.log(`stada: raderade ${r.rowCount} bolag (${fore.kedjor} kedjor, ${fore.moten} mote via kaskad); kvar: ${kvar.n}`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error("\n\x1b[31mProvet avbrots:\x1b[0m", e.message);
  process.exit(1);
});
