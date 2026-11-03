#!/usr/bin/env node
/**
 * Orderns ekonomi ur Inkio (ekonomi.ts): stegen, slutbetald, märket och det
 * kortet får. Ren logik, inget nätverk.
 *
 *   TZ=UTC node --experimental-strip-types tests/inkio-ekonomi.mjs
 *
 * Svaren nedan är Inkios egna (2026-11-02), avskalade till de fält Nav läser:
 * TLS Värmepumpar (finansierad via Novo, utbetalningen inte registrerad), Mbix
 * (intern, 24 månadsfakturor, väntar på ekonomi) och SweAuto (kvartalsvis, den
 * första fakturan saknas i Fortnox).
 */
import fs from "node:fs";
import { dagarSedan, ekonomiMarke, faktureringsText, genitiv, hanteringsSteg, lopText, metodText, orderekonomi, slutbetald } from "../src/lib/crm/ekonomi.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const nu = new Date("2026-11-02T20:00:00Z");
const bas = "https://crm.inkio.se";

const plan = (n, start, belopp, lage = () => "planned") =>
  Array.from({ length: n }, (_, i) => ({ idx: i + 1, invoice_date: `2026-${String(((start + i - 1) % 12) + 1).padStart(2, "0")}-02`, due_date: null, amount: belopp, state: lage(i), fortnox: null }));

const TLS_ORDER = {
  id: "01a120e0-be2c-7057-beac-3ba7444939c9", number: "SO-2026-00087", state: "submitted", status: "Confirmed", customer: "01a120e0-bcd9-72bf-a776-05829cc989b9",
  order_date: "2026-09-25", delivery_date: "2026-09-25", currency: "SEK", total_contract_value: 17940, invoice_email: null, billing_contact_name: null,
  production_task_id: "01a120e0-be7f-7236-adf8-3f2443de07f6", contract_created: true, sales_person_name: "Zen .", invoicing: null,
  handling: { id: "01a120e0-be5b-725c-84d4-5e760a5af320", number: "OH-2026-00001", status: "Done", method: "Financed", financing_company: "Novo", handled_at: "2026-10-09T15:02:01.164157Z" },
};
const TLS_HANTERING = {
  id: "01a120e0-be5b-725c-84d4-5e760a5af320", number: "OH-2026-00001", status: "Done", method: "Financed", financing_company: "Novo", fortnox_reference: null,
  note: "Denna är finanserad via novo kapital.", handled_at: "2026-10-09T15:02:01.164157Z", handled_by_name: "Nenad Krstic",
  sent_to_financier_at: "2026-10-09T15:01:58.660366Z", sent_to_financier_by_name: "Nenad Krstic", order_cancelled_at: null, financing_payout: null,
  order_date: "2026-09-25", sales_person_name: "Zen .", invoicing: null, facts: { order: { order_date: "2026-09-25" }, invoicing: null },
};
const TLS_AVTAL = {
  id: "01a120e0-be43-706d-84ae-15dc40297bd8", number: "CTR-2026-00084", status: "Active", currency: "SEK", term_length: 1, term_unit: "Year", billing_interval: 1, billed_periods: 0,
  billing_end_date: null, start_date: "2026-09-25", end_date: "2027-09-25", next_billing_date: "2026-11-25", total_contract_value: 17940, external_billing_mode: null,
  invoices_financed: true, financing_company: "Novo", notice_given_on: null, terminated_at: null, services: ["Optimerad Kampanjsida"],
};
const TLS_KORT = {
  id: "01a120e0-be7f-7236-adf8-3f2443de07f6", number: "TASK-00001", title: "TLS Värmepumpar AB - Optimerad Kampanjsida 12 mån", column_title: "Godkänd & Lanserad",
  board_title: "Clicknet", project_title: "Produktionen", due_date: null, due_complete: false, completed_at: null, is_archived: false, checklist_total: 0, checklist_done: 0,
  assignees: [{ full_name: "Andreas Laine" }],
};
const MBIX_FAKT = {
  type: "Internal", order_value: 35880, currency: "SEK", term_months: 24, start_date: "2026-11-02", end_date: "2028-11-02", financing_company: null, schedule: "Monthly",
  interval_months: 1, payment_terms_days: 15, invoices: plan(24, 11, 1495, (i) => (i === 0 ? "expected" : "planned")), matching: true, outside_plan: [],
  progress: { total: 24, invoiced: 0, paid: 0, overdue: 0, missing: 0, credited: 0, next: { invoice_date: "2026-11-02", amount: 1495 } },
};
const SWE_FAKT = {
  type: "Internal", order_value: 13140, currency: "SEK", term_months: 12, start_date: "2026-10-09", end_date: "2027-10-09", financing_company: null, schedule: "Quarterly",
  interval_months: 3, payment_terms_days: 15,
  invoices: [
    { idx: 1, invoice_date: "2026-10-09", due_date: "2026-10-24", amount: 3285, state: "missing", fortnox: null },
    { idx: 2, invoice_date: "2027-01-09", due_date: "2027-01-24", amount: 3285, state: "planned", fortnox: null },
    { idx: 3, invoice_date: "2027-04-09", due_date: "2027-04-24", amount: 3285, state: "planned", fortnox: null },
    { idx: 4, invoice_date: "2027-07-09", due_date: "2027-07-24", amount: 3285, state: "planned", fortnox: null },
  ],
  matching: true, outside_plan: [], progress: { total: 4, invoiced: 0, paid: 0, overdue: 0, missing: 1, credited: 0, next: { invoice_date: "2026-10-09", amount: 3285 } },
};
const tom = { utbetalning: null, avtal: [], kort: null, kortStangt: false, fakturor: [], filer: [], samtal: [], bas, nu };

