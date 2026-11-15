#!/usr/bin/env node
/**
 * Hemvyns jobb (forslag-jobb.ts): dagjobbet som skapar förslag om obekräftade möten, och nattjobbet som stänger,
 * dömer, stämmer av ändringar, sparar facit och takt.
 *
 * Databasen är en attrapp i minnet som beter sig som tabellerna i 0303: `nav_forslag` är unik på regel och nyckel,
 * `nav_forslag_lage` räknas fram ur händelserna som vyn gör, och `nav_forslag_valj` ger ett beslut per förslag.
 * Varje ändring eller radering i loggen kastar, så att ett jobb som försöker skriva om en rad faller här.
 * Ingenting når produktionen.
 *
 *   TZ=UTC node --experimental-transform-types --no-warnings tests/forslag-jobb.mjs
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

const rot = join(fileURLToPath(import.meta.url), "..", "..");
const stubb = (kod) => ({ url: "data:text/javascript," + encodeURIComponent(kod), shortCircuit: true });
registerHooks({
  resolve(spec, ctx, nasta) {
    if (spec === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (spec === "@/lib/supabase/server") return stubb("export const supabaseServer = async () => globalThis.__db; export const supabaseAdmin = () => globalThis.__db;");
    if (spec === "@/lib/fel-server") return stubb("export const skrivFel = async (f) => { (globalThis.__fel ??= []).push(f); return true; };");
    if (spec === "next/headers") return stubb("export const cookies = async () => ({ get: () => undefined, getAll: () => [], set: () => {} }); export const headers = async () => new Headers();");
    if (spec === "next/cache") return stubb("export const revalidatePath = () => {}; export const revalidateTag = () => {}; export const unstable_cache = (f) => f;");
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
const j = (x) => JSON.stringify(x);

/* ------------------------------------------------------------------------ */
/* Attrappen: tabellerna i minnet                                            */
/* ------------------------------------------------------------------------ */

const UNIKT = { nav_forslag: ["regel", "nyckel"], nav_takt_dag: ["krets", "manad", "gatt"], nav_facit_dom: ["regel", "krets", "vid", "hog_n", "hog_av", "lag_n", "lag_av"] };
const BARA_NYA = new Set(["nav_forslag", "nav_forslag_handelse", "nav_takt_dag", "nav_facit_dom"]);

