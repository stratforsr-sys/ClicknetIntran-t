#!/usr/bin/env node
/**
 * UPPGIFTER: NYTT SEDAN SIST (migration 0301, `task_seen`).
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   TZ=UTC node tests/uppgift-sett-db.mjs
 *
 * Allt sker i EN transaktion mot den riktiga databasen och rullas ALLTID
 * tillbaka. Migrationsfilen läses från disk och körs inuti transaktionen, så
 * det är filens text som provas, också innan den är körd på riktigt (och den
 * körs två gånger: den ska gå att köra om).
 *
 * Provrader märks `[PROV sett]`. Inga anställda skapas: provet lånar två som
 * finns och rör dem inte.
 *
 * Det provet svarar på:
 *   1. tabellen har RLS och ingen skrivpolicy (skrivning bara via service role),
 *   2. var och en läser sina egna markeringar och ingen annans,
 *   3. startläget: alla i kretsen (skapare, bollen, med) har en markering för
 *      varje uppgift, så att ingen gammal uppgift lyser,
 *   4. markeringen flyttas fram (upsert), och försvinner med uppgiften.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HAR = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HAR, "..", "supabase", "migrations", "0301_uppgift_sett.sql");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL behövs.\n  set -a; . ~/.clicknet/nav.env; set +a; TZ=UTC node tests/uppgift-sett-db.mjs");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let fel = 0;
let sp = 0;

const sektion = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** En SAVEPOINT per kontroll: ett SQL-fel fäller bara den, inte resten. */
async function ok(namn, villkor) {
  const s = `ok${++sp}`;
  let svar = false;
  let info = "";
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

const en = async (sql, arg = []) => (await db.query(sql, arg)).rows[0];
const alla = async (sql, arg = []) => (await db.query(sql, arg)).rows;

/** Läser som en inloggad: rollen authenticated och personens auth-id i JWT:n. RLS svarar. */
async function som(authId, sql, arg = []) {
  await db.query("savepoint som");
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: authId, role: "authenticated" })]);
    await db.query("set local role authenticated");
    return (await db.query(sql, arg)).rows;
  } finally {
    await db.query("rollback to savepoint som");
  }
}

await db.connect();
try {
  await db.query("begin");
  // UTAN_MIGRATION=1 kör provet mot databasen som den står, för att se det falla (eller, efter körningen, hålla).
  if (!process.env.UTAN_MIGRATION) {
    await db.query(readFileSync(MIGRATION, "utf8"));
    await db.query(readFileSync(MIGRATION, "utf8"));
  }

  const folk = await alla(
    `select id, auth_user_id from employee where status = 'active' and auth_user_id is not null order by id limit 2`,
  );
  if (folk.length < 2) throw new Error("provet behöver två aktiva anställda med konto");
  const [A, B] = folk;

  // ---------------------------------------------------------------------------
  sektion("Tabellen och behörigheten");

  await ok("task_seen har row level security", async () => (await en(`select relrowsecurity r from pg_class where oid = 'public.task_seen'::regclass`)).r === true);
  await ok("bara en läspolicy, ingen skrivpolicy", async () => {
    const p = await alla(`select cmd from pg_policies where schemaname = 'public' and tablename = 'task_seen'`);
    return p.length === 1 && p[0].cmd === "SELECT";
  });
  await ok("migrationen gick att köra två gånger", true);

  // ---------------------------------------------------------------------------
  sektion("Startläget: alla i kretsen har sett sina uppgifter");

  const saknas = await en(`
    select count(*)::int n from (
      select t.id task_id, k.employee_id from task t
      cross join lateral (values (t.created_by), (t.assignee_id)) k(employee_id) where k.employee_id is not null
      union
      select task_id, employee_id from task_member
    ) krets
    where not exists (select 1 from task_seen s where s.task_id = krets.task_id and s.employee_id = krets.employee_id)`);
  await ok(`varje skapare, ansvarig och medlem har en markering (${saknas.n} saknas)`, saknas.n === 0);
  // Bara raderna migrationen skrev i den här transaktionen (xmin): den som lämnat en uppgift har sin gamla
  // markering kvar, och det är ingen fråga för startläget.
  await ok("startläget ger ingen markering till någon utanför kretsen", async () => {
    const r = await en(`
      select count(*)::int n from task_seen s join task t on t.id = s.task_id
      where s.xmin::text = (txid_current() % 4294967296)::text
        and s.employee_id is distinct from t.created_by and s.employee_id is distinct from t.assignee_id
        and not exists (select 1 from task_member m where m.task_id = s.task_id and m.employee_id = s.employee_id)`);
    return r.n === 0;
  });

  // ---------------------------------------------------------------------------
  sektion("Var och en läser sitt eget");

  const t1 = (await en(`insert into task (title, assignee_id, created_by) values ('[PROV sett] Delad', $1, $1) returning id`, [A.id])).id;
  await db.query(`insert into task_member (task_id, employee_id, role, added_by) values ($1, $2, 'redigerare', $3)`, [t1, B.id, A.id]);
  await db.query(`insert into task_seen (task_id, employee_id, seen_at) values ($1, $2, now() - interval '1 hour'), ($1, $3, now() - interval '2 hours')`, [t1, A.id, B.id]);

  await ok("A ser sin markering för uppgiften", async () => (await som(A.auth_user_id, `select employee_id from task_seen where task_id = $1`, [t1])).map((r) => r.employee_id).join() === A.id);
  await ok("B ser sin, inte A:s", async () => (await som(B.auth_user_id, `select employee_id from task_seen where task_id = $1`, [t1])).map((r) => r.employee_id).join() === B.id);
  await ok("A ser inga andras markeringar alls", async () => (await som(A.auth_user_id, `select count(*)::int n from task_seen where employee_id <> $1`, [A.id]))[0].n === 0);
  await ok("en inloggad kan inte skriva sin egen markering (service role skriver)", async () => {
    try {
      await som(A.auth_user_id, `insert into task_seen (task_id, employee_id) values ($1, $2)`, [t1, A.id]);
      return false;
    } catch (e) {
      return e.code === "42501";
    }
  });
  await ok("och inte flytta någon annans", async () => {
    const r = await som(A.auth_user_id, `update task_seen set seen_at = now() where task_id = $1 and employee_id = $2 returning 1`, [t1, B.id]).catch((e) => (e.code === "42501" ? [] : null));
    return Array.isArray(r) && r.length === 0;
  });

  // ---------------------------------------------------------------------------
  sektion("Markeringen flyttas fram och följer uppgiften");

  const fore = (await en(`select seen_at from task_seen where task_id = $1 and employee_id = $2`, [t1, A.id])).seen_at;
  await db.query(
    `insert into task_seen (task_id, employee_id, seen_at) values ($1, $2, now()) on conflict (task_id, employee_id) do update set seen_at = excluded.seen_at`,
    [t1, A.id],
  );
  await ok("rutan öppnad igen: samma rad, senare tid", async () => {
    const r = await alla(`select seen_at from task_seen where task_id = $1 and employee_id = $2`, [t1, A.id]);
    return r.length === 1 && r[0].seen_at > fore;
  });
  await db.query(`delete from task where id = $1`, [t1]);
  await ok("uppgiften raderad: markeringarna med den", async () => (await en(`select count(*)::int n from task_seen where task_id = $1`, [t1])).n === 0);
} catch (e) {
  fel++;
  console.error(`\n\x1b[31mProvet avbröts: ${e.message}\x1b[0m`);
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom. Inget sparades.\x1b[0m" : `\n\x1b[31m${fel} prov föll. Inget sparades.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