rubrik("Slutbetald är Inkios: alla fakturor i planen betalda, bara intern fakturering");
{
  const betalda = (n) => ({ ...MBIX_FAKT, progress: { ...MBIX_FAKT.progress, invoiced: n, paid: n } });
  ok("0 av 24 betalda: inte slutbetald", !slutbetald(MBIX_FAKT));
  ok("1 av 24 betalda: inte slutbetald (grenens gamla regel hade sagt betald)", !slutbetald(betalda(1)));
  ok("23 av 24 betalda: inte slutbetald", !slutbetald(betalda(23)));
  ok("24 av 24 betalda: slutbetald", slutbetald(betalda(24)));
  ok("finansierad: aldrig slutbetald (finansbolaget betalar ut, kunden betalar dem)", !slutbetald({ ...betalda(24), type: "Financed" }));
  ok("ingen plan: inte slutbetald", !slutbetald({ type: "Internal", invoices: [], progress: null }));
  ok("utan progress räknas planens lägen", slutbetald({ type: "Internal", invoices: plan(3, 1, 100, () => "paid"), progress: null }) && !slutbetald({ type: "Internal", invoices: plan(3, 1, 100, (i) => (i ? "paid" : "invoiced")), progress: null }));
  ok("ingen fakturering alls: inte slutbetald", !slutbetald(null) && !slutbetald(undefined));
}

