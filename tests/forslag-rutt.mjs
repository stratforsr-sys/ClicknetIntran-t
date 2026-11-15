#!/usr/bin/env node
/**
 * Rutten /nav2/forslag: vem som får välja, ångra, kommentera, berätta om en ändring och ändra inställningarna.
 *
 * Rutten körs på riktigt, men inloggningen och databasen är attrapper (samma mönster som
 * tests/moten-rutt-behorighet.mjs): ingen riktig persons session behövs, och ingenting når produktionen.
 * Attrappen bokför varje skrivning och varje rpc-anrop, så ett behörighetsfel som släpper igenom syns som en
 * skrivning, inte bara som fel status. Att två klick ger ett beslut prövas mot den riktiga databasen i
 * tests/forslag-db.mjs; här prövas att rutten svarar 409 när databasen säger att valet redan är gjort.
 *
 *   node --experimental-strip-types tests/forslag-rutt.mjs
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
    if (spec === "@/lib/fel-server") return stubb("export const skrivFel = async (f) => { (globalThis.__fel ??= []).push(f); return true; };");
    if (spec === "@/lib/notishandelse-server") return stubb("export const notifiera = async () => {};");
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
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const H = "b0000000-0000-4000-8000-000000000001"; // den som håller mötet
const B = "b0000000-0000-4000-8000-000000000002"; // den som bokade
const X = "b0000000-0000-4000-8000-000000000003"; // en annan säljare
const TL = "b0000000-0000-4000-8000-000000000004"; // teamledaren för H och B
const ADM = "b0000000-0000-4000-8000-000000000005";
const M = "c0000000-0000-4000-8000-000000000001";
const K = "d0000000-0000-4000-8000-000000000001";
const F = "e0000000-0000-4000-8000-000000000001";
const UPPG = "a0000000-0000-4000-8000-000000000001";
const LAG = "a1000000-0000-4000-8000-000000000001";

/**
 * En attrapp av supabase-js. Läsningar svarar ur `tabeller` med de filter rutten sätter (eq, in, is, gte, lte, gt,
 * lt). Som REST-lagret kapar den ett svar vid 1000 rader utan att säga det: bara `range` ger resten.
 * Skrivningar bokförs med raden, och rpc-anrop svaras av `rpc` (ett okänt anrop ger fel, så att inget går
 * igenom av en slump).
 */
