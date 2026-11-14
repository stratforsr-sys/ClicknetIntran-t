#!/usr/bin/env node
/**
 * UPPGIFTER: EN KOLLEGA I MIN UPPGIFT (migration 0298).
 *
 *   set -a; . ~/.clicknet/nav.env; set +a
 *   TZ=UTC node tests/uppgift-kollega-db.mjs
 *
 * Allt sker i EN transaktion mot den riktiga databasen och rullas ALLTID
 * tillbaka. Migrationsfilen läses från disk och körs inuti transaktionen, så
 * det är filens text som provas, också innan den är körd på riktigt.
 *
 * Provrader märks `[PROV kollega]`. Inga anställda skapas: provet lånar fyra
 * som finns (A har bollen, B är med, C är ny, D står utanför) och rör dem inte.
 *
 * Det provet svarar på:
 *   1. passa: bollen byter hand, mottagarens medlemsrad försvinner, den som
 *      hade bollen blir kvar — i ett steg,
 *   2. två som bockar samtidigt ger EN händelse,
 *   3. den som är med i föräldern ser deluppgiftens händelser (H16), och den
 *      utanför ser ingenting, före som efter,
 *   4. den som tagits bort ser ingenting längre,
 *   5. de två nya händelsetyperna går in, en påhittad gör det inte.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HAR = dirname(fileURLToPath(import.meta.url));
// 0298 och rättelsen 0299 (den villkorade händelsen får clock_timestamp(); se den).
const MIGRATIONER = ["0298_uppgift_kollega.sql", "0299_uppgift_villkorad_tid.sql"].map((f) => join(HAR, "..", "supabase", "migrations", f));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL behövs.\n  set -a; . ~/.clicknet/nav.env; set +a; TZ=UTC node tests/uppgift-kollega-db.mjs");
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
    // Ett väntat fel som kontrollen själv fångat lämnar transaktionen avbruten:
    // svaret står kvar, och savepointen rullas tillbaka utan anmärkning.
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

const LAGESTYPER = ["skapad", "paborjad", "inlamnad", "godkand", "klar", "returnerad", "ateroppnad", "avbruten"];
const STANGER = ["klar", "godkand", "inlamnad"];

await db.connect();
try {
  await db.query("begin");
  // UTAN_MIGRATION=1 kör provet mot databasen som den står, för att se det falla.
  if (!process.env.UTAN_MIGRATION) for (const m of MIGRATIONER) await db.query(readFileSync(m, "utf8"));

  const folk = await alla(
    `select id, auth_user_id from employee where status = 'active' and auth_user_id is not null order by id limit 4`,
  );
  if (folk.length < 4) throw new Error("provet behöver fyra aktiva anställda med konto");
  const [A, B, C, D] = folk;

  const nyUppgift = async (titel, ansvarig, skapare, foralder = null) => {
    const r = await en(
      `insert into task (title, assignee_id, created_by, parent_id) values ($1, $2, $3, $4) returning id`,
      [`[PROV kollega] ${titel}`, ansvarig, skapare, foralder],
    );
    await db.query(`insert into task_event (task_id, type, by_employee_id) values ($1, 'skapad', $2)`, [r.id, skapare]);
    return r.id;
  };
  const med = async (task) => (await alla(`select employee_id, role from task_member where task_id = $1 order by employee_id`, [task])).map((r) => `${r.employee_id}:${r.role}`);
  const bollen = async (task) => (await en(`select assignee_id from task where id = $1`, [task])).assignee_id;
  const handelser = async (task, typ) => Number((await en(`select count(*) n from task_event where task_id = $1 and type = $2`, [task, typ])).n);

  // ---------------------------------------------------------------------------
  sektion("Passa bollen");

  const t1 = await nyUppgift("Passa", A.id, A.id);
  await db.query(`insert into task_member (task_id, employee_id, role, added_by) values ($1, $2, 'redigerare', $3)`, [t1, B.id, A.id]);

  await db.query(`select public.uppgift_passa($1, $2, $3, true, 'passade')`, [t1, B.id, A.id]);
  await ok("bollen ligger hos B", async () => (await bollen(t1)) === B.id);
  await ok("B har ingen medlemsrad kvar, A är med", async () => (await med(t1)).join() === `${A.id}:redigerare`);
  await ok("en tilldelad-händelse", async () => (await handelser(t1, "tilldelad")) === 1);

  await db.query(`select public.uppgift_passa($1, $2, $3, true, null)`, [t1, B.id, A.id]);
  await ok("att passa till den som redan har bollen gör ingenting", async () => (await handelser(t1, "tilldelad")) === 1);

  // B5: A (med) lämnar över B:s boll till C, som står utanför. B får inte tappa uppgiften.
  await db.query(`select public.uppgift_passa($1, $2, $3, true, null)`, [t1, C.id, A.id]);
  await ok("C har bollen", async () => (await bollen(t1)) === C.id);
  await ok("B blev kvar som med, bredvid A", async () => (await med(t1)).sort().join() === [`${A.id}:redigerare`, `${B.id}:redigerare`].sort().join());

  // Den som själv lämnar över och väljer att gå.
  await db.query(`select public.uppgift_passa($1, $2, $3, false, null)`, [t1, A.id, C.id]);
  await ok("C valde att gå: ingen rad för C", async () => !(await med(t1)).some((r) => r.startsWith(C.id)));
  await ok("A har bollen och ingen medlemsrad", async () => (await bollen(t1)) === A.id && !(await med(t1)).some((r) => r.startsWith(A.id)));

  // Till inkorgen.
  await db.query(`select public.uppgift_passa($1, null, $2, true, null)`, [t1, A.id]);
  await ok("inkorgen: ingen har bollen, A är kvar som med", async () => (await bollen(t1)) === null && (await med(t1)).some((r) => r.startsWith(A.id)));

  // En granskare som får bollen ska inte också stå kvar som granskare.
  const t1b = await nyUppgift("Granskare får bollen", A.id, A.id);
  await db.query(`insert into task_member (task_id, employee_id, role, added_by) values ($1, $2, 'granskare', $3)`, [t1b, B.id, A.id]);
  await db.query(`select public.uppgift_passa($1, $2, $3, true, null)`, [t1b, B.id, A.id]);
  await ok("mottagarens gamla roll försvinner, en person har en ställning", async () => (await med(t1b)).join() === `${A.id}:redigerare`);

  await ok("en uppgift som inte finns: fel, inte tyst", async () => {
    try {
      await db.query(`select public.uppgift_passa(gen_random_uuid(), $1, $1, true, null)`, [A.id]);
      return false;
    } catch (e) {
      return /finns inte/.test(e.message);
    }
  });

  // ---------------------------------------------------------------------------
  sektion("Två som bockar samtidigt");

  const t2 = await nyUppgift("Bocka", A.id, A.id);
  const villkorad = async (task, typ, av, stoppande = STANGER) =>
    (await en(`select public.uppgift_handelse_villkorad($1, $2, $3, null, $4, $5) svar`, [task, typ, av, LAGESTYPER, stoppande])).svar;

  await ok("den första bocken skrivs", async () => (await villkorad(t2, "klar", A.id)) === null);
  await ok("den andra stoppas och säger varför", async () => (await villkorad(t2, "klar", B.id)) === "klar");
  await ok("en klar i historiken, inte två", async () => (await handelser(t2, "klar")) === 1);

  // En kommentar bär inget läge och får inte dölja att uppgiften är klar. Provet går i en transaktion, där now() står
  // still; händelserna efter bocken får clock_timestamp(), som i produktionen där varje händelse har sin egen transaktion.
  await db.query(`insert into task_event (task_id, type, by_employee_id, note, at) values ($1, 'kommentar', $2, 'hej', clock_timestamp())`, [t2, B.id]);
  await ok("en kommentar efteråt öppnar inte för en ny bock", async () => (await villkorad(t2, "klar", B.id)) === "klar");

  await db.query(`insert into task_event (task_id, type, by_employee_id, at) values ($1, 'ateroppnad', $2, clock_timestamp())`, [t2, A.id]);
  await ok("efter Öppna igen går den att bocka", async () => (await villkorad(t2, "klar", B.id)) === null);
  await ok("updated_at följde med", async () => (await en(`select updated_at >= now() - interval '1 minute' ok from task where id = $1`, [t2])).ok);

  // ---------------------------------------------------------------------------
  sektion("Händelsetyperna");

  await ok("andrad går in", async () => { await db.query(`insert into task_event (task_id, type, by_employee_id, note) values ($1, 'andrad', $2, 'flyttade till mån 17 nov')`, [t2, B.id]); return true; });
  await ok("krets går in", async () => { await db.query(`insert into task_event (task_id, type, by_employee_id, note) values ($1, 'krets', $2, 'la till C')`, [t2, A.id]); return true; });
  await ok("paminnelse går fortfarande in (0092)", async () => { await db.query(`insert into task_event (task_id, type, by_employee_id) values ($1, 'paminnelse', $2)`, [t2, A.id]); return true; });
  await ok("en påhittad typ vägras", async () => {
    try {
      await db.query(`insert into task_event (task_id, type, by_employee_id) values ($1, 'hittepa', $2)`, [t2, A.id]);
      return false;
    } catch (e) {
      return e.code === "23514";
    }
  });

  // ---------------------------------------------------------------------------
  sektion("Vem ser vad (RLS, som inloggad)");

  const t3 = await nyUppgift("Delad", A.id, A.id);
  const del = await nyUppgift("Ett steg", A.id, A.id, t3);
  await db.query(`insert into task_event (task_id, type, by_employee_id) values ($1, 'klar', $2)`, [del, A.id]);
  await db.query(`insert into task_member (task_id, employee_id, role, added_by) values ($1, $2, 'redigerare', $3)`, [t3, B.id, A.id]);

  const ser = async (vem, tabell, kolumn, id) => (await som(vem.auth_user_id, `select 1 from ${tabell} where ${kolumn} = $1`, [id])).length;

  await ok("B (med) ser uppgiften", async () => (await ser(B, "task", "id", t3)) === 1);
  await ok("B ser deluppgiften", async () => (await ser(B, "task", "id", del)) === 1);
  await ok("H16: B ser deluppgiftens händelser, alltså att steget är bockat", async () => (await ser(B, "task_event", "task_id", del)) === 2);
  await ok("B ser vilka som är med", async () => (await ser(B, "task_member", "task_id", t3)) === 1);

  await ok("D (utanför) ser inte uppgiften", async () => (await ser(D, "task", "id", t3)) === 0);
  await ok("D ser inte deluppgiften", async () => (await ser(D, "task", "id", del)) === 0);
  await ok("D ser inga händelser, varken uppgiftens eller stegets", async () => (await ser(D, "task_event", "task_id", t3)) + (await ser(D, "task_event", "task_id", del)) === 0);
  await ok("D ser inte vilka som är med", async () => (await ser(D, "task_member", "task_id", t3)) === 0);

  await db.query(`delete from task_member where task_id = $1 and employee_id = $2`, [t3, B.id]);
  await ok("B borttagen: ser inte uppgiften längre", async () => (await ser(B, "task", "id", t3)) === 0);
  await ok("B borttagen: ser inte steget eller dess händelser", async () => (await ser(B, "task", "id", del)) + (await ser(B, "task_event", "task_id", del)) === 0);

  // ---------------------------------------------------------------------------
  sektion("Ingen utomstående kör funktionerna som skriver");

  for (const f of ["uppgift_passa", "uppgift_handelse_villkorad"]) {
    await ok(`${f} går inte att köra som inloggad`, async () => {
      try {
        await som(D.auth_user_id, f === "uppgift_passa" ? `select public.uppgift_passa($1, $2, $2, true, null)` : `select public.uppgift_handelse_villkorad($1, 'klar', $2, null, array['klar'], array['klar'])`, [t3, D.id]);
        return false;
      } catch (e) {
        return e.code === "42501";
      }
    });
  }
} catch (e) {
  fel++;
  console.error(`\n\x1b[31mProvet avbröts: ${e.message}\x1b[0m`);
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom. Inget sparades.\x1b[0m" : `\n\x1b[31m${fel} prov föll. Inget sparades.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