rubrik("Stegen följer Inkios handlingTypes");
{
  const s = hanteringsSteg(TLS_HANTERING, nu);
  ok("finansierad: tre steg", s.map((x) => x.nyckel).join(",") === "skickad,finansbolag,godkand", s.map((x) => x.text).join(" → "));
  ok("finansierad och hanterad: alla klara", s.every((x) => x.lage === "klar"));
  ok("Skickade till Novo, av vem och när", s[1].text === "Skickade till Novo" && s[1].detalj === "Nenad Krstic · 2026-10-09");
  ok("Inkios lösa punkt efter namnet tas bort", s[0].detalj === "2026-09-25 · Zen", s[0].detalj);

  const hos = hanteringsSteg({ ...TLS_HANTERING, status: "Awaiting Financier", handled_at: null, sent_to_financier_at: "2026-10-30T09:00:00Z" }, nu);
  ok("hos finansbolaget: Godkänd väntar, med dagarna", hos[2].lage === "nu" && hos[2].ton === "vanta" && hos[2].detalj === "Väntar på deras svar · 3 dagar", hos[2].detalj);
  const pend = hanteringsSteg({ ...TLS_HANTERING, status: "Pending", handled_at: null, sent_to_financier_at: null }, nu);
  ok("finansierad, väntar på ekonomi: ekonomi skickar den", pend[1].lage === "nu" && pend[1].detalj === "Ekonomi skickar den" && pend[2].lage === "kvar");

  const intern = hanteringsSteg({ id: "x", status: "Pending", method: null, order_date: "2026-11-02", sales_person_name: "Fredrik", facts: { invoicing: MBIX_FAKT } }, nu);
  ok("intern: fyra steg till Slutbetald", intern.map((x) => x.text).join(" → ") === "Ordern är skickad → Upplagd i Fortnox → Fakturerade 0/24 → Slutbetald", intern.map((x) => x.text).join(" → "));
  ok("intern, väntar: Fortnox nu, resten kvar", intern[1].lage === "nu" && intern[2].lage === "kvar" && intern[3].lage === "kvar" && intern[3].detalj === "0 av 24 betalda");
  const sw = hanteringsSteg({ id: "x", status: "Pending", facts: { invoicing: SWE_FAKT } }, nu);
  ok("en faktura saknas i Fortnox: Fakturerade-steget är rött", sw[2].ton === "fel");
  const klar = hanteringsSteg({ id: "x", status: "Done", method: "Fortnox Automatic", handled_at: "2026-11-01T10:00:00Z", handled_by_name: "Nenad Krstic", facts: { invoicing: { ...MBIX_FAKT, progress: { ...MBIX_FAKT.progress, invoiced: 24, paid: 24 } } } }, nu);
  ok("allt fakturerat och betalt: Slutbetald klar", klar[2].lage === "klar" && klar[3].lage === "klar" && klar[1].detalj === "Automatiskt i Fortnox · Nenad Krstic · 2026-11-01", klar[1].detalj);

  const mak = hanteringsSteg({ ...TLS_HANTERING, status: "Cancelled", handled_at: null, sent_to_financier_at: null, order_cancelled_at: "2026-10-20T08:00:00Z" }, nu);
  ok("makulerad: stannar på steget den var på", mak[1].lage === "stopp" && mak[1].detalj === "Ordern makulerades 2026-10-20" && mak[2].lage === "kvar" && mak[2].detalj === null);
  const annan = hanteringsSteg({ id: "x", status: "Done", method: "Fortnox Manual", handled_at: "2026-10-13T13:53:20Z", handled_by_name: "Nenad Krstic" }, nu);
  ok("intern utan fakta: Faktureringen upplagd", annan.length === 2 && annan[1].text === "Faktureringen upplagd" && annan[1].detalj === "Manuellt i Fortnox · Nenad Krstic · 2026-10-13", annan[1].detalj);
}

rubrik("Inkios ord");
{
  ok("Intern · Månadsvis · 15 dagar", faktureringsText(MBIX_FAKT) === "Intern · Månadsvis · 15 dagar");
  ok("Finansierad · Novo", faktureringsText({ type: "Financed", financing_company: "Novo", schedule: "Monthly", payment_terms_days: 15 }) === "Finansierad · Novo");
  ok("ingen typ: Inte angivet", faktureringsText({ type: null }) === "Inte angivet");
  ok("metoderna", metodText("Fortnox Automatic") === "Automatiskt i Fortnox" && metodText("Financed", "Novo") === "Finansierad av Novo" && metodText(null) === "–");
  ok("löpraden, som Inkios", lopText(SWE_FAKT) === "0 av 4 fakturerade · 0 betalda · 1 hittades inte i Fortnox", lopText(SWE_FAKT));
  ok("genitiv: Novos, Kronans", genitiv("Novo") === "Novos" && genitiv("Kronans") === "Kronans");
  ok("dagar sedan, i hela dagar", dagarSedan("2026-10-09T15:02:01Z", nu) === 24 && dagarSedan(null, nu) === null);
}