function attrapp(tabeller, rpc = {}) {
  const skrivningar = [];
  const SKRIV = new Set(["insert", "update", "delete", "upsert"]);
  const fraga = (tabell) => {
    let skriver = null;
    let en = false;
    let omfang = null;
    const filter = [];
    const svaret = () => {
      if (skriver) return { data: skriver.rad ? [{ id: "ny", ...skriver.rad }] : null, error: skriver.fel ?? null };
      const rader = (tabeller[tabell] ?? []).filter((r) => filter.every((f) => f(r)));
      const sida = omfang ? rader.slice(omfang[0], Math.min(omfang[1] + 1, omfang[0] + 1000)) : rader.slice(0, 1000);
      return en ? { data: rader[0] ?? null, error: null } : { data: sida, error: null, count: rader.length };
    };
    const jamfor = (test) => (kol, varde) => {
      if (!skriver) filter.push((r) => test(r[kol], varde));
      return kedja;
    };
    const kedja = new Proxy(
      {},
      {
        get(_, namn) {
          if (namn === "then") return (a, b) => Promise.resolve(svaret()).then(a, b);
          if (SKRIV.has(namn)) {
            return (rad) => {
              skriver = { rad: Array.isArray(rad) ? rad[0] : rad, fel: tabeller[`${tabell}!fel`] ?? null };
              skrivningar.push({ text: `${String(namn)} ${tabell}`, rad: skriver.rad });
              return kedja;
            };
          }
          if (namn === "eq") return jamfor((a, b) => a === b);
          if (namn === "neq") return jamfor((a, b) => a !== b);
          if (namn === "in") return jamfor((a, b) => b.includes(a));
          if (namn === "is") return jamfor((a, b) => (a ?? null) === b);
          if (namn === "gte") return jamfor((a, b) => a >= b);
          if (namn === "lte") return jamfor((a, b) => a <= b);
          if (namn === "gt") return jamfor((a, b) => a > b);
          if (namn === "lt") return jamfor((a, b) => a < b);
          if (namn === "range") return (fran, till) => { omfang = [fran, till]; return kedja; };
          if (namn === "maybeSingle" || namn === "single") {
            return () => {
              en = true;
              const s = svaret();
              return Promise.resolve(skriver ? { data: s.data?.[0] ?? null, error: s.error } : s);
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
    rpc: (namn, arg) => {
      skrivningar.push({ text: `rpc ${namn}`, arg });
      if (!(namn in rpc)) return Promise.resolve({ data: null, error: { message: `attrapp: ${namn}`, code: "XX000" } });
      return Promise.resolve({ data: typeof rpc[namn] === "function" ? rpc[namn](arg) : rpc[namn], error: null });
    },
  };
}

const I_MORGON = new Date(Date.now() + 20 * 3600e3).toISOString();
const dag = (iso) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const NYCKEL = `${M}@${dag(I_MORGON)}@${H}`;

const forslag = (o = {}) => ({
  id: F, sort: "forslag", regel: "moten.obekraftat", nyckel: NYCKEL, kalla: "regel", om: H, lag: null, skapad: new Date().toISOString(),
  belagg: { mote: M, forsok: 2 }, trodde: { n: 1, av: 4 }, val: ["ringer-sjalv", "flytta", "lat-sta"], doms_dag: "2026-11-18", utgar: I_MORGON,
  text: null, prov: false, beslut_id: null, beslut: null, beslut_av: null, atgard: null, kommentar: null, matning: null, dom: null, ...o,
});
const tabeller = (o = {}) => ({
  nav_forslag_lage: [forslag(o.forslag)],
  mote: [{ id: M, kedja_id: K, bokat_av: B, halls_av: H, bokat_nar: "2026-11-10T09:00:00Z", flyttad_nar: null, mote_tid: I_MORGON, art: "ny", bekraftat_nar: null, utfall: null, utfall_nar: null, forsok: 2, ...(o.mote ?? {}) }],
  mote_kort: [{ kedja_id: K, namn: "PROV Hagby Glas", kontakt: "Prov Person", telefon: "+46700000000" }],
  employee: [{ id: H, first_name: "Hanna", last_name: "Prov", status: "active", team_id: LAG }, { id: B, first_name: "Mick", last_name: "Prov", status: "active", team_id: LAG }, { id: X, first_name: "Xerxes", last_name: "Prov", status: "active", team_id: null }],
  team: [{ id: LAG, name: "Prov-laget", lead_id: TL }],
  nav_setting: [],
  ...(o.extra ?? {}),
});

const { GET, POST } = await import("../src/app/nav2/forslag/route.ts");

async function anropa(roller, id, kropp, o = {}) {
  const db = attrapp(tabeller(o), {
    nav_forslag_valj: () => "f1000000-0000-4000-8000-000000000001",
    nav_forslag_angra: () => "f1000000-0000-4000-8000-000000000001",
    mote_bekrafta_overta: () => ({ task: UPPG, fran: B, ny: false }),
    mote_bekrafta_aterlamna: () => true,
    mote_statkrets: () => (roller.some((r) => ["sales_manager", "ceo", "admin"].includes(r)) ? null : roller.includes("team_lead") ? [id, H, B] : [id]),
    ...(o.rpc ?? {}),
  });
  globalThis.__rutt = { db, user: { employee: { id, first_name: "Prov", last_name: "Person", team_id: null }, roles: roller, permissions: [] } };
  const req = kropp === null
    ? new Request(`https://nav.test/nav2/forslag?${o.fraga ?? ""}`, { headers: { origin: "https://nav.test" } })
    : new Request("https://nav.test/nav2/forslag", { method: "POST", headers: { origin: o.ursprung ?? "https://nav.test", "content-type": "application/json" }, body: JSON.stringify(kropp) });
  let status = 0, text = "", data = null;
  try {
    const res = kropp === null ? await GET(req) : await POST(req);
    status = res.status;
    text = await res.text();
    try { data = JSON.parse(text); } catch { /* inte JSON */ }
  } catch (e) {
    text = `kastade: ${e instanceof Error ? e.stack : String(e)}`;
  }
  const skriv = db.skrivningar.filter((s) => s.text !== "rpc mote_statkrets");
  return { status, text: text.slice(0, 400), data, skrivningar: skriv, lista: skriv.map((x) => x.text).join(", ") };
}
const visa = (r) => `${r.status} ${r.lista || "inga skrivningar"} ${r.text.slice(0, 160)}`;

rubrik("Välj: bara den som håller mötet");
{
  const r = await anropa(["salesperson"], X, { handling: "valj", forslag: F, val: "lat-sta" });
  ok("en annan säljare nekas, och ingenting skrivs", r.status === 403 && r.skrivningar.length === 0, visa(r));
  const c = await anropa(["sales_manager"], ADM, { handling: "valj", forslag: F, val: "lat-sta" });
  ok("en chef väljer inte åt den som håller mötet", c.status === 403 && c.skrivningar.length === 0, visa(c));
  const s = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "lat-sta" });
  ok("den som håller mötet väljer Låt stå", s.status === 200 && s.lista === "rpc nav_forslag_valj", visa(s));
  ok("valet sparas med vem och vad", s.skrivningar[0]?.arg?.p_forslag === F && s.skrivningar[0].arg.p_av === H && s.skrivningar[0].arg.p_data?.val === "lat-sta");
  ok("kvittot säger vad som gjordes och när domen kommer", /^Klart\. Mötet står kvar som det är\. .+ säger jag hur det gick\.$/.test(s.data?.ok ?? ""), s.data?.ok);
  ok("svaret säger att valet går att ångra", s.data?.angra === true && s.data?.forslag === F);
}

rubrik("Välj: ett val per förslag");
{
  const r = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "lat-sta" }, { rpc: { nav_forslag_valj: () => null } });
  ok("databasen säger att valet redan är gjort: 409", r.status === 409 && r.data?.fel === "Valet är redan gjort.", visa(r));
  ok("och ingen åtgärd görs", r.lista === "rpc nav_forslag_valj", r.lista);
  const redan = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "lat-sta" }, { forslag: { beslut_id: "x", beslut: { val: "lat-sta" }, beslut_av: H } });
  ok("ett förslag med ett val svarar 409 utan att skriva", redan.status === 409 && redan.skrivningar.length === 0, visa(redan));
  const domd = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "lat-sta" }, { forslag: { dom: { utfall: "hallet" } } });
  ok("ett dömt förslag går inte att välja i", domd.status === 409 && domd.skrivningar.length === 0, visa(domd));
  const okant = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "avboka" });
  ok("ett val som inte lades fram nekas", okant.status === 400 && okant.skrivningar.length === 0, visa(okant));
  const flytt = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "flytta" });
  ok("Flytta sparas inte här, utan när mötet är flyttat", flytt.status === 400 && flytt.skrivningar.length === 0, visa(flytt));
  const borta = await anropa(["salesperson"], H, { handling: "valj", forslag: "e0000000-0000-4000-8000-0000000000ff", val: "lat-sta" });
  ok("ett förslag som inte finns: 404", borta.status === 404 && borta.skrivningar.length === 0, visa(borta));
}

