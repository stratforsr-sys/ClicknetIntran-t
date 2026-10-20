import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nav 2.0: navets läsningar direkt mot Postgres, med samma RLS och samma svar.
 *
 * ===========================================================================
 * VARFÖR. /nav2 bygger alla vyers data vid varje laddning, ca 360 frågor.
 * Genom Supabases REST-lager (PostgREST) kostar varje fråga ~35 ms och bara
 * 10–15 körs åt gången; resten köar. Uppmätt 2026-10-20: 2,0–3,3 s för datan,
 * fast en fråga i Postgres tar ett par millisekunder. Här går samma frågor
 * direkt till databasen över ett fåtal anslutningar (Supavisor, transaktions-
 * läge), och REST-lagret behövs bara för det som inte är en läsning.
 *
 * SAMMA RÄTTIGHETER. Varje anslutning öppnar en transaktion med
 * `set local role authenticated` och den inloggades claims i
 * `request.jwt.claims`, precis som PostgREST gör med en verifierad token.
 * Claims byggs av servern ur den identitet mellanvaran redan verifierat
 * (`sub`, `email`, `role`), aldrig ur något klienten skickat. RLS avgör
 * alltså fortfarande vad var och en ser. Admin (service role) får egna
 * anslutningar med `set local role service_role`. Allt är `read only`.
 *
 * SAMMA SVAR. Frågebyggaren tar emot exakt de anrop supabase-js har
 * (`from().select().eq()…`, `rpc()`), och svaret byggs av Postgres egen
 * `json_agg`, som PostgREST gör: samma nycklar, samma datum- och talformat,
 * samma tak på 1000 rader (Supabases max rows). Provat 2026-10-20 genom att
 * bygga hela datan båda vägarna för chef och säljare och jämföra.
 *
 * ALLT ANNAT GÅR SOM FÖRUT. Ett anrop som byggaren inte känner igen (en
 * skrivning, `storage`, `auth`, en relation den inte kan avgöra), och varje
 * fråga som ger fel i Postgres, spelas upp på den vanliga supabase-js-
 * klienten i stället. Saknas `NAV2_PG_URL`, eller går anslutningen inte att
 * öppna, går hela bygget som förut. Det värsta som kan hända är alltså att
 * sidan blir lika långsam som i går.
 * ===========================================================================
 *
 * Används bara av byggNav2Data (data.ts) via `medPg`. supabaseServer() och
 * supabaseAdmin() lämnar den här klienten medan bygget pågår (AsyncLocalStorage),
 * så att delar som skapar sin egen klient (notiserna, kalendern) också får den.
 */

/** Supabase Root 2021 CA. Poolerns certifikat är utfärdat av den, inte av en publik CA. */
const SUPABASE_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;

/** Supabases "max rows": REST-lagret kapar ett svar på toppnivå vid 1000 rader. */
const MAX_RADER = 1000;
/** Anslutningar per instans. Varje fråga håller sin bara ett par millisekunder. */
const ANSLUTNINGAR = Number(process.env.NAV2_PG_ANSLUTNINGAR) || 10;

// pg tolkar json och jsonb själv; allt annat lämnas som Postgres skrev det.
pg.types.setTypeParser(114, JSON.parse);
pg.types.setTypeParser(3802, JSON.parse);

let poolen: pg.Pool | null = null;
function pool(): pg.Pool | null {
  const url = process.env.NAV2_PG_URL;
  if (!url) return null;
  if (!poolen) {
    poolen = new pg.Pool({
      connectionString: url,
      ssl: { ca: SUPABASE_CA, rejectUnauthorized: true },
      max: ANSLUTNINGAR,
      idleTimeoutMillis: 15_000,
      connectionTimeoutMillis: 10_000,
    });
    poolen.on("error", (e) => console.error("nav2 pg: poolen", e.message));
  }
  return poolen;
}

/* ------------------------------------------------------------------------ */
/* Schemat: främmande nycklar (för inbäddningar) och funktioner (för rpc).   */
/* ------------------------------------------------------------------------ */

/** `unik`: barnets nyckelkolumner är dess primärnyckel eller unika. Då är relationen en-till-en, och PostgREST ger ett objekt åt båda hållen. */
type Fk = { namn: string; barn: string; far: string; barnKol: string[]; farKol: string[]; unik: boolean };
type Fn = { retset: boolean; sammansatt: boolean; scalar: boolean; argtyper: Record<string, string> };
type Schema = { fk: Fk[]; tabeller: Set<string>; fn: Map<string, Fn[]> };
let schemat: Promise<Schema> | null = null;

