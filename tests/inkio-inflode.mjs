#!/usr/bin/env node
/**
 * Inkio in i Nav (0277): tolkningen, jämförelsen, notisen, kretsen, statusen,
 * kopplingen och kundkortets rader. Ren logik, inget nätverk.
 *
 *   node --experimental-strip-types tests/inkio-inflode.mjs
 *
 * Posterna nedan är riktiga poster ur `get-customer-history` (2026-11-02),
 * med id:n och namn som de stod.
 */
import {
  NOTIS_FONSTER_MS,
  KALL_MS,
  aktivitetsrader,
  attLasa,
  avtryck,
  etikett,
  jamfor,
  kopplaPaOrgnr,
  kretsen,
  navForfattare,
  notisFor,
  omradeFor,
  posttext,
  postuppgifter,
  provfilter,
  renText,
  senastHant,
  statusFranInkio,
  statusfelNotis,
  tolkaPost,
} from "../src/lib/crm/inflode.ts";
import { nyOrder, orderrader, rattning } from "../src/lib/crm/inkio-mappning.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const NU = Date.parse("2026-11-02T12:00:00Z");
const timmeSedan = new Date(NU - 60 * 60 * 1000).toISOString();
const tvaDagarSedan = new Date(NU - 48 * 60 * 60 * 1000).toISOString();

const anteckning = (at = timmeSedan, ovrigt = {}) => ({
  id: "01a10fff-f6ca-70d5-9c86-8df0aec78f23",
  kind: "comment",
  area: "customer",
  at,
  about: null,
  entry: {
    id: "01a10fff-f6ca-70d5-9c86-8df0aec78f23",
    content: "Ringde, inget svar.",
    created_by_full_name: "Matias Lopez",
    created_by_email: "Matias@EffektivMedia.nu",
    created_by_is_service_account: false,
    created_at: at,
    comment_type: "Comment",
    import_unattributed: false,
    activity_template: null,
    activity_args: null,
    reference_doctype: "Customer",
    reference_id: "01a10ffe-ddb9-7491-9a49-d58ba88061f7",
    edited_at: null,
    deleted_at: null,
    ...ovrigt,
  },
});

const order = (data = {}, at = "2026-09-17T05:53:07.000000Z") => ({
  id: "order:01a10fff-bf68-712d-abb0-daed49ad7541",
  kind: "order",
  area: "sales",
  at,
  about: { doctype: "Sales Order", id: "01a10fff-bf68-712d-abb0-daed49ad7541", title: "Kampanjsida 24 mån", subtitle: "SO-2026-00046 · 2026-09-17", route: "/sales-orders/01a10fff-bf68-712d-abb0-daed49ad7541" },
  data: { number: "SO-2026-00046", services: ["Kampanjsida 24 mån"], value: 167880, currency: "SEK", deal_type: "New", status: "Confirmed", cancelled: false, sold_by: null, ...data },
  all_day: false,
});

const kortflytt = {
  id: "01a15fa1-0000-7000-8000-000000000001",
  kind: "activity",
  area: "work",
  at: timmeSedan,
  about: { doctype: "Task", id: "01a15fa1-task", title: "Roos Alltjänst", subtitle: null, route: "/tasks/01a15fa1-task" },
  entry: {
    id: "01a15fa1-0000-7000-8000-000000000001",
    content: "Dennis Dzananovic moved this card from VK (Dennis) to Godkänd & Lanserad",
    created_by_full_name: "Dennis Dzananovic",
    created_by_email: "dennis@effektivmedia.nu",
    created_by_is_service_account: false,
    created_at: timmeSedan,
    comment_type: "Info",
    activity_template: "{0} moved this card from {1} to {2}",
    activity_args: '["Dennis Dzananovic","VK (Dennis)","Godkänd & Lanserad"]',
    edited_at: null,
    deleted_at: null,
  },
};

rubrik("Tolkningen");
{
  const r = tolkaPost(anteckning());
  ok("en kommentar blir en anteckning", r.slag === "anteckning" && r.text === "Ringde, inget svar.");
  ok("författarens mejl i gemener", r.forfattare_epost === "matias@effektivmedia.nu");
  ok("på kunden: etiketten är Kunden", etikett(r) === "Kunden");
  const o = tolkaPost(order());
  ok("en order blir en post med nummer och värde", o.slag === "post" && o.om_nummer === "SO-2026-00046" && o.text.includes("167 880 kr"), o.text);
  ok("orderns länk följer med", o.data.route === "/sales-orders/01a10fff-bf68-712d-abb0-daed49ad7541");
  const k = tolkaPost(kortflytt);
  ok("en kortflytt är en aktivitet på leveranskortet", k.slag === "aktivitet" && etikett(k) === "Leveranskort Roos Alltjänst");
  ok("taggar och entiteter tas bort", renText("<p>Hej&nbsp;där</p><p>&amp; mer</p>") === "Hej där\n& mer");
  ok("ett omnämnande blir @Namn", renText("@[Simon Omar](ref:User/01a10ffe-8e2c-74dd-a6de-1fb0b10f0a49) kolla") === "@Simon Omar kolla");
  ok("avtrycket är stabilt oavsett nyckelordning", avtryck({ a: 1, b: [2, { c: 3, d: 4 }] }) === avtryck({ b: [2, { d: 4, c: 3 }], a: 1 }));
  ok("ett ärende i en mening", posttext({ id: "ticket:x", kind: "ticket", about: { title: "Kunden vill bestrida", subtitle: "TKT-2026-00003" }, data: { number: "TKT-2026-00003", subject: "Kunden vill bestrida", status: "Open" } }) === "Ärende TKT-2026-00003: Kunden vill bestrida · öppet");
  ok("en post utan id ger ingen rad", tolkaPost({ kind: "comment", at: timmeSedan }) === null);
}

