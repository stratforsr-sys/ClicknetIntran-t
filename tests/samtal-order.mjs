#!/usr/bin/env node
/**
 * Kopplingen mellan samtal och affar.
 *
 *   node --experimental-strip-types tests/samtal-order.mjs
 *
 * ===========================================================================
 * TVA PROV I ETT, OCH DET ANDRA AR DET SOM INTE GAR ATT VARA UTAN
 *
 * Forsta halvan provar REGELN: vilken order ett samtal hamnar pa. Ren logik,
 * ingen databas.
 *
 * Andra halvan provar att `normalisera_nummer()` I DATABASEN svarar likadant
 * som `normaliseraNummer()` i TypeScript. Den kraver DATABASE_URL och hoppas
 * over utan.
 *
 * Varfor den andra halvan finns: 0056 la numret som en GENERERAD kolumn pa
 * `sales_order`, sa normaliseringen finns nu pa tva stallen. Det ar ett
 * medvetet pris — en genererad kolumn kan inte bli inaktuell, vilket en kolumn
 * koden fyller i kan — men priset ar bara forsvarbart sa lange de tva gar att
 * jamfora. Glider de isar blir foljden att en order slutar hitta sina samtal
 * utan att nagot ser fel ut: ett tomt avsnitt pa ordersidan ser precis ut som
 * en kund ingen ringt.
 */
import { parIhop, valjOrder, gallringsfrist, GALLRINGSFRIST_DYGN } from "../src/lib/samtal-order.ts";
import { normaliseraNummer } from "../src/lib/samtal.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};

const samtal = (id, nummer, tid, extra = {}) => ({
  id,
  counterpartE164: nummer,
  startedAt: tid,
  salesOrderId: null,
  orderLinkedBy: null,
  ...extra,
});
const order = (id, nummer, skapad) => ({ id, contactPhoneE164: nummer, createdAt: skapad });

const KUND = "+46701234567";
const ANNAN = "+46709999999";

console.log("\n\x1b[1mSamtalet hittar sin affar\x1b[0m");
{
  const o = [order("O1", KUND, "2026-09-10T12:00:00Z")];

  ok("samma nummer ger kopplingen",
    valjOrder(samtal("S1", KUND, "2026-09-09T10:00:00Z"), o) === "O1");
  ok("annat nummer ger ingen koppling",
    valjOrder(samtal("S2", ANNAN, "2026-09-09T10:00:00Z"), o) === null);
  ok("utan nummer ger ingen koppling",
    valjOrder(samtal("S3", null, "2026-09-09T10:00:00Z"), o) === null);
  ok("ingen order alls ger null",
    valjOrder(samtal("S4", KUND, "2026-09-09T10:00:00Z"), []) === null);
}

console.log("\n\x1b[1mINGEN UNDRE TIDSGRANS — bestallarens uttryckliga krav\x1b[0m");
{
  const o = [order("O1", KUND, "2026-09-10T12:00:00Z")];

  ok("ett samtal en vecka fore hittas",
    valjOrder(samtal("S", KUND, "2026-09-03T10:00:00Z"), o) === "O1");
  ok("ett samtal ett halvar fore hittas ocksa",
    valjOrder(samtal("S", KUND, "2026-03-01T10:00:00Z"), o) === "O1",
    "det forsta samtalet ar ofta det intressantaste");
  ok("ett samtal tva ar fore hittas ocksa",
    valjOrder(samtal("S", KUND, "2024-09-10T10:00:00Z"), o) === "O1");
}

console.log("\n\x1b[1mFLERA SAMTAL PA SAMMA AFFAR ar normalfallet\x1b[0m");
{
  const o = [order("O1", KUND, "2026-09-10T12:00:00Z")];
  const s = [
    samtal("S1", KUND, "2026-08-01T10:00:00Z"),
    samtal("S2", KUND, "2026-09-01T10:00:00Z"),
    samtal("S3", KUND, "2026-09-09T10:00:00Z"),
    samtal("S4", KUND, "2026-09-10T11:00:00Z"),
  ];
  const k = parIhop(s, o);
  ok("alla fyra kopplas till samma affar",
    k.length === 4 && k.every((x) => x.orderId === "O1"),
    `fick ${k.length} kopplingar`);
}

