#!/usr/bin/env node
/**
 * Möten: hållarbytet i rutten (POST /nav2/moten), ordningen mellan skrivningarna (granskningen 2026-11-16).
 * Rutten körs på riktigt; inloggningen och databasen är attrapper. Attrappen förstår eq/neq/is/in på läsningar,
 * spelar in varje skrivning och rpc med sin data, och låter en skrivning eller en rpc svara som provet vill.
 * Ingenting når någon databas.
 *
 *   node --experimental-strip-types tests/moten-hallare-rutt.mjs
 *
 *   1. Byte före mötet: mötesraden först (villkorad på den gamla hållaren), sedan kalendern. Fallerar kalendern
 *      läggs raden tillbaka och inget loggas eller aviseras.
 *   2. Utfall med `holl` efter mötet: hållaren skrivs i SAMMA update som utfallet, villkorad på den gamla. Går
 *      utfallet inte att spara ändras inte hållaren och ingen notis om bytet går ut. Före mötet: Ändra.
 *   3. Ändra med ny hållare och en kollega som slutat: 400 innan något skrivs.
 *   4. Boka när `mote_foregaende` inte svarar: kortets senaste möte blir föregående (ombokning, inte ny).
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
      const aktaAuth = pathToFileURL(join(rot, "src", "lib", "auth.ts")).href;
      return stubb(`export * from ${JSON.stringify(aktaAuth)}; export const getCurrentUser = async () => globalThis.__rutt.user;`);
    }
    if (spec.startsWith("@/")) {
      const bas = join(rot, "src", spec.slice(2));
      const fil = [".ts", ".tsx", "/index.ts"].map((x) => bas + x).find((x) => existsSync(x)) ?? bas + ".ts";
      return { url: pathToFileURL(fil).href, shortCircuit: true };
    }
    if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const bas = fileURLToPath(new URL(spec, ctx.parentURL));
      const fil = [".ts", ".tsx", "/index.ts"].map((x) => bas + x).find((x) => existsSync(x));
      if (fil) return { url: pathToFileURL(fil).href, shortCircuit: true };
    }
    return nasta(spec, ctx);
  },
});

let fel = 0;
let antal = 0;
const ok = (namn, villkor, extra = "") => {
  antal++;
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const B = "b0000000-0000-4000-8000-000000000001"; // bokaren
const H = "b0000000-0000-4000-8000-000000000002"; // står som hållare
const X = "b0000000-0000-4000-8000-000000000003"; // kollega på mötet
const Y = "b0000000-0000-4000-8000-000000000006"; // har slutat
const M = "c0000000-0000-4000-8000-000000000001";
const K = "d0000000-0000-4000-8000-000000000001";
const E = "e0000000-0000-4000-8000-000000000001";
const BO = "f0000000-0000-4000-8000-000000000001";

/** supabase-js-attrapp: läsningar filtreras (eq, neq, is, in), skrivningar och rpc spelas in med sin data. */
function attrapp(tabeller, { skrivSvar = {}, rpcSvar = {} } = {}) {
  const logg = [];
  const fraga = (tabell) => {
    const st = { op: null, filter: [], en: false, select: false };
    const passar = (r) => st.filter.every(([typ, kol, v]) =>
      typ === "eq" ? String(r[kol]) === String(v) : typ === "neq" ? String(r[kol]) !== String(v) : typ === "is" ? (r[kol] ?? null) === v : typ === "in" ? v.map(String).includes(String(r[kol])) : true);
    const svaret = () => {
      if (st.op) {
        const s = skrivSvar[`${st.op} ${tabell}`];
        const v = typeof s === "function" ? s(logg.at(-1), logg) : s;
        if (v) return v;
        return { data: st.select ? [{ id: "rad" }] : null, error: null };
      }
      const rader = (tabeller[tabell] ?? []).filter(passar);
      return st.en ? { data: rader[0] ?? null, error: null } : { data: rader, error: null, count: rader.length };
    };
    const k = new Proxy({}, {
      get(_, namn) {
        if (namn === "then") return (a, b) => Promise.resolve(svaret()).then(a, b);
        if (["insert", "update", "delete", "upsert"].includes(namn)) return (data) => { st.op = namn; logg.push({ op: namn, tabell, data, filter: st.filter }); return k; };
        if (["eq", "neq", "is", "in"].includes(namn)) return (kol, v) => { st.filter.push([namn, kol, v]); return k; };
        if (namn === "select") return () => { if (st.op) st.select = true; return k; };
        if (namn === "maybeSingle" || namn === "single") return () => { st.en = true; return Promise.resolve(svaret()); };
        return () => k;
      },
    });
    return k;
  };
  return {
    logg,
    from: (t) => fraga(t),
    rpc: (namn, args) => {
      logg.push({ op: "rpc", tabell: namn, data: args, filter: [] });
      const s = rpcSvar[namn];
      const v = typeof s === "function" ? s(args, logg) : s;
      return Promise.resolve(v ?? { data: null, error: { message: "attrapp", code: "XX000" } });
    },
    storage: { from: () => ({ remove: async () => ({ error: null }), upload: async () => ({ error: null }) }) },
  };
}