async function lasSchema(c: pg.Pool): Promise<Schema> {
  const { rows: fk } = await c.query(`
    select c.conname as namn, cl.relname as barn, fl.relname as far,
      array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as "barnKol",
      array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as "farKol",
      exists (select 1 from pg_constraint u where u.conrelid = c.conrelid and u.contype in ('p', 'u')
        and (select array_agg(x order by x) from unnest(u.conkey) x) = (select array_agg(x order by x) from unnest(c.conkey) x)) as unik
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
    join pg_class fl on fl.oid = c.confrelid join pg_namespace fn on fn.oid = fl.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and fn.nspname = 'public'`);
  const { rows: tab } = await c.query(`select c.relname as namn from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')`);
  const { rows: fns } = await c.query(`
    select p.proname as namn, p.proretset as retset, t.typtype = 'c' or p.prorettype = 'record'::regtype as sammansatt,
      t.typtype in ('b', 'd', 'e', 'r') and p.prorettype <> 'void'::regtype as scalar,
      coalesce((select json_object_agg(x.n, format_type(x.t, null)) from unnest(p.proargnames[1:p.pronargs], p.proargtypes::oid[]) x(n, t) where x.n is not null and x.n <> ''), '{}') as argtyper
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and p.prokind = 'f'`);
  const fn = new Map<string, Fn[]>();
  for (const r of fns) fn.set(r.namn, [...(fn.get(r.namn) ?? []), { retset: r.retset, sammansatt: r.sammansatt, scalar: r.scalar, argtyper: r.argtyper }]);
  return { fk: fk as Fk[], tabeller: new Set(tab.map((r) => r.namn as string)), fn };
}

/* ------------------------------------------------------------------------ */
/* Frågebyggaren: tolkar supabase-js-anropen till SQL.                       */
/* ------------------------------------------------------------------------ */

class EjStod extends Error {}
const ID = (s: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new EjStod("namn " + s);
  return '"' + s + '"';
};
type Steg = [string, unknown[]];

type Nod = {
  tabell: string;
  /** Kolumner och inbäddningar i ordning. */
  delar: ({ typ: "alla" } | { typ: "kol"; alias: string; kol: string; cast?: string } | { typ: "emb"; nod: Emb })[];
  villkor: ((a: string, p: unknown[]) => string)[];
  ordning: ((a: string) => string)[];
  lim?: number;
  off?: number;
};
/** `upp`: förälderns nyckel pekar på barnet (många-till-en). `tillEn`: svaret är ett objekt, inte en lista. */
type Emb = Nod & { alias: string; fk: Fk; upp: boolean; tillEn: boolean; inner: boolean };