rubrik("Välj: förslaget gäller bara så länge läget gör det");
{
  const bekr = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "ringer-sjalv" }, { mote: { bekraftat_nar: new Date().toISOString() } });
  ok("mötet har blivit bekräftat: 409 och ingenting skrivs", bekr.status === 409 && bekr.skrivningar.length === 0, visa(bekr));
  const gammalt = new Date(Date.now() - 3600e3).toISOString();
  const sent = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "lat-sta" }, { forslag: { utgar: gammalt, nyckel: `${M}@${dag(gammalt)}@${H}` }, mote: { mote_tid: gammalt } });
  ok("mötet har börjat: 409 och ingenting skrivs", sent.status === 409 && sent.skrivningar.length === 0, visa(sent));
}

rubrik("Jag ringer själv");
{
  const r = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "ringer-sjalv" });
  ok("valet, överlämningen och åtgärden skrivs i den ordningen", r.status === 200 && r.lista === "rpc nav_forslag_valj, rpc mote_bekrafta_overta, insert nav_forslag_handelse", visa(r));
  const overta = r.skrivningar[1]?.arg ?? {};
  ok("uppgiften går till den som håller mötet, i dag", overta.p_mote === M && overta.p_till === H && overta.p_dag === dag(new Date().toISOString()), JSON.stringify(overta).slice(0, 200));
  ok("uppgiften heter som bokarens", overta.p_titel === "Bekräfta mötet med PROV Hagby Glas", overta.p_titel);
  const atgard = r.skrivningar[2]?.rad ?? {};
  ok("åtgärden bär uppgiftens id och vem den togs från", atgard.forslag === F && atgard.sort === "atgard" && atgard.av === H && atgard.data?.uppgift === UPPG && atgard.data?.fran === B && atgard.data?.ny === false, JSON.stringify(atgard));
  ok("kvittot", r.data?.ok?.startsWith("Klart. Bekräftelsen ligger i din lista i dag."), r.data?.ok);

  const lopp = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "ringer-sjalv" }, { rpc: { mote_bekrafta_overta: () => null } });
  ok("går uppgiften inte att ta över tas valet tillbaka", lopp.status === 409 && lopp.lista === "rpc nav_forslag_valj, rpc mote_bekrafta_overta, rpc nav_forslag_angra", visa(lopp));
}

rubrik("Ångra");
{
  const medVal = { beslut_id: "f1000000-0000-4000-8000-000000000001", beslut: { val: "ringer-sjalv" }, beslut_av: H, atgard: { uppgift: UPPG, fran: B, ny: false } };
  const r = await anropa(["salesperson"], H, { handling: "angra", forslag: F }, { forslag: medVal });
  ok("ångra skrivs och uppgiften lämnas tillbaka", r.status === 200 && r.lista === "rpc nav_forslag_angra, rpc mote_bekrafta_aterlamna", visa(r));
  const tillbaka = r.skrivningar[1]?.arg ?? {};
  ok("uppgiften går tillbaka till den som hade den", tillbaka.p_task === UPPG && tillbaka.p_fran === B && tillbaka.p_ny === false && tillbaka.p_av === H, JSON.stringify(tillbaka));
  ok("svaret säger att förslaget är öppet igen", r.data?.oppet === true && /öppet igen/.test(r.data?.ok ?? ""), r.text);
  const annan = await anropa(["salesperson"], X, { handling: "angra", forslag: F }, { forslag: medVal });
  ok("någon annan ångrar inte", annan.status === 403 && annan.skrivningar.length === 0, visa(annan));
  const inget = await anropa(["salesperson"], H, { handling: "angra", forslag: F });
  ok("utan val finns inget att ångra", inget.status === 409 && inget.skrivningar.length === 0, visa(inget));
  const latsta = await anropa(["salesperson"], H, { handling: "angra", forslag: F }, { forslag: { beslut_id: "x", beslut: { val: "lat-sta" }, beslut_av: H } });
  ok("Låt stå ångras utan att någon uppgift rörs", latsta.status === 200 && latsta.lista === "rpc nav_forslag_angra", visa(latsta));
  const domd = await anropa(["salesperson"], H, { handling: "angra", forslag: F }, { forslag: { ...medVal, dom: { utfall: "hallet" } } });
  ok("efter domen går valet inte att ångra", domd.status === 409 && domd.skrivningar.length === 0, visa(domd));
}

