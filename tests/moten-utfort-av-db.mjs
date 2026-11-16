#!/usr/bin/env node
/**
 * DEN SOM GJORDE DET STÅR SOM DEN SOM GJORDE DET (migration 0309).
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   node tests/moten-utfort-av-db.mjs            (kör 0309 i transaktionen)
 *   node tests/moten-utfort-av-db.mjs --utan-0309 (funktionerna som de ligger i databasen)
 *
 * Felet 2026-11-16: Zen flyttade ett möte som Mick höll i, i Möten. Möten kör kalenderns funktioner
 * som hållaren, så notisen sa "Mick flyttade … Svara igen" till Zen, och Mick fick ingenting.
 *
 * Allt sker i EN transaktion mot den riktiga databasen och rullas ALLTID tillbaka. Provrader märks
 * `PROV utfort-av`. Anställda som behövs läggs in i transaktionen.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";

const HAR = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HAR, "..", "supabase", "migrations", "0309_moten_utfort_av.sql");
const UTAN = process.argv.includes("--utan-0309");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL behövs.\n  set -a; . ~/.clicknet/nav.env; set +a; node tests/moten-utfort-av-db.mjs");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let antal = 0;
let fel = 0;
let sp = 0;

function sektion(rubrik) {
  console.log(`\n\x1b[1m${rubrik}\x1b[0m`);
}

async function ok(namn, villkor) {
  antal++;
  let svar = false;
  let info = "";
  const s = `ok${++sp}`;
  await db.query(`savepoint ${s}`);
  try {
    svar = typeof villkor === "function" ? await villkor() : villkor;
    await db.query(`release savepoint ${s}`);
  } catch (e) {
    info = ` (${e.code ?? ""} ${e.message})`;
    await db.query(`rollback to savepoint ${s}`);
  }
  if (svar) console.log(`  \x1b[32m✓\x1b[0m ${namn}`);
  else {
    fel++;
    console.log(`  \x1b[31m✗\x1b[0m ${namn}${info}`);
  }
}

async function ett(sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}

/** Kör SQL i en SAVEPOINT; ger felmeddelandet, eller null om det gick. */
async function felet(sql, args = []) {
  const s = `sp${++sp}`;
  await db.query(`savepoint ${s}`);
  try {
    await db.query(sql, args);
    await db.query(`release savepoint ${s}`);
    return null;
  } catch (e) {
    await db.query(`rollback to savepoint ${s}`);
    return e.message ?? "?";
  }
}

async function anstalld(namn) {
  const e = await ett(
    `insert into employee (auth_user_id, email, first_name, last_name, status)
     values ($1, $2, 'PROV utfort-av', $3, 'active') returning id`,
    [randomUUID(), `prov-utfort-av-${randomUUID()}@example.invalid`, namn],
  );
  return e.id;
}

/** Notiserna i utkorgen för händelsen efter `fran` (outboxens id). */
async function notiser(ev, fran) {
  const r = await db.query(
    `select payload->>'till' till, payload->>'av' av, payload->>'mall' mall, payload->'data' data
       from outbox where kind = 'notis' and event_id = $1 and id > $2 order by id`,
    [ev, fran],
  );
  return r.rows;
}
const sistaId = async () => (await ett(`select coalesce(max(id), 0) id from outbox`)).id;
const svaret = async (ev, vem) => (await ett(`select response from calendar_attendee where event_id = $1 and employee_id = $2`, [ev, vem]))?.response;