function delaUpp(s: string, sep = ","): string[] {
  const ut: string[] = [];
  let d = 0, cur = "", cit = false;
  for (const ch of s) {
    if (ch === '"') cit = !cit;
    if (!cit && ch === "(") d++;
    if (!cit && ch === ")") d--;
    if (!cit && ch === sep && d === 0) { ut.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) ut.push(cur);
  return ut.map((x) => x.trim()).filter(Boolean);
}

function tolkaSelect(schema: Schema, tabell: string, sel: string): Nod {
  const nod: Nod = { tabell, delar: [], villkor: [], ordning: [] };
  for (const del of delaUpp(sel.replace(/\s+/g, " "))) {
    if (del === "*") { nod.delar.push({ typ: "alla" }); continue; }
    const e = del.match(/^(?:([A-Za-z_]\w*):)?([A-Za-z_]\w*)((?:![A-Za-z_]\w*)*)\s*\(([\s\S]*)\)$/);
    if (e) {
      const [, alias, namn, tips, inre] = e;
      const flaggor = tips.split("!").filter(Boolean);
      const inner = flaggor.includes("inner");
      const hint = flaggor.filter((f) => f !== "inner" && f !== "left");
      if (hint.length > 1) throw new EjStod("två tips " + del);
      const { fk, upp, tillEn, mal } = relation(schema, tabell, namn, hint[0]);
      const barn = tolkaSelect(schema, mal, inre || "*");
      nod.delar.push({ typ: "emb", nod: { ...barn, alias: alias ?? namn, fk, upp, tillEn, inner } });
      continue;
    }
    const k = del.match(/^(?:([A-Za-z_]\w*):)?([A-Za-z_]\w*)(?:::([A-Za-z_]\w*))?$/);
    if (!k) throw new EjStod("kolumn " + del);
    nod.delar.push({ typ: "kol", alias: k[1] ?? k[2], kol: k[2], cast: k[3] });
  }
  return nod;
}

/** Relationen PostgREST väljer för `namn!hint(...)` från `tabell`. Allt tvetydigt går till REST-lagret. */
function relation(schema: Schema, tabell: string, namn: string, hint?: string): { fk: Fk; upp: boolean; tillEn: boolean; mal: string } {
  if (!schema.tabeller.has(namn)) {
    // Inbäddning via kolumnen: `employee_id(status)` är många-till-en genom den nyckeln.
    const k = schema.fk.filter((f) => f.barn === tabell && f.barnKol.length === 1 && f.barnKol[0] === namn && (!hint || f.namn === hint || f.far === hint));
    if (k.length !== 1) throw new EjStod("relation " + namn);
    return { fk: k[0], upp: true, tillEn: true, mal: k[0].far };
  }
  if (namn === tabell) throw new EjStod("självrelation " + namn);
  const upp = schema.fk.filter((f) => f.barn === tabell && f.far === namn && (!hint || f.namn === hint || (f.barnKol.length === 1 && f.barnKol[0] === hint)));
  const ner = schema.fk.filter((f) => f.barn === namn && f.far === tabell && (!hint || f.namn === hint || (f.barnKol.length === 1 && f.barnKol[0] === hint)));
  if (upp.length + ner.length !== 1) throw new EjStod("tvetydig relation " + namn);
  return upp.length ? { fk: upp[0], upp: true, tillEn: true, mal: namn } : { fk: ner[0], upp: false, tillEn: ner[0].unik, mal: namn };
}

/** Noden för en sökväg som "course" eller "a.b" (alias eller tabellnamn). */
function hitta(nod: Nod, vag: string[]): Nod {
  let n = nod;
  for (const v of vag) {
    const e = n.delar.find((d) => d.typ === "emb" && (d.nod.alias === v || d.nod.tabell === v));
    if (!e || e.typ !== "emb") throw new EjStod("okänd inbäddning " + v);
    n = e.nod;
  }
  return n;
}

/** Ett värde som supabase-js skriver det i adressen. */
const somText = (v: unknown) => (v === null ? "null" : String(v));

/** Ett villkor i PostgREST-form (`kol`, `op`, `värde` som text), som SQL mot alias `a`. */
function ettVillkor(kol: string, op: string, v: string): (a: string, p: unknown[]) => string {
  const neg = op.startsWith("not.");
  const o = neg ? op.slice(4) : op;
  const kolSql = (a: string) => `${a}.${ID(kol)}`;
  let f: (a: string, p: unknown[]) => string;
  const bin: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike", cs: "@>", cd: "<@", ov: "&&" };
  if (o in bin) {
    const varde = o === "like" || o === "ilike" ? v.replace(/\*/g, "%") : v;
    f = (a, p) => { p.push(varde); return `${kolSql(a)} ${bin[o]} $${p.length}`; };
  } else if (o === "is") {
    const m = { null: "null", true: "true", false: "false", unknown: "unknown" }[v.toLowerCase()];
    if (!m) throw new EjStod("is " + v);
    f = (a) => `${kolSql(a)} is ${m}`;
  } else if (o === "in") {
    const lista = tolkaLista(v);
    f = (a, p) => { p.push(lista); return `${kolSql(a)} = any($${p.length})`; };
  } else if (/^(fts|plfts|phfts|wfts)(\([a-z_]+\))?$/.test(o)) {
    const [, typ, conf] = o.match(/^(\w+?)(?:\(([a-z_]+)\))?$/)!;
    const fn = { fts: "to_tsquery", plfts: "plainto_tsquery", phfts: "phraseto_tsquery", wfts: "websearch_to_tsquery" }[typ]!;
    f = (a, p) => { p.push(v); return `${kolSql(a)} @@ ${fn}(${conf ? `'${conf}', ` : ""}$${p.length})`; };
  } else throw new EjStod("operator " + op);
  return neg ? (a, p) => `not (${f(a, p)})` : f;
}

/** "(a,b,"c,d")" → ["a", "b", "c,d"] */
function tolkaLista(v: string): string[] {
  const inne = v.trim().replace(/^\(/, "").replace(/\)$/, "");
  if (!inne) return [];
  return delaUpp(inne).map((x) => (x.startsWith('"') && x.endsWith('"') ? x.slice(1, -1).replace(/\\(.)/g, "$1") : x));
}

/** PostgREST:s `or=(a.eq.1,and(b.gt.2,c.is.null))` som SQL. */
function logik(uttryck: string, och: boolean): (a: string, p: unknown[]) => string {
  const delar = delaUpp(uttryck).map((d) => {
    const m = d.match(/^(not\.)?(and|or)\(([\s\S]*)\)$/);
    if (m) { const f = logik(m[3], m[2] === "and"); return m[1] ? (a: string, p: unknown[]) => `not ${f(a, p)}` : f; }
    const x = d.match(/^([A-Za-z_]\w*)\.((?:not\.)?[a-z]+(?:\([a-z_]+\))?)\.([\s\S]*)$/);
    if (!x) throw new EjStod("or-del " + d);
    const v = x[3].startsWith('"') && x[3].endsWith('"') ? x[3].slice(1, -1) : x[3];
    return ettVillkor(x[1], x[2], v);
  });
  return (a, p) => "(" + delar.map((f) => f(a, p)).join(och ? " and " : " or ") + ")";
}

/** Bygger frågan ur de inspelade stegen. Kastar EjStod för allt som ska gå till REST-lagret. */
function bygg(schema: Schema, tabell: string, steg: Steg[]) {
  if (!schema.tabeller.has(tabell)) throw new EjStod("tabell " + tabell);
  let nod: Nod | null = null;
  let antal = false, huvud = false, en: "en" | "kanske" | null = null;
  const senare: Steg[] = [];
  for (const [m, a] of steg) {
    if (m === "select") {
      if (nod) throw new EjStod("två select");
      nod = tolkaSelect(schema, tabell, (a[0] as string | undefined) ?? "*");
      const o = (a[1] ?? {}) as { count?: string; head?: boolean };
      if (o.count && o.count !== "exact") throw new EjStod("count " + o.count);
      antal = !!o.count; huvud = !!o.head;
    } else senare.push([m, a]);
  }
  if (!nod) throw new EjStod("ingen select");
  const rot = nod;
  const kolVag = (k: string) => { const d = k.split("."); return { n: hitta(rot, d.slice(0, -1)), kol: d[d.length - 1] }; };
  for (const [m, a] of senare) {
    switch (m) {
      case "eq": case "neq": case "gt": case "gte": case "lt": case "lte": case "like": case "ilike": {
        const { n, kol } = kolVag(a[0] as string);
        n.villkor.push(ettVillkor(kol, m, somText(a[1])));
        break;
      }
      case "is": { const { n, kol } = kolVag(a[0] as string); n.villkor.push(ettVillkor(kol, "is", somText(a[1]))); break; }
      case "in": {
        const { n, kol } = kolVag(a[0] as string);
        const lista = (a[1] as unknown[]).map(somText);
        n.villkor.push((al, p) => { p.push(lista); return `${al}.${ID(kol)} = any($${p.length})`; });
        break;
      }
      case "contains": case "containedBy": case "overlaps": {
        const { n, kol } = kolVag(a[0] as string);
        const v = a[1];
        if (typeof v !== "string" && !Array.isArray(v)) throw new EjStod(m + " med objekt");
        const op = { contains: "cs", containedBy: "cd", overlaps: "ov" }[m]!;
        n.villkor.push(ettVillkor(kol, op, typeof v === "string" ? v : `{${(v as unknown[]).map(somText).join(",")}}`));
        break;
      }
      case "not": { const { n, kol } = kolVag(a[0] as string); n.villkor.push(ettVillkor(kol, "not." + (a[1] as string), somText(a[2]))); break; }
      case "filter": { const { n, kol } = kolVag(a[0] as string); n.villkor.push(ettVillkor(kol, a[1] as string, somText(a[2]))); break; }
      case "match": for (const [k, v] of Object.entries(a[0] as Record<string, unknown>)) { const { n, kol } = kolVag(k); n.villkor.push(ettVillkor(kol, "eq", somText(v))); } break;
      case "or": {
        const o = (a[1] ?? {}) as { foreignTable?: string; referencedTable?: string };
        const ref = o.referencedTable ?? o.foreignTable;
        hitta(rot, ref ? ref.split(".") : []).villkor.push(logik(a[0] as string, false));
        break;
      }
      case "textSearch": {
        const { n, kol } = kolVag(a[0] as string);
        const o = (a[2] ?? {}) as { config?: string; type?: string };
        const typ = o.type === "plain" ? "plfts" : o.type === "phrase" ? "phfts" : o.type === "websearch" ? "wfts" : "fts";
        n.villkor.push(ettVillkor(kol, `${typ}${o.config ? `(${o.config})` : ""}`, somText(a[1])));
        break;
      }
      case "order": {
        const o = (a[1] ?? {}) as { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string };
        const ref = o.referencedTable ?? o.foreignTable;
        const kol = a[0] as string;
        if (!/^[A-Za-z_]\w*$/.test(kol)) throw new EjStod("ordning " + kol);
        const riktning = o.ascending === false ? " desc" : " asc";
        const nulls = o.nullsFirst === undefined ? "" : o.nullsFirst ? " nulls first" : " nulls last";
        hitta(rot, ref ? ref.split(".") : []).ordning.push((al) => `${al}.${ID(kol)}${riktning}${nulls}`);
        break;
      }
      case "limit": {
        const o = (a[1] ?? {}) as { foreignTable?: string; referencedTable?: string };
        const ref = o.referencedTable ?? o.foreignTable;
        hitta(rot, ref ? ref.split(".") : []).lim = Number(a[0]);
        break;
      }
      case "range": {
        const o = (a[2] ?? {}) as { foreignTable?: string; referencedTable?: string };
        const ref = o.referencedTable ?? o.foreignTable;
        const n = hitta(rot, ref ? ref.split(".") : []);
        n.off = Number(a[0]); n.lim = Number(a[1]) - Number(a[0]) + 1;
        break;
      }
      case "single": en = "en"; break;
      case "maybeSingle": en = "kanske"; break;
      case "abortSignal": case "returns": case "overrideTypes": break;
      default: throw new EjStod("metod " + m);
    }
  }
  return { rot, antal, huvud, en };
}

let lopnr = 0;
/** `select <kolumner> from tabell a where … order … limit …`, med inbäddningarna som underfrågor. */
function sqlFor(n: Nod, a: string, p: unknown[], koppling?: string, tak?: number): string {
  const kol = n.delar.map((d) => {
    if (d.typ === "alla") return `${a}.*`;
    if (d.typ === "kol") return `${a}.${ID(d.kol)}${d.cast ? "::" + ID(d.cast).slice(1, -1) : ""} as ${ID(d.alias)}`;
    const e = d.nod, b = `_e${++lopnr}`, x = `_x${lopnr}`;
    const inre = sqlFor(e, b, p, kopplingFor(e, b, a));
    return e.tillEn
      ? `(select row_to_json(${x}) from (${inre} limit 1) ${x}) as ${ID(e.alias)}`
      : `coalesce((select json_agg(${x}) from (${inre}) ${x}), '[]'::json) as ${ID(e.alias)}`;
  });
  const w = villkorFor(n, a, p, koppling);
  const lim = n.lim !== undefined ? (tak !== undefined ? Math.min(n.lim, tak) : n.lim) : tak;
  return `select ${kol.join(", ")} from public.${ID(n.tabell)} ${a}${w ? " where " + w : ""}` +
    (n.ordning.length ? " order by " + n.ordning.map((f) => f(a)).join(", ") : "") +
    (lim !== undefined ? ` limit ${lim | 0}` : "") + (n.off ? ` offset ${n.off | 0}` : "");
}
function kopplingFor(e: Emb, b: string, a: string): string {
  // upp: förälderns nyckel pekar på barnet. Annars pekar barnets nyckel på föräldern.
  return e.fk.barnKol.map((k, i) => e.upp ? `${b}.${ID(e.fk.farKol[i])} = ${a}.${ID(k)}` : `${b}.${ID(k)} = ${a}.${ID(e.fk.farKol[i])}`).join(" and ");
}
/** Nodens egna villkor, och att varje !inner-inbäddning har en rad. */
function villkorFor(n: Nod, a: string, p: unknown[], koppling?: string): string {
  const w = [...(koppling ? [koppling] : []), ...n.villkor.map((f) => f(a, p))];
  for (const d of n.delar) {
    if (d.typ !== "emb" || !d.nod.inner) continue;
    const b = `_i${++lopnr}`;
    w.push(`exists (select 1 from public.${ID(d.nod.tabell)} ${b} where ${villkorFor(d.nod, b, p, kopplingFor(d.nod, b, a))})`);
  }
  return w.join(" and ");
}

/* ------------------------------------------------------------------------ */
/* Sessionen: ett bygge, med den inloggades claims.                          */
/* ------------------------------------------------------------------------ */

type Vem = "server" | "admin";
type Verklig = { server: () => Promise<SupabaseClient>; admin: () => SupabaseClient };

/** Ett värde som SQL-literal. Otypad, som en parameter: Postgres tar typen ur sammanhanget. */
function lit(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return lit("{" + v.map((x) => (x === null ? "NULL" : '"' + String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"')).join(",") + "}");
  const t = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (t.includes("\0")) throw new EjStod("nolltecken");
  const e = t.replace(/'/g, "''");
  return t.includes("\\") ? ` E'${e.replace(/\\/g, "\\\\")}'` : `'${e}'`;
}

/**
 * Varje fråga är en egen kort transaktion i en enda rundresa: rollen, claims
 * och skrivskyddet sätts med `set local` och gäller bara den. Anslutningen är
 * fri igen direkt efter, så poolen delas av alla byggen i instansen och ingen
 * håller en plats i poolern medan något annat väntar.
 */
class Session {
  stangd = false;
  /** Hur det gick, för Server-Timing: frågor i Postgres, anrop till REST-lagret och fel. */
  matt = { pg: 0, rest: 0, fel: 0 };
  private klienter: Partial<Record<Vem, SupabaseClient>> = {};
  private forord: Record<Vem, string>;

  constructor(private pool: pg.Pool, claims: string, sub: string, readonly schema: Schema, private verklig: Verklig) {
    const f = (roll: string, c: string, s: string) =>
      `set local role ${roll}; set local transaction_read_only = on; set local statement_timeout = '15s'; ` +
      `select set_config('request.jwt.claims', ${lit(c)}, true), set_config('request.jwt.claim.sub', ${lit(s)}, true); `;
    this.forord = { server: f("authenticated", claims, sub), admin: f("service_role", JSON.stringify({ role: "service_role" }), "") };
  }

  async fraga(vem: Vem, sql: string, p: unknown[]): Promise<pg.QueryResult> {
    if (avstangd()) throw new EjStod("ingen anslutning");
    const text = this.forord[vem] + sql.replace(/\$(\d+)/g, (_, n) => lit(p[Number(n) - 1]));
    this.matt.pg++;
    const t0 = performance.now();
    try {
      const r = (await this.pool.query(text)) as unknown as pg.QueryResult[];
      if (LOGG) LOGG.push([vem, 0, Math.round(performance.now() - t0), 0, sql.slice(0, 90)]);
      return r[r.length - 1];
    } catch (e) {
      this.matt.fel++;
      // Ett fel i anslutningen (inte i frågan): stäng av vägen en stund, så att nästa fråga inte väntar på samma sak.
      if (!(e as { code?: string }).code || /^(08|57P0|53)/.test((e as { code: string }).code)) stangAv(e);
      throw e;
    }
  }

  stang() {
    this.stangd = true;
  }

  /** Den vanliga klienten, skapad utanför sessionen så att den inte blir den här igen. */
  async rest(vem: Vem): Promise<SupabaseClient> {
    this.matt.rest++;
    if (!this.klienter[vem]) this.klienter[vem] = await ALS.exit(() => (vem === "admin" ? this.verklig.admin() : this.verklig.server()));
    return this.klienter[vem]!;
  }

  klient(vem: Vem): SupabaseClient {
    return klientProxy(this, vem) as unknown as SupabaseClient;
  }
}

/** Efter ett anslutningsfel går byggena via REST-lagret en minut. */
let avstangdTill = 0;
const avstangd = () => Date.now() < avstangdTill;
function stangAv(e: unknown) {
  avstangdTill = Date.now() + 60_000;
  console.error("nav2 pg: anslutningen svarar inte, via REST en minut", e instanceof Error ? e.message : e);
}

const ALS = new AsyncLocalStorage<Session>();
/** Bara i provet: varje fråga med väntan och tid. */
const LOGG: [string, number, number, number, string][] | null = process.env.NAV2_PG_LOGG === "2" ? [] : null;
export const pgLogg = () => LOGG;

/** Under ett bygge: klienten som läser direkt i Postgres. Annars null. */
export function pgKlient(vem: Vem): SupabaseClient | null {
  const s = ALS.getStore();
  return s && !s.stangd ? s.klient(vem) : null;
}

/* ------------------------------------------------------------------------ */
/* Klienten: spelar in anropen och kör dem i Postgres eller i REST-lagret.   */
/* ------------------------------------------------------------------------ */

/** Spelar upp inspelade anrop på den vanliga klienten. */
function spelaUpp(rot: unknown, steg: (["get", string] | ["call", unknown[]])[]): unknown {
  let x: unknown = rot, forra: unknown = undefined;
  for (const s of steg) {
    if (s[0] === "get") { forra = x; x = (x as Record<string, unknown>)[s[1]]; }
    else x = (x as (...a: unknown[]) => unknown).apply(forra, s[1]);
  }
  return x;
}

/** Allt som inte är from/rpc (auth, storage, functions): spelas in och körs på den vanliga klienten. */
function inspelning(s: Session, vem: Vem, steg: (["get", string] | ["call", unknown[]])[]): unknown {
  return new Proxy(function () {}, {
    get(_, prop) {
      if (prop === "then") {
        if (!steg.length) return undefined;
        return (ok: (v: unknown) => unknown, nej: (e: unknown) => unknown) => s.rest(vem).then((k) => spelaUpp(k, steg)).then(ok, nej);
      }
      if (typeof prop === "symbol") return undefined;
      return inspelning(s, vem, [...steg, ["get", prop]]);
    },
    apply(_, __, args) {
      return inspelning(s, vem, [...steg, ["call", args]]);
    },
  });
}

function klientProxy(s: Session, vem: Vem) {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === "from") return (t: string) => fraganBorjar(s, vem, t);
      if (prop === "schema") return () => inspelning(s, vem, [["get", "schema"]]);
      if (prop === "rpc") return (fn: string, args?: Record<string, unknown>, o?: Record<string, unknown>) => fraga(s, vem, { fn, args: args ?? {}, o: o ?? {} }, []);
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return inspelning(s, vem, [["get", prop]]);
    },
  });
}