const person = (id, fornamn, status = "active") => ({ id, first_name: fornamn, last_name: "Prov", status, email: `${fornamn}@prov.test`, employee_role: [{ role: "salesperson" }] });
const tabellerFor = (moteTid, o = {}) => ({
  mote: [{ id: M, kedja_id: K, event_id: E, bokat_av: B, halls_av: H, bokat_nar: "2026-11-01T09:00:00.000Z", mote_tid: moteTid, langd_min: 30, kalla: "Kallsamtal", mal: null, agenda: null, personer: [], nulage: null,
    bekraftat_nar: null, bekraftat_av: null, utfall: null, resultat: null, antal_flyttningar: 0, forsok: 0, senast_forsok: null, flyttad_nar: null, niva: null, provision_last_nar: null, foregaende_id: null, art: "ny", ...(o.mote ?? {}) }],
  mote_kedja: [{ id: K, bolag_id: BO, deltagare: [B, H, X], avslut: null, uppfoljning_andrad: null, inget_svar_i_rad: 0, version: 1, uppfoljning_datum: null }],
  mote_bolag: [{ id: BO, namn: "PROV Bolag AB", kontakt: "Prov Person", telefon: "+46700000000", epost: null, doman: null }],
  calendar_event: [{ id: E, dag: moteTid.slice(0, 10), tid: "10:00:00", minuter: 30, title: "PROV Bolag AB: Möte", plats: "Telefon", online_url: null, agenda_md: "", cancelled_at: null }],
  calendar_attendee: [{ event_id: E, employee_id: X, external_email: null, optional: false }],
  nav_setting: [],
  employee: [person(B, "Bo"), person(H, "Hanna"), person(X, "Xena"), person(Y, "Yngve", "offboarded")],
});

const { POST } = await import("../src/app/nav2/moten/route.ts");
const { lokal } = await import("../src/lib/nav2/leads.ts");

async function anropa(roller, id, kropp, tabeller, svar = {}) {
  const db = attrapp(tabeller, svar);
  globalThis.__rutt = { db, user: { employee: { id, first_name: "Prov", last_name: "Person" }, roles: roller } };
  const req = new Request("https://nav.test/nav2/moten", { method: "POST", headers: { origin: "https://nav.test", "content-type": "application/json" }, body: JSON.stringify(kropp) });
  let status = 0;
  let json = {};
  try {
    const res = await POST(req);
    status = res.status;
    json = await res.json().catch(() => ({}));
  } catch (e) {
    json = { kastade: e instanceof Error ? e.message : String(e) };
  }
  return { status, json, logg: db.logg };
}
const skrivningar = (logg) => logg.filter((x) => x.op !== "rpc" || !["mote_kunden_traffad", "mote_foregaende"].includes(x.tabell));
const harFilter = (rad, kol, v) => rad.filter.some(([typ, k, x]) => typ === "eq" && k === kol && String(x) === String(v));
const notiserOmBytet = (logg) => logg.filter((x) => x.op === "insert" && x.tabell === "notification_event" && /mote-hallare/.test(JSON.stringify(x.data)));
const handelseOmBytet = (logg) => logg.filter((x) => x.op === "insert" && /hallare_bytt/.test(JSON.stringify(x.data)));

const SENARE = new Date(Date.now() + 3 * 864e5).toISOString();
const TIDIGARE = new Date(Date.now() - 2 * 3600e3).toISOString();

