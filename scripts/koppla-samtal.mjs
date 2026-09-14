#!/usr/bin/env node
/**
 * Raknar om kopplingen mellan samtal och affar for HELA databasen.
 *
 *   node --experimental-strip-types scripts/koppla-samtal.mjs --torrkor
 *   node --experimental-strip-types scripts/koppla-samtal.mjs
 *
 * ===========================================================================
 * SAMMA REGEL SOM NAVET, INTE EN KOPIA AV DEN
 *
 * Skriptet importerar `parIhop()` ur `src/lib/samtal-order.ts` — samma funktion
 * som `svepKoppling()` i navet anvander. Skillnaden ar bara vagen till
 * databasen: navet gar via Supabase-klienten, skriptet via pg.
 *
 * Att skriva om regeln har hade varit det vanliga sattet att fa tva svar pa
 * samma fraga. Bakfyllningen hade da kopplat ett samtal ena vagen och natten
 * andra vagen, och skillnaden hade bara synts som att ett samtal byter affar
 * ibland.
 *
 * KOR DET EFTER att order lagts in bakvagen, eller nar reglerna i
 * `samtal-order.ts` andrats. I vardagen behovs det inte: mottagningen kopplar
 * varje nytt samtal, och nattjobbet sveper.
 *
 * ===========================================================================
 * TRE SAKER FOLJS AT, OCH DET AR HELA SVARIGHETEN
 *
 * Se `svepKoppling()` for resonemanget. Kort: kopplingen, gallringsfristen och
 * filens `sales_order_id` maste andras i samma andetag. Villkoret
 * `phone_call_gallring` i 0056 avvisar raden om fristen star kvar nar ordern
 * satts — vilket ar meningen: det ar sa databasen sager ifran nar koden glomt
 * halva jobbet.
 */
import pg from "pg";
import { parIhop, gallringsfrist } from "../src/lib/samtal-order.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL saknas.");
  process.exit(1);
}

const torrkor = process.argv.includes("--torrkor");

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await db.connect();

const ordrar = (
  await db.query(
    `select id, contact_phone_e164, created_at from sales_order
      where contact_phone_e164 is not null`,
  )
).rows.map((o) => ({
  id: o.id,
  contactPhoneE164: o.contact_phone_e164,
  createdAt: o.created_at.toISOString(),
}));

const raa = (
  await db.query(
    `select id, counterpart_e164, started_at, sales_order_id, order_linked_by, recording_file_id
       from phone_call where counterpart_e164 is not null`,
  )
).rows;

const samtal = raa.map((s) => ({
  id: s.id,
  counterpartE164: s.counterpart_e164,
  startedAt: s.started_at ? s.started_at.toISOString() : null,
  salesOrderId: s.sales_order_id,
  orderLinkedBy: s.order_linked_by,
}));

const harFil = new Map(raa.map((s) => [s.id, s.recording_file_id]));

const andringar = parIhop(samtal, ordrar);

console.log(
  `${samtal.length} samtal, ${ordrar.length} order med tolkbart nummer.\n` +
    `${andringar.length} andring(ar) att skriva.${torrkor ? "  TORRKORNING." : ""}\n`,
);

let kopplade = 0;
let upplosta = 0;

for (const a of andringar) {
  const fil = harFil.get(a.samtalId);
  console.log(`  ${a.samtalId}  ->  ${a.orderId ?? "(loses upp)"}`);
  if (torrkor) {
    if (a.orderId) kopplade++;
    else upplosta++;
    continue;
  }

  if (a.orderId) {
    await db.query(
      `update phone_call
          set sales_order_id = $2, order_linked_at = now(), recording_retained_until = null
        where id = $1`,
      [a.samtalId, a.orderId],
    );
    kopplade++;
  } else {
    await db.query(
      `update phone_call
          set sales_order_id = null, order_linked_at = null, recording_retained_until = $2
        where id = $1`,
      [a.samtalId, fil ? gallringsfrist() : null],
    );
    upplosta++;
  }

  if (fil) {
    await db.query("update file_object set sales_order_id = $2 where id = $1", [fil, a.orderId]);
  }
}

console.log(`\n${kopplade} kopplade, ${upplosta} upplosta.`);

// Sjalvkontroll efterat. Villkoren i databasen skulle redan ha avvisat en
// felaktig rad — men en tyst noll ar ett samre besked an en rad som sager att
// kontrollen faktiskt gjordes.
const kvar = await db.query(
  `select count(*)::int n from phone_call
    where sales_order_id is not null and recording_retained_until is not null`,
);
console.log(
  kvar.rows[0].n === 0
    ? "Inget ordersamtal bar en gallringsfrist."
    : `VARNING: ${kvar.rows[0].n} ordersamtal bar en gallringsfrist.`,
);

await db.end();