function minne(start) {
  const t = { nav_forslag: [], nav_forslag_handelse: [], nav_takt_dag: [], nav_facit_dom: [], audit_log: [], team: [], sales_order: [], nav_setting: [], mote_kort: [], ...structuredClone(start) };
  const skrivningar = [];
  let lopnr = 0;
  const nyttId = () => `99999999-0000-4000-8000-${String(++lopnr).padStart(12, "0")}`;
  const klocka = () => new Date(Date.parse(db.nu) + lopnr).toISOString();

  // Vyn nav_forslag_lage, som 0303 räknar den.
  const lage = () =>
    t.nav_forslag.map((f) => {
      const h = t.nav_forslag_handelse.filter((x) => x.forslag === f.id && x.sort !== "ogiltig" && !t.nav_forslag_handelse.some((o) => o.ogiltigar === x.id));
      const sista = (sorter, efter = null) => h.filter((x) => sorter.includes(x.sort) && (efter === null || x.lopnr >= efter)).sort((a, b) => b.lopnr - a.lopnr)[0] ?? null;
      const s = sista(["beslut", "angrad"]);
      const b = s?.sort === "beslut" ? s : null;
      const a = b ? sista(["atgard"], b.lopnr) : null;
      const k = sista(["kommentar"]), m = sista(["matning"]), d = sista(["dom"]);
      return {
        ...f, beslut_id: b?.id ?? null, beslut: b?.data ?? null, beslut_av: b?.av ?? null, beslut_nar: b?.nar ?? null, atgard: a?.data ?? null,
        kommentar: k?.data ?? null, kommentar_nar: k?.nar ?? null, matning: m?.data ?? null, matning_nar: m?.nar ?? null, dom: d?.data ?? null, dom_nar: d?.nar ?? null,
      };
    });
  const rader = (tabell) => (tabell === "nav_forslag_lage" ? lage() : (t[tabell] ??= []));

  const laggIn = (tabell, rad, hoppaDubbletter) => {
    const u = UNIKT[tabell];
    if (u && t[tabell].some((r) => u.every((k) => j(r[k] ?? null) === j(rad[k] ?? null)))) {
      return hoppaDubbletter ? null : { fel: { code: "23505", message: `dubblett i ${tabell}` } };
    }
    const ny = { ...rad };
    lopnr++;
    if (tabell !== "nav_takt_dag") ny.id ??= nyttId();
    if (tabell === "nav_forslag") Object.assign(ny, { skapad: ny.skapad ?? klocka(), prov: ny.prov ?? false, om: ny.om ?? null, lag: ny.lag ?? null, skapad_av: ny.skapad_av ?? null });
    if (tabell === "nav_forslag_handelse") Object.assign(ny, { nar: klocka(), lopnr, av: ny.av ?? null, data: ny.data ?? {} });
    t[tabell].push(ny);
    skrivningar.push({ text: `insert ${tabell}`, rad: ny });
    return { rad: ny };
  };

  const fraga = (tabell) => {
    let skrivet = null;
    let en = false;
    let antal = null;
    const filter = [];
    const ordning = [];
    const svaret = () => {
      if (skrivet) return { data: skrivet.rader, error: skrivet.fel ?? null };
      let ut = rader(tabell).filter((r) => filter.every((f) => f(r)));
      for (const [kol, stigande] of [...ordning].reverse()) ut = [...ut].sort((a, b) => (a[kol] < b[kol] ? -1 : a[kol] > b[kol] ? 1 : 0) * (stigande ? 1 : -1));
      if (antal !== null) ut = ut.slice(0, antal);
      return en ? { data: ut[0] ?? null, error: null } : { data: ut, error: null, count: ut.length };
    };
    const jamfor = (test) => (kol, varde) => {
      filter.push((r) => test(r[kol], varde));
      return kedja;
    };
    const skriv = (namn) => (inn, val = {}) => {
      if (namn === "update" || namn === "delete") {
        if (BARA_NYA.has(tabell)) throw new Error(`${namn} ${tabell}: loggen tar bara emot nya rader`);
        skrivningar.push({ text: `${namn} ${tabell}` });
        skrivet = { rader: [] };
        return kedja;
      }
      const lista = Array.isArray(inn) ? inn : [inn];
      const nya = [];
      let felet = null;
      for (const r of lista) {
        const svar = laggIn(tabell, r, namn === "upsert" && val.ignoreDuplicates === true);
        if (svar?.fel) felet = svar.fel;
        else if (svar?.rad) nya.push(svar.rad);
      }
      skrivet = { rader: nya, fel: felet };
      return kedja;
    };
    const kedja = new Proxy(
      {},
      {
        get(_, namn) {
          if (namn === "then") return (a, b) => Promise.resolve(svaret()).then(a, b);
          if (["insert", "upsert", "update", "delete"].includes(namn)) return skriv(namn);
          if (namn === "eq") return jamfor((a, b) => a === b);
          if (namn === "neq") return jamfor((a, b) => a !== b);
          if (namn === "in") return jamfor((a, b) => b.includes(a));
          if (namn === "is") return jamfor((a, b) => (a ?? null) === b);
          if (namn === "gte") return jamfor((a, b) => a >= b);
          if (namn === "lte") return jamfor((a, b) => a <= b);
          if (namn === "gt") return jamfor((a, b) => a > b);
          if (namn === "lt") return jamfor((a, b) => a < b);
          if (namn === "like") return jamfor((a, b) => typeof a === "string" && a.startsWith(String(b).replace(/%$/, "")));
          if (namn === "not") return (kol, op, varde) => {
            if (op === "is" && varde === null) filter.push((r) => (r[kol] ?? null) !== null);
            else throw new Error(`attrappen kan inte not(${kol}, ${op})`);
            return kedja;
          };
          if (namn === "order") return (kol, o = {}) => {
            ordning.push([kol, o.ascending !== false]);
            return kedja;
          };
          if (namn === "limit") return (n) => {
            antal = n;
            return kedja;
          };
          if (namn === "maybeSingle" || namn === "single") return () => {
            en = true;
            return Promise.resolve(svaret());
          };
          return () => kedja; // select, or (läser allt: provens data är ordnade så att det inte spelar roll)
        },
      },
    );
    return kedja;
  };

  const db = {
    nu: "2026-11-16T13:30:00.000Z",
    t,
    skrivningar,
    lage,
    from: (tabell) => fraga(tabell),
    rpc: (namn, arg = {}) => {
      if (namn === "nav_forslag_valj") {
        const rad = lage().find((r) => r.id === arg.p_forslag);
        if (!rad || rad.beslut_id) return Promise.resolve({ data: null, error: null });
        const svar = laggIn("nav_forslag_handelse", { forslag: arg.p_forslag, sort: "beslut", av: arg.p_av ?? null, data: arg.p_data ?? {} });
        return Promise.resolve({ data: svar.rad.id, error: null });
      }
      if (namn === "nav_forslag_avidentifiera") {
        skrivningar.push({ text: "rpc nav_forslag_avidentifiera", arg });
        return Promise.resolve({ data: 0, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `attrapp: ${namn}`, code: "XX000" } });
    },
  };
  return db;
}