rubrik("Personens egen rad");
{
  const r = await anropa(["salesperson"], H, { handling: "kommentar", forslag: F, text: "  Kunden bad om ny tid, bokas om på måndag.  " });
  ok("den raden handlar om skriver en rad", r.status === 200 && r.lista === "insert nav_forslag_handelse" && r.skrivningar[0].rad.sort === "kommentar" && r.skrivningar[0].rad.data.text === "Kunden bad om ny tid, bokas om på måndag.", visa(r));
  const lang = await anropa(["salesperson"], H, { handling: "kommentar", forslag: F, text: "x".repeat(201) });
  ok("över 200 tecken: 400", lang.status === 400 && lang.skrivningar.length === 0, visa(lang));
  const tom = await anropa(["salesperson"], H, { handling: "kommentar", forslag: F, text: "   " });
  ok("en tom rad: 400", tom.status === 400 && tom.skrivningar.length === 0, visa(tom));
  const chef = await anropa(["sales_manager"], ADM, { handling: "kommentar", forslag: F, text: "Chefens ord" });
  ok("chefen skriver inte personens rad", chef.status === 403 && chef.skrivningar.length === 0, visa(chef));
}

rubrik("Berätta om en ändring");
{
  const bas = { handling: "beratta", text: "Vi ringer kunden dagen före i stället för samma dag.", fran: "2026-11-13", matt: "moten.uteblivna" };
  const jag = await anropa(["salesperson"], X, { ...bas, om: "jag" });
  const rad = jag.skrivningar[0]?.rad ?? {};
  ok("alla får berätta om sig själva", jag.status === 200 && jag.lista === "insert nav_forslag", visa(jag));
  ok("raden är en ändring från en person, med måttet och motvikten", rad.sort === "andring" && rad.kalla === "person" && rad.om === X && rad.lag === null && rad.skapad_av === X && rad.regel === "moten.uteblivna"
    && rad.foljer?.matt === "moten.uteblivna" && rad.foljer?.motvikt === "moten.hallna-av-alla" && rad.foljer?.fran === "2026-11-13" && rad.foljer?.version === 1 && rad.text === bas.text, JSON.stringify(rad).slice(0, 300));
  const utanfor = await anropa(["team_lead"], TL, { ...bas, om: X });
  ok("en person utanför kretsen: 403", utanfor.status === 403 && utanfor.skrivningar.length === 0, visa(utanfor));
  const annan = await anropa(["salesperson"], X, { ...bas, om: H });
  ok("en säljare berättar inte om en kollega", annan.status === 403 && annan.skrivningar.length === 0, visa(annan));
  const inom = await anropa(["team_lead"], TL, { ...bas, om: H });
  ok("teamledaren berättar om en i sitt lag", inom.status === 200 && inom.skrivningar[0]?.rad?.om === H && inom.skrivningar[0].rad.skapad_av === TL, visa(inom));
  const laget = await anropa(["team_lead"], TL, { ...bas, om: "laget" });
  ok("teamledarens laget är det egna laget", laget.status === 200 && laget.skrivningar[0]?.rad?.lag === LAG && laget.skrivningar[0].rad.om === null, visa(laget));
  const alla = await anropa(["sales_manager"], ADM, { ...bas, om: "laget" });
  ok("säljchefens laget är hela företaget", alla.status === 200 && alla.skrivningar[0]?.rad?.lag === null && alla.skrivningar[0].rad.om === null, visa(alla));
  const saljLaget = await anropa(["salesperson"], X, { ...bas, om: "laget" });
  ok("en säljare berättar inte för laget", saljLaget.status === 403 && saljLaget.skrivningar.length === 0, visa(saljLaget));
  const antal = await anropa(["salesperson"], X, { ...bas, om: "jag", matt: "order.netto" });
  ok("ett mått av sorten antal går inte att följa än", antal.status === 400 && antal.skrivningar.length === 0, visa(antal));
  const okant = await anropa(["salesperson"], X, { ...bas, om: "jag", matt: "moten.pahittat" });
  ok("ett okänt mått: 400", okant.status === 400 && okant.skrivningar.length === 0, visa(okant));
  const utanText = await anropa(["salesperson"], X, { ...bas, om: "jag", text: " " });
  ok("utan text: 400", utanText.status === 400 && utanText.skrivningar.length === 0, visa(utanText));
  const felDag = await anropa(["salesperson"], X, { ...bas, om: "jag", fran: "13/11" });
  ok("en dag som inte är en dag: 400", felDag.status === 400 && felDag.skrivningar.length === 0, visa(felDag));
  const dubbel = await anropa(["salesperson"], X, { ...bas, om: "jag" }, { extra: { "nav_forslag!fel": { code: "23505", message: "duplicate" } } });
  ok("samma ändring två gånger: 409", dubbel.status === 409 && dubbel.data?.fel === "Den ändringen finns redan.", visa(dubbel));
  ok("samma ändring får samma nyckel", jag.skrivningar[0].rad.nyckel === dubbel.skrivningar[0].rad.nyckel && jag.skrivningar[0].rad.nyckel.length > 10, jag.skrivningar[0].rad.nyckel);
}

