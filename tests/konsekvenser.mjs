#!/usr/bin/env node
/**
 * Konsekvensmotorn. Ren logik, ingen Supabase, ingen Next.
 *
 * Sex saker star pa spel, och de flesta av dem ar granser nagon skulle kunna
 * flytta av misstag:
 *
 *   1. D-K12. Sen ankomst far ALDRIG bli en ogiltig franvaro. Provet skickar
 *      in en person som stamplat in en timme for sent och kraver noll.
 *      Faller den kontrollen har granhsen glidit, och da ska K12 avsnitt 6 och
 *      7 beslutas om pa nytt innan koden andras.
 *   2. O15. Femminutersgranhsen, samma tal som check-villkoret i 0037.
 *   3. FONSTRET. Rullande, raknat bakat, halvoppet. Bade fraga 42 och 47 ska
 *      falla ut ratt ur samma regel.
 *   4. HAVNING RAKNAR FOR INGENTING. Motsatsen till makuleringen i `order.ts`,
 *      och det ar den skillnaden som ar lattast att fa om bakfoten.
 *   5. O8. Volymbonus och K&V faller, GRUNDPROVISIONEN ROSS INTE.
 *   6. Fraga 45. Orderraknaren borjar om fran noll, och `netto` fortsatter
 *      berata sanningen om hur manga order manaden hade.
 *
 *   node --experimental-strip-types tests/konsekvenser.mjs
 */
import {
  MINSTA_MINUTER,
  helaManaderMellan,
  iFonstret,
  konsekvenslageFor,
  manadFor,
  manaderFore,
  raknas,
  trappstegFor,
  uteblivenInstampling,
  varningslage,
} from "../src/lib/konsekvens.ts";
import { raknaUnderlag } from "../src/lib/provision-motor.ts";
import { periodFor } from "../src/lib/order.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const SCHEMA = { start_time: "08:00", end_time: "17:00" };

const handelse = (h) => ({
  id: h.id ?? Math.random().toString(36).slice(2),
  employee_id: h.person ?? "s1",
  occurred_on: h.dag,
  minutes: h.minuter ?? 540,
  status: h.status ?? "godkand",
  ordningsnummer: h.ordning ?? null,
  atgard: h.atgard ?? null,
  period_month: h.dag ? `${h.dag.slice(0, 7)}-01` : null,
});

// Trappan som ligger seedad i 0037.
const TRAPPA = [
  { id: "r1", ordning: 1, antal_handelser: 1, periodlangd_manader: 3, atgard: "varning", omfattning: null, notifiera: true },
  { id: "r2", ordning: 2, antal_handelser: 2, periodlangd_manader: 3, atgard: "bonusforlust", omfattning: "innevarande_manad", notifiera: true },
  { id: "r3", ordning: 3, antal_handelser: 3, periodlangd_manader: 3, atgard: "arende", omfattning: null, notifiera: true },
];

// -----------------------------------------------------------------------------

console.log("\nD-K12: den som varit har raknas ALDRIG");
{
  const sent = [{ kind: "in", occurred_at: "2026-08-10T09:15:00Z" }];
  ok("en timme for sen ger ingen handelse", uteblivenInstampling(sent, SCHEMA) === null);

  const tidigtHem = [
    { kind: "in", occurred_at: "2026-08-10T06:00:00Z" },
    { kind: "out", occurred_at: "2026-08-10T09:00:00Z" },
  ];
  ok("tidig hemgang ger ingen handelse", uteblivenInstampling(tidigtHem, SCHEMA) === null);

  const glapp = [
    { kind: "in", occurred_at: "2026-08-10T06:00:00Z" },
    { kind: "out", occurred_at: "2026-08-10T08:00:00Z" },
    { kind: "in", occurred_at: "2026-08-10T12:00:00Z" },
    { kind: "out", occurred_at: "2026-08-10T15:00:00Z" },
  ];
  ok("fyra timmars glapp mitt pa dagen ger ingen handelse", uteblivenInstampling(glapp, SCHEMA) === null);

  const baraUt = [{ kind: "out", occurred_at: "2026-08-10T15:00:00Z" }];
  ok("en ensam utstampling ar en rattelse, inte en handelse", uteblivenInstampling(baraUt, SCHEMA) === null);
}