/* ------------------------------------------------------------------------ */
/* Provdata                                                                  */
/* ------------------------------------------------------------------------ */

const H = "b0000000-0000-4000-8000-000000000001"; // håller mötet
const B = "b0000000-0000-4000-8000-000000000002"; // bokade
const H2 = "b0000000-0000-4000-8000-000000000003";
const M1 = "c0000000-0000-4000-8000-000000000001";
const K1 = "d0000000-0000-4000-8000-000000000001";
const LAG = "a1000000-0000-4000-8000-000000000001";
const REGEL = "moten.obekraftat";

const mote = (id, o = {}) => ({
  id, kedja_id: K1, bokat_av: B, halls_av: H, bokat_nar: "2026-11-05T09:00:00Z", flyttad_nar: null, mote_tid: "2026-11-17T09:00:00Z", langd_min: 30,
  art: "ny", kalla: "Kalla samtal", bekraftat_nar: null, utfall: null, utfall_nar: null, resultat: null, forsok: 2, ...o,
});
/** Tidigare möten med utfall: `antal` stycken från en startdag, ett om dagen kl. 10. */
const gamla = (prefix, antal, o) =>
  Array.from({ length: antal }, (_x, i) => {
    const tid = new Date(Date.UTC(2026, 9, 1 + (o.dagFran ?? 0) + i, 10)).toISOString();
    const egna = typeof o.per === "function" ? o.per(i) : {};
    return mote(`${prefix}${String(i).padStart(4, "0")}-0000-4000-8000-000000000000`, { mote_tid: tid, bokat_nar: "2026-09-20T09:00:00Z", utfall: "hallet", utfall_nar: tid, halls_av: H, bokat_av: B, ...o.bas, ...egna });
  });

const installningar = (pa, extra = []) => [
  { key: "moten.galler-fran", value: "2026-09-01T00:00:00Z" },
  { key: "forslag.pa", value: pa },
  ...extra,
];
const bas = (pa, o = {}) => ({
  nav_setting: installningar(pa, o.installningar),
  mote: [mote(M1), ...(o.moten ?? [])],
  mote_kort: [{ kedja_id: K1, namn: "PROV Hagby Glas", kontakt: "Prov Person", telefon: "+46700000000" }],
  employee: [
    { id: H, first_name: "Hanna", status: "active", team_id: LAG }, { id: B, first_name: "Mick", status: "active", team_id: LAG },
    { id: H2, first_name: "Edvin", status: "active", team_id: null },
  ],
  team: [{ id: LAG, name: "Prov-laget", lead_id: B }],
  ...(o.extra ?? {}),
});

const { skapaObekraftade, korForslagNatt } = await import("../src/lib/nav2/forslag-jobb.ts");
const { lasInst } = await import("../src/lib/nav2/forslag.ts");

const dag = async (db, nu) => {
  db.nu = nu;
  const i = await lasInst(db);
  return skapaObekraftade(db, i.m, i.f, new Date(nu));
};
const natt = async (db, nu) => {
  db.nu = nu;
  return korForslagNatt(db, new Date(nu));
};
const handelser = (db, sort) => db.t.nav_forslag_handelse.filter((h) => h.sort === sort);

const MAN_1430 = "2026-11-16T13:30:00.000Z"; // måndag 14.30 svensk tid, dagen före mötet
const MAN_1200 = "2026-11-16T11:00:00.000Z"; // måndag 12.00: före klockslaget

/* ------------------------------------------------------------------------ */

rubrik("Dagjobbet: torrkörning tills forslag.pa slås på");
{
  const db = minne(bas(false));
  const k = await dag(db, MAN_1430);
  ok("kvittot säger vad som skulle ha skapats", j(k) === j({ skulle: 1, skapade: 0, inaktuella: 0, torr: true }), j(k));
  ok("ingenting skrivs", db.skrivningar.length === 0, j(db.skrivningar.map((s) => s.text)));
}

