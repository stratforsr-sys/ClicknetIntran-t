#!/usr/bin/env node
/**
 * Rutten /nav2/chatt: chatten med Claude, avstängd tills någon slår på den.
 *
 * INGET HÄR NÅR ANTHROPIC. SDK:n är utbytt mot en attrapp som svarar det provet säger, och databasen och
 * inloggningen är attrapper (samma mönster som tests/forslag-rutt.mjs). Källorna bakom verktygen
 * (`chatt/kallor.ts`) är också utbytta: provet håller behörigheten, taken, loggen och talen, inte vyernas
 * byggfunktioner, som har sina egna prov.
 *
 *   TZ=UTC node --experimental-transform-types --no-warnings tests/chatt-rutt.mjs
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
globalThis.__rutt = { user: null, db: null };
globalThis.__ai = { svar: [], anrop: [], skapad: [] };
globalThis.__kallor = () => ({});
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
    if (spec === "@anthropic-ai/sdk") {
      return stubb(
        "export default class Anthropic { constructor(o) { globalThis.__ai.skapad.push(o); this.beta = { messages: { stream: (p, o) => { globalThis.__ai.anrop.push(JSON.parse(JSON.stringify(p)));" +
          " return { finalMessage: async () => { const s = globalThis.__ai.svar.shift(); if (!s) throw new Error('attrapp: inget svar kvar'); if (s instanceof Error) throw s; return typeof s === 'function' ? await s() : s; } }; } } }; } }",
      );
    }
    if (spec === "@/lib/nav2/chatt/kallor") return stubb("export const skapaKallor = (...a) => globalThis.__kallor(...a);");
    if (spec === "@/lib/fel-server") return stubb("export const skrivFel = async (f) => { (globalThis.__fel ??= []).push(f); return true; };");
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
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra && !villkor ? "  " + String(extra).slice(0, 500) : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const S = "b0000000-0000-4000-8000-000000000001"; // en säljare
const X = "b0000000-0000-4000-8000-000000000003"; // en annan säljare, utanför S krets
const TL = "b0000000-0000-4000-8000-000000000004"; // teamledaren för S

/** En attrapp av supabase-js: läser ur `tabeller` med rutans filter, bokför varje skrivning och varje rpc. */
function attrapp(tabeller, rpc = {}) {
  const skrivningar = [];
  const SKRIV = new Set(["insert", "update", "delete", "upsert"]);
  const fraga = (tabell) => {
    let skriver = null;
    let en = false;
    const filter = [];
    const svaret = () => {
      if (skriver) return { data: skriver.rad ? [{ id: "ny", ...skriver.rad }] : null, error: tabeller[`${tabell}!fel`] ?? null };
      const rader = (tabeller[tabell] ?? []).filter((r) => filter.every((f) => f(r)));
      return en ? { data: rader[0] ?? null, error: null } : { data: rader.slice(0, 1000), error: null, count: rader.length };
    };
    const jamfor = (test, namn) => (kol, varde) => {
      if (!skriver) filter.push((r) => test(r[kol], varde));
      else (skrivningar.at(-1).filter ??= []).push([namn, kol, varde]);
      return kedja;
    };
    const kedja = new Proxy({}, {
      get(_, namn) {
        if (namn === "then") return (a, b) => Promise.resolve(svaret()).then(a, b);
        if (SKRIV.has(namn)) return (rad) => { skriver = { rad: Array.isArray(rad) ? rad[0] : rad }; skrivningar.push({ text: `${String(namn)} ${tabell}`, rad: skriver.rad }); return kedja; };
        if (namn === "eq") return jamfor((a, b) => a === b, "eq");
        if (namn === "in") return jamfor((a, b) => b.includes(a), "in");
        if (namn === "like") return jamfor((a, b) => String(a).startsWith(String(b).replace(/%$/, "")), "like");
        if (namn === "maybeSingle" || namn === "single") return () => { en = true; return Promise.resolve(svaret()); };
        return (...a) => { if (skriver) (skrivningar.at(-1).filter ??= []).push([String(namn), ...a]); return kedja; };
      },
    });
    return kedja;
  };
  return {
    skrivningar,
    from: (t) => fraga(t),
    rpc: (namn, arg) => {
      skrivningar.push({ text: `rpc ${namn}`, arg });
      if (!(namn in rpc)) return Promise.resolve({ data: null, error: { message: `attrapp: ${namn}`, code: "XX000" } });
      return Promise.resolve({ data: typeof rpc[namn] === "function" ? rpc[namn](arg) : rpc[namn], error: null });
    },
  };
}

process.env.ANTHROPIC_API_KEY = "prov-nyckel-som-aldrig-lamnar-provet";
process.env.ANTHROPIC_WORKSPACE_ID = "prov-workspace";

const { POST } = await import("../src/app/nav2/chatt/route.ts");
const { avtryck, SYSTEMTEXT } = await import("../src/lib/nav2/chatt/systemtext.ts");
const { VERKTYG, korVerktyg, periodFor, kallrad, dagUr } = await import("../src/lib/nav2/chatt/verktyg.ts");
const { kostnadUsd, maxFragaUsd } = await import("../src/lib/nav2/chatt/chattforma.ts");

