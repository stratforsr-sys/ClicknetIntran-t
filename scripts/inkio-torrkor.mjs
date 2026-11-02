#!/usr/bin/env node
/**
 * Inkio-bevakningen som torrkörning (0277): vad SKULLE ett varv göra just nu?
 *
 *   set -a; . ~/.clicknet/nav.env; . ~/.clicknet/crm.env; set +a
 *   node --experimental-strip-types scripts/inkio-torrkor.mjs [org.nr …] [--alla-rader]
 *
 * RÖR INGENTING. Inkio läses bara med GET (kunden på org.nr och kundens
 * historik), och Navs databas läses i en transaktion som är `read only` och
 * rullas tillbaka. Logiken är bevakningens egen (`src/lib/crm/inflode.ts`), så
 * det som skrivs ut är det `bevaka()` hade gjort: nya och ändrade rader,
 * notiserna med mottagarnas namn, ordrar som hade makulerats, markerats betalda
 * eller fått avtalsbevakningen avslutad, och kopplingarna på org.nr.
 *
 * Nycklarna: DATABASE_URL (nav.env) och CRM_API_KEY/CRM_API_SECRET (crm.env,
 * gärna en läsnyckel). Mottagarna räknas som i produktionen, utan provfiltret.
 */
import pg from "pg";
import { jamfor, kopplaPaOrgnr, kretsen, notisFor, statusFranInkio, tolkaPost, avtryck } from "../src/lib/crm/inflode.ts";
import { INKIO_CLICKNET, orgnrSiffror } from "../src/lib/crm/inkio-mappning.ts";

const args = process.argv.slice(2);
const allaRader = args.includes("--alla-rader");
const bara = args.filter((a) => /^\d{6}-\d{4}$/.test(a));
const NU = Date.now();