rubrik("Dagjobbet: ett obekräftat möte blir ett förslag");
{
  // Fyra tidigare möten stod obekräftade när de började, ett av dem hölls. Sex bekräftade, alla hölls.
  const tidigare = [
    ...gamla("e1", 4, { per: (i) => ({ utfall: i === 0 ? "hallet" : "uteblev" }) }),
    ...gamla("e2", 6, { dagFran: 10, per: (i) => ({ bekraftat_nar: new Date(Date.UTC(2026, 9, 10 + i, 8)).toISOString() }) }),
  ];
  const db = minne(bas(true, { moten: tidigare }));
  const fore = await dag(db, MAN_1200);
  ok("före klockslaget skapas inget", fore.skulle === 0 && fore.skapade === 0 && db.t.nav_forslag.length === 0, j(fore));
  const k = await dag(db, MAN_1430);
  ok("kvittot: en rad skapad", j(k) === j({ skulle: 1, skapade: 1, inaktuella: 0, torr: false }), j(k));
  const f = db.t.nav_forslag[0] ?? {};
  ok("raden går till den som håller mötet, inte till den som bokade", f.om === H && f.sort === "forslag" && f.regel === REGEL && f.kalla === "regel", j(f).slice(0, 200));
  ok("nyckeln bär mötet, mötesdagen och hållaren", f.nyckel === `${M1}@2026-11-17@${H}`, f.nyckel);
  ok("domsdagen är arbetsdagen efter mötet, och förslaget går ut när mötet börjar", f.doms_dag === "2026-11-18" && f.utgar === "2026-11-17T09:00:00.000Z", `${f.doms_dag} ${f.utgar}`);
  ok("tre val läggs fram", j(f.val) === j(["ringer-sjalv", "flytta", "lat-sta"]), j(f.val));
  ok("det Nav trodde skrivs före valet: 1 av 4 obekräftade hölls", j(f.trodde) === j({ n: 1, av: 4 }), j(f.trodde));
  ok("belägget bär talen, mötet och måttets version", f.belagg?.mote === M1 && f.belagg?.forsok === 2 && j(f.belagg?.bekraftade) === j({ n: 6, av: 6 }) && f.belagg?.forFa === true && f.belagg?.version === 1 && f.belagg?.rader?.length === 4, j(f.belagg).slice(0, 260));
  ok("raden är inte provdata", f.prov === false);
  const igen = await dag(db, "2026-11-16T13:45:00.000Z");
  ok("en andra körning skriver ingen dubblett", igen.skulle === 0 && igen.skapade === 0 && db.t.nav_forslag.length === 1, j(igen));
}

rubrik("Dagjobbet: mötet flyttas, bekräftas eller byter hållare innan någon valt");
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  db.t.mote[0].mote_tid = "2026-11-19T09:00:00Z";
  db.t.mote[0].flyttad_nar = "2026-11-16T13:40:00Z";
  const k = await dag(db, "2026-11-16T13:45:00.000Z");
  ok("ett flyttat möte stänger det gamla förslaget som inaktuellt", k.inaktuella === 1 && handelser(db, "beslut").length === 1 && handelser(db, "beslut")[0].data.val === "inaktuellt" && handelser(db, "beslut")[0].av === null, j(k));
  ok("den nya tiden får inget förslag förrän dess sista dag", db.t.nav_forslag.length === 1);
  const igen = await dag(db, "2026-11-16T14:00:00.000Z");
  ok("det stängs bara en gång", igen.inaktuella === 0 && handelser(db, "beslut").length === 1, j(igen));
  const ons = await dag(db, "2026-11-18T13:30:00.000Z");
  ok("står den nya tiden också obekräftad sista dagen frågar Nav igen, i en egen rad", ons.skapade === 1 && db.t.nav_forslag.length === 2 && db.t.nav_forslag[1].nyckel === `${M1}@2026-11-19@${H}`, j(ons));
}
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  db.t.mote[0].bekraftat_nar = "2026-11-16T14:00:00Z";
  const k = await dag(db, "2026-11-16T14:15:00.000Z");
  ok("ett bekräftat möte stänger förslaget som inaktuellt, aldrig som ingen valde", k.inaktuella === 1 && handelser(db, "beslut")[0]?.data.val === "inaktuellt", j(k));
}
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  db.t.mote[0].halls_av = H2;
  const k = await dag(db, "2026-11-16T14:15:00.000Z");
  ok("byter mötet hållare stängs raden, och den nya hållaren får en egen", k.inaktuella === 1 && k.skapade === 1 && db.t.nav_forslag[1]?.om === H2, j(k));
}
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  await db.rpc("nav_forslag_valj", { p_forslag: db.t.nav_forslag[0].id, p_av: H, p_data: { val: "lat-sta" } });
  db.t.mote[0].bekraftat_nar = "2026-11-16T15:00:00Z";
  const k = await dag(db, "2026-11-16T15:15:00.000Z");
  ok("ett förslag med ett val rörs inte av dagjobbet", k.inaktuella === 0 && handelser(db, "beslut").length === 1, j(k));
}