console.log("\nEn helt utebliven dag ar ett fall, och bara da");
{
  ok("ingen stampling alls ger 540 minuter", uteblivenInstampling([], SCHEMA) === 540);
  ok("utan schema finns ingenting att utebli fran", uteblivenInstampling([], null) === null);
}

console.log("\nO15: femminutersgranhsen");
{
  ok("granhsen ar 5, samma tal som villkoret i 0037", MINSTA_MINUTER === 5);
  ok(
    "ett fyra minuter kort schema ger ingen handelse",
    uteblivenInstampling([], { start_time: "08:00", end_time: "08:04" }) === null,
  );
  ok(
    "exakt fem minuter racker",
    uteblivenInstampling([], { start_time: "08:00", end_time: "08:05" }) === 5,
  );
}

console.log("\nDatumrakningen bakat");
{
  ok("tre manader fore 2026-08-15", manaderFore("2026-08-15", 3) === "2026-05-15");
  ok("den 31:a klams i stallet for att rulla", manaderFore("2026-05-31", 3) === "2026-02-28");
  ok("negativt gar framat", manaderFore("2026-08-15", -3) === "2026-11-15");
  ok("over ett arsskifte", manaderFore("2026-02-10", 3) === "2025-11-10");
}

console.log("\nFonstret ar rullande, raknat bakat och halvoppet");
{
  const alla = [
    handelse({ id: "a", dag: "2026-05-15" }),
    handelse({ id: "b", dag: "2026-07-01" }),
    handelse({ id: "c", dag: "2026-08-15" }),
  ];

  const inne = iFonstret(alla, "2026-08-15", 3);
  ok("exakt tre manader tillbaka ligger UTANFOR", !inne.some((h) => h.id === "a"), "halvoppet");
  ok("de tva senare ar inne", inne.length === 2);

  // Fraga 47: har det inte hant nagot pa tre manader ar fonstret tomt.
  ok("tre manader senare ar allt borta", iFonstret(alla, "2026-11-16", 3).length === 0);

  // Fraga 42: den andra ser den forsta.
  const tva = [handelse({ id: "x", dag: "2026-06-01" })];
  ok("en handelse tva manader senare ser den forra", iFonstret(tva, "2026-08-01", 3).length === 1);
}

console.log("\nBara godkanda handelser raknas — en havning raknar for INGENTING");
{
  ok("godkand raknas", raknas(handelse({ dag: "2026-08-01", status: "godkand" })));
  ok("foreslagen raknas inte", !raknas(handelse({ dag: "2026-08-01", status: "foreslagen" })));
  ok("avvisad raknas inte", !raknas(handelse({ dag: "2026-08-01", status: "avvisad" })));
  ok("HAVD raknas inte", !raknas(handelse({ dag: "2026-08-01", status: "havd" })));

  // Skillnaden mot `harGodkants` i order.ts: en havd handelse far inte fortsatta
  // bygga trappan efter att beslutet rivits.
  const havd = [handelse({ dag: "2026-08-01", status: "havd", ordning: 1, atgard: "varning" })];
  ok(
    "efter en havning ar nasta handelse steg ETT igen",
    trappstegFor(TRAPPA, havd, "2026-08-20")?.ordning === 1,
  );
}

console.log("\nTrappan: forsta, andra, tredje — och sedan still");
{
  ok("forsta gangen ger varning", trappstegFor(TRAPPA, [], "2026-08-10")?.atgard === "varning");

  const en = [handelse({ dag: "2026-07-10" })];
  ok("andra gangen ger bonusforlust", trappstegFor(TRAPPA, en, "2026-08-10")?.atgard === "bonusforlust");

  const tva = [handelse({ dag: "2026-07-10" }), handelse({ dag: "2026-07-20" })];
  ok("tredje gangen ger arende", trappstegFor(TRAPPA, tva, "2026-08-10")?.atgard === "arende");

  const tre = [...tva, handelse({ dag: "2026-08-01" })];
  ok("fjarde gangen star still pa arende", trappstegFor(TRAPPA, tre, "2026-08-10")?.atgard === "arende");

  // Fraga 47 igen, nu genom trappan.
  const gammal = [handelse({ dag: "2026-01-10" })];
  ok(
    "en handelse aldre an fonstret borjar om pa varning",
    trappstegFor(TRAPPA, gammal, "2026-08-10")?.atgard === "varning",
  );

  ok("tom trappa ger ingen konsekvens", trappstegFor([], [], "2026-08-10") === null);
}