rubrik("TLS Värmepumpar: finansierad, Novo har inte betalat ut");
{
  const e = orderekonomi({ ...tom, order: TLS_ORDER, hantering: TLS_HANTERING, avtal: [TLS_AVTAL], kort: TLS_KORT, fortnox: { connected: false } });
  ok("faktureringen tas ur metoden när ordern saknar den", e.fakturering?.typ === "Financed" && e.fakturering.text === "Finansierad · Novo", e.fakturering?.text);
  ok("ingen plan för en finansierad order", e.fakturering?.plan.length === 0 && !e.fakturering.slutbetald);
  ok("utbetalningen väntar sedan hanteringen, 24 dagar", e.utbetalning?.lage === "vantar" && e.utbetalning.dagar === 24 && e.utbetalning.belopp === 17940 && e.utbetalning.finansbolag === "Novo");
  ok("orderhanteringen: Finansierad av Novo, länk till Inkio", e.hantering?.marke === "Finansierad av Novo" && e.hantering.lank === `${bas}/invoices/handling/${TLS_HANTERING.id}`);
  ok("avtalet: Aktiv, nästa faktura, finansierat", e.avtal[0].status.text === "Aktiv" && e.avtal[0].nastaFaktura === "2026-11-25" && e.avtal[0].finansierat && e.avtal[0].lank === `${bas}/contracts/${TLS_AVTAL.id}`);
  ok("leveransen: produktionskortet och kolumnen", e.leverans?.kolumn === "Godkänd & Lanserad" && e.leverans.ansvariga[0] === "Andreas Laine" && e.leverans.lank === `${bas}/tasks/${TLS_KORT.id}`);
  ok("Fortnox inte kopplat", e.fortnox?.kopplat === false);
  const m = ekonomiMarke(e);
  ok("märket: väntar på Novos utbetalning", m.text === "väntar på Novos utbetalning" && m.ton === "signal", m.text);
  const ut = orderekonomi({ ...tom, order: TLS_ORDER, hantering: { ...TLS_HANTERING, financing_payout: "p1" }, utbetalning: { id: "p1", financing_company: "Novo", payout_date: "2026-11-01", amount: 17940, reference: "NV-88" } });
  ok("registrerad utbetalning", ut.utbetalning?.lage === "registrerad" && ut.utbetalning.datum === "2026-11-01" && ekonomiMarke(ut).text === "utbetald av Novo");
  const stangt = orderekonomi({ ...tom, order: TLS_ORDER, hantering: TLS_HANTERING, kortStangt: true });
  ok("kortet på en tavla Nav inte når: sägs, med länken", stangt.leverans?.stangt === true && !!stangt.leverans.lank);
}

rubrik("Mbix och SweAuto: interna, väntar på ekonomi");
{
  const mbix = orderekonomi({ ...tom, order: { id: "m", number: "SO-2026-00101", status: "Confirmed", invoicing: MBIX_FAKT, handling: { id: "h", number: "OH-2026-00010", status: "Pending", method: null } }, hantering: null });
  ok("24 planerade fakturor, den första väntar på faktura", mbix.fakturering?.plan.length === 24 && mbix.fakturering.plan[0].text === "Väntar på faktura" && mbix.fakturering.plan[0].ton === "warn");
  ok("märket: väntar på ekonomi", ekonomiMarke(mbix).text === "väntar på ekonomi");
  ok("orderhanteringen utan get-item: märket finns, inga steg", mbix.hantering?.marke === "Väntar på ekonomi" && mbix.hantering.steg.length === 0);
  const swe = orderekonomi({ ...tom, order: { id: "s", number: "SO-2026-00097", status: "Confirmed", invoicing: SWE_FAKT, handling: null }, hantering: null });
  ok("SweAuto: Saknas i Fortnox på den första", swe.fakturering?.plan[0].text === "Saknas i Fortnox" && swe.fakturering.plan[0].ton === "danger");
  ok("utan orderhantering men med plan: betalningarna, gult när en saknas i Fortnox", swe.hantering === null && ekonomiMarke(swe).text === "0 av 4 betalda" && ekonomiMarke(swe).ton === "warn", ekonomiMarke(swe).text);
  const gammal = orderekonomi({ ...tom, order: { id: "g", status: "Confirmed", invoicing: null, handling: null }, hantering: null });
  ok("äldre import utan plan och orderhantering: inte hos ekonomi", gammal.fakturering === null && ekonomiMarke(gammal).text === "inte hos ekonomi");
}