rubrik("Nattjobbet: ingen valde");
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  const k = await natt(db, "2026-11-17T23:30:00.000Z"); // natten mot onsdag: mötet har börjat, ingen valde
  ok("efter att mötet börjat sparas ingen valde", k.ingenValde === 1 && handelser(db, "beslut")[0]?.data.val === "ingen" && handelser(db, "beslut")[0].av === null, j(k));
  ok("och raden väntar på utfallet, eftersom domsdagen är inne men utfallet saknas", k.utanUtfall === 1 && k.domda === 0 && handelser(db, "matning")[0]?.data.vantar === true, j(k));
}

rubrik("Nattjobbet: ett inaktuellt förslag döms aldrig");
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  Object.assign(db.t.mote[0], { mote_tid: "2026-11-19T09:00:00Z", flyttad_nar: "2026-11-16T15:00:00Z" }); // flyttat av någon annan, ingen dagkörning emellan
  const k = await natt(db, "2026-11-17T23:30:00.000Z");
  ok("natten stänger det som inaktuellt, inte som ingen valde", k.inaktuella === 1 && k.ingenValde === 0 && handelser(db, "beslut")[0]?.data.val === "inaktuellt", j(k));
  ok("och det får ingen dom, fast domsdagen är inne", k.domda === 0 && k.utanUtfall === 0 && handelser(db, "dom").length === 0 && handelser(db, "matning").length === 0, j(k));
  const igen = await natt(db, "2026-11-24T23:30:00.000Z");
  ok("inte heller senare", igen.domda === 0 && igen.inaktuella === 0 && handelser(db, "dom").length === 0, j(igen));
}

rubrik("Nattjobbet: domen dagen efter mötet");
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  await db.rpc("nav_forslag_valj", { p_forslag: db.t.nav_forslag[0].id, p_av: H, p_data: { val: "lat-sta" } });
  const tidigt = await natt(db, "2026-11-16T23:30:00.000Z"); // natten mot tisdag: domsdagen är onsdag
  ok("före domsdagen döms ingenting, och Nav säger inte att utfallet saknas", tidigt.domda === 0 && tidigt.utanUtfall === 0 && handelser(db, "dom").length === 0 && handelser(db, "matning").length === 0, j(tidigt));
  Object.assign(db.t.mote[0], { utfall: "hallet", utfall_nar: "2026-11-17T10:00:00Z" });
  const k = await natt(db, "2026-11-17T23:30:00.000Z");
  const d = handelser(db, "dom")[0]?.data ?? {};
  ok("en rad vars domsdag kommit döms", k.domda === 1 && handelser(db, "dom").length === 1, j(k));
  ok("domen bär utfallet och genomförandet", d.utfall === "hallet" && d.bekraftat === false, j(d));
  ok("och måttet med sin version", d.matt === "moten.hallna-av-alla" && d.version === 1, j(d));
  const igen = await natt(db, "2026-11-18T23:30:00.000Z");
  ok("nästa natt döms den inte en gång till", igen.domda === 0 && handelser(db, "dom").length === 1, j(igen));
}
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  await db.rpc("nav_forslag_valj", { p_forslag: db.t.nav_forslag[0].id, p_av: H, p_data: { val: "ringer-sjalv" } });
  Object.assign(db.t.mote[0], { bekraftat_nar: "2026-11-16T15:00:00Z", utfall: "uteblev", utfall_nar: "2026-11-17T09:40:00Z" });
  await natt(db, "2026-11-17T23:30:00.000Z");
  const d = handelser(db, "dom")[0]?.data ?? {};
  ok("bekräftat före mötet står i domen", d.utfall === "uteblev" && d.bekraftat === true, j(d));
}

rubrik("Nattjobbet: utfallet saknas på domsdagen");
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  await db.rpc("nav_forslag_valj", { p_forslag: db.t.nav_forslag[0].id, p_av: H, p_data: { val: "lat-sta" } });
  const k = await natt(db, "2026-11-17T23:30:00.000Z");
  ok("raden väntar: Nav säger att utfallet inte är satt", k.utanUtfall === 1 && k.domda === 0 && handelser(db, "dom").length === 0 && handelser(db, "matning").length === 1, j(k));
  const igen = await natt(db, "2026-11-18T23:30:00.000Z");
  ok("nästa natt skrivs ingen ny väntrad", igen.utanUtfall === 1 && handelser(db, "matning").length === 1, j(igen));
  const fyra = await natt(db, "2026-11-23T23:30:00.000Z"); // tisdag 24 nov: fyra arbetsdagar efter domsdagen
  ok("fyra arbetsdagar efter domsdagen väntar den fortfarande", fyra.domda === 0 && handelser(db, "dom").length === 0, j(fyra));
  const fem = await natt(db, "2026-11-24T23:30:00.000Z"); // onsdag 25 nov: fem arbetsdagar
  ok("efter fem arbetsdagar stängs den som okänd", fem.domda === 1 && handelser(db, "dom")[0]?.data.utfall === "okant", j(fem));
}
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  await db.rpc("nav_forslag_valj", { p_forslag: db.t.nav_forslag[0].id, p_av: H, p_data: { val: "lat-sta" } });
  await natt(db, "2026-11-17T23:30:00.000Z");
  Object.assign(db.t.mote[0], { utfall: "uteblev", utfall_nar: "2026-11-19T08:00:00Z" });
  const k = await natt(db, "2026-11-19T23:30:00.000Z");
  ok("sätts utfallet senare döms raden då", k.domda === 1 && handelser(db, "dom")[0]?.data.utfall === "uteblev", j(k));
}