console.log("\n\x1b[1mSAMMA NUMMER, TVA AFFARER — den svara delningen\x1b[0m");
{
  const o = [
    order("O1", KUND, "2026-06-01T12:00:00Z"),
    order("O2", KUND, "2026-09-10T12:00:00Z"),
  ];

  ok("fore forsta affaren -> forsta affaren",
    valjOrder(samtal("S", KUND, "2026-05-20T10:00:00Z"), o) === "O1");
  ok("mellan affarerna -> ANDRA affaren",
    valjOrder(samtal("S", KUND, "2026-07-01T10:00:00Z"), o) === "O2",
    "det ar de samtalen som ledde dit");
  ok("efter sista affaren -> sista affaren",
    valjOrder(samtal("S", KUND, "2026-10-01T10:00:00Z"), o) === "O2",
    "uppfoljning");
  ok("exakt pa orderns tidpunkt -> den ordern",
    valjOrder(samtal("S", KUND, "2026-06-01T12:00:00Z"), o) === "O1");

  // Ordningen i listan far inte spela roll. Kommer ordrarna i en annan ordning
  // ur databasen ska svaret bli detsamma.
  const bakvant = [...o].reverse();
  ok("ordningen i listan spelar ingen roll",
    valjOrder(samtal("S", KUND, "2026-07-01T10:00:00Z"), bakvant) === "O2");
}

console.log("\n\x1b[1mEtt samtal utan tidpunkt forsvinner inte\x1b[0m");
{
  const o = [
    order("O1", KUND, "2026-06-01T12:00:00Z"),
    order("O2", KUND, "2026-09-10T12:00:00Z"),
  ];
  const vald = valjOrder(samtal("S", KUND, null), o);
  ok("det hamnar pa den aldsta affaren", vald === "O1");
  ok("men det hamnar NAGONSTANS", vald !== null,
    "ett samtal som inte gar att placera ska anda synas pa en affar");
}

console.log("\n\x1b[1mEn manniskas beslut skrivs aldrig over\x1b[0m");
{
  const o = [order("O1", KUND, "2026-09-10T12:00:00Z")];
  const s = [
    // Nagon har flyttat samtalet till en annan affar for hand.
    samtal("S1", KUND, "2026-09-09T10:00:00Z", { salesOrderId: "O9", orderLinkedBy: "chef-id" }),
  ];
  ok("svepningen ror inte raden", parIhop(s, o).length === 0,
    "order_linked_by satt = nagon bestamde");

  const utan = [samtal("S2", KUND, "2026-09-09T10:00:00Z", { salesOrderId: "O9" })];
  ok("men en gissning skrivs om", parIhop(utan, o)[0]?.orderId === "O1");
}

console.log("\n\x1b[1mSvepningen skriver bara det som skiljer sig\x1b[0m");
{
  const o = [order("O1", KUND, "2026-09-10T12:00:00Z")];
  const redanRatt = [samtal("S1", KUND, "2026-09-09T10:00:00Z", { salesOrderId: "O1" })];
  ok("en rad som redan star ratt rors inte", parIhop(redanRatt, o).length === 0,
    "annars blir updated_at vardelos");

  const borttappad = [samtal("S2", ANNAN, "2026-09-09T10:00:00Z", { salesOrderId: "O1" })];
  const k = parIhop(borttappad, o);
  ok("en koppling som inte langre stammer loses upp",
    k.length === 1 && k[0].orderId === null,
    "numret pa ordern kan ha rattats");
}

