#!/usr/bin/env node
/**
 * Tolkar om `call_ingest` till `phone_call`.
 *
 *   node --experimental-strip-types scripts/tolka-om-samtal.mjs            -> alla
 *   node --experimental-strip-types scripts/tolka-om-samtal.mjs --otolkade -> bara de som foll
 *   node --experimental-strip-types scripts/tolka-om-samtal.mjs --torrkor  -> visar utan att skriva
 *
 * ===========================================================================
 * VARFOR SKRIPTET FINNS
 *
 * 0052 delade mottagningen i tva: `call_ingest` ar radlogg och andras aldrig,
 * `phone_call` ar tolkningen av den. Loftet var att en felaktig tolkning gar
 * att GORA OM utan att en uppgift gatt forlorad. Det loftet ar varderlost utan
 * nagot som faktiskt gor om den — och forsta gangen det behovdes var dagen
 * efter att webhooken slogs pa:
 *
 * Lynes skickade `direction: "OUTGOING_CALL"`, `recorderId`, `callerNumber`,
 * `calleeNumber`, `talkTime` i millisekunder och `fileUrls` som en array.
 * Tolken letade efter `outbound`, `userEmail`, `to`, `duration` och
 * `recordingUrl`. Sexton samtal skrevs med noll fel och fel varde i nastan
 * varje kolumn. Rapasarna lag kvar, och det har skriptet gjorde om dem.
 *
 * KOR DET EFTER VARJE ANDRING I `src/lib/samtal.ts`. En rattad tolk rattar
 * inget som redan star i tabellen.
 *
 * ===========================================================================
 * VARFOR DET SKRIVER OVER OCH INTE LAGGER TILL
 *
 * Sommen `(source, external_ref)` ar densamma vid en omtolkning, sa raden
 * uppdateras. Det ar meningen: `phone_call` ar en harledning och inte en
 * handelse. Vill man veta vad som faktiskt kom in star det i `call_ingest`.
 *
 * TVA KOLUMNER SKRIVS DOCK ALDRIG OVER, for de ar inte harledda ur pasen:
 * `recording_file_id` / `recording_state = 'hamtad'` (nagon har hamtat hem
 * ljudet) och `sales_order_id` (nagon har parat ihop samtalet med en affar).
 * En omtolkning far inte kasta bort det arbetet.
 */
import pg from "pg";
import { inspelningslage, tolkaSamtal } from "../src/lib/samtal.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL saknas.");
  process.exit(1);
}

const argv = process.argv.slice(2);
const torrkor = argv.includes("--torrkor");
const baraOtolkade = argv.includes("--otolkade");

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

/** Samma former som `identitetsformer()` i src/lib/samtal-server.ts. */
function identitetsformer(agentRef) {
  const v = agentRef.trim();
  const former = [{ kind: "lynes_user", value: v }];
  if (v.includes("@")) former.push({ kind: "epost", value: v.toLowerCase() });
  const siffror = v.replace(/[\s\-+()]/g, "");
  if (/^\d+$/.test(siffror)) {
    former.push(siffror.length <= 6 ? { kind: "anknytning", value: siffror } : { kind: "msisdn", value: siffror });
  }
  return former;
}

async function slaUppPerson(agentRef, agentUserId) {
  const forsok = [
    ...(agentRef ? identitetsformer(agentRef) : []),
    ...(agentUserId ? [{ kind: "lynes_user", value: agentUserId }] : []),
  ];

  for (const form of forsok) {
    const r = await db.query("select employee_id from phone_identity where kind = $1 and value = $2", [
      form.kind,
      form.value,
    ]);
    if (r.rows[0]) {
      // Bron bokfors aven nar personen redan ar kand — se samtal-server.ts.
      await bokforBron(r.rows[0].employee_id, agentUserId);
      return r.rows[0].employee_id;
    }
  }

  if (!agentRef?.includes("@")) return null;

  const p = await db.query("select id from employee where email = $1", [agentRef.trim().toLowerCase()]);
  if (!p.rows[0]) return null;

  if (!torrkor) {
    await db.query(
      "insert into phone_identity (employee_id, kind, value) values ($1, 'epost', $2) on conflict do nothing",
      [p.rows[0].id, agentRef.trim().toLowerCase()],
    );
  }
  await bokforBron(p.rows[0].id, agentUserId);
  return p.rows[0].id;
}