rubrik("Nattjobbet: utfallet rättas efter domen");
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  await db.rpc("nav_forslag_valj", { p_forslag: db.t.nav_forslag[0].id, p_av: H, p_data: { val: "lat-sta" } });
  Object.assign(db.t.mote[0], { utfall: "hallet", utfall_nar: "2026-11-17T10:00:00Z" });
  await natt(db, "2026-11-17T23:30:00.000Z");
  Object.assign(db.t.mote[0], { utfall: "uteblev", utfall_nar: "2026-11-18T09:00:00Z" }); // Rätta utfall
  const k = await natt(db, "2026-11-18T23:30:00.000Z");
  const domar = handelser(db, "dom");
  ok("en ny dom skrivs, den gamla står kvar i loggen", k.omdomda === 1 && domar.length === 2 && domar[0].data.utfall === "hallet" && domar[1].data.utfall === "uteblev", j(k));
  ok("den nya domen säger att den rättar en tidigare", domar[1]?.data.rattar === "hallet", j(domar[1]?.data));
  ok("läget visar den senaste domen", db.lage()[0].dom.utfall === "uteblev");
  const igen = await natt(db, "2026-11-19T23:30:00.000Z");
  ok("och den döms inte om igen", igen.omdomda === 0 && handelser(db, "dom").length === 2, j(igen));
}

rubrik("Nattjobbet: torrkörning");
{
  const db = minne(bas(true));
  await dag(db, MAN_1430);
  db.t.nav_setting.find((s) => s.key === "forslag.pa").value = false;
  const fore = db.skrivningar.length;
  const k = await natt(db, "2026-11-17T23:30:00.000Z");
  ok("med forslag.pa av skrivs ingenting", db.skrivningar.length === fore && k.torr === true, j(db.skrivningar.slice(fore).map((s) => s.text)));
  ok("men kvittot säger vad som skulle ha hänt", k.ingenValde === 1, j(k));
}

rubrik("Nattjobbet: takten sparas varje arbetsmorgon");
{
  const order = (id, dagen, o = {}) => ({ id, salesperson_id: H, package_id: 1, term_months: 24, signed_on: dagen, period_month: `${dagen.slice(0, 7)}-01`, status: "signerad", cancel_period_month: null, ...o });
  const db = minne(bas(true, { extra: { sales_order: [order("o1", "2026-11-03"), order("o2", "2026-11-10"), order("o3", "2026-11-12", { salesperson_id: H2 }), order("o4", "2026-10-05", { status: "makulerad", cancel_period_month: "2026-11-01" })] } }));
  const k = await natt(db, "2026-11-16T23:30:00.000Z"); // tisdag 17 nov på morgonen: 11 arbetsdagar har gått
  const alla = db.t.nav_takt_dag.find((r) => r.krets === "alla") ?? {};
  const laget = db.t.nav_takt_dag.find((r) => r.krets === LAG) ?? {};
  ok("en rad för alla och en för varje lag", k.takt === 2 && db.t.nav_takt_dag.length === 2, j(k));
  ok("alla: tre order minus en makulerad, efter 11 av 21 arbetsdagar", alla.manad === "2026-11-01" && alla.gatt === 11 && alla.netto === 2 && alla.prognos === 4, j(alla));
  ok("laget: bara lagets order", laget.netto === 1 && laget.gatt === 11 && laget.prognos === 2, j(laget));
  const igen = await natt(db, "2026-11-16T23:45:00.000Z");
  ok("en gång per morgon", igen.takt === 0 && db.t.nav_takt_dag.length === 2, j(igen));
  const lordag = await natt(db, "2026-11-20T23:30:00.000Z"); // lördag morgon
  ok("på helgen sparas ingenting", lordag.takt === 0, j(lordag));
}

