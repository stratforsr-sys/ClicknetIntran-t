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

    // ---- B lagger till sina sektioner har ----
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }

  console.log(`\n${antal - fel}/${antal} kontroller grona${fel ? `, \x1b[31m${fel} fel\x1b[0m` : ""} (rullat tillbaka)`);
  process.exit(fel ? 1 : 0);
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