rubrik("Jämförelsen");
{
  const r = tolkaPost(anteckning());
  ok("aldrig sedd: ny", jamfor(undefined, r).typ === "ny");
  ok("samma avtryck: samma", jamfor({ avtryck: r.avtryck, text: r.text, data: r.data, raderad: null, andrad: null }, r).typ === "samma");
  const andrad = tolkaPost(anteckning(timmeSedan, { content: "Ringde två gånger, inget svar.", edited_at: new Date(NU).toISOString() }));
  ok("ändrad text: ändrad", jamfor({ avtryck: r.avtryck, text: r.text, data: r.data, raderad: null, andrad: null }, andrad).typ === "andrad");
  const raderad = tolkaPost(anteckning(timmeSedan, { deleted_at: new Date(NU).toISOString() }));
  ok("raderad i Inkio: raderad", jamfor({ avtryck: r.avtryck, text: r.text, data: r.data, raderad: null, andrad: null }, raderad).typ === "raderad");

  const fore = tolkaPost(order());
  const efter = tolkaPost(order({ cancelled: true, status: "Cancelled" }));
  const f = jamfor({ avtryck: fore.avtryck, text: fore.text, data: fore.data, raderad: null, andrad: null }, efter);
  ok("makulerad order: säger makulerades", f.typ === "andrad" && f.vad[0] === "Order SO-2026-00046 makulerades i Inkio", JSON.stringify(f));
  const nyttVarde = tolkaPost(order({ value: 150000 }));
  const v = jamfor({ avtryck: fore.avtryck, text: fore.text, data: fore.data, raderad: null, andrad: null }, nyttVarde);
  ok("nytt värde: före och efter", v.typ === "andrad" && v.vad.some((x) => x.includes("167 880 kr → 150 000 kr")), JSON.stringify(v));
}

rubrik("Notisen");
{
  const r = tolkaPost(anteckning());
  const n = notisFor(r, { typ: "ny" }, { bolag: "Hedboms Måleri AB", nu: NU, navSkapadeNyss: false });
  ok("ny anteckning: notis med namn och text", n && n.kalla === "order-inkio-anteckning" && n.rubrik === "Hedboms Måleri AB: Matias Lopez skrev i Inkio" && n.detalj === "Ringde, inget svar.", JSON.stringify(n));
  ok("gammal anteckning (första läsningen): tyst", notisFor(tolkaPost(anteckning(tvaDagarSedan)), { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false }) === null);
  ok("precis innanför tolv timmar: notis", notisFor(tolkaPost(anteckning(new Date(NU - NOTIS_FONSTER_MS + 1000).toISOString())), { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false }) !== null);
  ok("ändrad anteckning: tyst", notisFor(r, { typ: "andrad", vad: [] }, { bolag: "X", nu: NU, navSkapadeNyss: false }) === null);
  ok("raderad anteckning: tyst", notisFor(r, { typ: "raderad" }, { bolag: "X", nu: NU, navSkapadeNyss: false }) === null);
  const eko = tolkaPost(anteckning(timmeSedan, { created_by_is_service_account: true, content: "**Zen** (via Nav): hej" }));
  ok("Navs eget eko: tyst", notisFor(eko, { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false }) === null);
  const k = notisFor(tolkaPost(kortflytt), { typ: "ny" }, { bolag: "Roos Alltjänst", nu: NU, navSkapadeNyss: false });
  ok("kortflytt: händelse på svenska", k && k.kalla === "order-inkio-handelse" && k.rubrik === "Roos Alltjänst: Dennis Dzananovic flyttade kortet från VK (Dennis) till Godkänd & Lanserad", JSON.stringify(k));
  const makulerad = tolkaPost(order({ cancelled: true }));
  const m = notisFor(makulerad, { typ: "andrad", vad: ["Order SO-2026-00046 makulerades i Inkio"] }, { bolag: "Hedboms", nu: NU, navSkapadeNyss: false });
  ok("ändrad order: notis om ändringen", m && m.rubrik === "Hedboms: Order SO-2026-00046 makulerades i Inkio");
  ok("makulerad order: egen sort (mejlas)", m && m.kalla === "order-inkio-makulerad", JSON.stringify(m));
  const nyttVardeN = notisFor(tolkaPost(order({ value: 150000 })), { typ: "andrad", vad: ["Ordervärdet på SO-2026-00046 ändrades i Inkio: 167 880 kr → 150 000 kr"] }, { bolag: "X", nu: NU, navSkapadeNyss: false });
  ok("nytt ordervärde: händelse (bara klockan)", nyttVardeN && nyttVardeN.kalla === "order-inkio-handelse", JSON.stringify(nyttVardeN));
  const nyOrder = tolkaPost(order({}, timmeSedan));
  ok("ny order som Nav nyss lade: tyst", notisFor(nyOrder, { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: true }) === null);
  ok("ny order som någon annan lade: notis", notisFor(nyOrder, { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false }) !== null);
  const framat = tolkaPost({ id: "agreement:a9:started", kind: "agreement", at: "2099-01-01", about: { doctype: "Contract", id: "a9", subtitle: "CTR-9" }, data: { change: "started", start_date: "2099-01-01", status: "Scheduled" } });
  ok("avtal med startdag framåt: 'startar', inte 'startade'", framat.text.startsWith("Avtal CTR-9 startar 2099-01-01"), framat.text);
  ok("avtal med startdag framåt vid första läsningen: tyst", notisFor(framat, { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false, forsta: true }) === null);
  ok("avtal med startdag framåt som dyker upp senare: notis", notisFor(framat, { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false, forsta: false }) !== null);
}