type Kalla = { tabell: string } | { fn: string; args: Record<string, unknown>; o: Record<string, unknown> };
type Svar = { data: unknown; error: unknown; count: number | null; status: number; statusText: string };

/**
 * `from(t)`: som supabase-js QueryBuilder ger varje select/insert/… en egen fråga.
 * Filtren därefter ändrar samma fråga och ger den tillbaka (supabase-js gör så,
 * och kod som skriver `q.eq(…)` utan att ta vara på svaret räknar med det).
 */
function fraganBorjar(s: Session, vem: Vem, tabell: string): unknown {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return (...a: unknown[]) => fraga(s, vem, { tabell }, [[prop, a]]);
    },
  });
}
function fraga(s: Session, vem: Vem, kalla: Kalla, steg: Steg[]): unknown {
  const p: object = new Proxy({}, {
    get(_, prop) {
      if (prop === "then") return (ok: (v: Svar) => unknown, nej: (e: unknown) => unknown) => utfor(s, vem, kalla, [...steg]).then(ok, nej);
      if (prop === "catch" || prop === "finally") return (f: (x: unknown) => unknown) => (utfor(s, vem, kalla, [...steg]) as Promise<unknown>)[prop as "catch"](f);
      if (typeof prop === "symbol") return undefined;
      return (...a: unknown[]) => { steg.push([prop, a]); return p; };
    },
  });
  return p;
}

