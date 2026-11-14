#!/usr/bin/env node
/**
 * Mötens rutt (POST /nav2/moten) som någon annan än den som får: en säljare som inte är med på mötet, och en
 * teamledare som avbokar efter mötets tid (hårdtestet 2026-11-14). Rutten körs på riktigt, men inloggningen och
 * databasen är attrapper: ingen riktig persons session behövs, och ingenting når produktionen.
 *
 * Varje handling ska ge 403 och INGEN skrivning: inget insert, update, delete, upsert och inget rpc-anrop. Attrappen
 * bokför varje anrop, så ett behörighetsfel som släpper igenom syns som en skrivning, inte bara som fel status.
 *
 *   node --experimental-strip-types tests/moten-rutt-behorighet.mjs
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
globalThis.__rutt = { user: null, db: null };
const stubb = (kod) => ({ url: "data:text/javascript," + encodeURIComponent(kod), shortCircuit: true });
registerHooks({
  resolve(spec, ctx, nasta) {
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (spec === "next/server") {
      return stubb(
        "export const NextResponse = { json: (d, i) => new Response(JSON.stringify(d), { status: i?.status ?? 200, headers: { 'content-type': 'application/json' } }) };" +
          "export const after = () => {};",
      );
    }
    if (spec === "next/cache") return stubb("export const revalidatePath = () => {}; export const revalidateTag = () => {}; export const unstable_cache = (f) => f;");
    if (spec === "next/headers") return stubb("export const cookies = async () => ({ get: () => undefined, getAll: () => [], set: () => {} }); export const headers = async () => new Headers();");
    if (spec === "@/lib/supabase/server") {
      return stubb("export const supabaseServer = async () => globalThis.__rutt.db; export const supabaseAdmin = () => globalThis.__rutt.db;");
    }
    if (spec === "@/lib/auth") {
      // Den riktiga modulen, med bara inloggningen utbytt (en lokal export går före `export *`).
      const aktaAuth = pathToFileURL(join(rot, "src", "lib", "auth.ts")).href;
      return stubb(`export * from ${JSON.stringify(aktaAuth)}; export const getCurrentUser = async () => globalThis.__rutt.user;`);
    }
    if (spec.startsWith("@/")) {
      const bas = join(rot, "src", spec.slice(2));
      const fil = [".ts", ".tsx", "/index.ts"].map((x) => bas + x).find((x) => existsSync(x)) ?? bas + ".ts";
      return { url: pathToFileURL(fil).href, shortCircuit: true };
    }
    // Relativa importer utan ändelse i .ts-filerna (`./pushvard`).
    if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const bas = fileURLToPath(new URL(spec, ctx.parentURL));
      const fil = [".ts", ".tsx", "/index.ts"].map((x) => bas + x).find((x) => existsSync(x));
      if (fil) return { url: pathToFileURL(fil).href, shortCircuit: true };
    }
    return nasta(spec, ctx);
  },
});

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const B = "b0000000-0000-4000-8000-000000000001"; // bokaren
const H = "b0000000-0000-4000-8000-000000000002"; // hållaren
const X = "b0000000-0000-4000-8000-000000000003"; // en annan säljare
const T = "b0000000-0000-4000-8000-000000000004"; // en teamledare som inte är med
const M = "c0000000-0000-4000-8000-000000000001";
const K = "d0000000-0000-4000-8000-000000000001";
const E = "e0000000-0000-4000-8000-000000000001";
const BO = "f0000000-0000-4000-8000-000000000001";

/** En attrapp av supabase-js: läsningar svarar ur `tabeller`, varje skrivning och rpc bokförs i `skrivningar`. */
function attrapp(tabeller) {
  const skrivningar = [];
  const SKRIV = new Set(["insert", "update", "delete", "upsert"]);
  const fraga = (tabell) => {
    let skriver = false;
    let en = false;
    const svaret = () => {
      if (skriver) return { data: null, error: null };
      const rader = tabeller[tabell] ?? [];
      return en ? { data: rader[0] ?? null, error: null } : { data: rader, error: null, count: rader.length };
    };
    const kedja = new Proxy(
      {},
      {
        get(_, namn) {
          if (namn === "then") return (a, b) => Promise.resolve(svaret()).then(a, b);
          if (SKRIV.has(namn)) {
            return () => {
              skriver = true;
              skrivningar.push({ text: `${String(namn)} ${tabell}`, filter: {} });
              return kedja;
            };
          }
          // Filtren på en skrivning bokförs, så att provet ser VEMS rad en villkorad skrivning kan träffa.
          if (namn === "eq" && skriver) {
            return (kol, varde) => {
              skrivningar[skrivningar.length - 1].filter[kol] = varde;
              return kedja;
            };
          }
          if (namn === "maybeSingle" || namn === "single") {
            return () => {
              en = true;
              return Promise.resolve(svaret());
            };
          }
          return () => kedja;
        },
      },
    );
    return kedja;
  };
  return {
    skrivningar,
    from: (t) => fraga(t),
    rpc: (namn) => {
      skrivningar.push({ text: `rpc ${namn}`, filter: {} });
      return Promise.resolve({ data: null, error: { message: "attrapp", code: "XX000" } });
    },
    storage: { from: () => ({ remove: async () => ({ error: null }), upload: async () => ({ error: null }) }) },
  };
}