console.log("\n\x1b[1mINGA SAMTAL FORSVINNER\x1b[0m");
{
  // Kravet formulerat som ett prov: varje samtal som gar in ska antingen fa en
  // koppling eller uttryckligen fa null. Inget far tappas pa vagen.
  const o = [order("O1", KUND, "2026-09-10T12:00:00Z")];
  const s = [
    samtal("S1", KUND, "2026-09-09T10:00:00Z"),
    samtal("S2", ANNAN, "2026-09-09T10:00:00Z"),
    samtal("S3", null, "2026-09-09T10:00:00Z"),
    samtal("S4", KUND, null),
  ];
  const k = parIhop(s, o);
  const rorda = new Set(k.map((x) => x.samtalId));

  // S2 och S3 ska inte fa nagon andring alls (de star redan pa null), men de
  // ska inte heller ha kastats bort — de syns i listan over okopplade.
  ok("S1 kopplas", k.find((x) => x.samtalId === "S1")?.orderId === "O1");
  ok("S4 kopplas trots saknad tidpunkt", k.find((x) => x.samtalId === "S4")?.orderId === "O1");
  ok("S2 och S3 lamnas orörda utan att kastas", !rorda.has("S2") && !rorda.has("S3"),
    "de star redan pa null och ska inte skrivas i onodan");
  ok("ingen koppling pekar pa ett samtal som inte skickades in",
    k.every((x) => s.some((y) => y.id === x.samtalId)));
}

console.log("\n\x1b[1mGallringsfristen\x1b[0m");
{
  const nu = new Date("2026-09-11T12:00:00Z");
  const frist = new Date(gallringsfrist(nu));
  const dygn = Math.round((frist.getTime() - nu.getTime()) / 86400000);
  ok(`fristen ar ${GALLRINGSFRIST_DYGN} dygn`, dygn === GALLRINGSFRIST_DYGN, `fick ${dygn}`);
  ok("fristen ar en ISO-strang", /^\d{4}-\d{2}-\d{2}T/.test(gallringsfrist(nu)));
}

/* ------------------------------------------------------------------------- *
 * Andra halvan: SQL mot TypeScript
 * ------------------------------------------------------------------------- */

const NUMMER = [
  "070-123 45 67",
  "+46701234567",
  "0046701234567",
  "(08) 123 456 78",
  "46701234567",
  "08 123 456 78",
  "0701234567",
  "+46 70 123 45 67",
  "070.123.45.67",
  "1042",
  "12345",
  "anonymous",
  "",
  "   ",
  "+4670123456789012",
  "0700000000",
  "00460812345678",
  "070-123 45 67 (Anna)",
  "abc",
  "+",
  "0",
  "00",
];

if (!process.env.DATABASE_URL) {
  console.log("\n\x1b[33mDATABASE_URL saknas — hoppar over jamforelsen mot databasen.\x1b[0m");
  console.log("  Den ar inte valfri i en riktig korning: utan den kan SQL och TS glida isar.");
} else {
  const { default: pg } = await import("pg");
  const db = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();

  console.log("\n\x1b[1mnormalisera_nummer() i SQL svarar som normaliseraNummer() i TS\x1b[0m");

  for (const n of NUMMER) {
    const { rows } = await db.query("select public.normalisera_nummer($1) as svar", [n]);
    const sql = rows[0].svar;
    const ts = normaliseraNummer(n);
    ok(`${JSON.stringify(n)} -> ${JSON.stringify(ts)}`, sql === ts,
      sql === ts ? "" : `SQL sa ${JSON.stringify(sql)}`);
  }

  // Och den genererade kolumnen ska faktiskt anvanda funktionen.
  const { rows: kol } = await db.query(
    `select is_generated, generation_expression from information_schema.columns
      where table_name = 'sales_order' and column_name = 'contact_phone_e164'`,
  );
  ok("kolumnen ar genererad", kol[0]?.is_generated === "ALWAYS",
    "en vanlig kolumn gar att fylla i for hand och kan bli inaktuell");
  ok("den anvander normalisera_nummer",
    String(kol[0]?.generation_expression ?? "").includes("normalisera_nummer"));

  await db.end();
}

console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom\x1b[0m\n" : `\n\x1b[31m${fel} prov foll\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