const H = {
  Authorization: `token ${process.env.CRM_API_KEY}:${process.env.CRM_API_SECRET}`,
  Accept: "application/json",
  "X-Inkio-Company": process.env.INKIO_COMPANY_ID || INKIO_CLICKNET,
};
async function get(sokvag, query = {}) {
  const u = new URL(sokvag, process.env.INKIO_URL || "https://crm.inkio.se");
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const r = await fetch(u, { method: "GET", headers: H });
  if (!r.ok) throw new Error(`Inkio ${r.status} på GET ${u.pathname}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("begin read only");
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const finnsTabell = async (t) => (await q("select to_regclass($1) is not null as f", [`public.${t}`]))[0].f;

try {
  const ordrar = await q(`select id, org_number, company_name, salesperson_id, status, order_value::float, approved_at
                            from sales_order where status <> 'utkast' and org_number ~ '^\\d{6}-\\d{4}$' order by created_at`);
  const personer = await q(`select e.id, e.first_name || ' ' || e.last_name as namn, lower(e.email) as epost, e.status, e.manager_id, e.team_id,
                                   coalesce(array_agg(r.role) filter (where r.role is not null), '{}') as roller
                              from employee e left join employee_role r on r.employee_id = e.id group by e.id`);
  const team = new Map((await q("select id, lead_id from team")).map((t) => [t.id, t.lead_id]));
  // `kopplad` kom med 0277; före migrationen är varje koppling Navs egen.
  const harKopplad = (await q("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'crm_order' and column_name = 'kopplad'")).length > 0;
  const kopplingar = await q(`select order_id, crm_order_id, ${harKopplad ? "kopplad" : "'nav' as kopplad"}, synced_at, state from crm_order`);
  const harHandelse = await finnsTabell("crm_handelse");

  const NIVA = { ceo: "superadmin", admin: "superadmin", sales_manager: "admin", team_lead: "admin", finance: "admin", project_manager: "admin", delivery: "admin" };
  const nivaFor = (rr) => rr.reduce((b, r) => (["salesperson", "admin", "superadmin"].indexOf(NIVA[r] ?? "salesperson") > ["salesperson", "admin", "superadmin"].indexOf(b) ? NIVA[r] : b), "salesperson");
  const AKTIV = new Set(["active", "onboarding"]);
  const per = new Map(personer.map((p) => [p.id, p]));
  const niva = new Map(personer.map((p) => [p.id, nivaFor(p.roller)]));
  const epost = new Map(personer.filter((p) => p.epost && AKTIV.has(p.status)).map((p) => [p.epost, p.id]));
  const namn = (id) => per.get(id)?.namn ?? id;
  const krets = (saljare) => {
    const aktiv = (id) => AKTIV.has(per.get(id)?.status);
    const chefer = new Map(saljare.map((s) => [s, [per.get(s)?.manager_id, team.get(per.get(s)?.team_id)].filter((x) => x && x !== s)]));
    const superadmin = [...niva].filter(([id, n]) => n === "superadmin" && aktiv(id)).map(([id]) => id);
    return kretsen({ superadmin, saljare: saljare.filter(aktiv), chefer, niva }).filter(aktiv);
  };

  const perKund = new Map();
  for (const o of ordrar) perKund.set(o.org_number, [...(perKund.get(o.org_number) ?? []), o]);
  const kunder = [...perKund.keys()].filter((k) => !bara.length || bara.includes(k));

  const summa = { kunder: kunder.length, iInkio: 0, rader: 0, notiser: 0, status: 0, kopplingar: 0, saknas: [] };
  console.log(`\nTorrkörning ${new Date(NU).toISOString()} — ${kunder.length} kunder, crm_handelse ${harHandelse ? "finns" : "finns inte än (allt räknas som första läsningen)"}\n`);

  for (const org of kunder) {
    const o = perKund.get(org);
    const bolag = o.slice().sort((a, b) => String(a.approved_at ?? "").localeCompare(String(b.approved_at ?? ""))).pop().company_name;
    const k = (await get("/api/records/customer", { filters: [["tax_id_key", "=", orgnrSiffror(org)]], fields: ["id", "number", "customer_name"] }))[0];
    if (!k) {
      summa.saknas.push(`${org} ${bolag}`);
      console.log(`— ${bolag} (${org}): finns inte i Inkio`);
      continue;
    }
    summa.iInkio++;
    const t0 = Date.now();
    const h = await get("/api/customers/get-customer-history", { id: k.id, with_deleted: "1" });
    const ms = Date.now() - t0;
    const rader = (h.items ?? []).map(tolkaPost).filter(Boolean);
    summa.rader += rader.length;
    const tidigare = harHandelse
      ? new Map((await q("select extern_id, avtryck, text, data, raderad, andrad from crm_handelse where org_number = $1", [org])).map((r) => [r.extern_id, r]))
      : new Map();
    const saljare = [...new Set(o.map((x) => x.salesperson_id))];
    const mottagare = krets(saljare);
    const navSkapadeNyss = kopplingar.some((x) => o.some((y) => y.id === x.order_id) && x.kopplad === "nav" && NU - Date.parse(x.synced_at) < 2 * 3600 * 1000);

    const ut = [];
    for (const r of rader) {
      const f = jamfor(tidigare.get(r.extern_id), r);
      const n = notisFor(r, f, { bolag, nu: NU, navSkapadeNyss, forsta: tidigare.size === 0 });
      const s = statusFranInkio(r, f, NU);
      if (n) {
        const av = r.forfattare_epost ? epost.get(r.forfattare_epost) : null;
        const till = mottagare.filter((m) => m !== av);
        summa.notiser += till.length;
        ut.push(`   NOTIS  ${n.kalla}: "${n.rubrik}" — ${n.detalj.slice(0, 80)}\n          till ${till.map(namn).join(", ") || "ingen"}${av ? ` (inte ${namn(av)}, som skrev)` : ""}`);
      }
      if (s) {
        summa.status++;
        ut.push(`   STATUS ${s.vad}: ${s.skal}`);
      }
      if (allaRader) ut.push(`   ${f.typ.padEnd(7)} ${r.skapad.slice(0, 16)} ${r.slag.padEnd(10)} ${(r.forfattare ?? "").padEnd(18)} ${r.text.slice(0, 70).replace(/\n/g, " ")}`);
    }

    const godkanda = o.filter((x) => x.status === "signerad" || x.status === "betald");
    const kopplade = new Set(kopplingar.map((x) => x.order_id));
    const upptagna = new Set(kopplingar.map((x) => x.crm_order_id).filter(Boolean));
    const inkioOrdrar = rader.filter((r) => r.slag === "post" && r.sort === "order").map((r) => ({ id: r.om_id, nummer: r.om_nummer, varde: r.data?.value ?? null, makulerad: r.data?.cancelled === true }));
    const par = kopplaPaOrgnr(godkanda.map((x) => ({ id: x.id, varde: x.order_value, kopplad: kopplade.has(x.id) })), inkioOrdrar, upptagna);
    for (const p of par) {
      summa.kopplingar++;
      const navOrder = o.find((x) => x.id === p.navId);
      const i = inkioOrdrar.find((x) => x.id === p.inkioId);
      ut.push(`   KOPPLA Nav ${navOrder.order_value} kr → Inkio ${p.nummer} (${i?.varde ?? "?"} kr${i && Math.round(i.varde) !== Math.round(navOrder.order_value) ? ", OLIKA VÄRDEN" : ""})`);
    }
    const ejKopplade = godkanda.filter((x) => !kopplade.has(x.id) && !par.some((p) => p.navId === x.id));
    if (ejKopplade.length) ut.push(`   okopplad: ${ejKopplade.map((x) => `${x.order_value} kr`).join(", ")} — Inkio har ${inkioOrdrar.map((i) => `${i.nummer} ${i.varde} kr${i.makulerad ? " (makulerad)" : ""}`).join(", ") || "ingen order"}`);
    const gamlaMak = inkioOrdrar.filter((i) => i.makulerad && (kopplingar.some((x) => x.crm_order_id === i.id && o.some((y) => y.id === x.order_id && (y.status === "signerad" || y.status === "betald")))));
    const utanPar = inkioOrdrar.filter((i) => i.makulerad && godkanda.length && !kopplingar.some((x) => x.crm_order_id === i.id));
    if (utanPar.length) ut.push(`   OBS    order makulerad i Inkio, Nav har godkända order på kunden: ${utanPar.map((i) => `${i.nummer} ${i.varde} kr`).join(", ")}`);
    if (gamlaMak.length) ut.push(`   OBS    makulerad i Inkio men godkänd i Nav (rörs inte, gammalt läge): ${gamlaMak.map((i) => i.nummer).join(", ")}`);

    console.log(`${ut.length ? "●" : "·"} ${bolag} (${org}) ${k.number}: ${rader.length} rader, ${ms} ms, avtryck ${avtryck(h.items).slice(0, 8)}`);
    for (const rad of ut) console.log(rad);
  }

  console.log(`\nSumma: ${summa.iInkio}/${summa.kunder} kunder i Inkio, ${summa.rader} rader, ${summa.notiser} notiser, ${summa.status} statusändringar, ${summa.kopplingar} kopplingar.`);
  if (summa.saknas.length) console.log(`Saknas i Inkio: ${summa.saknas.join("; ")}`);
} finally {
  await db.query("rollback");
  await db.end();
}