console.log("\nManaden en handelse belastar ar HANDELSENS egen");
{
  ok("augustihandelse hor till augusti", manadFor({ occurred_on: "2026-08-31" }) === "2026-08-01");
  ok("septemberhandelse hor till september", manadFor({ occurred_on: "2026-09-01" }) === "2026-09-01");
}

console.log("\nManadens konsekvenslage");
{
  ok("ren manad ger null, inte en flagga pa false", konsekvenslageFor([], "2026-08-01") === null);

  const varning = [handelse({ dag: "2026-08-05", ordning: 1, atgard: "varning" })];
  const lageV = konsekvenslageFor(varning, "2026-08-01");
  ok("en varning ar ett lage utan bonusforlust", lageV?.bonusforlust === false);
  ok("och utan omstart av raknaren", lageV?.raknareFran === null);

  const forlust = [
    handelse({ dag: "2026-08-05", ordning: 1, atgard: "varning" }),
    handelse({ dag: "2026-08-20", ordning: 2, atgard: "bonusforlust" }),
  ];
  const lageF = konsekvenslageFor(forlust, "2026-08-01");
  ok("bonusforlusten syns", lageF?.bonusforlust === true);
  ok("raknaren borjar om pa handelsens dag", lageF?.raknareFran === "2026-08-20");

  const tva = [
    handelse({ dag: "2026-08-05", ordning: 2, atgard: "bonusforlust" }),
    handelse({ dag: "2026-08-25", ordning: 2, atgard: "bonusforlust" }),
  ];
  ok(
    "tva forluster: den SENASTE galler",
    konsekvenslageFor(tva, "2026-08-01")?.raknareFran === "2026-08-25",
  );

  const annanManad = [handelse({ dag: "2026-07-20", ordning: 2, atgard: "bonusforlust" })];
  ok("juli belastar inte augusti", konsekvenslageFor(annanManad, "2026-08-01") === null);
}

console.log("\nVarningslaget i saljarens vy");
{
  ok("ingen handelse ger ingen ruta", varningslage([], TRAPPA, "2026-08-20") === null);

  const en = [handelse({ dag: "2026-08-10", ordning: 1, atgard: "varning" })];
  const v = varningslage(en, TRAPPA, "2026-08-20");
  ok("en handelse i fonstret", v?.antal === 1);
  ok("nasta skulle bli bonusforlust", v?.nasta?.atgard === "bonusforlust");
  ok("nollstalls tre manader efter den senaste", v?.nollstallsDen === "2026-11-10");
  ok("tva hela manader kvar", v?.manaderKvar === 2, `${v?.manaderKvar}`);

  ok("gammal handelse ger ingen ruta", varningslage([handelse({ dag: "2026-01-01" })], TRAPPA, "2026-08-20") === null);
}

console.log("\nHela manader raknas NEDAT");
{
  ok("tva manader och 29 dagar blir 2", helaManaderMellan("2026-08-20", "2026-11-19") === 2);
  ok("exakt tre manader blir 3", helaManaderMellan("2026-08-20", "2026-11-20") === 3);
  ok("bakat blir noll", helaManaderMellan("2026-11-20", "2026-08-20") === 0);
}

// -----------------------------------------------------------------------------
// Motorn: vad konsekvensen gor med pengarna
// -----------------------------------------------------------------------------

const order = (o) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  salesperson_id: "s1",
  package_id: 1,
  term_months: 12,
  signed_on: o.signerad,
  period_month: periodFor(o.signerad),
  status: o.status ?? "signerad",
  is_addon: false,
  commission_amount: o.belopp ?? 1500,
  cancel_period_month: o.makuleradManad ?? null,
});

const NIVAER = [
  { id: "n5", threshold: 5, amount: 200, unit: "amount_fixed", valid_from: "2026-01-01", valid_to: null },
  { id: "n10", threshold: 10, amount: 500, unit: "amount_fixed", valid_from: "2026-01-01", valid_to: null },
];

/** `antal` order i augusti, jamnt utspridda fran den dag som anges. */
const orderFran = (dag, antal) =>
  Array.from({ length: antal }, (_, i) =>
    order({ id: `${dag}-${i}`, signerad: `2026-08-${String(dag + i).padStart(2, "0")}` }),
  );