const moteRad = (moteTid) => ({
  id: M, kedja_id: K, event_id: E, bokat_av: B, halls_av: H, mote_tid: moteTid, langd_min: 30, kalla: "Kalla samtal",
  mal: null, agenda: null, personer: [], nulage: null, bekraftat_nar: null, bekraftat_av: null, utfall: null,
  resultat: null, antal_flyttningar: 0, forsok: 0, senast_forsok: null, flyttad_nar: null, niva: null,
  provision_last_nar: null, foregaende_id: null, uppfoljning_datum: "2026-11-20",
});
const tabellerFor = (moteTid) => ({
  mote: [moteRad(moteTid)],
  mote_kedja: [{ id: K, bolag_id: BO, deltagare: [B, H], avslut: null, uppfoljning_andrad: null, inget_svar_i_rad: 0, version: 1, uppfoljning_datum: "2026-11-20" }],
  mote_bolag: [{ id: BO, namn: "PROV Bolag AB", kontakt: "Prov Person", telefon: "+46700000000", epost: null, doman: null }],
  calendar_attendee: [],
  nav_setting: [],
  employee: [],
  // Säljarens egen order, så att det är mötet och inte ordern som prövas i `kund`.
  sales_order: [{ id: O, salesperson_id: X, created_by: X }],
});

const { POST } = await import("../src/app/nav2/moten/route.ts");
const { NEJ_SKAL } = await import("../src/lib/nav2/motenforma.ts");
const O = "a0000000-0000-4000-8000-000000000001";

async function anropa(roller, id, kropp, moteTid) {
  const db = attrapp(tabellerFor(moteTid));
  globalThis.__rutt = {
    db,
    user: { employee: { id, first_name: "Prov", last_name: "Person" }, roles: roller },
  };
  const req = new Request("https://nav.test/nav2/moten", {
    method: "POST",
    headers: { origin: "https://nav.test", "content-type": "application/json" },
    body: JSON.stringify(kropp),
  });
  let status = 0;
  let text = "";
  try {
    const res = await POST(req);
    status = res.status;
    text = (await res.text()).slice(0, 140);
  } catch (e) {
    text = `kastade: ${e instanceof Error ? e.message : String(e)}`;
  }
  return { status, text, skrivningar: db.skrivningar, lista: db.skrivningar.map((x) => x.text).join(", ") };
}

const SENARE = new Date(Date.now() + 3 * 864e5).toISOString();
const TIDIGARE = new Date(Date.now() - 2 * 3600e3).toISOString();

// Varje handling med en kropp som klarar indatakontrollen, så att det är behörigheten som prövas och inte formatet.
const HANDLINGAR = [
  ["bekrafta", { mote: M }],
  ["angra", { mote: M, vad: "bekrafta", nar: new Date().toISOString() }],
  ["forsok", { mote: M }],
  ["flytta", { mote: M, dag: SENARE.slice(0, 10), start: "10:00" }],
  ["avboka", { mote: M }],
  ["utfall", { mote: M, utfall: "uteblev" }],
  ["bedom", { mote: M, svar: [] }, [["salesperson"], H]], // bara hållaren (eller en admin) bedömer
  ["ratta_utfall", { mote: M, utfall: "uteblev", skal: "Prov" }, [["admin"], "b0000000-0000-4000-8000-000000000005"]], // bara admin
  ["radera", { mote: M }],
  ["andra", { mote: M, fore: "2026-11-17 10:00", agenda: "Prov" }],
  ["kund", { kedja: K, order: O, mote: M }],
  ["nej", { kedja: K, skal: NEJ_SKAL[0] }],
  ["inget_svar", { kedja: K }],
  ["prova_igen", { kedja: K }],
  ["uppfoljning_andra", { kedja: K, datum: "2026-11-25" }],
];
// `paminn` hör inte till något möte (en påminnelse i den egnas kalender) och står därför inte här.