/** Raden som binder ihop de tva floden. Se slaUppPerson() i samtal-server.ts. */
async function bokforBron(employeeId, agentUserId) {
  if (!agentUserId || torrkor) return;
  await db.query(
    "insert into phone_identity (employee_id, kind, value) values ($1, 'lynes_user', $2) on conflict do nothing",
    [employeeId, agentUserId],
  );
}

const villkor = baraOtolkade ? "where normalized_at is null" : "";
const rader = await db.query(
  `select id, payload, fingerprint from call_ingest ${villkor} order by id`,
);

console.log(`${rader.rowCount} rad(er) att tolka.${torrkor ? "  TORRKORNING." : ""}\n`);

let skrivna = 0;
let fel = 0;

for (const rad of rader.rows) {
  try {
    const t = tolkaSamtal(rad.payload);
    const externalRef = t.externalRef ?? `avtryck:${rad.fingerprint.slice(0, 32)}`;
    const employeeId = await slaUppPerson(t.agentRef, t.agentUserId);

    const befintlig = await db.query(
      "select recording_state, sales_order_id from phone_call where source = 'lynes' and external_ref = $1",
      [externalRef],
    );
    const hamtad = befintlig.rows[0]?.recording_state === "hamtad";
    const lage = hamtad ? "hamtad" : inspelningslage(t);

    console.log(
      `  #${rad.id}  ${externalRef.padEnd(26)} ${t.direction.padEnd(5)} ` +
        `${String(t.durationSeconds ?? "-").padStart(5)}s  tal ${String(t.talkSeconds ?? "-").padStart(5)}s  ` +
        `${(t.counterpartE164 ?? "-").padEnd(14)} ${employeeId ? "kopplad" : "okopplad"}  ${lage}`,
    );

    if (torrkor) continue;

    await db.query(
      `insert into phone_call (
         ingest_id, source, external_ref, direction, outcome, raw_call_type, raw_item_type,
         agent_ref, employee_id, counterpart_e164, counterpart_raw,
         started_at, ended_at, duration_seconds, talk_seconds, recording_url, recording_state)
       values ($1,'lynes',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (source, external_ref) do update set
         ingest_id = excluded.ingest_id,
         direction = excluded.direction,
         outcome = excluded.outcome,
         raw_call_type = excluded.raw_call_type,
         raw_item_type = excluded.raw_item_type,
         agent_ref = excluded.agent_ref,
         employee_id = excluded.employee_id,
         counterpart_e164 = excluded.counterpart_e164,
         counterpart_raw = excluded.counterpart_raw,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         duration_seconds = excluded.duration_seconds,
         talk_seconds = excluded.talk_seconds,
         recording_url = excluded.recording_url,
         recording_state = excluded.recording_state`,
      [
        rad.id, externalRef, t.direction, t.outcome, t.rawCallType, t.rawItemType,
        t.agentRef, employeeId, t.counterpartE164, t.counterpartRaw,
        t.startedAt, t.endedAt, t.durationSeconds, t.talkSeconds, t.recordingUrl, lage,
      ],
    );

    await db.query("update call_ingest set normalized_at = now(), normalize_error = null where id = $1", [rad.id]);
    skrivna++;
  } catch (e) {
    fel++;
    console.log(`  #${rad.id}  MISSLYCKADES: ${e.message}`);
    if (!torrkor) {
      await db.query("update call_ingest set normalize_error = $2 where id = $1", [rad.id, String(e.message).slice(0, 1000)]);
    }
  }
}

console.log(`\n${skrivna} skriven/skrivna, ${fel} fel.`);
await db.end();
process.exit(fel === 0 ? 0 : 1);