rubrik("1. Byte före mötet: raden först, sedan kalendern");
{
  const r = await anropa(["salesperson"], B, { handling: "hallare", mote: M, ny: X }, tabellerFor(SENARE), { rpcSvar: { lk_byt_organisator: { data: { ok: true }, error: null } } });
  const iRad = r.logg.findIndex((x) => x.op === "update" && x.tabell === "mote" && x.data?.halls_av === X);
  const iKal = r.logg.findIndex((x) => x.op === "rpc" && x.tabell === "lk_byt_organisator");
  ok("bytet går igenom", r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  ok("mötesraden skrivs före kalendern, villkorad på den gamla hållaren", iRad >= 0 && iKal > iRad && harFilter(r.logg[iRad], "halls_av", H), `rad ${iRad}, kalender ${iKal}`);
  ok("kalendern anropas som den gamla hållaren med den nya", iKal >= 0 && r.logg[iKal].data.p_aktor === H && r.logg[iKal].data.p_ny === X);
}
{
  const r = await anropa(["salesperson"], B, { handling: "hallare", mote: M, ny: X }, tabellerFor(SENARE));
  const tillbaka = r.logg.find((x) => x.op === "update" && x.tabell === "mote" && x.data?.halls_av === H);
  ok("kalendern säger nej: 409", r.status === 409, `${r.status} ${JSON.stringify(r.json)}`);
  ok("raden läggs tillbaka, villkorad på den nya", !!tillbaka && harFilter(tillbaka, "halls_av", X));
  ok("ingen notis och ingen händelse om ett byte som inte blev av", notiserOmBytet(r.logg).length === 0 && handelseOmBytet(r.logg).length === 0);
}
{
  const r = await anropa(["salesperson"], B, { handling: "hallare", mote: M, ny: X }, tabellerFor(SENARE), { skrivSvar: { "update mote": { data: [], error: null } } });
  ok("någon hann före (raden uppdaterades inte): 409 och kalendern rörs inte", r.status === 409 && !r.logg.some((x) => x.op === "rpc" && x.tabell === "lk_byt_organisator"), `${r.status}`);
}

rubrik("2. Utfall med vem som höll mötet: hållaren i samma skrivning som utfallet");
const utfallKropp = { handling: "utfall", mote: M, utfall: "hallet", resultat: "offert", datum: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), holl: X };
{
  const r = await anropa(["salesperson"], X, utfallKropp, tabellerFor(TIDIGARE));
  const forsta = r.logg.find((x) => x.op === "update" && x.tabell === "mote");
  ok("utfallet sparas", r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  ok("första skrivningen på mötet är utfallet med den nya hållaren, villkorad på den gamla", !!forsta && forsta.data.halls_av === X && forsta.data.utfall === "hallet" && harFilter(forsta, "halls_av", H), JSON.stringify(forsta));
  ok("ingen kalender efter mötet", !r.logg.some((x) => x.op === "rpc" && x.tabell === "lk_byt_organisator"));
}
{
  const r = await anropa(["salesperson"], X, utfallKropp, tabellerFor(TIDIGARE), { skrivSvar: { "update mote": { data: [], error: null } } });
  ok("utfallet går inte att spara: 409", r.status === 409, `${r.status}`);
  ok("och ingen notis eller händelse om ett hållarbyte", notiserOmBytet(r.logg).length === 0 && handelseOmBytet(r.logg).length === 0);
  ok("och ingen separat skrivning av hållaren", !r.logg.some((x) => x.op === "update" && x.tabell === "mote" && x.data?.halls_av === X && !("utfall" in x.data)));
}
{
  const r = await anropa(["salesperson"], X, utfallKropp, tabellerFor(SENARE));
  ok("före mötets tid byts hållaren i Ändra, inte i utfallet", r.status === 409 && /Ändra/.test(r.json.fel ?? "") && !r.logg.some((x) => x.op === "update" && x.tabell === "mote"), `${r.status} ${JSON.stringify(r.json)}`);
}

rubrik("3. Ändra prövar resten innan hållaren byts");
{
  const r = await anropa(["salesperson"], B, { handling: "andra", mote: M, fore: lokal(SENARE), hallsAv: X, med: [Y] }, tabellerFor(SENARE), { rpcSvar: { lk_byt_organisator: { data: { ok: true }, error: null } } });
  ok("en kollega som slutat: 400", r.status === 400, `${r.status} ${JSON.stringify(r.json)}`);
  ok("och ingenting skrevs (ingen hållare, ingen kalender)", skrivningar(r.logg).filter((x) => x.op !== "select").length === 0, r.logg.map((x) => `${x.op} ${x.tabell}`).join(", "));
}

rubrik("4. Boka när mote_foregaende inte svarar");
{
  const dag = (() => { let d = new Date(Date.now() + 2 * 864e5); while ([0, 6].includes(d.getUTCDay())) d = new Date(d.getTime() + 864e5); return d.toISOString().slice(0, 10); })();
  const tab = tabellerFor(TIDIGARE, { mote: { utfall: "uteblev" } });
  const r = await anropa(["salesperson"], B, { handling: "boka", kedja: K, namn: "PROV Bolag AB", kontakt: "Prov Person", telefon: "+46700000000", kalla: "Kallsamtal", hallsAv: H, dag, start: "10:00", langd: 30, platsTyp: "telefon" }, tab,
    { rpcSvar: { mote_kunden_traffad: { data: false, error: null } } });
  const ins = r.logg.find((x) => x.op === "insert" && x.tabell === "mote");
  ok("mötesraden läggs in", !!ins, `${r.status} ${JSON.stringify(r.json)}`);
  ok("kortets senaste möte blir föregående: ombokning, inte ny", !!ins && ins.data.art === "ombokning" && ins.data.foregaende_id === M, JSON.stringify(ins?.data));
}

console.log(fel === 0 ? `\n\x1b[32mAlla ${antal} prov gick igenom.\x1b[0m` : `\n\x1b[31m${fel} av ${antal} prov föll.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