rubrik("Nattjobbet: en följd inställning som ändras blir en rad i loggen");
{
  const logg = [
    { id: 71, actor_id: B, action: "installning", object_type: "nav_setting", object_id: "moten.bekrafta-dagar", meta: { fore: 2, efter: 1 }, ts: "2026-11-13T10:00:00Z" },
    { id: 72, actor_id: B, action: "installning", object_type: "nav_setting", object_id: "moten.tidszon", meta: { fore: "Europe/Stockholm", efter: "Europe/Oslo" }, ts: "2026-11-13T10:05:00Z" },
    { id: 73, actor_id: B, action: "installning", object_type: "nav_setting", object_id: "moten.bekrafta-tid", meta: { fore: null, efter: "09:00" }, ts: "2026-11-13T10:06:00Z" },
  ];
  const db = minne(bas(true, { extra: { audit_log: logg } }));
  const k = await natt(db, "2026-11-16T23:30:00.000Z");
  const r = db.t.nav_forslag.find((f) => f.sort === "andring") ?? {};
  ok("bara de följda inställningarna, och bara en ändring från ett värde till ett annat", k.installningar === 1 && db.t.nav_forslag.filter((f) => f.sort === "andring").length === 1, j(k));
  ok("raden säger varifrån den kom och vem som ändrade", r.kalla === "installning" && r.skapad_av === B && r.om === null && r.lag === null && r.nyckel === "installning:71", j(r).slice(0, 200));
  ok("måttet som följs är uteblivna möten, från ändringens dag", r.regel === "moten.uteblivna" && r.foljer?.matt === "moten.uteblivna" && r.foljer?.motvikt === "moten.hallna-av-alla" && r.foljer?.fran === "2026-11-13" && r.foljer?.installning === "moten.bekrafta-dagar", j(r.foljer));
  ok("texten säger vad som ändrades, i klartext", r.text === "Bekräftelsen öppnar 1 arbetsdag före mötet i stället för 2.", r.text);
  const igen = await natt(db, "2026-11-17T23:30:00.000Z");
  ok("en andra körning skriver ingen dubblett", igen.installningar === 0 && db.t.nav_forslag.filter((f) => f.sort === "andring").length === 1, j(igen));
}

rubrik("Nattjobbet: en ändring stäms av och får sin dom");
{
  const andring = (o = {}) => ({
    id: "f0000000-0000-4000-8000-000000000001", sort: "andring", regel: "moten.uteblivna", nyckel: "prov-andring", kalla: "person", om: null, lag: null, skapad_av: B, skapad: "2026-10-20T08:00:00Z",
    text: "Vi ringer kunden dagen före.", foljer: { matt: "moten.uteblivna", motvikt: "moten.hallna-av-alla", version: 1, fran: "2026-10-21", avsikt: "beratta" }, prov: false, ...o,
  });
  // 15 möten före ändringen: för få för att jämföra med.
  const fa = minne(bas(true, { moten: gamla("e3", 15, { per: (i) => ({ utfall: i % 3 === 0 ? "uteblev" : "hallet" }) }), extra: { nav_forslag: [andring()] } }));
  const k1 = await natt(fa, "2026-11-16T23:30:00.000Z");
  const m1 = handelser(fa, "matning")[0]?.data ?? {};
  ok("färre än 20 möten före: inget före att jämföra med, och ingen dom", k1.andringar === 1 && m1.dom?.sort === "inget-fore" && handelser(fa, "dom").length === 0, j(m1).slice(0, 200));
  ok("Nav visar antal i stället", typeof m1.tal === "string" && m1.tal.includes("Bokade per vecka"), m1.tal);
  const k1b = await natt(fa, "2026-11-17T23:30:00.000Z");
  ok("samma läge nästa natt ger ingen ny rad", k1b.andringar === 0 && handelser(fa, "matning").length === 1, j(k1b));

  // 40 möten före (16 uteblev) och 20 efter (inga uteblev): ser bra ut vid första kontrollpunkten.
  const fore = gamla("e4", 20, { per: (i) => ({ utfall: i % 5 < 2 ? "uteblev" : "hallet" }) });
  const fore2 = gamla("e5", 20, { per: (i) => ({ utfall: i % 5 < 2 ? "uteblev" : "hallet", mote_tid: new Date(Date.UTC(2026, 9, 1 + i, 14)).toISOString() }) });
  const efter = gamla("e6", 22, { dagFran: 20, per: (i) => ({ mote_tid: new Date(Date.UTC(2026, 9, 21 + i, 10)).toISOString() }) });
  const bra = minne(bas(true, { moten: [...fore, ...fore2, ...efter], extra: { nav_forslag: [andring()] } }));
  const k2 = await natt(bra, "2026-11-16T23:30:00.000Z");
  const d2 = handelser(bra, "dom")[0]?.data ?? {};
  ok("20 möten efter, tydligt färre uteblivna: ser bra ut, och raden stängs", k2.andringar === 1 && d2.dom?.sort === "ser-bra-ut" && d2.dom?.stangd === true, j(d2).slice(0, 240));
  ok("domen räknas vid kontrollpunkten 20, inte på alla 22", d2.vid === 20 && j(d2.efter) === j({ n: 0, av: 20 }) && j(d2.fore) === j({ n: 16, av: 40 }), j([d2.vid, d2.efter, d2.fore]));
  ok("ändringen gäller hela företaget: inget att jämföra med", d2.dom?.helaLaget === true, j(d2.dom));
  ok("måttets version står i domen", d2.matt === "moten.uteblivna" && d2.version === 1, j([d2.matt, d2.version]));
  const k2b = await natt(bra, "2026-11-17T23:30:00.000Z");
  ok("en stängd rad stäms inte av igen", k2b.andringar === 0 && handelser(bra, "dom").length === 1, j(k2b));
}