/** Via REST-lagret, exakt som anropen skrevs. */
async function viaRest(s: Session, vem: Vem, kalla: Kalla, steg: Steg[]): Promise<Svar> {
  const k = await s.rest(vem);
  let q = ("tabell" in kalla ? k.from(kalla.tabell) : k.rpc(kalla.fn, kalla.args, kalla.o)) as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const [m, a] of steg) q = q[m](...a) as Record<string, (...a: unknown[]) => unknown>;
  return (await (q as unknown as PromiseLike<Svar>)) as Svar;
}

const SKRIVER = new Set(["insert", "update", "upsert", "delete", "throwOnError", "csv", "geojson", "explain", "rollback", "setHeader"]);

async function utfor(s: Session, vem: Vem, kalla: Kalla, steg: Steg[]): Promise<Svar> {
  if (s.stangd || steg.some(([m]) => SKRIVER.has(m))) return viaRest(s, vem, kalla, steg);
  let fragan: { sql: string; p: unknown[]; tolka: (r: pg.QueryResult) => Svar | null };
  try {
    fragan = "tabell" in kalla ? tabellfraga(s.schema, kalla.tabell, steg) : rpcfraga(s.schema, kalla, steg);
  } catch (e) {
    if (process.env.NAV2_PG_LOGG) console.error("nav2 pg: via REST", e instanceof Error ? e.message : e);
    return viaRest(s, vem, kalla, steg);
  }
  try {
    const svar = fragan.tolka(await s.fraga(vem, fragan.sql, fragan.p));
    // null = ett svar REST-lagret ger som fel (single utan exakt en rad): låt det ge sitt eget.
    return svar ?? viaRest(s, vem, kalla, steg);
  } catch (e) {
    if (process.env.NAV2_PG_LOGG && !(e instanceof EjStod)) console.error("nav2 pg: fel i Postgres, via REST", e instanceof Error ? e.message : e, fragan.sql);
    return viaRest(s, vem, kalla, steg);
  }
}

