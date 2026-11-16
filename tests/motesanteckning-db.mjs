#!/usr/bin/env node
/**
 * MÖTEN: ANTECKNINGARNA (migration 0310, `mote_anteckning` och `mote_anteckning_sett`).
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   TZ=UTC node tests/motesanteckning-db.mjs
 *
 * Allt sker i EN transaktion mot den riktiga databasen och rullas ALLTID
 * tillbaka. Migrationsfilen läses från disk och körs två gånger inuti
 * transaktionen (den ska gå att köra om), så det är filens text som provas,
 * också innan den är körd på riktigt.
 *
 * Provet skapar ett bolag och en kedja märkta `[PROV anteckning]`, men inget
 * möte: triggrarna på `mote` skriver i tabeller med identitetskolumner, och en
 * sekvens rullas inte tillbaka. Inga anställda skapas; provet lånar tre som
 * finns (två som inte är chefer, en chef) och rör dem inte.
 *
 * Det provet svarar på:
 *   1. båda tabellerna har RLS och ingen skrivpolicy, och anon får ingenting,
 *   2. deltagaren läser kortets tråd, den som inte är med gör det inte, chefen gör det,
 *   3. var och en läser bara sin egen sett-rad,
 *   4. CHECK-villkoret avvisar tom text, för lång text, text på ett borttaget inlägg
 *      och ett inlägg utan både text och borttagen (NULL släpper inte igenom),
 *   5. samma id två gånger blir ett inlägg (`on conflict do nothing`),
 *   6. startläget: varje gammalt mål finns som inlägg, och alla deltagare har en sett-rad,
 *   7. kedjan raderad: tråden och sett-raderna med den.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const HAR = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HAR, "..", "supabase", "migrations", "0310_mote_anteckning.sql");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL behövs.\n  set -a; . ~/.clicknet/nav.env; set +a; TZ=UTC node tests/motesanteckning-db.mjs");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let fel = 0;
let antal = 0;
let sp = 0;

const sektion = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** En SAVEPOINT per kontroll: ett SQL-fel fäller bara den, inte resten. */
async function ok(namn, villkor) {
  const s = `ok${++sp}`;
  let svar = false;
  let info = "";
  antal++;
  await db.query(`savepoint ${s}`);
  try {
    svar = typeof villkor === "function" ? await villkor() : villkor;
    await db.query(`release savepoint ${s}`);
  } catch (e) {
    if (!svar) info = ` (${e.code ?? ""} ${e.message})`;
    await db.query(`rollback to savepoint ${s}`);
  }
  console.log(`  ${svar ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${info}`);
  if (!svar) fel++;
}

/** Ger true om satsen avvisas med just den felkoden. */
async function avvisas(sql, arg, kod) {
  await db.query("savepoint av");
  try {
    await db.query(sql, arg);
    await db.query("rollback to savepoint av");
    return false;
  } catch (e) {
    await db.query("rollback to savepoint av");
    return e.code === kod;
  }
}

const en = async (sql, arg = []) => (await db.query(sql, arg)).rows[0];
const alla = async (sql, arg = []) => (await db.query(sql, arg)).rows;

/** Läser som en inloggad: rollen authenticated och personens auth-id i JWT:n. RLS svarar. */
async function som(authId, sql, arg = [], roll = "authenticated") {
  await db.query("savepoint som");
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: authId, role: roll })]);
    await db.query(`set local role ${roll}`);
    return (await db.query(sql, arg)).rows;
  } finally {
    await db.query("rollback to savepoint som");
  }
}

const CHEF = ["team_lead", "sales_manager", "ceo", "admin"];