rubrik("Pröva med laget");
{
  const bas = { handling: "prova", text: "Alla ringer kunden dagen före.", fran: "2026-11-16", matt: "moten.uteblivna" };
  const salj = await anropa(["salesperson"], X, bas);
  ok("en säljare prövar inte med laget", salj.status === 403 && salj.skrivningar.length === 0, visa(salj));
  const tl = await anropa(["team_lead"], TL, bas);
  ok("teamledaren lägger in en ändring för sitt lag", tl.status === 200 && tl.skrivningar[0]?.rad?.lag === LAG && tl.skrivningar[0].rad.sort === "andring" && tl.skrivningar[0].rad.foljer?.avsikt === "prova", visa(tl));
}

rubrik("Inställningarna");
{
  const salj = await anropa(["salesperson"], X, { handling: "installningar", nyckel: "forslag.grans-facit", varde: 0.02 });
  ok("en säljare ändrar inga inställningar", salj.status === 403 && salj.skrivningar.length === 0, visa(salj));
  const utanfor = await anropa(["admin"], ADM, { handling: "installningar", nyckel: "forslag.grans-facit", varde: 0.5 });
  ok("gränsen för facit utanför 0,001–0,1: 400", utanfor.status === 400 && utanfor.skrivningar.length === 0, visa(utanfor));
  const inom = await anropa(["admin"], ADM, { handling: "installningar", nyckel: "forslag.grans-facit", varde: 0.02 });
  ok("en admin ändrar en gräns", inom.status === 200 && inom.lista === "upsert nav_setting" && inom.skrivningar[0].rad.key === "forslag.grans-facit" && inom.skrivningar[0].rad.value === 0.02 && inom.skrivningar[0].rad.updated_by === ADM, visa(inom));
  const ribba = await anropa(["team_lead"], TL, { handling: "installningar", nyckel: "forslag.grans-dom", varde: 0.2 });
  ok("en teamledare flyttar inte ribban för domen", ribba.status === 403 && ribba.skrivningar.length === 0, visa(ribba));
  const tid = await anropa(["team_lead"], TL, { handling: "installningar", nyckel: "forslag.obekraftat-tid", varde: "13:30" });
  ok("en teamledare ändrar klockslaget", tid.status === 200 && tid.skrivningar[0]?.rad?.key === "forslag.obekraftat-tid", visa(tid));
  const brytare = await anropa(["team_lead"], TL, { handling: "installningar", nyckel: "forslag.pa", varde: true });
  ok("en teamledare slår inte på förslagen", brytare.status === 403 && brytare.skrivningar.length === 0, visa(brytare));
  const pa = await anropa(["admin"], ADM, { handling: "installningar", nyckel: "forslag.pa", varde: true });
  ok("en admin slår på förslagen", pa.status === 200 && pa.skrivningar[0]?.rad?.value === true, visa(pa));
  const hem = await anropa(["admin"], ADM, { handling: "installningar", nyckel: "hem.nytt", varde: [H, "b0000000-0000-4000-8000-0000000000ee"] });
  ok("nya hemmet ges bara till personer som finns", hem.status === 400 && hem.skrivningar.length === 0, visa(hem));
  const hemOk = await anropa(["admin"], ADM, { handling: "installningar", nyckel: "hem.nytt", varde: [H] });
  ok("nya hemmet till en person som finns", hemOk.status === 200 && hemOk.lista === "upsert nav_setting", visa(hemOk));
  const annan = await anropa(["admin"], ADM, { handling: "installningar", nyckel: "moten.tidszon", varde: "Europe/Stockholm" });
  ok("Mötens inställningar sparas inte här", annan.status === 400 && annan.skrivningar.length === 0, visa(annan));
}

rubrik("Läsningarna");
{
  const facit = await anropa(["salesperson"], X, null, { fraga: "las=facit" });
  ok("lagets facit är inte säljarens", facit.status === 403, visa(facit));
  const okand = await anropa(["admin"], ADM, null, { fraga: "las=allt" });
  ok("en okänd läsning: 400", okand.status === 400, visa(okand));
  const ett = await anropa(["salesperson"], H, null, { fraga: `las=forslag&id=${F}` });
  ok("förslaget läses med Navs tre rader", ett.status === 200 && Array.isArray(ett.data?.forslag?.rader) && ett.data.forslag.rader.length === 3, visa(ett));
  ok("första raden säger läget", /^Mötet med PROV Hagby Glas .+ är inte bekräftat\. Mick har ringt två gånger utan svar\.$/.test(ett.data?.forslag?.rader?.[0] ?? ""), ett.data?.forslag?.rader?.[0]);
  ok("andra raden är det Nav trodde när raden skapades", ett.data?.forslag?.rader?.[1]?.startsWith("Hittills har 1 av 4 obekräftade möten hållits."), ett.data?.forslag?.rader?.[1]);
  ok("källraden säger hur texten kom till", ett.data?.forslag?.kalla === "Räknat av regler", ett.data?.forslag?.kalla);
  ok("läsningen skriver ingenting", ett.skrivningar.length === 0, ett.lista);
}