rubrik("Märket lyfter det förfallna först");
{
  const forsenad = orderekonomi({ ...tom, order: { id: "f", status: "Delivered", invoicing: { ...MBIX_FAKT, progress: { ...MBIX_FAKT.progress, invoiced: 5, paid: 4, overdue: 1 } }, handling: { id: "h", status: "Done", method: "Fortnox Automatic" } }, hantering: null });
  ok("en försenad: rött", ekonomiMarke(forsenad).text === "1 försenad" && ekonomiMarke(forsenad).ton === "danger");
  const inkasso = orderekonomi({ ...tom, order: { id: "f", status: "Delivered", invoicing: MBIX_FAKT, handling: { id: "h", status: "Done", method: "Fortnox Automatic" } }, hantering: null,
    fakturor: [{ id: "i1", invoice_number: "1049", status: "Overdue", stand: "inkasso", stand_label: "Inkasso", reminders_total: 2 }, { id: "i2", status: "Overdue", stand: "kfm" }] });
  ok("Kronofogden före inkasso", ekonomiMarke(inkasso).text === "kronofogden", ekonomiMarke(inkasso).text);
  ok("fakturans ställning och påminnelser", inkasso.fakturor[0].stand?.text === "Inkasso" && inkasso.fakturor[0].paminnelser === 2 && inkasso.fakturor[0].lank === `${bas}/invoices/i1`);
  const betald = orderekonomi({ ...tom, order: { id: "b", status: "Delivered", invoicing: { ...MBIX_FAKT, progress: { ...MBIX_FAKT.progress, invoiced: 24, paid: 24 } }, handling: { id: "h", status: "Done", method: "Fortnox Automatic" } }, hantering: null });
  ok("slutbetald: grönt", ekonomiMarke(betald).text === "slutbetald" && ekonomiMarke(betald).ton === "ok");
  const delvis = orderekonomi({ ...tom, order: { id: "d", status: "Delivered", invoicing: { ...MBIX_FAKT, progress: { ...MBIX_FAKT.progress, invoiced: 4, paid: 3 } }, handling: { id: "h", status: "Done", method: "Fortnox Automatic" } }, hantering: null });
  ok("delvis betald: 3 av 24 betalda", ekonomiMarke(delvis).text === "3 av 24 betalda", ekonomiMarke(delvis).text);
  const ejSkickad = orderekonomi({ ...tom, order: { id: "e", invoicing: null }, hantering: null, fakturor: [{ id: "i", source: "Fortnox", status: "Sent", booked: true, sent: false }] });
  ok("bokförd men inte skickad i Fortnox: Inte skickat", ejSkickad.fakturor[0].status.text === "Inte skickat");
}

rubrik("Filer och samtal");
{
  const e = orderekonomi({ ...tom, order: { id: "o" }, hantering: null,
    filer: [{ id: "d", title: "TLS Värmepumpar AB Zen Signad", file_name: "x.pdf", file_url: "/private/files/a/x.pdf", file_size: 112671 }],
    samtal: [{ id: "c", started_at: "2026-10-01T09:00:00Z", duration_seconds: 1380, our_user: "Fredrik Ek", their_number: "+4670", headline: "Ordersamtal" }] });
  ok("filen öppnas i Inkio", e.filer[0].lank === `${bas}/private/files/a/x.pdf`);
  ok("samtalet", e.samtal[0].sek === 1380 && e.samtal[0].vem === "Fredrik Ek" && e.samtal[0].rubrik === "Ordersamtal");
}

rubrik("Kortet: rutan sitter på den utfällda ordern, och Nav 2.0 fyller den");
{
  const sida = fs.readFileSync(new URL("../src/nav2/utkast.html", import.meta.url), "utf8");
  ok("utkastets krok på ordern", sida.includes("${kkEkonomi(x)}") && sida.includes("function kkEkonomi(x){ return ''; }"));
  ok("utkastets krok i huvudet", sida.includes("...kkHalsaEkonomi(o),") && sida.includes("function kkHalsaEkonomi(o){ return []; }"));
  ok("Nav 2.0 läser /nav2/inkio?vad=ekonomi", sida.includes("/nav2/inkio?vad=ekonomi&order="));
  ok("Nav 2.0 ersätter båda krokarna", /\nkkEkonomi = function\(x\)\{/.test(sida) && /\nkkHalsaEkonomi = function\(o\)\{/.test(sida));
  ok("stegens puls stängs av för den som vill slippa rörelse", /prefers-reduced-motion:reduce\)\{\.kksteg li\.nu>i::after/.test(sida));
}

console.log(fel ? `\n\x1b[31m${fel} fel\x1b[0m` : "\n\x1b[32mAllt stämmer.\x1b[0m");
process.exit(fel ? 1 : 0);