async function main() {
  await db.connect();
  await db.query("begin");
  try {
    if (!UTAN) await db.query(readFileSync(MIGRATION, "utf8"));

    const H = await anstalld("Hållaren");
    const G = await anstalld("Gör det");
    const K = await anstalld("Kollegan");

    sektion("Bokning åt en kollega (lk_skapa_mote som hållaren, gjord av G)");
    let fore = await sistaId();
    let ev = null;
    await ok("lk_skapa_mote tar p_utfort_av", async () => {
      const r = await ett(
        `select public.lk_skapa_mote($1, $1, 'PROV utfort-av möte', '2030-01-08', '09:00', 30, array[$1, $2, $3]::uuid[], null, null, '', 10, $2) r`,
        [H, G, K],
      );
      ev = r.r.event_id;
      return !!ev;
    });
    if (!ev) throw new Error("Ingen händelse att fortsätta med.");
    let n = await notiser(ev, fore);
    await ok("kollegan bjuds in av G", () => n.some((x) => x.till === K && x.av === G && x.mall === "inbjudan"));
    await ok("G får ingen notis om sin egen bokning", () => !n.some((x) => x.till === G));
    await ok("hållaren får ingen kalendernotis (Möten skickar mote-bokat)", () => !n.some((x) => x.till === H));
    await ok("ingen notis har hållaren som avsändare", () => !n.some((x) => x.av === H));
    await ok("G har redan sagt ja", async () => (await svaret(ev, G)) === "ja");
    await ok("kollegan väntar på att svara", async () => (await svaret(ev, K)) === "vantar");
    await ok("händelsen är skapad av G", async () => (await ett(`select created_by from calendar_event where id = $1`, [ev])).created_by === G);

    sektion("Flytta (lk_flytta som hållaren, gjord av G)");
    await ok("G får fortfarande inte flytta i hållarens kalender på egen hand", async () => /lk:behorighet/.test((await felet(`select public.lk_flytta($1, $2, '2030-01-09', '10:00', null)`, [G, ev])) ?? ""));
    fore = await sistaId();
    await ok("lk_flytta tar p_utfort_av", async () => !(await felet(`select public.lk_flytta($1, $2, '2030-01-09', '10:00', null, $3)`, [H, ev, G])));
    n = await notiser(ev, fore);
    await ok("hållaren får veta att G flyttade", () => n.some((x) => x.till === H && x.av === G && x.mall === "flyttad"));
    await ok("kollegan får veta att G flyttade, och svarar igen", () => n.some((x) => x.till === K && x.av === G && x.data?.svara_igen === true));
    await ok("G får ingen notis om sin egen flytt", () => !n.some((x) => x.till === G));
    await ok("ingen notis har hållaren som avsändare", () => !n.some((x) => x.av === H));
    await ok("G behåller sitt ja", async () => (await svaret(ev, G)) === "ja");
    await ok("kollegan ombeds svara igen", async () => (await svaret(ev, K)) === "vantar");

    sektion("Ändra med ny tid (lk_spara_mote som hållaren, gjord av G)");
    fore = await sistaId();
    await ok("lk_spara_mote tar p_utfort_av", async () => !(await felet(
      `select public.lk_spara_mote($1, $2, '2030-01-10', '11:00', 30, 'PROV utfort-av möte', null, null, '', array[$3, $4]::uuid[], '{}'::uuid[], null, null, null, null, $3)`,
      [H, ev, G, K],
    )));
    n = await notiser(ev, fore);
    await ok("kollegan får veta att G flyttade", () => n.some((x) => x.till === K && x.av === G && x.mall === "flyttad"));
    await ok("hållaren får ingen kalendernotis (Möten skickar mote-andrat)", () => !n.some((x) => x.till === H));
    await ok("G får ingen notis om sin egen ändring", () => !n.some((x) => x.till === G));
    await ok("G behåller sitt ja", async () => (await svaret(ev, G)) === "ja");

    sektion("Kalendern som förut (utan p_utfort_av)");
    fore = await sistaId();
    await ok("lk_flytta utan p_utfort_av går som förut", async () => !(await felet(`select public.lk_flytta($1, $2, '2030-01-11', '10:00', null)`, [H, ev])));
    n = await notiser(ev, fore);
    await ok("då står hållaren som avsändare", () => n.length > 0 && n.every((x) => x.av === H));

    sektion("Avboka (lk_stall_in som hållaren, gjord av G)");
    fore = await sistaId();
    await ok("lk_stall_in tar p_utfort_av", async () => !(await felet(`select public.lk_stall_in($1, $2, $3)`, [H, ev, G])));
    n = await notiser(ev, fore);
    await ok("hållaren får veta att G ställde in", () => n.some((x) => x.till === H && x.av === G && x.mall === "installd"));
    await ok("kollegan får veta att G ställde in", () => n.some((x) => x.till === K && x.av === G && x.mall === "installd"));
    await ok("G får ingen notis om sin egen avbokning", () => !n.some((x) => x.till === G));

    sektion("Rättigheterna");
    for (const sig of [
      "lk_flytta(uuid, uuid, date, time, integer, uuid)",
      "lk_stall_in(uuid, uuid, uuid)",
      "lk_spara_mote(uuid, uuid, date, time, integer, text, text, text, text, uuid[], uuid[], integer, boolean, text, boolean, uuid)",
      "lk_skapa_mote(uuid, uuid, text, date, time, integer, uuid[], text, text, text, integer, uuid)",
    ]) {
      await ok(`${sig.split("(")[0]}: bara service_role`, async () => {
        const r = await ett(
          `select has_function_privilege('anon', $1::regprocedure, 'execute') a, has_function_privilege('authenticated', $1::regprocedure, 'execute') b,
                  has_function_privilege('service_role', $1::regprocedure, 'execute') c`,
          [`public.${sig}`],
        );
        return !r.a && !r.b && r.c;
      });
    }
  } finally {
    await db.query("rollback").catch(() => {});
    await db.end();
  }
  console.log(`\n${antal - fel}/${antal} kontroller gröna${fel ? `, \x1b[31m${fel} fel\x1b[0m` : ""} (rullat tillbaka)`);
  process.exit(fel ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