await db.connect();
try {
  await db.query("begin");
  if (!process.env.UTAN_MIGRATION) {
    await db.query(readFileSync(MIGRATION, "utf8"));
    await db.query(readFileSync(MIGRATION, "utf8"));
  }

  const ejChef = await alla(
    `select e.id, e.auth_user_id from employee e
      where e.status = 'active' and e.auth_user_id is not null
        and not exists (select 1 from employee_role r where r.employee_id = e.id and r.role = any($1))
      order by e.id limit 2`,
    [CHEF],
  );
  const chef = await en(
    `select e.id, e.auth_user_id from employee e
      where e.status = 'active' and e.auth_user_id is not null
        and exists (select 1 from employee_role r where r.employee_id = e.id and r.role = any($1))
      order by e.id limit 1`,
    [CHEF],
  );
  if (ejChef.length < 2 || !chef) throw new Error("provet behöver två aktiva anställda utan chefsroll och en chef, alla med konto");
  const [A, B] = ejChef;

  // ---------------------------------------------------------------------------
  sektion("Tabellerna och behörigheten");

  for (const t of ["mote_anteckning", "mote_anteckning_sett"]) {
    await ok(`${t} har row level security`, async () => (await en(`select relrowsecurity r from pg_class where oid = $1::regclass`, [`public.${t}`])).r === true);
    await ok(`${t}: bara en läspolicy, ingen skrivpolicy`, async () => {
      const p = await alla(`select cmd from pg_policies where schemaname = 'public' and tablename = $1`, [t]);
      return p.length === 1 && p[0].cmd === "SELECT";
    });
    await ok(`${t}: anon får inte läsa`, async () => !(await en(`select has_table_privilege('anon', $1, 'select') h`, [`public.${t}`])).h);
  }
  await ok("migrationen gick att köra två gånger", true);

  // ---------------------------------------------------------------------------
  sektion("Startläget");

  const malSaknas = await en(`
    select count(*)::int n from mote m
     where nullif(btrim(m.mal), '') is not null
       and not exists (select 1 from mote_anteckning a where a.mote_id = m.id and a.av = m.bokat_av and a.text = left(btrim(m.mal), 4000) and a.skapad = m.bokat_nar)`);
  await ok(`varje gammalt mål finns som bokarens inlägg med bokningens tid (${malSaknas.n} saknas)`, malSaknas.n === 0);
  const malDubbel = await en(`select count(*)::int n from (select mote_id from mote_anteckning where mote_id is not null group by mote_id, text having count(*) > 1) x`);
  await ok("inget mål ligger två gånger efter två körningar", malDubbel.n === 0);
  const settSaknas = await en(`
    select count(*)::int n from mote_kedja k cross join lateral unnest(k.deltagare) d(p) join employee e on e.id = d.p
     where not exists (select 1 from mote_anteckning_sett s where s.kedja_id = k.id and s.employee_id = d.p)`);
  await ok(`varje deltagare har en sett-rad för sitt kort (${settSaknas.n} saknas)`, settSaknas.n === 0);
  const nyttVidStart = await en(`
    select count(*)::int n from mote_anteckning a join mote_anteckning_sett s on s.kedja_id = a.kedja_id
     where a.av <> s.employee_id and a.skapad > s.sett_till
       -- Bara det som fanns när 0310 kördes: ett inlägg skrivet efteråt är riktig användning och får vara nytt.
       and a.skapad <= coalesce((select max(applied_at) from schema_migrations where name like '0310%'), now())`);
  await ok(`ingenting står som nytt för någon vid start (${nyttVidStart.n})`, nyttVidStart.n === 0);

  // ---------------------------------------------------------------------------
  sektion("Vem som läser tråden");

  const bolag = (await en(`insert into mote_bolag (namn, kalla) values ('[PROV anteckning] Bolaget', 'prov') returning id`)).id;
  const kedja = (await en(`insert into mote_kedja (bolag_id, deltagare) values ($1, $2) returning id`, [bolag, [A.id]])).id;
  const i1 = randomUUID();
  await db.query(`insert into mote_anteckning (id, kedja_id, av, text) values ($1, $2, $3, '[PROV anteckning] Ägaren heter Lena')`, [i1, kedja, A.id]);
  await db.query(`insert into mote_anteckning_sett (kedja_id, employee_id) values ($1, $2), ($1, $3)`, [kedja, A.id, B.id]);

  await ok("deltagaren läser kortets tråd", async () => (await som(A.auth_user_id, `select id from mote_anteckning where kedja_id = $1`, [kedja])).map((r) => r.id).join() === i1);
  await ok("den som inte är med läser den inte", async () => (await som(B.auth_user_id, `select id from mote_anteckning where kedja_id = $1`, [kedja])).length === 0);
  await ok("chefen läser den", async () => (await som(chef.auth_user_id, `select id from mote_anteckning where kedja_id = $1`, [kedja])).length === 1);
  await ok("anon läser ingenting", async () => {
    try {
      const r = await som(null, `select id from mote_anteckning where kedja_id = $1`, [kedja], "anon");
      return r.length === 0;
    } catch (e) {
      return e.code === "42501";
    }
  });
  await db.query(`update mote_kedja set deltagare = $2 where id = $1`, [kedja, [A.id, B.id]]);
  await ok("B läggs till på kortet: B läser tråden", async () => (await som(B.auth_user_id, `select id from mote_anteckning where kedja_id = $1`, [kedja])).length === 1);
  await ok("var och en läser bara sin egen sett-rad", async () => {
    const a = await som(A.auth_user_id, `select employee_id from mote_anteckning_sett where kedja_id = $1`, [kedja]);
    const b = await som(B.auth_user_id, `select employee_id from mote_anteckning_sett where kedja_id = $1`, [kedja]);
    return a.map((r) => r.employee_id).join() === A.id && b.map((r) => r.employee_id).join() === B.id;
  });
  await ok("en inloggad kan inte skriva ett inlägg själv (service role skriver)", async () =>
    (await som(A.auth_user_id, `select 1`).then(() => true)) &&
    (await (async () => {
      try {
        await som(A.auth_user_id, `insert into mote_anteckning (id, kedja_id, av, text) values ($1, $2, $3, 'x')`, [randomUUID(), kedja, A.id]);
        return false;
      } catch (e) {
        return e.code === "42501";
      }
    })()));
  await ok("och inte ändra någon annans inlägg", async () => {
    const r = await som(B.auth_user_id, `update mote_anteckning set text = 'kapat' where id = $1 returning 1`, [i1]).catch((e) => (e.code === "42501" ? [] : null));
    return Array.isArray(r) && r.length === 0;
  });

  // ---------------------------------------------------------------------------
  sektion("Villkoren");

  const ins = `insert into mote_anteckning (id, kedja_id, av, text, borttagen) values ($1, $2, $3, $4, $5)`;
  await ok("tom text avvisas", async () => avvisas(ins, [randomUUID(), kedja, A.id, "   ", null], "23514"));
  await ok("text på 4001 tecken avvisas", async () => avvisas(ins, [randomUUID(), kedja, A.id, "x".repeat(4001), null], "23514"));
  await ok("text på 4000 tecken går", async () => !(await avvisas(ins, [randomUUID(), kedja, A.id, "x".repeat(4000), null], "23514")));
  await ok("varken text eller borttagen avvisas (NULL släpper inte igenom)", async () => avvisas(ins, [randomUUID(), kedja, A.id, null, null], "23514"));
  await ok("borttaget inlägg med text kvar avvisas", async () => avvisas(ins, [randomUUID(), kedja, A.id, "kvar", new Date()], "23514"));
  await ok("borttaget inlägg utan text går", async () => !(await avvisas(ins, [randomUUID(), kedja, A.id, null, new Date()], "23514")));
  await ok("ett inlägg utan kedja avvisas", async () => avvisas(ins, [randomUUID(), randomUUID(), A.id, "x", null], "23503"));

  // ---------------------------------------------------------------------------
  sektion("Samma id är samma inlägg");

  const i2 = randomUUID();
  const skriv = `insert into mote_anteckning (id, kedja_id, av, text) values ($1, $2, $3, $4) on conflict (id) do nothing returning id`;
  const forsta = await alla(skriv, [i2, kedja, B.id, "[PROV anteckning] Ska jag ta med offerten?"]);
  const andra = await alla(skriv, [i2, kedja, B.id, "[PROV anteckning] Ska jag ta med offerten?"]);
  await ok("första skrivningen ger raden, den andra ingenting", forsta.length === 1 && andra.length === 0);
  await ok("tråden har två inlägg, i den ordning de skrevs", async () => {
    const r = await alla(`select id from mote_anteckning where kedja_id = $1 order by skapad, id`, [kedja]);
    return r.length === 2 && r[0].id === i1 && r[1].id === i2;
  });

  // ---------------------------------------------------------------------------
  sektion("Tråden följer kortet");

  await db.query(`delete from mote_kedja where id = $1`, [kedja]);
  await ok("kortet raderat: inläggen med det", async () => (await en(`select count(*)::int n from mote_anteckning where kedja_id = $1`, [kedja])).n === 0);
  await ok("och sett-raderna", async () => (await en(`select count(*)::int n from mote_anteckning_sett where kedja_id = $1`, [kedja])).n === 0);
} catch (e) {
  fel++;
  console.error(`\n\x1b[31mProvet avbröts: ${e.message}\x1b[0m`);
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}

console.log(fel === 0 ? `\n\x1b[32mAlla ${antal} prov gick igenom. Inget sparades.\x1b[0m` : `\n\x1b[31m${fel} av ${antal} prov föll. Inget sparades.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