rubrik("Teamet i månaden");
{
  const idag = new Date(), manad = dag(idag.toISOString()).slice(0, 7), forra = new Date(Date.UTC(idag.getUTCFullYear(), idag.getUTCMonth() - 1, 15)).toISOString().slice(0, 7);
  const o = (id, salj, d, x = {}) => ({ id, salesperson_id: salj, status: "signerad", signed_on: d, period_month: `${d.slice(0, 7)}-01`, cancelled_on: null, cancel_period_month: null, ...x });
  const extra = {
    sales_order: [o("o1", H, `${manad}-02`), o("o2", H, `${manad}-03`), o("o3", B, `${manad}-03`, { status: "inskickad" }), o("o4", H, `${forra}-05`), o("o5", B, `${forra}-20`)],
    sales_target: [{ employee_id: H, target_orders: 8, period_month: `${manad}-01` }],
    nav_takt_dag: [],
  };
  const salj = await anropa(["salesperson"], X, null, { fraga: "las=team", extra });
  ok("en säljare får inte lagets tal", salj.status === 403, visa(salj));
  const tl = await anropa(["team_lead"], TL, null, { fraga: "las=team", extra });
  const t = tl.data?.team;
  ok("teamledaren får genomgången", tl.status === 200 && !!t, visa(tl));
  ok("kortets tal: netto, väntande och målet", t?.kort?.netto === 2 && t.kort.vantar === 1 && t.kort.mal === 8 && t.kort.manad === manad, String(JSON.stringify(t?.kort)).slice(0, 300));
  ok("det stora talet är order av målet", t?.kort?.text?.stort === "2 av 8 order", t?.kort?.text?.stort);
  ok("den som har order men inget mål nämns", t?.kort?.utanMal === 0 || t?.kort?.text?.malrad?.startsWith("Mål saknas"), JSON.stringify(t?.kort?.text));
  ok("en rad per person som har något att visa", Array.isArray(t?.personer) && t.personer.some((p) => p.namn.startsWith("Hanna") && p.order === 2), JSON.stringify(t?.personer));
  ok("uträkningen står i klartext, eller säger att ingen arbetsdag har gått", typeof t?.utrakning === "string" && (/gånger månadens \d+ arbetsdagar/.test(t.utrakning) || /ingen arbetsdag/i.test(t.utrakning)), t?.utrakning);
  ok("förra månaden står i taktens facit, räknad i efterhand", Array.isArray(t?.takten) && t.takten[0]?.manad === forra && t.takten[0].blev === 2 && t.takten[0].efterhand === true, JSON.stringify(t?.takten));
  ok("lagets öppna rad om obekräftade möten står överst", /^Obekräftade möten .*: 1, utan val\.$/.test(t?.oppna ?? ""), t?.oppna);
  ok("källraden och det Nav inte ser", t?.kalla === "Räknat av regler" && t?.serInte?.startsWith("Det här ser jag inte:"), JSON.stringify([t?.kalla, t?.serInte]));
  ok("läsningen skriver ingenting", tl.skrivningar.length === 0, tl.lista);
  // REST-lagret kapar ett svar vid 1000 rader utan att säga det. Lagets tal läses därför sida för sida.
  const hanna = (r) => r.data?.team?.personer?.find((p) => p.namn.startsWith("Hanna"));
  const manga = Array.from({ length: 1200 }, (_x, i) => o(`fler${i}`, H, `${manad}-02`));
  const stor = await anropa(["team_lead"], TL, null, { fraga: "las=team", extra: { ...extra, sales_order: [...extra.sales_order, ...manga] } });
  ok("fler än tusen order: alla räknas, inte bara första sidan", stor.data?.team?.kort?.netto === 1202 && hanna(stor)?.order === 1202, `${stor.status} netto ${stor.data?.team?.kort?.netto}, Hanna ${hanna(stor)?.order}`);
  const moten = Array.from({ length: 1100 }, (_x, i) => ({ id: `mm${i}`, kedja_id: `kk${i}`, bokat_av: B, halls_av: H, bokat_nar: `${manad}-01T08:00:00Z`, mote_tid: `${manad}-01T10:00:00Z`, art: "ny", utfall: "hallet", resultat: null, kalla: null, bekraftat_nar: null }));
  const mm = await anropa(["team_lead"], TL, null, { fraga: "las=team", extra: { ...extra, mote: moten } });
  ok("fler än tusen möten: alla räknas", hanna(mm)?.hallna === 1100 && mm.data?.team?.personer?.find((p) => p.namn.startsWith("Mick"))?.bokade === 1100, `${mm.status} ${JSON.stringify(mm.data?.team?.personer)}`.slice(0, 300));
}