rubrik("Sorten: ärendet, makulerat och uppsagt mejlas, resten står i klockan");
{
  // Riktiga rader ur crm_handelse (2026-11-02): anteckningar på TKT-2026-00003.
  const ticketAnteckning = anteckning(timmeSedan, { content: "Alexander ska kika på ärendet nu.", reference_doctype: "Ticket", reference_id: "01a1535c-d7a0-70fe-94dd-2f69810e26eb" });
  ticketAnteckning.about = { doctype: "Ticket", id: "01a1535c-d7a0-70fe-94dd-2f69810e26eb", title: "Kunden vill bestrida", subtitle: "TKT-2026-00003 · 2026-10-20", route: "/tickets/01a1535c-d7a0-70fe-94dd-2f69810e26eb" };
  const t = notisFor(tolkaPost(ticketAnteckning), { typ: "ny" }, { bolag: "Hedboms Måleri AB", nu: NU, navSkapadeNyss: false });
  ok("anteckning på ett ärende: ärendet", t && t.kalla === "order-inkio-arende", JSON.stringify(t));
  ok("anteckning på ett ärende: säger vilket", t && t.rubrik === "Hedboms Måleri AB: Matias Lopez skrev i ärendet Kunden vill bestrida" && t.detalj === "Alexander ska kika på ärendet nu.", JSON.stringify(t));

  const kund = notisFor(tolkaPost(anteckning()), { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false });
  ok("anteckning på kunden: anteckning (bara klockan)", kund && kund.kalla === "order-inkio-anteckning");
  ok("aktivitet: händelse (bara klockan)", notisFor(tolkaPost(kortflytt), { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false })?.kalla === "order-inkio-handelse");

  const arende = (data = {}) => ({ id: "ticket:01a1535c", kind: "ticket", area: "support", at: timmeSedan, about: { doctype: "Ticket", id: "01a1535c", title: "Kunden vill bestrida", subtitle: "TKT-2026-00003 · 2026-11-02" }, data: { number: "TKT-2026-00003", subject: "Kunden vill bestrida", status: "Open", ...data } });
  ok("nytt ärende: ärendet", notisFor(tolkaPost(arende()), { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false })?.kalla === "order-inkio-arende");
  ok("ärendet byter status: ärendet", notisFor(tolkaPost(arende({ status: "Solved" })), { typ: "andrad", vad: ["Ärende TKT-2026-00003 är löst: Kunden vill bestrida"] }, { bolag: "X", nu: NU, navSkapadeNyss: false })?.kalla === "order-inkio-arende");

  const avtal = (andring, status) => ({ id: `agreement:01a1933c:${andring}`, kind: "agreement", at: timmeSedan, about: { doctype: "Contract", id: "01a1933c", subtitle: "CTR-2026-00090" }, data: { change: andring, number: "CTR-2026-00090", status, start_date: "2026-11-02", end_date: "2027-11-02" } });
  ok("avtal som sägs upp: uppsagt", notisFor(tolkaPost(avtal("terminated", "Terminated")), { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false })?.kalla === "order-inkio-uppsagt");
  ok("avtal som startar: händelse (bara klockan)", notisFor(tolkaPost(avtal("started", "Active")), { typ: "ny" }, { bolag: "X", nu: NU, navSkapadeNyss: false })?.kalla === "order-inkio-handelse");
}