rubrik("Nattjobbet: Navs facit sparas vid vart tionde möte");
{
  const hallare = [H, H2, B, "b0000000-0000-4000-8000-000000000007", "b0000000-0000-4000-8000-000000000008"];
  const forslag = [], handelse = [], moten = [];
  for (let i = 0; i < 10; i++) {
    const mid = `c1000000-0000-4000-8000-${String(i).padStart(12, "0")}`, fid = `f1000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const om = hallare[i % 5], d = `2026-11-${String(2 + i).padStart(2, "0")}`;
    const ringde = i < 5;
    moten.push(mote(mid, { halls_av: om, mote_tid: `${d}T09:00:00Z`, utfall: ringde ? "hallet" : "uteblev", utfall_nar: `${d}T10:00:00Z` }));
    forslag.push({ id: fid, sort: "forslag", regel: REGEL, nyckel: `${mid}@${d}@${om}`, kalla: "regel", om, lag: null, doms_dag: "2026-11-13", utgar: `${d}T09:00:00Z`, trodde: null, belagg: {}, val: [], prov: false, skapad: `${d}T08:00:00Z` });
    handelse.push({ id: `a1000000-0000-4000-8000-${String(i).padStart(12, "0")}`, forslag: fid, sort: "beslut", av: om, data: { val: ringde ? "ringer-sjalv" : "lat-sta" }, nar: `${d}T08:30:00Z`, lopnr: -100 + i });
  }
  const db = minne({ ...bas(true, { moten }), nav_forslag: forslag, nav_forslag_handelse: handelse });
  const k = await natt(db, "2026-11-16T23:30:00.000Z");
  const f = db.t.nav_facit_dom[0] ?? {};
  ok("tio rader döms", k.domda === 10, j(k));
  ok("facit sparas en gång, på de tio möten som fanns", k.facit === 1 && db.t.nav_facit_dom.length === 1 && f.regel === REGEL && f.krets === "alla" && f.vid === 10, j(f));
  ok("talen och domen står på raden", f.hog_n === 5 && f.hog_av === 5 && f.lag_n === 0 && f.lag_av === 5 && f.sort === "utslag" && f.matt_version === 1, j(f));
  const igen = await natt(db, "2026-11-17T23:30:00.000Z");
  ok("nästa natt sparas inget nytt", igen.facit === 0 && db.t.nav_facit_dom.length === 1, j(igen));
}

rubrik("Nattjobbet: trendregeln och städningen");
{
  const db = minne(bas(true, { moten: gamla("e7", 11, {}) }));
  const sondag = await natt(db, "2026-11-14T23:30:00.000Z"); // natten mot söndag
  ok("andra nätter räknas trenden inte", sondag.trend === null, j(sondag.trend));
  const mandag = await natt(db, "2026-11-15T23:30:00.000Z"); // natten mot måndag
  ok("natten mot måndag: trenden säger hur långt det är kvar, bara i kvittot", j(mandag.trend) === j({ lage: "saknas", har: 11, behover: 60 }), j(mandag.trend));
  const avid = db.skrivningar.filter((s) => s.text === "rpc nav_forslag_avidentifiera");
  ok("rader äldre än 24 månader avidentifieras", avid.length === 2 && avid[1].arg.p_fore === "2024-11-16", j(avid.map((a) => a.arg)));
}
{
  const db = minne({ ...bas(true), nav_setting: [{ key: "forslag.pa", value: true }] });
  const k = await natt(db, "2026-11-16T23:30:00.000Z");
  ok("utan moten.galler-fran gör jobbet ingenting och säger varför", k.hoppade_over === "moten.galler-fran saknas" && db.skrivningar.length === 0, j(k));
}

console.log(fel ? `\n\x1b[31m${fel} ✗\x1b[0m` : "\n\x1b[32mAlla ✓\x1b[0m");
process.exit(fel ? 1 : 0);