rubrik("En säljare som inte är med på mötet: 403 och ingen skrivning, för varje handling");
for (const [handling, kropp] of HANDLINGAR) {
  const r = await anropa(["salesperson"], X, { handling, ...kropp }, SENARE);
  ok(`${handling}: nekas`, r.status === 403 && r.skrivningar.length === 0, `${r.status} ${r.lista || "inga skrivningar"} ${r.status === 403 ? "" : r.text}`);
}

rubrik("Samma anrop som bokaren (eller den som får): förbi behörigheten (annars är provet grönt på fel grund)");
for (const [handling, kropp, vem] of HANDLINGAR) {
  const [roller, id] = vem ?? [["salesperson"], B];
  const r = await anropa(roller, id, { handling, ...kropp }, SENARE);
  ok(`${handling}: inte nekad`, r.status !== 403 && r.status !== 404 && r.status !== 0, `${r.status} ${r.text}`);
}
{
  // Ifrågasätt är villkorat i själva skrivningen: bara den egna provisionsraden (`employee_id` = den inloggade) kan
  // träffas. En främling träffar noll rader och får 403 efteråt.
  const r = await anropa(["salesperson"], X, { handling: "ifragasatt", mote: M }, SENARE);
  const egen = r.skrivningar.every((w) => w.text === "update mote_provision" && w.filter.employee_id === X && w.filter.mote_id === M);
  ok("ifragasatt: nekas, och skrivningen kan bara träffa den egna raden", r.status === 403 && egen, `${r.status} ${r.lista}`);
}

rubrik("Avboka efter mötets tid (hårdtestet 2026-11-14)");
{
  const efter = await anropa(["team_lead"], T, { handling: "avboka", mote: M }, TIDIGARE);
  ok("en teamledare som inte är med avbokar inte efter mötets tid", efter.status === 403 && efter.skrivningar.length === 0, `${efter.status} ${efter.lista}`);
  const fore = await anropa(["team_lead"], T, { handling: "avboka", mote: M }, SENARE);
  ok("före mötets tid kommer teamledaren förbi behörigheten", fore.status !== 403, `${fore.status} ${fore.text}`);
  const flytt = await anropa(["team_lead"], T, { handling: "flytta", mote: M, dag: SENARE.slice(0, 10), start: "10:00" }, TIDIGARE);
  ok("och flyttar det inte framåt för att sedan avboka det", flytt.status === 403 && flytt.skrivningar.length === 0, `${flytt.status} ${flytt.lista}`);
  const bokaren = await anropa(["salesperson"], B, { handling: "avboka", mote: M }, TIDIGARE);
  ok("bokaren kommer förbi behörigheten efter mötets tid", bokaren.status !== 403, `${bokaren.status} ${bokaren.text}`);
}

rubrik("Inställningarna: frågorna räknas som pengar");
{
  const r = await anropa(["team_lead"], T, { handling: "installningar", nyckel: "moten.fragor", varde: [] }, SENARE);
  ok("en teamledare ändrar inte frågorna", r.status === 403 && r.skrivningar.length === 0, `${r.status} ${r.lista}`);
  const s = await anropa(["salesperson"], X, { handling: "installningar", nyckel: "moten.bekrafta-dagar", varde: 2 }, SENARE);
  ok("en säljare ändrar inga inställningar", s.status === 403 && s.skrivningar.length === 0, `${s.status} ${s.lista}`);
}

rubrik("Utloggad och fel ursprung");
{
  globalThis.__rutt = { db: attrapp({}), user: null };
  const r = await POST(new Request("https://nav.test/nav2/moten", { method: "POST", headers: { origin: "https://nav.test" }, body: JSON.stringify({ handling: "avboka", mote: M }) }));
  ok("utloggad: 401", r.status === 401);
  globalThis.__rutt = { db: attrapp({}), user: { employee: { id: B }, roles: ["salesperson"] } };
  const u = await POST(new Request("https://nav.test/nav2/moten", { method: "POST", headers: { origin: "https://ond.test" }, body: JSON.stringify({ handling: "avboka", mote: M }) }));
  ok("fel ursprung: 403", u.status === 403);
}

console.log(fel ? `\n\x1b[31m${fel} ✗\x1b[0m` : "\n\x1b[32mAlla ✓\x1b[0m");
process.exit(fel ? 1 : 0);