rubrik("Kretsen");
{
  const niva = new Map([["zen", "superadmin"], ["simon", "superadmin"], ["chef", "admin"], ["fredrik", "salesperson"], ["kollega", "salesperson"]]);
  const k = kretsen({ superadmin: ["zen", "simon"], saljare: ["fredrik"], chefer: new Map([["fredrik", ["chef", "kollega"]]]), niva });
  ok("superadmin, säljaren och admin som leder säljaren", ["zen", "simon", "fredrik", "chef"].every((x) => k.includes(x)) && k.length === 4, JSON.stringify(k));
  ok("en ledare som bara är säljare får inte", !k.includes("kollega"));
  const ingen = kretsen({ superadmin: ["zen"], saljare: [], chefer: new Map(), niva });
  ok("utan säljare: bara superadmin", ingen.length === 1 && ingen[0] === "zen");
}

rubrik("Provfiltret");
{
  const ids = ["zen", "fredrik", null, "zen", undefined];
  const prov = "zen , annan";
  ok("previewen utan NOTIS_PROV_TILL: ingen", provfilter(ids, { VERCEL_ENV: "preview" }).length === 0);
  ok("previewen med: bara de listade", JSON.stringify(provfilter(ids, { VERCEL_ENV: "preview", NOTIS_PROV_TILL: prov })) === '["zen"]');
  ok("produktionen utan: alla, en gång var", JSON.stringify(provfilter(ids, { VERCEL_ENV: "production" })) === '["zen","fredrik"]');
  ok("produktionen med: bara de listade", JSON.stringify(provfilter(ids, { VERCEL_ENV: "production", NOTIS_PROV_TILL: prov })) === '["zen"]');
  ok("produktionen med en tom variabel: alla", provfilter(ids, { VERCEL_ENV: "production", NOTIS_PROV_TILL: " , " }).length === 2);
  ok("lokalt utan miljö: ingen", provfilter(ids, {}).length === 0);
}

rubrik("Ändringar i Inkio som ändrar Nav");
{
  const fore = tolkaPost(order());
  const efter = tolkaPost(order({ cancelled: true }));
  const f = jamfor({ avtryck: fore.avtryck, text: fore.text, data: fore.data, raderad: null, andrad: null }, efter);
  const s = statusFranInkio(efter, f, NU);
  ok("makulerad i Inkio → makulera i Nav", s && s.vad === "makulerad" && s.inkioOrder === "01a10fff-bf68-712d-abb0-daed49ad7541");
  ok("en gammal makulerad order som Nav ser första gången: ingenting", statusFranInkio(efter, { typ: "ny" }, NU) === null);
  const vardeAndrat = tolkaPost(order({ value: 1 }));
  ok("bara värdet ändrat: ingen status", statusFranInkio(vardeAndrat, { typ: "andrad", vad: ["Ordervärdet …"] }, NU) === null);
  const faktura = tolkaPost({ id: "invoice:f1", kind: "invoice", at: timmeSedan, about: { doctype: "Invoice", id: "f1", subtitle: "INV-1" }, data: { number: "INV-1", status: "Paid", sales_order: "o1" } });
  const b = statusFranInkio(faktura, { typ: "andrad", vad: ["Faktura INV-1 är betald"] }, NU);
  ok("betald faktura → betald i Nav", b && b.vad === "betald" && b.inkioOrder === "o1");
  const startat = tolkaPost({ id: "agreement:a1:started", kind: "agreement", at: "2026-09-11", about: { doctype: "Contract", id: "a1", subtitle: "CTR-1" }, data: { change: "started", status: "Active" } });
  ok("ett avtal som startar: ingenting", statusFranInkio(startat, { typ: "ny" }, Date.parse("2026-09-11T06:00:00Z")) === null);
  const uppsagt = tolkaPost({ id: "agreement:a1:terminated", kind: "agreement", at: timmeSedan, about: { doctype: "Contract", id: "a1", subtitle: "CTR-1" }, data: { change: "terminated", status: "Terminated" } });
  const u = statusFranInkio(uppsagt, { typ: "ny" }, NU);
  ok("uppsagt avtal → avtalsbevakningen avslutas", u && u.vad === "uppsagt" && u.inkioAvtal === "a1");
  const utlopt = tolkaPost({ id: "agreement:a1:ended", kind: "agreement", at: timmeSedan, about: { doctype: "Contract", id: "a1" }, data: { change: "ended", status: "Expired" } });
  ok("ett avtal som bara löpt ut: ingenting (kan vara förnyat)", statusFranInkio(utlopt, { typ: "ny" }, NU) === null);

  // Nav kunde inte ändra ordern (0279 rättade villkoren): larmet säger det.
  const larm = statusfelNotis(s, "SPM Väst AB", 'new row for relation "sales_order" violates check constraint "sales_order_makulerad_av"');
  ok("Nav kunde inte makulera: rubriken säger det", larm.rubrik === "SPM Väst AB: makulerad i Inkio, men inte i Nav", larm.rubrik);
  ok("larmet har skälet, felet och vad som ska göras", larm.detalj.startsWith("Makulerad i Inkio (") && larm.detalj.includes("sales_order_makulerad_av") && larm.detalj.endsWith("Gör det för hand i Nav."), larm.detalj);
  ok("uppsagt som inte gick: rubriken säger det", statusfelNotis(u, "SPM Väst AB", "x").rubrik === "SPM Väst AB: uppsagt i Inkio, men inte i Nav");
  ok("betald som inte gick: rubriken säger det", statusfelNotis(b, "SPM Väst AB", "x").rubrik === "SPM Väst AB: betald i Inkio, men inte i Nav");
  ok("ett långt fel kortas", statusfelNotis(s, "X", "f".repeat(2000)).detalj.length < 500);
}