console.log("\nO8: grundprovisionen ROSS INTE, volymbonusen och K&V faller");
{
  const rader = orderFran(1, 12);
  const kv = { godkanda: 4, bedomda: 4, procent: 5 };

  const utan = raknaUnderlag("s1", rader, "2026-08-01", NIVAER, kv, null);
  ok("utan konsekvens: niva 10", utan.volymbonus?.niva.threshold === 10);
  ok("utan konsekvens: K&V ger bonus", utan.kv !== null);

  // Konsekvensen slar in efter alla tolv orderna.
  const lage = konsekvenslageFor(
    [handelse({ dag: "2026-08-28", ordning: 2, atgard: "bonusforlust" })],
    "2026-08-01",
  );
  const med = raknaUnderlag("s1", rader, "2026-08-01", NIVAER, kv, lage);

  ok("grundprovisionen ar oforandrad", med.grundprovision === utan.grundprovision);
  ok("volymbonusen ar borta", med.volymbonus === null);
  ok("K&V-bonusen ar borta (O17)", med.kv === null);
  ok("summan ar bara grundprovisionen", med.summa === med.grundprovision);
  ok("netto berattar fortfarande sanningen", med.antal.netto === 12);
  ok("men bonusen raknas pa noll", med.antal.bonusgrundande === 0);
  ok("laget star i underlaget", med.konsekvens?.bonusforlust === true);
}

console.log("\nFraga 45: raknaren borjar om, och fem nya order ger niva 5");
{
  // Tjugo order den 1-20, konsekvens den 20:e, fem till den 21-25.
  const rader = [...orderFran(1, 20), ...orderFran(21, 5)];
  const lage = konsekvenslageFor(
    [handelse({ dag: "2026-08-20", ordning: 2, atgard: "bonusforlust" })],
    "2026-08-01",
  );
  const u = raknaUnderlag("s1", rader, "2026-08-01", NIVAER, null, lage);

  ok("tjugofem order i manaden", u.antal.netto === 25);
  // Den 20:e ar bade konsekvensens dag och en orderdag — "fran och med" gor att
  // den ordern hor till den NYA trappan, till den anstalldas fordel.
  ok("bonusen raknas pa sex order", u.antal.bonusgrundande === 6, `${u.antal.bonusgrundande}`);
  ok("vilket ar niva 5, inte niva 10", u.volymbonus?.niva.threshold === 5);
  ok("alltsa 200 kr och inte 500", u.volymbonus?.belopp === 200);
  ok("prognosen pekar pa niva 10", u.nasta?.niva.threshold === 10);
  ok("fyra order dit", u.nasta?.kvar === 4);
}

console.log("\nEn makulering foljer sin order over konsekvensgranhsen");
{
  const tidig = order({ id: "tidig", signerad: "2026-08-02", status: "makulerad", makuleradManad: "2026-08-01" });
  const rader = [...orderFran(21, 6), tidig];

  const lage = konsekvenslageFor(
    [handelse({ dag: "2026-08-20", ordning: 2, atgard: "bonusforlust" })],
    "2026-08-01",
  );
  const u = raknaUnderlag("s1", rader, "2026-08-01", NIVAER, null, lage);

  ok("nettot bar makuleringen", u.antal.netto === 6, `${u.antal.netto}`);
  ok(
    "men den nya raknaren rors inte av en order fran den 2:a",
    u.antal.bonusgrundande === 6,
    `${u.antal.bonusgrundande}`,
  );
  ok("avdraget bokfors anda", u.rader.some((r) => r.slag === "makulering" && r.belopp === -1500));
}

console.log("\nEn varning utan bonusforlust ror inga pengar");
{
  const rader = orderFran(1, 12);
  const lage = konsekvenslageFor(
    [handelse({ dag: "2026-08-05", ordning: 1, atgard: "varning" })],
    "2026-08-01",
  );
  const u = raknaUnderlag("s1", rader, "2026-08-01", NIVAER, { godkanda: 4, bedomda: 4, procent: 5 }, lage);

  ok("volymbonusen star kvar", u.volymbonus?.niva.threshold === 10);
  ok("K&V star kvar", u.kv !== null);
  ok("men laget syns i underlaget", u.konsekvens?.handelser === 1);
}

console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
