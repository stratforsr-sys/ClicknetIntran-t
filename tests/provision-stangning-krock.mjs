#!/usr/bin/env node
/**
 * Fastställandet av en provisionsmånad (`faststallPeriod`) i två lägen som bara syns när något gått snett:
 *
 *  1. KROCKEN (23505). Ett tidigare försök hann bokföra några av posterna. Insättningen är en sats, så när en rad
 *     kolliderar skrivs ingen. Posterna som saknas måste skrivas i ett andra försök, annars stängs månaden utan dem
 *     och pengarna försvinner i tysthet (hårdtestet 2026-11-14).
 *  2. NYCKELN (0302). `provision_stangning_klar` får den nyckel `provision_stangning_borjar` lämnade, så att en
 *     stängning bara tar bort sin egen markering.
 *
 * Inloggningen och databasen är attrapper: ingenting når produktionen.
 *
 *   node --experimental-transform-types tests/provision-stangning-krock.mjs
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
globalThis.__st = { user: null, db: null };
const stubb = (kod) => ({ url: "data:text/javascript," + encodeURIComponent(kod), shortCircuit: true });
registerHooks({
  resolve(spec, ctx, nasta) {
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (spec === "next/cache") return stubb("export const revalidatePath = () => {}; export const revalidateTag = () => {}; export const unstable_cache = (f) => f;");
    if (spec === "next/headers") return stubb("export const cookies = async () => ({ get: () => undefined, getAll: () => [], set: () => {} }); export const headers = async () => new Headers();");
    if (spec === "@/lib/supabase/server") {
      return stubb("export const supabaseServer = async () => globalThis.__st.db; export const supabaseAdmin = () => globalThis.__st.db;");
    }
    if (spec === "@/lib/auth") {
      const aktaAuth = pathToFileURL(join(rot, "src", "lib", "auth.ts")).href;
      return stubb(`export * from ${JSON.stringify(aktaAuth)}; export const getCurrentUser = async () => globalThis.__st.user;`);
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
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const MANAD = "2001-01-01";
const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const ADMIN = "a0000000-0000-4000-8000-0000000000ad";
const NYCKEL = "c0000000-0000-4000-8000-00000000c0de";

const order = (id, saljare, belopp) => ({
  id, salesperson_id: saljare, package_id: null, term_months: 12, signed_on: "2001-01-10", period_month: MANAD,
  status: "signerad", is_addon: false, commission_amount: belopp, order_value: 10000, buyout_amount: null,
  finance_amount: null, cancel_period_month: null,
});

/**
 * En attrapp av supabase-js. Läsningar svarar ur `tabeller`; `commission_period` är tom (månaden öppen). Den första
 * insättningen i `commission_entry` krockar med 23505 när `forBokfort` inte är tomt, och läsningen av redan bokförda
 * referenser svarar med `forBokfort`.
 */