const OK = (data: unknown, count: number | null = null): Svar => ({ data, error: null, count, status: 200, statusText: "OK" });

function tabellfraga(schema: Schema, tabell: string, steg: Steg[]) {
  // Utan select ger supabase-js inget att läsa; låt REST-lagret svara som det gör.
  if (!steg.some(([m]) => m === "select")) throw new EjStod("utan select");
  const { rot, antal, huvud, en } = bygg(schema, tabell, steg);
  const p: unknown[] = [];
  const data = huvud ? "null::json" : `(select coalesce(json_agg(_x), '[]'::json) from (${sqlFor(rot, "_t", p, undefined, MAX_RADER)}) _x)`;
  const n = antal ? `(select count(*) from public.${ID(tabell)} _t${(() => { const w = villkorFor(rot, "_t", p); return w ? " where " + w : ""; })()})::int` : "null::int";
  return {
    sql: `select ${data} as j, ${n} as n`,
    p,
    tolka: (r: pg.QueryResult): Svar | null => {
      const rader = r.rows[0].j as unknown[] | null, count = r.rows[0].n as number | null;
      if (huvud) return OK(null, count);
      if (en) {
        if (rader!.length === 1) return OK(rader![0], count);
        if (en === "kanske" && rader!.length === 0) return OK(null, count);
        return null;
      }
      return OK(rader, count);
    },
  };
}