const PA = [
  { key: "chatt.pa", value: true },
  { key: "chatt.avtal", value: true },
  { key: "hem.nytt", value: "alla" },
];
const UTRYMME = { person_usd: 1.5, foretag_usd: 20, tak_person_usd: 14, tak_foretag_usd: 85 };
const PROV = [{ modell: "claude-sonnet-5-5", avtryck: avtryck(), godkand: true }];
const USAGE = { input_tokens: 9000, output_tokens: 700, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const verktygstur = (namn, input, id = "tu_1") => ({ stop_reason: "tool_use", usage: USAGE, content: [{ type: "tool_use", id, name: namn, input }] });
const textsvar = (text, o = {}) => ({ stop_reason: "end_turn", usage: USAGE, content: [{ type: "text", text }], ...o });

// Förra veckans onsdag, så att "forra-veckan" alltid träffar.
const idag = new Date();
const mandag = new Date(Date.UTC(idag.getUTCFullYear(), idag.getUTCMonth(), idag.getUTCDate() - ((idag.getUTCDay() + 6) % 7)));
const forraOnsdag = new Date(mandag.getTime() - 5 * 864e5).toISOString().slice(0, 10);
const mote = (id, utfall, vem = S) => ({ id, kedja: "k" + id, bokatAv: vem, hallsAv: vem, bokatNar: `${forraOnsdag}T08:00:00Z`, moteTid: `${forraOnsdag}T10:00:00Z`, art: "ny", utfall, resultat: null, kalla: "nav", bekraftatNar: null });
const MOTEN = [mote("m1", "hallet"), mote("m2", "hallet"), mote("m3", "uteblev"), mote("m4", "hallet", X)];

function kallor(roller, id, lasta) {
  const krets = roller.some((r) => ["sales_manager", "ceo", "admin"].includes(r)) ? null : roller.includes("team_lead") ? [id, S] : [id];
  return {
    krets: async () => krets,
    personer: async () => [{ id: S, namn: "Sara Prov" }, { id: X, namn: "Xerxes Prov" }, { id: TL, namn: "Tea Prov" }],
    moten: async () => { lasta.push("moten"); return MOTEN; },
    order: async () => { lasta.push("order"); return []; },
    forslag: async () => ({ pa: false, oppna: [], andrat: [], trendrad: null }),
    vantar: async () => ({ sammanfattning: "Inget väntar.", rader: [] }),
    dag: async () => ({ poster: [], uppgifter: [] }),
    provision: async () => null,
  };
}

async function anropa(roller, id, kropp, o = {}) {
  const lasta = [];
  const db = attrapp(
    { nav_setting: o.inst ?? PA, nav_chatt_prov: o.prov ?? PROV, ...(o.extra ?? {}) },
    { nav_chatt_reservera: () => ("reservation" in o ? o.reservation : { ...UTRYMME, ok: true, id: "rad-1" }) },
  );
  globalThis.__rutt = { db, user: id ? { employee: { id, first_name: "Prov", last_name: "Person", team_id: null }, roles: roller, permissions: [] } : null };
  globalThis.__ai.svar = [...(o.ai ?? [])];
  globalThis.__ai.anrop = [];
  globalThis.__kallor = () => kallor(roller, id, lasta);
  const req = new Request("https://nav.test/nav2/chatt", { method: "POST", headers: { origin: o.ursprung ?? "https://nav.test", "content-type": "application/json" }, body: JSON.stringify(kropp) });
  let status = 0, text = "", data = null, rader = [];
  try {
    const res = await POST(req);
    status = res.status;
    if (o.stang) {
      // Personen stänger fliken medan Claude svarar.
      await res.body.cancel();
      for (let i = 0; i < 100 && !db.skrivningar.some((x) => x.text === "update nav_chatt_logg"); i++) await new Promise((r) => setTimeout(r, 5));
    } else text = await res.text();
    if ((res.headers.get("content-type") ?? "").includes("event-stream")) rader = text.split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")));
    else try { data = JSON.parse(text); } catch { /* inte JSON */ }
  } catch (e) {
    text = `kastade: ${e instanceof Error ? e.stack : String(e)}`;
  }
  // Loggraden skrivs av reservationen (rpc) och rättas till den verkliga kostnaden när svaret är klart (update).
  const res = db.skrivningar.filter((s) => s.text === "rpc nav_chatt_reservera").map((s) => s.arg);
  const rattad = db.skrivningar.filter((s) => s.text === "update nav_chatt_logg");
  const logg = rattad.map((s) => s.rad);
  const loggId = rattad.map((s) => (s.filter ?? []).find((x) => x[0] === "eq" && x[1] === "id")?.[2] ?? null);
  const ovrigt = db.skrivningar.filter((s) => !s.text.startsWith("rpc ") && s.text !== "update nav_chatt_logg").map((s) => s.text);
  return { status, text: text.slice(0, 600), data, rader, res, logg, loggId, ovrigt, lasta, ai: globalThis.__ai.anrop, svar: rader.find((r) => r.h === "svar") ?? null };
}
const visa = (r) => `${r.status} ai=${r.ai.length} res=${r.res.length} logg=${r.logg.length} ${r.text.slice(0, 300)}`;
const FRAGA = { fraga: "Hur gick lagets möten förra veckan?" };

rubrik("Avstängd tills någon slår på den");
{
  const av = await anropa(["salesperson"], S, FRAGA, { inst: [] });
  ok("utan inställning svarar rutten 409", av.status === 409 && av.data?.fel === "Chatten är inte påslagen.", visa(av));
  ok("ingenting går till Claude, ingenting reserveras och ingenting skrivs", av.ai.length === 0 && av.res.length === 0 && av.logg.length === 0 && av.ovrigt.length === 0, visa(av));
  const utanProv = await anropa(["salesperson"], S, FRAGA, { prov: [] });
  ok("påslagen utan godkänt prov: 409 med skälet", utanProv.status === 409 && utanProv.data?.fel === "Modellen har inget godkänt prov." && utanProv.ai.length === 0, visa(utanProv));
  const gammalt = await anropa(["salesperson"], S, FRAGA, { prov: [{ modell: "claude-sonnet-5-5", avtryck: "gammal", godkand: true }] });
  ok("ett prov på en äldre systemtext räcker inte", gammalt.status === 409 && /ändrats sedan provet/.test(gammalt.data?.fel ?? "") && gammalt.ai.length === 0, visa(gammalt));
  const ejGodkant = await anropa(["salesperson"], S, FRAGA, { prov: [{ modell: "claude-sonnet-5-5", avtryck: avtryck(), godkand: false }] });
  ok("ett prov som inte är godkänt räcker inte", ejGodkant.status === 409 && ejGodkant.ai.length === 0, visa(ejGodkant));
  const utanAvtal = await anropa(["salesperson"], S, FRAGA, { inst: PA.filter((r) => r.key !== "chatt.avtal") });
  ok("utan bekräftat avtal: 409", utanAvtal.status === 409 && /avtalet/.test(utanAvtal.data?.fel ?? "") && utanAvtal.ai.length === 0, visa(utanAvtal));
  const utanfor = await anropa(["salesperson"], S, FRAGA, { inst: [...PA.filter((r) => r.key !== "hem.nytt"), { key: "hem.nytt", value: [X] }] });
  ok("den som inte har det nya hemmet får 409, också med ett eget anrop förbi skrivrutan", utanfor.status === 409 && utanfor.data?.fel === "Chatten är inte påslagen." && utanfor.ai.length === 0 && utanfor.res.length === 0, visa(utanfor));
  const utanHem = await anropa(["salesperson"], S, FRAGA, { inst: PA.filter((r) => r.key !== "hem.nytt") });
  ok("och utan inställningen hem.nytt har ingen det", utanHem.status === 409 && utanHem.ai.length === 0, visa(utanHem));
  const nyckel = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const utanNyckel = await anropa(["salesperson"], S, FRAGA);
  process.env.ANTHROPIC_API_KEY = nyckel;
  ok("utan nyckel i miljön: 409", utanNyckel.status === 409 && /Nyckeln saknas/.test(utanNyckel.data?.fel ?? "") && utanNyckel.ai.length === 0, visa(utanNyckel));
}

rubrik("Vem som får fråga");
{
  const ute = await anropa([], null, FRAGA);
  ok("utloggad: 401", ute.status === 401 && ute.ai.length === 0, visa(ute));
  const fel = await anropa(["salesperson"], S, FRAGA, { ursprung: "https://ond.test" });
  ok("fel ursprung: 403", fel.status === 403 && fel.ai.length === 0, visa(fel));
  const kort = await anropa(["salesperson"], S, { fraga: " a " });
  ok("en för kort fråga: 400", kort.status === 400 && kort.ai.length === 0, visa(kort));
}

rubrik("Gränserna: dollar per person och för företaget, prövade innan Claude anropas");
{
  const person = await anropa(["salesperson"], S, FRAGA, { reservation: { ...UTRYMME, ok: false, skal: "person" } });
  ok("personens utrymme slut: 429 med beskedet, och inget går till Claude", person.status === 429 && person.data?.fel === "Du har använt månadens AI-utrymme. Det fylls på den 1:a." && person.data.tak === true && person.ai.length === 0 && person.logg.length === 0, visa(person));
  const foretag = await anropa(["salesperson"], S, FRAGA, { reservation: { ...UTRYMME, ok: false, skal: "foretag" } });
  ok("företagets utrymme slut: 429 med beskedet", foretag.status === 429 && foretag.data?.fel === "Företaget har använt månadens AI-utrymme. Det fylls på den 1:a." && foretag.ai.length === 0, visa(foretag));
  const trasig = await anropa(["salesperson"], S, FRAGA, { reservation: null });
  ok("går utrymmet inte att läsa svarar rutten hellre nej än ja", trasig.status === 503 && trasig.ai.length === 0, visa(trasig));
  const utanRad = await anropa(["salesperson"], S, FRAGA, { reservation: { ...UTRYMME, ok: true } });
  ok("ett ja utan en loggrad är inget ja", utanRad.status === 503 && utanRad.ai.length === 0, visa(utanRad));
  const r = await anropa(["salesperson"], S, FRAGA, { ai: [textsvar("Inget väntar.")] });
  const a = r.res[0] ?? {};
  ok("reservationen görs på personen, modellen och miljön, med frågan", r.res.length === 1 && a.p_employee === S && a.p_modell === "claude-sonnet-5-5" && a.p_miljo === "lokal" && a.p_fraga === FRAGA.fraga, JSON.stringify(a));
  ok("med det mesta en fråga kan kosta: sex varv fulla, till den dyraste modellens pris när en reservmodell kan ta över", Math.abs(a.p_max_usd - maxFragaUsd("okand", 2000, 6)) < 1e-12 && Math.abs(a.p_max_usd - 0.24) < 1e-12, String(a.p_max_usd));
  const h = await anropa(["salesperson"], S, FRAGA, { inst: [...PA, { key: "chatt.modell", value: "claude-haiku-5-5" }], prov: [{ modell: "claude-haiku-5-5", avtryck: avtryck(), godkand: true }], ai: [textsvar("Inget väntar.")] });
  ok("Haiku har ingen reservmodell, så den reserverar sitt eget pris", Math.abs((h.res[0]?.p_max_usd ?? 0) - maxFragaUsd("claude-haiku-5-5", 2000, 6)) < 1e-12, String(h.res[0]?.p_max_usd));
  const styr = await anropa(["salesperson"], S, { fraga: "Hur gick\u0000 mina\u0007 möten?" }, { ai: [textsvar("Inget väntar.")] });
  ok("styrtecken tvättas ur frågan, så att raden alltid går att skriva", styr.res[0]?.p_fraga === "Hur gick mina möten?", JSON.stringify(styr.res[0]?.p_fraga));
}

rubrik("Frågan räknas också när personen stänger fliken");
{
  const sen = async () => { await new Promise((r) => setTimeout(r, 30)); return textsvar("Inget väntar."); };
  const r = await anropa(["salesperson"], S, FRAGA, { ai: [sen], stang: true });
  ok("Claude anropades, och raden rättas till den verkliga kostnaden fast ingen lyssnar", r.ai.length === 1 && r.logg.length === 1 && r.loggId[0] === "rad-1" && r.logg[0].stop_reason === "end_turn" && Math.abs(r.logg[0].kostnad_usd - kostnadUsd("claude-sonnet-5-5", USAGE)) < 1e-12, visa(r) + " " + JSON.stringify(r.logg));
}

rubrik("Ett svar: verktyget hämtar, servern sätter in talen");
{
  const r = await anropa(["team_lead"], TL, FRAGA, {
    ai: [verktygstur("las_matt", { matt: "moten.hallna-av-alla", vem: "laget", period: "forra-veckan" }), textsvar("Laget höll {{t:1.antal}} av {{t:1.av}} möten förra veckan.")],
  });
  ok("svaret strömmas", r.status === 200 && r.rader.length >= 2, visa(r));
  ok("det står vad som hämtas medan verktyget kör", r.rader[0]?.h === "hamtar" && r.rader[0].text === "Hämtar hållna möten för laget, förra veckan.", JSON.stringify(r.rader[0]));
  ok("talen är insatta av servern, med källa", r.svar?.text === "Laget höll ⟦t1:2⟧ av ⟦t2:3⟧ möten förra veckan." && r.svar.tal?.[0]?.kalla?.verktyg === "las_matt" && r.svar.tal[0].kalla.falt === "antal", JSON.stringify(r.svar));
  const mv = await anropa(["team_lead"], TL, FRAGA, {
    ai: [verktygstur("las_matt", { matt: "moten.hallna-av-alla", vem: "laget", period: "forra-veckan" }), textsvar("Laget höll {{t:1.antal}} möten, och {{t:1.motvikt.antal}} uteblev. Det bokades {{t:1.bokadePerVecka}} i veckan.")],
  });
  ok("motviktens tal bär motviktens förklaring, inte huvudmåttets", /^Hållna möten/.test(mv.svar?.tal?.[0]?.om ?? "") && /^Uteblivna möten av hållna och uteblivna\./.test(mv.svar?.tal?.[1]?.om ?? "") && / · Ditt lag · förra veckan/.test(mv.svar.tal[1].om), JSON.stringify(mv.svar?.tal?.map((t) => t.om)));
  ok("och bokade per vecka säger att det är bokade möten", /^Första möten som bokades i perioden, per vecka/.test(mv.svar?.tal?.[2]?.om ?? ""), mv.svar?.tal?.[2]?.om);
  ok("varje tal säger vad det är: mått, vem, period och data per", /^Hållna möten av hållna, uteblivna och avbokade\./.test(r.svar?.tal?.[0]?.om ?? "") && /Ditt lag · förra veckan \(\d{4}-\d{2}-\d{2} till \d{4}-\d{2}-\d{2}\) · data per \d{4}-\d{2}-\d{2}$/.test(r.svar.tal[0].om), r.svar?.tal?.[0]?.om);
  ok("inget är obelagt, och källraden säger att texten är AI", r.svar?.obelagda === 0 && r.svar.kalla === "Skrivet av AI ur Navs tal");
  ok("ett möte utanför kretsen räknas inte", r.svar?.tal?.[1]?.varde === 3);
  const a = r.ai[0] ?? {};
  ok("verktygsvalet är auto och verktygen är strikta", a.tool_choice?.type === "auto" && a.tools?.length === 6 && a.tools.every((t) => t.strict === true && t.input_schema.additionalProperties === false), JSON.stringify(a.tool_choice));
  ok("effort är satt uttryckligen och tänkandet lämnas orört", a.output_config?.effort === "low" && !("thinking" in a));
  ok("reservmodellen är med för Sonnet", a.fallbacks === "default" && a.betas?.includes("server-side-fallback-2026-07-01"), JSON.stringify(a.betas));
  ok("systemtexten är den fasta, med cachemärke", a.system?.[0]?.text === SYSTEMTEXT && a.system[0].cache_control?.type === "ephemeral" && a.model === "claude-sonnet-5-5");
  ok("datum och person står i användarens tur, inte i systemtexten", /Idag är \d{4}-\d{2}-\d{2}/.test(a.messages?.at(-1)?.content ?? "") && !/\d{4}-\d{2}-\d{2}/.test(SYSTEMTEXT));
  const b = r.ai[1] ?? {};
  ok("andra varvet bär Claudes tur oförändrad och verktygets svar", b.messages?.at(-2)?.role === "assistant" && b.messages.at(-2).content?.[0]?.type === "tool_use" && b.messages.at(-1).content?.[0]?.type === "tool_result" && b.messages.at(-1).content[0].tool_use_id === "tu_1");
  ok("systemtext och verktyg är desamma i båda varven", JSON.stringify(a.system) === JSON.stringify(b.system) && JSON.stringify(a.tools) === JSON.stringify(b.tools));
  const l = r.logg[0] ?? {};
  ok("en loggrad per fråga, på personen: reserverad först, rättad när svaret är klart", r.res.length === 1 && r.res[0].p_employee === TL && r.logg.length === 1 && r.loggId[0] === "rad-1" && l.stop_reason === "end_turn", JSON.stringify({ res: r.res, l }));
  ok("loggen bär kostnaden i dollar för båda varven, och samma i kronor", Math.abs(l.kostnad_usd - 2 * kostnadUsd("claude-sonnet-5-5", USAGE)) < 1e-12 && Math.abs(l.kostnad_kr - l.kostnad_usd * 11) < 1e-9 && l.tokens_in === 18000 && l.tokens_ut === 1400, JSON.stringify(l));
  ok("loggen bär verktygen med argument, frågan och svaret", l.verktyg?.[0]?.namn === "las_matt" && l.verktyg[0].input?.vem === "laget" && r.res[0].p_fraga === FRAGA.fraga && l.svar === "Laget höll 2 av 3 möten förra veckan." && l.obelagda === 0);
  ok("inget annat skrivs", r.ovrigt.length === 0, r.ovrigt.join(", "));
  ok("klienten skapas med workspace-rubriken", globalThis.__ai.skapad.at(-1)?.defaultHeaders?.["anthropic-workspace-id"] === "prov-workspace");
}

rubrik("Ett tal utan hänvisning märks och räknas");
{
  const r = await anropa(["team_lead"], TL, FRAGA, { ai: [textsvar("Laget höll 12 möten förra veckan.")] });
  ok("talet märks som obelagt i svaret", r.svar?.obelagda === 1 && r.svar.text === "Laget höll ⟦obelagt:12⟧ möten förra veckan.", JSON.stringify(r.svar));
  ok("och räknas i loggen", r.logg[0]?.obelagda === 1);
}

rubrik("En person utanför kretsen");
{
  const r = await anropa(["salesperson"], S, { fraga: "Hur många möten höll Xerxes förra veckan?" }, {
    ai: [verktygstur("las_matt", { matt: "moten.hallna-av-alla", vem: "Xerxes", period: "forra-veckan" }), textsvar("Det får du inte se.")],
  });
  const svaret = r.ai[1]?.messages?.at(-1)?.content?.[0]?.content ?? "";
  ok("verktyget svarar att det inte får visas", JSON.parse(svaret || "{}").fel === "Det får du inte se.", svaret);
  ok("och svaret bär inget tal", !/"antal"|"av"|"procent"/.test(svaret), svaret);
  ok("mötena läses aldrig", !r.lasta.includes("moten"), r.lasta.join(","));
  const laget = await anropa(["salesperson"], S, FRAGA, { ai: [verktygstur("las_matt", { matt: "order.netto", vem: "laget", period: "denna-manad" }), textsvar("Det får du inte se.")] });
  ok("en säljare får inte lagets tal", JSON.parse(laget.ai[1]?.messages?.at(-1)?.content?.[0]?.content ?? "{}").fel === "Det får du inte se." && !laget.lasta.includes("order"));
  const egen = await anropa(["salesperson"], S, FRAGA, { ai: [verktygstur("las_matt", { matt: "moten.hallna-av-alla", vem: "jag", period: "forra-veckan" }), textsvar("Du höll {{t:1.antal}} möten.")] });
  ok("sina egna tal får säljaren", egen.svar?.text === "Du höll ⟦t1:2⟧ möten." && egen.svar.obelagda === 0, JSON.stringify(egen.svar));
  const tl = await anropa(["team_lead"], TL, FRAGA, { ai: [verktygstur("las_matt", { matt: "moten.hallna-av-alla", vem: "Xerxes Prov", period: "forra-veckan" }), textsvar("Det får du inte se.")] });
  ok("en teamledare får inte en person i ett annat lag", JSON.parse(tl.ai[1]?.messages?.at(-1)?.content?.[0]?.content ?? "{}").fel === "Det får du inte se.");
}

rubrik("Claude förbereder, en människa godkänner");
{
  const r = await anropa(["salesperson"], S, { fraga: "Lägg upp att jag ringer Hagby i morgon" }, {
    ai: [verktygstur("forbered_uppgifter", { uppgifter: [{ titel: "Ring Hagby Glas", dag: "2026-11-17" }, { titel: "Skicka offerten", dag: "" }] }), textsvar("Jag har förberett två uppgifter. Tryck på Lägg i min dag om de stämmer.")],
  });
  ok("utkastet följer med svaret", r.svar?.utkast?.length === 2 && r.svar.utkast[0].titel === "Ring Hagby Glas" && r.svar.utkast[0].dag === "2026-11-17" && r.svar.utkast[1].dag === null, JSON.stringify(r.svar?.utkast));
  ok("ingenting skapas i uppgifterna", r.ovrigt.length === 0 && r.logg.length === 1, r.ovrigt.join(", "));
  const tvatt = await anropa(["salesperson"], S, FRAGA, { ai: [verktygstur("forbered_uppgifter", { uppgifter: [{ titel: "Du har sålt 40 order", dag: "" }] }), textsvar("{{t:1.utkast.0.titel}}, och {{t:1.uppgifter}} uppgift är förberedd.")] });
  ok("Claudes egna ord i ett utkast kan aldrig bli ett belagt tal", (tvatt.svar?.tal ?? []).length === 0 && tvatt.svar?.obelagda === 2 && !/40/.test(tvatt.svar.text), JSON.stringify(tvatt.svar));
  const s = await anropa(["salesperson"], S, FRAGA, { ai: [verktygstur("forbered_uppgifter", { uppgifter: [{ titel: "", dag: "i morgon" }] }), textsvar("Det gick inte.")] });
  ok("ett utkast utan titel eller med en dag som inte är ett datum nekas", (s.svar?.utkast ?? []).length === 0 && /fel/.test(s.ai[1]?.messages?.at(-1)?.content?.[0]?.content ?? ""));
}

rubrik("Avböjande, avbrott och fel");
{
  const r = await anropa(["salesperson"], S, FRAGA, { ai: [{ stop_reason: "refusal", usage: USAGE, content: [] }] });
  ok("avböjer modellen säger rutan det rakt", r.rader.at(-1)?.h === "avbojt" && /avböjde/.test(r.rader.at(-1).text) && !r.svar, JSON.stringify(r.rader));
  ok("avböjandet loggas med kostnad", r.logg.length === 1 && r.logg[0].stop_reason === "refusal" && r.logg[0].kostnad_usd > 0);
  const m = await anropa(["team_lead"], TL, FRAGA, { ai: [{ stop_reason: "max_tokens", usage: USAGE, content: [{ type: "tool_use", id: "tu_9", name: "las_matt", input: { matt: "moten.hallna-av-alla", vem: "laget", period: "forra-veckan" } }] }] });
  ok("ett avbrutet svar kör aldrig sina verktyg", m.lasta.length === 0 && m.ai.length === 1 && m.rader.at(-1)?.h === "fel" && m.logg[0]?.stop_reason === "max_tokens", JSON.stringify(m.rader));
  const varv = Array.from({ length: 12 }, (_x, i) => verktygstur("las_vantar", {}, `tu_${i}`));
  const v = await anropa(["salesperson"], S, FRAGA, { ai: varv });
  ok("verktygsvarven har ett tak", v.ai.length === 6 && v.rader.at(-1)?.h === "fel" && v.logg.length === 1, `ai=${v.ai.length}`);
  const f = await anropa(["salesperson"], S, FRAGA, { ai: [new Error("529 overloaded")] });
  ok("ett fel från Anthropic blir ett rakt besked, och loggas", f.rader.at(-1)?.h === "fel" && !/529|overloaded/.test(f.rader.at(-1).text) && f.logg.length === 1 && f.logg[0].stop_reason === "fel" && f.logg[0].kostnad_usd === 0, JSON.stringify(f.rader));
  const h = await anropa(["salesperson"], S, FRAGA, { inst: [...PA, { key: "chatt.modell", value: "claude-haiku-5-5" }], prov: [{ modell: "claude-haiku-5-5", avtryck: avtryck(), godkand: true }], ai: [textsvar("Inget väntar.")] });
  ok("Haiku har ingen reservmodell på servern, så den skickas inte med", h.status === 200 && h.ai[0]?.model === "claude-haiku-5-5" && !("fallbacks" in h.ai[0]) && !("betas" in h.ai[0]), JSON.stringify(Object.keys(h.ai[0] ?? {})));
}

rubrik("Samtalet: tidigare svar skickas utan sina tal");
{
  const r = await anropa(["salesperson"], S, { fraga: "Och veckan före?", historia: [{ fraga: "Hur gick mina möten?", svar: "Du höll 12 av 19 möten." }] }, { ai: [textsvar("Jag behöver hämta det igen.")] });
  const m = r.ai[0]?.messages ?? [];
  ok("den tidigare frågan och svaret följer med", m.length === 3 && m[0].role === "user" && m[1].role === "assistant", JSON.stringify(m));
  ok("men talen i det gamla svaret är borta, så att de inte kan återanvändas utan källa", !/\d/.test(JSON.stringify(m[1].content)), JSON.stringify(m[1]));
  const lang = await anropa(["salesperson"], S, { fraga: "Och sen?", historia: Array.from({ length: 9 }, (_x, i) => ({ fraga: `Fråga ${i}`, svar: "Svar." })) }, { ai: [textsvar("Okej.")] });
  ok("högst tre tidigare utbyten skickas", (lang.ai[0]?.messages ?? []).length === 7);
}

rubrik("Verktygen, var för sig");
{
  ok("verktygen är sex, i fast ordning", VERKTYG.map((v) => v.name).join(",") === "las_matt,las_forslag,las_vantar,las_dag,las_provision,forbered_uppgifter");
  ok("perioderna räknas ur dagen", JSON.stringify(periodFor("forra-veckan", "2026-11-18")) === JSON.stringify({ fran: "2026-11-09", till: "2026-11-15", manad: null, text: "förra veckan" })
    && periodFor("denna-vecka", "2026-11-18").fran === "2026-11-16" && periodFor("denna-vecka", "2026-11-18").till === "2026-11-18"
    && JSON.stringify(periodFor("forra-manaden", "2026-01-05")) === JSON.stringify({ fran: "2025-12-01", till: "2025-12-31", manad: "2025-12", text: "förra månaden" })
    && periodFor("denna-manad", "2026-11-18").fran === "2026-11-01" && periodFor("denna-manad", "2026-11-18").manad === "2026-11", JSON.stringify(periodFor("forra-veckan", "2026-11-18")));
  const lasta = [];
  const ctx = { mig: TL, idag: forraOnsdag, kallor: kallor(["team_lead"], TL, lasta) };
  const m = await korVerktyg("las_matt", { matt: "moten.uteblivna", vem: "laget", period: "denna-vecka" }, ctx, 1);
  ok("ett mått bär antal, av, procent, motvikt, data per och vad det inte ser", m.svar.antal === 1 && m.svar.av === 3 && m.svar.procent === 33 && m.svar.motvikt?.matt === "moten.hallna-av-alla" && m.svar.motvikt.antal === 2 && m.svar.dataPer === forraOnsdag && /Ser inte/.test(m.svar.serInte) && m.svar._anrop === 1 && m.svar._verktyg === "las_matt", JSON.stringify(m.svar));
  ok("ett litet underlag sägs vara för litet för en jämförelse", m.svar.rackerForJamforelse === false);
  const o = await korVerktyg("las_matt", { matt: "order.netto", vem: "jag", period: "forra-veckan" }, ctx, 2);
  ok("order räknas per månad, och verktyget säger det", /per månad/.test(o.svar.fel ?? "") && !("antal" in o.svar), JSON.stringify(o.svar));
  const okand = await korVerktyg("las_matt", { matt: "lon.alla", vem: "jag", period: "denna-manad" }, ctx, 3);
  ok("ett mått utanför registret finns inte", /fel/.test(Object.keys(okand.svar).join(",")) && !("antal" in okand.svar));
  const d = await korVerktyg("las_dag", { dag: "i morgon" }, ctx, 4);
  ok("en dag som inte är ett datum nekas", !!d.svar.fel);
  const p = await korVerktyg("las_provision", { manad: "denna-manad" }, ctx, 5);
  ok("saknas provisionsunderlaget säger verktyget det, utan tal", /saknas|inte/.test(p.svar.fel ?? "") && !("summa" in p.svar), JSON.stringify(p.svar));
  ok("källraden för ett ordermått skiljer på måttet, motvikten och det som väntar", /^Order som makulerats/.test(kallrad({ _verktyg: "las_matt", vad: "Order som signerats", motvikt: { matt: "order.makulerade", antal: 1 }, vem: "Du", period: "den här månaden" }, "motvikt.antal")) && /^Order som väntar på godkännande · Du/.test(kallrad({ _verktyg: "las_matt", vad: "Order som signerats", vem: "Du", period: "den här månaden" }, "vantarPaGodkannande")));
  const langt = { ...ctx.kallor, vantar: async () => ({ sammanfattning: "9 uppgifter är försenade. De första 6 står här.", rader: ["a", "b", "c", "d", "e", "f"] }), forslag: async () => ({ pa: true, oppna: [{ rubrik: "Ring", rader: ["x"] }], andrat: [{ text: "a", dom: null, tal: null }, { text: "b", dom: null, tal: null }, { text: "c", dom: null, tal: null }], trendrad: null }) };
  const v = await korVerktyg("las_vantar", {}, { ...ctx, kallor: langt }, 7);
  ok("Väntar på dig bär raderna men inget antal: listan är kapad, och ett radantal vore ett fel tal", !("antal" in v.svar) && v.svar.rader.length === 6 && /kortet Väntar på dig/.test(v.svar.serInte ?? ""), JSON.stringify(v.svar));
  const fo = await korVerktyg("las_forslag", {}, { ...ctx, kallor: langt }, 8);
  ok("det som ändrats bär de senaste raderna men inget antal", !("andrade" in fo.svar) && fo.svar.andrat.length === 3 && fo.svar.oppna === 1 && /de tre senaste/.test(fo.svar.serInte ?? ""), JSON.stringify(fo.svar));

  const post = (o) => ({ dag: "2026-11-18", slag: "mote", rubrik: "Kundmöte", start: 600, svar: "ja", ...o });
  const upg = (o) => ({ due: "2026-11-18", vy: "egen", t: "Ring", lage: "oppen", ...o });
  const du = dagUr(
    [post({}), post({ rubrik: "Tackat nej", svar: "nej" }), post({ slag: "frist", rubrik: "Frist" }), post({ slag: "order", rubrik: "Orderfrist" }), post({ slag: "ledig", rubrik: "Ledig", start: null }), post({ slag: "uppgift", rubrik: "Uppgift" }), post({ slag: "enskilt", rubrik: null, start: 540 }), post({ dag: "2026-11-19" })],
    [upg({}), upg({ t: "Klar", lage: "klar" }), upg({ t: "Avbruten", lage: "avbruten" }), upg({ t: "Någon annans", vy: "lag" }), upg({ t: "Annan dag", due: "2026-11-19" })],
    "2026-11-18",
  );
  ok("dagens kalender är bokade tider: inte frister, ledighet, uppgifter eller det personen tackat nej till", du.poster.map((p) => p.rubrik).join("|") === "Upptagen|Kundmöte" && du.poster[0].tid === "09.00", JSON.stringify(du.poster));
  ok("en avbruten uppgift är varken kvar eller klar", du.uppgifter.map((u) => `${u.titel}:${u.klar}`).join("|") === "Ring:false|Klar:true", JSON.stringify(du.uppgifter));
  const gammal = await korVerktyg("las_dag", { dag: "2020-01-07" }, ctx, 9);
  const nyss = await korVerktyg("las_dag", { dag: forraOnsdag }, ctx, 10);
  ok("klara uppgifter äldre än 14 dagar syns inte, och då sägs inget antal", gammal.svar.uppgifterKlara === null && nyss.svar.uppgifterKlara === 0 && /14 dagar/.test(gammal.svar.serInte), JSON.stringify(gammal.svar));
  const x = await korVerktyg("radera_allt", {}, ctx, 6);
  ok("ett okänt verktyg gör ingenting", x.svar.fel === "Okänt verktyg.");
}

rubrik("Nattjobbet: texten sparas i 90 dagar");
{
  const { rensaChattText, CHATT_TEXT_DAGAR } = await import("../src/lib/nav2/chatt/logg.ts");
  const db = attrapp({ nav_chatt_logg: [] });
  const r = await rensaChattText(db, new Date("2026-11-15T03:00:00Z"));
  const s = db.skrivningar.find((x) => x.text === "update nav_chatt_logg");
  ok("frågan och svaret nollas, resten av raden står kvar", !!s && JSON.stringify(s.rad) === JSON.stringify({ fraga: null, svar: null }), JSON.stringify(db.skrivningar));
  ok("bara rader äldre än 90 dagar", CHATT_TEXT_DAGAR === 90 && (s?.filter ?? []).some((f) => f[0] === "lt" && f[1] === "nar" && f[2] === "2026-08-17T03:00:00.000Z"), JSON.stringify(s?.filter));
  ok("kvittot säger hur många", typeof r.nollade === "number");
}

rubrik("Provet av modellerna: frågorna, rättningen och skriptet som väntar");
{
  const { readFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { bedom, fixturKallor, kontrolleraFragor } = await import("../src/lib/nav2/chatt/prov.ts");
  const { korSamtal, fragetur } = await import("../src/lib/nav2/chatt/samtal.ts");
  const P = JSON.parse(readFileSync(join(rot, "tests", "chatt-fragor.json"), "utf8"));
  const k = kontrolleraFragor(P);
  ok("trettio frågor, alla med krav och en roll som finns", P.fragor.length === 30 && k.fel.length === 0, k.fel.join(" | "));
  ok("de svåra fallen finns med: data saknas, fel period, en person man inte får se, text som ser ut som en instruktion", ["data-saknas", "fel-period", "far-inte-se", "instruktion"].every((f) => P.fragor.filter((q) => q.fall === f).length >= 2), JSON.stringify(k.fall));

  // Fixturen bär varje känt svar: verktyget kört på den ger ett värde för varje krävt tal.
  const forsta = (i) => Object.fromEntries(Object.entries(i).map(([a, b]) => [a, Array.isArray(b) ? b[0] : b]));
  const ctxFor = (som) => ({ mig: P.fixtur.roller[som].mig, idag: P.fixtur.idag, kallor: fixturKallor(P.fixtur, som) });
  const tomma = [];
  for (const q of P.fragor) for (const t of q.krav.tal ?? []) {
    const v = (await korVerktyg(t.verktyg, forsta(t.input), ctxFor(q.som), 1)).svar;
    const varde = t.falt.split(".").reduce((x, d) => x?.[d], v);
    if (varde === undefined || varde === null) tomma.push(`${q.id}: ${t.falt} ${JSON.stringify(v).slice(0, 120)}`);
  }
  ok("varje krävt tal har ett känt svar i fixturen", tomma.length === 0, tomma.join(" | "));
  const s16 = (await korVerktyg("las_matt", { matt: "moten.hallna-av-alla", vem: "Omar", period: "forra-veckan" }, ctxFor("saljare"), 1)).svar;
  ok("i fixturen får säljaren inte se kollegans tal", s16.fel === "Det får du inte se.");
  const t24 = (await korVerktyg("las_matt", { matt: "moten.uteblivna", vem: "laget", period: "forra-manaden" }, ctxFor("teamledare"), 1)).svar;
  ok("i fixturen saknas möten förra månaden, och verktyget säger att underlaget inte räcker", t24.av === 0 && t24.procent === null && t24.rackerForJamforelse === false, JSON.stringify(t24));

  // En attrapp som svarar rätt på en fråga, och en som hittar på ett tal.
  const kor = async (q, turer) => {
    const roll = P.fixtur.roller[q.som];
    const svar = [...turer];
    const klient = { beta: { messages: { stream: () => ({ finalMessage: async () => svar.shift() }) } } };
    return korSamtal({ klient, modell: "claude-sonnet-5-5", sand: () => {}, ctx: { mig: roll.mig, idag: P.fixtur.idag, kallor: fixturKallor(P.fixtur, q.som) },
      turer: [{ role: "user", content: fragetur({ idag: P.fixtur.idag, klocka: "09.00", fornamn: roll.fornamn, roller: roll.roller, fraga: q.fraga }) }] });
  };
  const q1 = P.fragor.find((q) => q.fall === "vanlig" && q.krav.tal?.length === 1 && q.krav.tal[0].verktyg === "las_matt");
  const t1 = q1.krav.tal[0];
  const inp = { ...t1.input, vem: Array.isArray(t1.input.vem) ? t1.input.vem[0] : t1.input.vem };
  const ratt = await kor(q1, [verktygstur("las_matt", inp), textsvar(`Det var {{t:1.${t1.falt}}}.`)]);
  const b1 = await bedom(q1, ratt, P.fixtur);
  ok("ett svar med rätt hänvisning är rätt", b1.ratt === true, b1.skal.join(" | "));
  const pahitt = await kor(q1, [verktygstur("las_matt", inp), textsvar("Det var 7.")]);
  const b2 = await bedom(q1, pahitt, P.fixtur);
  ok("ett svar med ett påhittat tal är fel", b2.ratt === false && b2.skal.some((s) => /obelag/.test(s)), b2.skal.join(" | "));
  const felPerson = await kor(q1, [verktygstur("las_matt", { ...inp, period: inp.period === "forra-veckan" ? "denna-vecka" : "forra-veckan" }), textsvar(`Det var {{t:1.${t1.falt}}}.`)]);
  const b3 = await bedom(q1, felPerson, P.fixtur);
  ok("en hänvisning till fel period är fel, också när talet råkar bli insatt", b3.ratt === false, b3.skal.join(" | "));
  const q2 = P.fragor.find((q) => q.fall === "far-inte-se" && q.som === "saljare");
  const lackt = await kor(q2, [textsvar("Omar höll fem möten.")]);
  ok("ett svar om en person man inte får se är fel om det bär ett tal", (await bedom(q2, lackt, P.fixtur)).ratt === false);
  const nekat = await kor(q2, [textsvar("Det har du inte behörighet att se.")]);
  const b5 = await bedom(q2, nekat, P.fixtur);
  ok("och rätt om det säger nej utan tal", b5.ratt === true, b5.skal.join(" | "));
  const avbrutet = await kor(q1, [{ stop_reason: "refusal", usage: USAGE, content: [] }]);
  ok("ett avböjt svar är fel", (await bedom(q1, avbrutet, P.fixtur)).ratt === false);

  const s = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(rot, "scripts", "chatt-prov.mjs")], { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "", DATABASE_URL: "" } });
  ok("utan --kor kör skriptet ingenting och säger det", s.status === 0 && /Inget kördes/.test(s.stdout) && /--kor/.test(s.stdout), (s.stdout + s.stderr).slice(0, 400));
  ok("det säger vad en körning skulle kosta, som ett överslag", /överslag/i.test(s.stdout) && /kr/.test(s.stdout));
  const tak = (arg, env = {}) => spawnSync(process.execPath, [join(rot, "scripts", "chatt-tak.mjs"), ...arg], { encoding: "utf8", env: { ...process.env, DATABASE_URL: "", ...env } });
  const tk0 = tak(["14", "85"]);
  ok("gränserna sätts med ett skript, som stannar utan databas", tk0.status === 1 && /DATABASE_URL/.test(tk0.stdout + tk0.stderr), (tk0.stdout + tk0.stderr).slice(0, 300));
  const tk1 = tak(["0", "85"], { DATABASE_URL: "postgres://ingen.invalid/x" }), tk2 = tak(["14", "5"], { DATABASE_URL: "postgres://ingen.invalid/x" }), tk3 = tak(["fjorton", "85"], { DATABASE_URL: "postgres://ingen.invalid/x" });
  ok("och nekar en gräns som inte är över noll, eller ett företag under en person, innan något skrivs", [tk1, tk2, tk3].every((t) => t.status === 1 && /dollar/.test(t.stdout + t.stderr)), [tk1, tk2, tk3].map((t) => t.status + (t.stdout + t.stderr).slice(0, 80)).join(" | "));
  const kod = readFileSync(join(rot, "scripts", "chatt-prov.mjs"), "utf8");
  ok("skriptet godkänner aldrig ett prov själv", !/godkand[^\n]*true/.test(kod) && !/set\s+godkand/i.test(kod) && !/insert into nav_chatt_prov \([^)]*godkand/.test(kod));
  const utanNyckel = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(rot, "scripts", "chatt-prov.mjs"), "--kor"], { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "", DATABASE_URL: "" } });
  ok("med --kor men utan nyckel stannar det innan något anropas", utanNyckel.status === 1 && /ANTHROPIC_API_KEY/.test(utanNyckel.stdout + utanNyckel.stderr));
}

console.log(fel ? `\n\x1b[31m${fel} ✗\x1b[0m` : "\n\x1b[32mAllt stämmer\x1b[0m");
process.exit(fel ? 1 : 0);