rubrik("Det som ändrats, och hemmets lilla läsning");
{
  const rader = [
    forslag({ id: "e0000000-0000-4000-8000-0000000000a1", beslut_id: "b1", beslut: { val: "lat-sta" }, beslut_av: H, beslut_nar: "2026-11-13T09:00:00Z", dom: { utfall: "hallet", bekraftat: false, matt: "moten.hallna-av-alla", version: 1 }, dom_nar: "2026-11-14T02:00:00Z" }),
    forslag({ id: "e0000000-0000-4000-8000-0000000000a2", sort: "andring", regel: "moten.uteblivna", nyckel: "andring-1", kalla: "person", om: H, text: "Jag ringer kunden dagen före.", foljer: { matt: "moten.uteblivna", motvikt: "moten.hallna-av-alla", fran: "2026-10-21" },
      dom: { dom: { sort: "ser-bra-ut", stangd: true, restenOcksa: false, helaLaget: true }, tal: "0 av 20 uteblev. Bokade per vecka: 6 före, 7 efter." }, dom_nar: "2026-11-15T02:00:00Z" }),
    forslag({ id: "e0000000-0000-4000-8000-0000000000a3", sort: "andring", regel: "moten.uteblivna", nyckel: "andring-2", kalla: "installning", om: null, text: "Bekräftelsen öppnar 1 arbetsdag före mötet i stället för 2.", foljer: { matt: "moten.uteblivna", motvikt: "moten.hallna-av-alla", fran: "2026-11-13" },
      matning: { dom: { sort: "inget-fore", stangd: false, restenOcksa: false, helaLaget: true }, tal: "1 av 3 uteblev. Bokade per vecka: 4 före, 5 efter." }, matning_nar: "2026-11-15T02:00:00Z", skapad: "2026-11-13T10:00:00Z" }),
  ];
  const r = await anropa(["salesperson"], H, null, { fraga: "las=andrat", extra: { nav_forslag_lage: rader } });
  const a = r.data?.andrat ?? [];
  const hitta = (id) => a.find((x) => x.id.endsWith(id)) ?? {};
  ok("läsningen ger tre rader och skriver ingenting", r.status === 200 && a.length === 3 && r.skrivningar.length === 0, visa(r));
  ok("ett dömt förslag: vad som valdes och hur det gick, aldrig en dom över mötet", hitta("a1").text === "PROV Hagby Glas: du valde att låta mötet stå. Mötet hölls. Mötet blev aldrig bekräftat." && hitta("a1").dom === null && hitta("a1").ton === "vet", JSON.stringify(hitta("a1")));
  ok("en ändring som ser bra ut: domen i ord, talen bredvid och en pil upp", hitta("a2").dom === "Ser bra ut. Hela laget ändrade sig samtidigt, så jag har inget att jämföra med." && hitta("a2").tal === "0 av 20 uteblev. Bokade per vecka: 6 före, 7 efter." && hitta("a2").ton === "upp" && hitta("a2").stangd === true, JSON.stringify(hitta("a2")));
  ok("en ändring utan före att jämföra med: Nav säger det, och visar antal", hitta("a3").dom === "Inget före att jämföra med." && hitta("a3").tal?.startsWith("1 av 3 uteblev.") && hitta("a3").ton === "vet" && hitta("a3").stangd === false && hitta("a3").fran === "installning", JSON.stringify(hitta("a3")));
  ok("nyast först", a[0].id.endsWith("a2") && a[2].id.endsWith("a1"), a.map((x) => x.id.slice(-2)).join(" "));
  ok("raden säger vem den gäller: läsaren själv, eller alla när det är en inställning", hitta("a1").galler === "dig" && hitta("a2").galler === "dig" && hitta("a3").galler === "alla", a.map((x) => x.galler).join(" "));
  ok("måtten som går att följa är andelar", Array.isArray(r.data?.matt) && r.data.matt.length === 3 && r.data.matt.every((m) => m.nyckel.startsWith("moten.")), JSON.stringify(r.data?.matt?.map((m) => m.nyckel)));
  ok("säljaren får inte berätta för laget", r.data?.farLaget === false);
  ok("säljarens krets är hen själv", JSON.stringify(r.data?.krets) === JSON.stringify([H]), JSON.stringify(r.data?.krets));
  const chef = await anropa(["team_lead"], TL, null, { fraga: "las=andrat", extra: { nav_forslag_lage: rader } });
  ok("hos chefen gäller raden en person, och en ändring för laget gäller laget", chef.data?.andrat.find((x) => x.id.endsWith("a1"))?.galler === "person" && (await anropa(["team_lead"], TL, null, { fraga: "las=andrat", extra: { nav_forslag_lage: [{ ...rader[1], om: null, lag: "l1" }] } })).data?.andrat[0]?.galler === "laget", JSON.stringify(chef.data?.andrat?.map((x) => x.galler)));
  ok("chefen får sin krets, så att formuläret bara listar dem hen får berätta om", JSON.stringify([...(chef.data?.krets ?? [])].sort()) === JSON.stringify([H, B, TL].sort()), JSON.stringify(chef.data?.krets));
  ok("den som ser alla får null i stället för en lista", (await anropa(["sales_manager"], ADM, null, { fraga: "las=andrat", extra: { nav_forslag_lage: rader } })).data?.krets === null);
  ok("hos chefen står personens namn på raden", chef.data?.farLaget === true && chef.data.andrat.find((x) => x.id.endsWith("a1"))?.text === "PROV Hagby Glas: Hanna valde att låta mötet stå. Mötet hölls. Mötet blev aldrig bekräftat." && chef.data.andrat.find((x) => x.id.endsWith("a1"))?.vem === "Hanna", JSON.stringify(chef.data?.andrat?.[0]));

  const { byggForslag } = await import("../src/lib/nav2/forslag.ts");
  const db = attrapp(tabeller(), { mote_statkrets: () => [H] });
  globalThis.__rutt = { db, user: null };
  const f = await byggForslag(db, { employee: { id: H, first_name: "Hanna", last_name: "Prov" }, roles: ["salesperson"], permissions: [] });
  ok("hemmets läsning: ett öppet förslag med Navs tre rader", f.oppna.length === 1 && f.oppna[0].id === F && f.oppna[0].rader.length === 3 && f.oppna[0].mote === M, JSON.stringify(f).slice(0, 300));
  ok("kortets rad leder med antalet", /^1 möte (i dag|i morgon) är obekräftat$/.test(f.kortrad ?? ""), f.kortrad);
  ok("trendregeln säger hur långt den har kvar", f.trendrad === "För att jämföra laget med sig självt behöver jag 60 avgjorda möten. Jag har 0." && f.trend.behover === 60, f.trendrad);
  ok("förslagen står av från början", f.pa === false);
  ok("läsningen skriver ingenting", db.skrivningar.length === 0, JSON.stringify(db.skrivningar));
  const annan = await byggForslag(db, { employee: { id: X, first_name: "X", last_name: "Y" }, roles: ["salesperson"], permissions: [] });
  ok("den som inte håller mötet får inget förslag", annan.oppna.length === 0 && annan.kortrad === null);
}