rubrik("Kopplingen på organisationsnummer");
{
  ok("samma värde: kopplas", kopplaPaOrgnr([{ id: "n1", varde: 167880, kopplad: false }], [{ id: "i1", nummer: "SO-1", varde: 167880.04, makulerad: false }], new Set()).length === 1);
  ok("en av varje men olika värde: kopplas inte", kopplaPaOrgnr([{ id: "n1", varde: 11940, kopplad: false }], [{ id: "i1", nummer: "SO-1", varde: 5970, makulerad: false }], new Set()).length === 0);
  const tva = kopplaPaOrgnr(
    [{ id: "n1", varde: 100, kopplad: false }, { id: "n2", varde: 200, kopplad: false }],
    [{ id: "i1", nummer: "SO-1", varde: 200, makulerad: false }, { id: "i2", nummer: "SO-2", varde: 100, makulerad: false }],
    new Set(),
  );
  ok("två av varje: på värdet", tva.length === 2 && tva.find((x) => x.navId === "n1").inkioId === "i2");
  ok("tvetydigt: ingenting", kopplaPaOrgnr([{ id: "n1", varde: 100, kopplad: false }, { id: "n2", varde: 100, kopplad: false }], [{ id: "i1", nummer: null, varde: 100, makulerad: false }, { id: "i2", nummer: null, varde: 100, makulerad: false }], new Set()).length === 0);
  ok("en makulerad Inkio-order kopplas inte", kopplaPaOrgnr([{ id: "n1", varde: 1, kopplad: false }], [{ id: "i1", nummer: null, varde: 1, makulerad: true }], new Set()).length === 0);
  ok("en redan kopplad Inkio-order kopplas inte igen", kopplaPaOrgnr([{ id: "n1", varde: 1, kopplad: false }], [{ id: "i1", nummer: null, varde: 1, makulerad: false }], new Set(["i1"])).length === 0);
}

rubrik("Kundkortets rader");
{
  ok("Navs prefix läses", JSON.stringify(navForfattare("**Zen Alzzabti** (via Nav): Ringde, inget svar")) === JSON.stringify({ namn: "Zen Alzzabti", text: "Ringde, inget svar" }));
  const matias = tolkaPost(anteckning());
  const eko = { ...tolkaPost(anteckning(timmeSedan, { content: "**Zen Alzzabti** (via Nav): Skickade offert", created_by_is_service_account: true })), extern_id: "eko-1" };
  const gammaltEko = { ...tolkaPost(anteckning(tvaDagarSedan, { content: "**Fredrik Pernehed** (via Nav): Bokade möte", created_by_is_service_account: true })), extern_id: "eko-2" };
  const raderad = { ...tolkaPost(anteckning(tvaDagarSedan, { deleted_at: timmeSedan })), extern_id: "raderad-1" };
  const nav = [{ id: "a1", text: "Skickade offert", skriven_namn: "Zen Alzzabti", skriven_at: timmeSedan, crm_id: "eko-1", crm_state: "skickad" }];
  const rader = aktivitetsrader([matias, eko, gammaltEko, raderad], nav, { superadmin: false, inkioBas: "https://crm.inkio.se" });
  ok("ekot av en Nav-anteckning visas inte två gånger", rader.filter((r) => r.text === "Skickade offert").length === 1);
  ok("ett äldre eko får sitt riktiga namn", rader.some((r) => r.vem === "Fredrik Pernehed" && r.text === "Bokade möte"));
  ok("raderad döljs för andra än superadmin", !rader.some((r) => r.id === "raderad-1"));
  const sa = aktivitetsrader([raderad], [], { superadmin: true, inkioBas: "https://crm.inkio.se" });
  ok("raderad syns för superadmin, märkt", sa.length === 1 && sa[0].text.startsWith("Raderad i Inkio: ") && sa[0].kalla.etikett.endsWith("raderad i Inkio"));
  ok("nyast först", rader[0].nar >= rader[rader.length - 1].nar);
  ok("formen är kundkortets", ["id", "nar", "vem", "anteckning", "text", "kalla"].every((k) => k in rader[0]) && "etikett" in rader[0].kalla);
}