function rpcfraga(schema: Schema, kalla: { fn: string; args: Record<string, unknown>; o: Record<string, unknown> }, steg: Steg[]) {
  const varianter = schema.fn.get(kalla.fn);
  if (!varianter || varianter.length !== 1) throw new EjStod("funktion " + kalla.fn);
  if (kalla.o.head || kalla.o.count || kalla.o.get) throw new EjStod("rpc-val");
  const f = varianter[0];
  const p: unknown[] = [];
  const args = Object.entries(kalla.args).map(([k, v]) => {
    const typ = f.argtyper[k];
    if (!typ) throw new EjStod("okänt argument " + k);
    p.push(v !== null && (typ === "json" || typ === "jsonb") ? JSON.stringify(v) : v);
    return `${ID(k)} => $${p.length}::${typ.replace(/[^a-z0-9_ ,\[\]()]/gi, "")}`;
  });
  const anrop = `public.${ID(kalla.fn)}(${args.join(", ")})`;
  if (f.scalar && !f.retset) {
    if (steg.length) throw new EjStod("rpc med steg");
    return { sql: `select to_json(${anrop}) as j`, p, tolka: (r: pg.QueryResult) => OK(r.rows[0].j ?? null) };
  }
  if (!f.retset || !f.sammansatt) throw new EjStod("rpc-typ " + kalla.fn);
  // En mängd rader: filtren och ordningen gäller raderna, som för en tabell.
  const nod: Nod = { tabell: "", delar: [{ typ: "alla" }], villkor: [], ordning: [] };
  let en: "en" | "kanske" | null = null;
  for (const [m, a] of steg) {
    if (m === "eq" || m === "neq" || m === "gt" || m === "gte" || m === "lt" || m === "lte") nod.villkor.push(ettVillkor(a[0] as string, m, somText(a[1])));
    else if (m === "order") { const o = (a[1] ?? {}) as { ascending?: boolean }; const k = a[0] as string; nod.ordning.push((al) => `${al}.${ID(k)}${o.ascending === false ? " desc" : " asc"}`); }
    else if (m === "limit") nod.lim = Number(a[0]);
    else if (m === "single") en = "en";
    else if (m === "maybeSingle") en = "kanske";
    else if (m === "abortSignal" || m === "returns") continue;
    else throw new EjStod("rpc-steg " + m);
  }
  const w = nod.villkor.map((g) => g("_r", p)).join(" and ");
  const lim = Math.min(nod.lim ?? MAX_RADER, MAX_RADER);
  const inre = `select _r.* from ${anrop} _r${w ? " where " + w : ""}${nod.ordning.length ? " order by " + nod.ordning.map((g) => g("_r")).join(", ") : ""} limit ${lim}`;
  return {
    sql: `select coalesce(json_agg(_x), '[]'::json) as j from (${inre}) _x`,
    p,
    tolka: (r: pg.QueryResult): Svar | null => {
      const rader = r.rows[0].j as unknown[];
      if (!en) return OK(rader);
      if (rader.length === 1) return OK(rader[0]);
      if (en === "kanske" && !rader.length) return OK(null);
      return null;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Ingången.                                                                 */
/* ------------------------------------------------------------------------ */

export type PgMatt = { pg: number; rest: number; fel: number; anslut: number } | null;

/**
 * Kör `fn` med läsningarna direkt i Postgres. `identitet` är den mellanvaran
 * verifierat. Går det inte att ansluta körs `fn` som förut, och svaret är null.
 */
export async function medPg<T>(
  identitet: { authUserId: string; email: string | null },
  verklig: Verklig,
  fn: () => Promise<T>,
): Promise<{ v: T; matt: PgMatt }> {
  const p = pool();
  if (!p || avstangd()) return { v: await fn(), matt: null };
  const t0 = performance.now();
  let schema: Schema;
  try {
    // Första gången i instansen läses schemat, och den första anslutningen öppnas med det.
    if (!schemat) { schemat = lasSchema(p); schemat.catch(() => { schemat = null; }); }
    schema = await schemat;
  } catch (e) {
    stangAv(e);
    return { v: await fn(), matt: null };
  }
  const claims = JSON.stringify({ sub: identitet.authUserId, role: "authenticated", aud: "authenticated", email: identitet.email ?? undefined });
  const s = new Session(p, claims, identitet.authUserId, schema, verklig);
  const anslut = Math.round(performance.now() - t0);
  try {
    const v = await ALS.run(s, fn);
    return { v, matt: { ...s.matt, anslut } };
  } finally {
    s.stang();
  }
}