rubrik("Din månad: Fråga om raden");
{
  const { POST: hemPost } = await import("../src/app/nav2/hem/route.ts");
  const kor = async (kropp) => {
    const db = attrapp({ nav_preference: [] });
    globalThis.__fel = [];
    globalThis.__rutt = { db, user: { employee: { id: H, first_name: "Hanna", last_name: "Prov", team_id: null }, roles: ["salesperson"], permissions: [] } };
    const res = await hemPost(new Request("https://nav.test/nav2/hem", { method: "POST", headers: { origin: "https://nav.test", "content-type": "application/json", "user-agent": "prov" }, body: JSON.stringify(kropp) }));
    return { status: res.status, data: await res.json(), fel: globalThis.__fel, skrivningar: db.skrivningar };
  };
  const r = await kor({ handling: "flagga", var: "manad", rad: "manad-0", text: "#11 Hagmans Rör · Stor, 36 månader · 6 500 kr" });
  ok("frågan blir en rad i kön för fel, med provisionsraden i klartext", r.status === 200 && r.fel.length === 1 && r.fel[0].body.includes("Din månad") && r.fel[0].body.includes("#11 Hagmans Rör · Stor, 36 månader · 6 500 kr") && r.fel[0].reporterId === H, JSON.stringify(r.fel));
  ok("svaret säger vart frågan gick", /provision/i.test(r.data.ok ?? ""), r.data.ok);
  ok("raden göms inte i någon sammanfattning", !r.skrivningar.some((s) => s.text.includes("nav_preference")), r.skrivningar.map((s) => s.text).join(", "));
  const gammal = await kor({ handling: "flagga", rad: "upg-1", text: "En uppgift är försenad." });
  ok("Stämmer inte i sammanfattningen fungerar som förut", gammal.status === 200 && gammal.fel[0].body.includes("Din dag i korthet") && gammal.skrivningar.some((s) => s.text === "upsert nav_preference"), JSON.stringify([gammal.fel, gammal.skrivningar.map((s) => s.text)]));
}

rubrik("Mötet flyttas av den som håller det");
{
  const { forslagEfterFlytt } = await import("../src/lib/nav2/forslag.ts");
  const db = attrapp(tabeller(), { nav_forslag_valj: () => "f1" });
  await forslagEfterFlytt(db, M, H);
  ok("flytten sparas som valet Flytta", db.skrivningar.map((s) => s.text).join(", ") === "rpc nav_forslag_valj" && db.skrivningar[0].arg.p_data.val === "flytta" && db.skrivningar[0].arg.p_av === H, JSON.stringify(db.skrivningar));
  const db2 = attrapp(tabeller(), { nav_forslag_valj: () => "f1" });
  await forslagEfterFlytt(db2, M, B);
  ok("flyttar någon annan sparas inget val (jobbet stänger raden som inaktuell)", db2.skrivningar.length === 0, JSON.stringify(db2.skrivningar));
  const db3 = attrapp(tabeller({ forslag: { beslut_id: "x", beslut: { val: "lat-sta" }, beslut_av: H } }), { nav_forslag_valj: () => "f1" });
  await forslagEfterFlytt(db3, M, H);
  ok("ett förslag med ett val rörs inte", db3.skrivningar.length === 0, JSON.stringify(db3.skrivningar));
  const db4 = attrapp(tabeller(), {});
  let kastade = false;
  try { await forslagEfterFlytt(db4, M, H); } catch { kastade = true; }
  ok("ett fel i loggen stoppar aldrig flytten", !kastade);
}

rubrik("Utloggad, fel ursprung och läsläge");
{
  globalThis.__rutt = { db: attrapp({}), user: null };
  const r = await POST(new Request("https://nav.test/nav2/forslag", { method: "POST", headers: { origin: "https://nav.test" }, body: JSON.stringify({ handling: "valj", forslag: F, val: "lat-sta" }) }));
  ok("utloggad: 401", r.status === 401);
  const g = await GET(new Request("https://nav.test/nav2/forslag?las=andrat"));
  ok("utloggad läsning: 401", g.status === 401);
  const u = await anropa(["salesperson"], H, { handling: "valj", forslag: F, val: "lat-sta" }, { ursprung: "https://ond.test" });
  ok("fel ursprung: 403 och ingenting skrivs", u.status === 403 && u.skrivningar.length === 0, visa(u));
  const okand = await anropa(["salesperson"], H, { handling: "radera", forslag: F });
  ok("en okänd handling: 400", okand.status === 400 && okand.skrivningar.length === 0, visa(okand));
}

console.log(fel ? `\n\x1b[31m${fel} ✗\x1b[0m` : "\n\x1b[32mAlla ✓\x1b[0m");
process.exit(fel ? 1 : 0);