rubrik("Kundkortets tidslinje: Inkios sort, område, roll och post (0278)");
{
  // Hedbloms Måleri AB, ur get-customer-history 2026-11-02 (telefon och bild borttagna).
  const roller = { "01a1109f-27d8-7106-9db8-14e2d2c176fb": "Administratör", "01a0f896-1e64-74d1-9a7e-e0f9e7899038": "Utvecklare" };
  const avtal = { id: "agreement:01a19c49-c203-748d-bed4-972c19af112d:started", kind: "agreement", area: "sales", at: "2026-11-02", about: { doctype: "Contract", id: "01a19c49-c203-748d-bed4-972c19af112d", title: "Optimerad Kampanjsida", subtitle: "CTR-2026-00094", route: "/contracts/01a19c49-c203-748d-bed4-972c19af112d" }, data: { change: "started", number: "CTR-2026-00094", services: ["Optimerad Kampanjsida"], term_length: 23, term_unit: "Month", start_date: "2026-11-02", end_date: "2028-10-02", monthly: 5999.0, currency: "SEK", status: "Active", financed_by: null }, all_day: true };
  const ny = { id: "order:01a19c49-c1dc-70b2-a32e-2f4abb0b570f", kind: "order", area: "sales", at: "2026-10-23", about: { doctype: "Sales Order", id: "01a19c49-c1dc-70b2-a32e-2f4abb0b570f", title: "Optimerad Kampanjsida", subtitle: "SO-2026-00102 · 2026-10-23", route: "/sales-orders/01a19c49-c1dc-70b2-a32e-2f4abb0b570f" }, data: { number: "SO-2026-00102", services: ["Optimerad Kampanjsida"], value: 137977.0, currency: "SEK", deal_type: "New", status: "Confirmed", cancelled: false, sold_by: "Zen ." }, all_day: true };
  const tjanst = { created_by: "01a1109f-27d8-7106-9db8-14e2d2c176fb", created_by_full_name: "Intranätet Clicknet", created_by_email: "intran-tet-clicknet@service.account", created_by_is_service_account: true, import_unattributed: false, edited_at: null, deleted_at: null, deleted_by_full_name: null };
  const kort = { id: "01a19c49-c25a-76f3-baac-880acd0677ef", kind: "activity", area: "work", at: "2026-11-02T12:44:02.009746Z", about: { doctype: "Task", id: "01a19c49-c252-7655-a3aa-824ea6a561de", title: "Hedbloms Måleri AB - Optimerad Kampanjsida 23 mån", subtitle: null, route: "/tasks/01a19c49-c252-7655-a3aa-824ea6a561de" }, entry: { ...tjanst, id: "01a19c49-c25a-76f3-baac-880acd0677ef", content: "Intranätet Clicknet created this card from order SO-2026-00102", created_at: "2026-11-02T12:44:02.009746Z", comment_type: "Info", activity_template: "{0} created this card from order {1}", activity_args: '["Intranätet Clicknet", "SO-2026-00102"]', reference_doctype: "Task", reference_id: "01a19c49-c252-7655-a3aa-824ea6a561de" } };
  const paOrdern = { id: "01a19c49-c24a-7261-a3a5-b415ed0723c5", kind: "comment", area: "sales", at: "2026-11-02T12:44:01.993203Z", about: { doctype: "Sales Order", id: "01a19c49-c1dc-70b2-a32e-2f4abb0b570f", title: "Optimerad Kampanjsida", subtitle: "SO-2026-00102 · 2026-10-23", route: "/sales-orders/01a19c49-c1dc-70b2-a32e-2f4abb0b570f" }, entry: { ...tjanst, id: "01a19c49-c24a-7261-a3a5-b415ed0723c5", content: "Paket 3 · 5 999 kr/mån · 23 mån · signerad 2026-10-23. Godkänd i Clicknet Nav av Zen 2026-11-02.", created_at: "2026-11-02T12:44:01.993203Z", comment_type: "Comment", activity_template: null, activity_args: null, reference_doctype: "Sales Order", reference_id: "01a19c49-c1dc-70b2-a32e-2f4abb0b570f" } };
  const matias = { id: "01a17da3-1027-708d-8fe6-9e16eaab9930", kind: "comment", area: "customer", at: "2026-10-27T13:53:20.935442Z", about: null, entry: { id: "01a17da3-1027-708d-8fe6-9e16eaab9930", content: "Inget svar från kunden! vid samtal igen. Går direkt till telefonsvarare.", created_by: "01a0f896-1e64-74d1-9a7e-e0f9e7899038", created_by_full_name: "Matias Lopez", created_by_email: "matias@effektivmedia.nu", created_by_is_service_account: false, created_at: "2026-10-27T13:53:20.935442Z", comment_type: "Comment", import_unattributed: false, activity_template: null, activity_args: null, reference_doctype: "Customer", reference_id: "01a10ffe-ddb9-7491-9a49-d58ba88061f7", edited_at: null, deleted_at: null, deleted_by_full_name: null } };

  const m = tolkaPost(matias, roller);
  ok("rollen sparas i data", m.data.roll === "Utvecklare");
  ok("Inkios område sparas i data", m.data.omrade === "customer" && tolkaPost(ny, roller).data.omrade === "sales");
  ok("rollen ingår inte i avtrycket", m.avtryck === tolkaPost(matias).avtryck);

  const niva = new Map([["zen alzzabti", "superadmin"], ["emp-fredrik", "salesperson"]]);
  const nivaAv = (k) => niva.get(k.id ?? "") ?? niva.get((k.namn ?? "").toLowerCase()) ?? null;
  const nav = [{ id: "a1", text: "Kunden vill ha **fler** bilder.", skriven_namn: "Fredrik Pernehed", skriven_av: "emp-fredrik", skriven_at: "2026-11-02T13:00:00Z", crm_id: null, crm_state: "ko", om_order: "6b9c0000-0000-4000-8000-000000000015" }];
  const eko = { ...tolkaPost(anteckning(timmeSedan, { created_by_is_service_account: true, content: "**Zen Alzzabti** (via Nav): Ringde, inget svar" })), extern_id: "eko-zen" };
  const rader = aktivitetsrader([avtal, ny, kort, paOrdern, matias].map((p) => tolkaPost(p, roller)).concat(eko), nav, { superadmin: false, inkioBas: "https://crm.inkio.se", nivaAv });
  const id = (x) => rader.find((r) => r.id === x);

  ok("sorten: avtal, order, systemrad, anteckning", id(avtal.id).sort === "avtal" && id(ny.id).sort === "order" && id(kort.id).sort === "aktivitet" && id(matias.id).sort === "anteckning");
  ok("området: ordern och anteckningen på ordern = försäljning, kortet = arbete, kunden = kund", id(ny.id).omrade === "forsaljning" && id(paOrdern.id).omrade === "forsaljning" && id(kort.id).omrade === "arbete" && id(matias.id).omrade === "kund");
  ok("vad anteckningen gäller: ordern med nummer", JSON.stringify(id(paOrdern.id).om) === JSON.stringify({ typ: "Sales Order", titel: "Optimerad Kampanjsida", nummer: "SO-2026-00102" }));
  ok("en anteckning på kunden gäller inget särskilt", id(matias.id).om === null);
  const p = id(ny.id).post;
  ok("ordern: nummer, värde, status och säljare", p.nummer === "SO-2026-00102" && p.varde === 137977 && p.kod === "confirmed" && p.status === "bekräftad" && p.saljare === "Zen ." && !p.makulerad);
  const a = id(avtal.id).post;
  ok("avtalet: månadsbelopp, start, slut och händelse", a.manad === 5999 && a.start === "2026-11-02" && a.slut === "2028-10-02" && a.andring === "started" && a.status === "aktivt");
  ok("bara poster har postuppgifter", id(matias.id).post === null && id(kort.id).post === null);
  ok("Inkios roll för Matias, ingen för Navs tjänstekonto", id(matias.id).roll === "Utvecklare" && id(paOrdern.id).roll === null);
  ok("Matias finns inte i Nav: ingen nivå", id(matias.id).niva === null);
  ok("Navs eko får nivån ur namnet", rader.find((r) => r.id === "eko-zen").niva === "superadmin");
  ok("Navs eget eko via tjänstekontot är en systemrad, en persons eko är det inte", id(paOrdern.id).tjanst === true && rader.find((r) => r.id === "eko-zen").tjanst === false && id(matias.id).tjanst === false);
  const egen = id("nav:a1");
  ok("anteckning från Nav: nivån ur anställningen, ordern den gäller", egen.nav === true && egen.niva === "salesperson" && egen.order === "6b9c0000-0000-4000-8000-000000000015" && egen.omrade === "forsaljning");
  ok("äldre rader utan område härleds ur vad de gäller", omradeFor({ om_typ: "Task", data: {} }) === "arbete" && omradeFor({ om_typ: "Contract", data: null }) === "forsaljning" && omradeFor({ om_typ: null, data: {} }) === "kund");
  ok("postuppgifter klarar en post utan data", postuppgifter({ om_nummer: "X-1", data: null }).nummer === "X-1");
  ok("de gamla fälten står kvar", ["id", "nar", "vem", "anteckning", "text", "kalla"].every((k) => k in egen));
}