function attrapp(tabeller, forBokfort) {
  const logg = [];
  let posterInsatta = 0;
  const fraga = (tabell) => {
    const steg = { tabell, op: "select", data: null, filter: [] };
    const svaret = () => {
      if (steg.op === "insert") {
        logg.push({ op: "insert", tabell, data: steg.data });
        if (tabell === "commission_entry") {
          posterInsatta++;
          if (posterInsatta === 1 && forBokfort.length) return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        return { data: null, error: null };
      }
      if (tabell === "commission_entry") {
        logg.push({ op: "select", tabell, filter: steg.filter });
        return { data: forBokfort.map((r) => ({ external_ref: r })), error: null };
      }
      return { data: tabeller[tabell] ?? [], error: null };
    };
    const kedja = new Proxy({}, {
      get(_, namn) {
        if (namn === "then") return (a, b) => Promise.resolve(svaret()).then(a, b);
        if (namn === "insert") return (d) => { steg.op = "insert"; steg.data = d; return kedja; };
        if (namn === "maybeSingle" || namn === "single") {
          return () => { const s = svaret(); return Promise.resolve({ ...s, data: Array.isArray(s.data) ? s.data[0] ?? null : s.data }); };
        }
        return (...arg) => { steg.filter.push([String(namn), ...arg]); return kedja; };
      },
    });
    return kedja;
  };
  return {
    logg,
    from: (t) => fraga(t),
    rpc: (namn, arg) => {
      logg.push({ op: "rpc", namn, arg });
      return Promise.resolve({ data: namn === "provision_stangning_borjar" ? NYCKEL : null, error: null });
    },
  };
}

const { faststallPeriod } = await import(pathToFileURL(join(rot, "src", "app", "(app)", "provision", "stangning.ts")).href);
const form = () => { const f = new FormData(); f.set("period_month", MANAD); return f; };
const tabeller = { sales_order: [order("o1", A, 1500), order("o2", B, 2500)], commission_period: [] };
globalThis.__st.user = { authUserId: "x", email: "prov@exempel.se", employee: { id: ADMIN, first_name: "Prov", last_name: "Admin" }, roles: ["admin"] };

rubrik("Utan krock: en insättning med alla poster");
const ref = (p) => `${MANAD}:${p}:`;
let alla = [];
{
  const db = attrapp(tabeller, []);
  globalThis.__st.db = db;
  const svar = await faststallPeriod({}, form());
  const ins = db.logg.filter((l) => l.op === "insert" && l.tabell === "commission_entry");
  alla = (ins[0]?.data ?? []).map((r) => r.external_ref);
  ok("månaden fastställs", !!svar.ok, JSON.stringify(svar));
  ok("en insättning, med poster för båda säljarna", ins.length === 1 && alla.some((r) => r.startsWith(ref(A))) && alla.some((r) => r.startsWith(ref(B))), alla.join(", "));
}

rubrik("Krock: ett tidigare försök hann bokföra säljare A:s poster");
{
  const forBokfort = alla.filter((r) => r.startsWith(ref(A)));
  const db = attrapp(tabeller, forBokfort);
  globalThis.__st.db = db;
  const svar = await faststallPeriod({}, form());
  const ins = db.logg.filter((l) => l.op === "insert" && l.tabell === "commission_entry");
  const andra = (ins[1]?.data ?? []).map((r) => r.external_ref);
  ok("månaden fastställs ändå", !!svar.ok, JSON.stringify(svar));
  ok("ett andra försök skriver posterna som saknades", ins.length === 2 && andra.length > 0 && andra.every((r) => r.startsWith(ref(B))), andra.join(", "));
  ok("och skriver inte om de redan bokförda", !andra.some((r) => forBokfort.includes(r)));
  ok("perioden skrivs efter posterna", db.logg.findIndex((l) => l.tabell === "commission_period" && l.op === "insert") > db.logg.lastIndexOf(ins[1]));
}

rubrik("Krock där allt redan är bokfört");
{
  const db = attrapp(tabeller, alla);
  globalThis.__st.db = db;
  const svar = await faststallPeriod({}, form());
  const ins = db.logg.filter((l) => l.op === "insert" && l.tabell === "commission_entry");
  ok("månaden fastställs utan ett andra försök", !!svar.ok && ins.length === 1, JSON.stringify(svar));
}

rubrik("Nyckeln");
{
  const db = attrapp(tabeller, []);
  globalThis.__st.db = db;
  await faststallPeriod({}, form());
  const klar = db.logg.find((l) => l.op === "rpc" && l.namn === "provision_stangning_klar");
  ok("klar får nyckeln från borjar", klar?.arg?.p_nyckel === NYCKEL, JSON.stringify(klar?.arg));
}

console.log(fel ? `\n\x1b[31m${fel} ✗\x1b[0m` : "\n\x1b[32mAlla ✓\x1b[0m");
process.exit(fel ? 1 : 0);