rubrik("Rättningen till Inkio (correct-sales-order)");
{
  const underlag = {
    navId: "0b6f6c62-1111-4a4a-9c9c-000000000001",
    signerad: "2026-10-07",
    startar: "2026-10-15",
    manadsbelopp: 1495,
    bindningManader: 12,
    paketnamn: "Paket 2",
    utkop: null,
    finans: null,
    finansierad: false,
    anteckning: null,
    navlank: "https://clicknet-nav.vercel.app/order?kund=x",
    tjanster: [{ namn: "Logotyp", fakturering: "engang", belopp: 3000, manader: null }],
  };
  const tj = { kampanjsida: "svc-kampanj", ovrigt: "svc-ovrigt", efterNamn: () => null };
  const rader = orderrader(underlag, tj);
  const r = rattning(underlag, rader, null);
  const skapad = nyOrder(underlag, "kund", null, rader, null);
  ok("raderna som tjänst, antal och text (Inkios eG)", r.items.length === rader.length && r.items.every((i) => i.service && i.quantity >= 1 && !("rate" in i)));
  ok("samma värde och längd som när ordern skapades", r.order.order_value === skapad.order_value && r.order.term_months === skapad.term_months);
  ok("faktureringen följer med", r.order.invoicing === skapad.invoicing && JSON.stringify(r.order.invoice_plan) === JSON.stringify(skapad.invoice_plan));
  ok("startdagen följer med, fakturamejlet nollas inte", r.order.delivery_date === "2026-10-15" && !("invoice_email" in r.order));
  ok("ingen kund, säljare eller provision i rättningen", !("customer" in r.order) && !("sales_person" in r.order) && !JSON.stringify(r).includes("provision"));
}

rubrik("Vilka kunder som läses: varma varje minut, kalla var femte");
{
  const sedan = (ms) => new Date(NU - ms).toISOString();
  const MIN = 60 * 1000;
  const kall = (org, last) => ({ org, klar: true, andrad: sedan(10 * 24 * 60 * MIN), last, godkand: sedan(60 * 24 * 60 * MIN) });
  ok("en ny kund läses", attLasa([{ org: "a", klar: false, andrad: null, last: null, godkand: null }], NU).includes("a"));
  ok("något nytt i går: läses varje minut", attLasa([{ ...kall("a", sedan(MIN)), andrad: sedan(24 * 60 * MIN) }], NU).includes("a"));
  ok("order godkänd för en vecka sedan: läses varje minut", attLasa([{ ...kall("a", sedan(MIN)), godkand: sedan(7 * 24 * 60 * MIN) }], NU).includes("a"));
  ok("tyst och läst för en minut sedan: vilar", !attLasa([kall("a", sedan(MIN))], NU).includes("a"));
  ok("tyst och läst för fem minuter sedan: läses", attLasa([kall("a", sedan(KALL_MS))], NU).includes("a"));
  ok("tyst och aldrig läst: läses", attLasa([kall("a", null)], NU).includes("a"));

  // Tjugo tysta, alla lästa samtidigt: de sprids ut, och ingen väntar längre än åtta minuter.
  const tysta = Array.from({ length: 20 }, (_, i) => kall(`k${i}`, sedan(0)));
  const sist = new Map(tysta.map((k) => [k.org, NU]));
  let langst = 0;
  let mest = 0;
  for (let m = 1; m <= 60; m++) {
    const nu = NU + m * MIN;
    const valda = attLasa(tysta.map((k) => ({ ...k, last: new Date(sist.get(k.org)).toISOString() })), nu);
    mest = Math.max(mest, valda.length);
    for (const org of valda) {
      langst = Math.max(langst, nu - sist.get(org));
      sist.set(org, nu);
    }
  }
  ok("tjugo tysta: högst fem per varv", mest <= 5, `${mest}`);
  ok("tjugo tysta: ingen väntar mer än åtta minuter", langst <= 8 * MIN, `${langst / MIN} min`);
  ok("tjugo tysta: alla läses inom en timme", [...sist.values()].every((t) => t >= NU + 50 * MIN));
}

rubrik("Första läsningen: varm efter det som hänt i Inkio, inte efter läsningen");
{
  const items = [{ at: "2026-08-28" }, { at: "2026-11-02T11:17:28.201356Z" }, { at: "2026-11-17" }];
  ok("det senaste som hänt, inte avtalet som startar framåt", senastHant(items, NU) === "2026-11-02T11:17:28.201Z");
  ok("bara gammalt: kallt", Date.parse(senastHant([{ at: "2026-08-28" }], NU)) < NU - 48 * 60 * 60 * 1000);
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt grönt\x1b[0m");
process.exit(fel ? 1 : 0);
