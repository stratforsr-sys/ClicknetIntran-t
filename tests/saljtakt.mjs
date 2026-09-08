#!/usr/bin/env node
/**
 * Dagen, takten och malet. Sex saker star pa spel och provas at bada hallen:
 *
 *   1. KALENDERN. Paskdagen ar den enda av arets roda dagar som inte gar att
 *      sla upp i en tabell utan att tabellen tar slut. Blir den fel blir fem
 *      helgdagar fel, och da blir varje takt i april och maj fel.
 *   2. ARBETSDAGARNA. Takten delas pa dem. Rakna med helger och december blir
 *      systematiskt for optimistisk for alla, varje ar.
 *   3. DAGSRAKNAREN. En makulerad order raknas inte, aven om den tecknades i
 *      dag — annars gar dagens siffra att blasa upp.
 *   4. TROSKELN FOR PROGNOSEN. En prognos ur en dag ar en gissning utkladd
 *      till en berakning, och den kastar sig varje dag den forsta veckan.
 *   5. MALET MOT TAKTEN, inte mot hela manaden. "12 av 20" den 8:e ar inte ett
 *      underbetyg, och en matare som alltid ar rod slutar man titta pa.
 *   6. KRAVET PER DAG AVRUNDAT UPPAT. Den som foljer ett nedrundat krav till
 *      punkt och pricka missar malet.
 *
 *   TZ=UTC node --experimental-strip-types tests/saljtakt.mjs
 */
import {
  MINSTA_DAGAR_FOR_PROGNOS,
  TAKTBAND,
  manadsfacit,
  samlatMal,
  taktaFlera,
  arArbetsdag,
  arbetsdagarIManad,
  arbetsdagarTill,
  dagPlus,
  dagarIManad,
  dagsserie,
  malFor,
  motMal,
  paskdagen,
  rodaDagar,
  saltEnDag,
  sistaDagen,
  takta,
  veckodag,
} from "../src/lib/saljtakt.ts";
import { raknaUnderlag } from "../src/lib/provision-motor.ts";
import { periodFor } from "../src/lib/order.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

const order = (o) => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  salesperson_id: o.saljare ?? "s1",
  package_id: o.paket ?? 1,
  term_months: o.loptid ?? 12,
  signed_on: o.signerad,
  period_month: periodFor(o.signerad),
  status: o.status ?? "signerad",
  is_addon: false,
  commission_amount: o.belopp ?? null,
  cancel_period_month: o.makuleradManad ?? null,
});

const SATSER = [
  {
    id: "r1",
    package_id: 1,
    term_months: 12,
    amount: 1500,
    valid_from: "2020-01-01",
    valid_to: null,
  },
];

const TRAPPA = [
  { id: "n5", threshold: 5, amount: 200, unit: "amount_fixed", valid_from: "2020-01-01", valid_to: null },
  { id: "n10", threshold: 10, amount: 500, unit: "amount_fixed", valid_from: "2020-01-01", valid_to: null },
  { id: "n15", threshold: 15, amount: 1000, unit: "amount_fixed", valid_from: "2020-01-01", valid_to: null },
  { id: "n20", threshold: 20, amount: 1200, unit: "amount_fixed", valid_from: "2020-01-01", valid_to: null },
];

// -----------------------------------------------------------------------------
console.log("\nPaskdagen — Meeus/Jones/Butcher mot facit");
{
  // Facit ur svensk almanacka. Aren ar valda for att spanna algoritmens grenar:
  // 2026 ar en tidig pask, 2038 en sen, 2000 och 2100 provar sekelregeln.
  const facit = {
    2024: "2024-03-31",
    2025: "2025-04-20",
    2026: "2026-04-05",
    2027: "2027-03-28",
    2028: "2028-04-16",
    2038: "2038-04-25",
    2000: "2000-04-23",
    2100: "2100-03-28",
  };

  for (const [ar, datum] of Object.entries(facit)) {
    ok(`pask ${ar} = ${datum}`, paskdagen(Number(ar)) === datum, paskdagen(Number(ar)));
  }

  ok(
    "paskdagen ar alltid en sondag",
    [2024, 2025, 2026, 2027, 2030, 2040].every((a) => veckodag(paskdagen(a)) === 0),
  );
}

// -----------------------------------------------------------------------------
console.log("\nRoda dagar");
{
  const r = rodaDagar(2026);

  ok("nyarsdagen", r.has("2026-01-01"));
  ok("trettondedag jul", r.has("2026-01-06"));
  ok("langfredagen ar pask minus tva", r.has(dagPlus(paskdagen(2026), -2)));
  ok("annandag pask ar pask plus ett", r.has(dagPlus(paskdagen(2026), 1)));
  ok("Kristi himmelsfard ar pask plus 39", r.has(dagPlus(paskdagen(2026), 39)));
  ok("pingstdagen ar pask plus 49", r.has(dagPlus(paskdagen(2026), 49)));
  ok("forsta maj", r.has("2026-05-01"));
  ok("nationaldagen", r.has("2026-06-06"));
  ok("julafton, juldagen, annandagen", r.has("2026-12-24") && r.has("2026-12-25") && r.has("2026-12-26"));
  ok("nyarsafton", r.has("2026-12-31"));

  // Midsommarafton ar fredagen fore midsommardagen, som ar lordagen 20-26 juni.
  const midsommarafton = [...r].find((d) => d.startsWith("2026-06") && d !== "2026-06-06");
  ok("midsommarafton ar en fredag", veckodag(midsommarafton) === 5, midsommarafton);
  ok(
    "midsommarafton ligger 19-25 juni",
    Number(midsommarafton.slice(8)) >= 19 && Number(midsommarafton.slice(8)) <= 25,
    midsommarafton,
  );

  // Kristi himmelsfard ar ALLTID en torsdag, pingstdagen alltid en sondag. Faller
  // det provet ar offseten fel, och da ar takten fel i hela maj.
  ok("Kristi himmelsfard ar en torsdag", veckodag(dagPlus(paskdagen(2026), 39)) === 4);
  ok("pingstdagen ar en sondag", veckodag(dagPlus(paskdagen(2026), 49)) === 0);

  // Alla helgons dag star medvetet INTE med — den ar alltid en lordag och hade
  // aldrig andrat en rakning. Se rubriken i saljtakt.ts.
  ok("alla helgons dag star inte med", ![...r].some((d) => d >= "2026-10-31" && d <= "2026-11-06"));
}

// -----------------------------------------------------------------------------
console.log("\nArbetsdagar");
{
  ok("en lordag ar ingen arbetsdag", !arArbetsdag("2026-09-05"));
  ok("en sondag ar ingen arbetsdag", !arArbetsdag("2026-09-06"));
  ok("en vanlig mandag ar en arbetsdag", arArbetsdag("2026-09-07"));
  ok("nationaldagen 2029 (en onsdag) ar ingen arbetsdag", !arArbetsdag("2029-06-06"));

  ok("september 2026 har 30 dagar", dagarIManad("2026-09-01").length === 30);
  ok("februari 2028 har 29 dagar (skottar)", dagarIManad("2028-02-01").length === 29);
  ok("sista dagen i september", sistaDagen("2026-09-01") === "2026-09-30");
  ok("sista dagen i februari 2028", sistaDagen("2028-02-01") === "2028-02-29");

  // September 2026: 1:a ar en tisdag, manaden har 22 vardagar och ingen rod dag.
  ok("september 2026 har 22 arbetsdagar", arbetsdagarIManad("2026-09-01").length === 22, String(arbetsdagarIManad("2026-09-01").length));

  // December 2026: 23 vardagar, varav 24, 25 och 31 ar roda (26:e ar en lordag).
  const dec = arbetsdagarIManad("2026-12-01");
  ok("december 2026 har 20 arbetsdagar", dec.length === 20, String(dec.length));
  ok("julafton ar inte med", !dec.includes("2026-12-24"));
  ok("nyarsafton ar inte med", !dec.includes("2026-12-31"));

  // DEN HAR SKILLNADEN AR HELA POANGEN med att rakna pa arbetsdagar. Rakna pa
  // kalenderdagar och december far 31 i namnaren i stallet for 20.
  ok("december har farre arbetsdagar an kalenderdagar", dec.length < dagarIManad("2026-12-01").length);
}

// -----------------------------------------------------------------------------
console.log("\nPasserade arbetsdagar — dagen i dag raknas som passerad");
{
  const till7 = arbetsdagarTill("2026-09-01", "2026-09-07");
  // 1, 2, 3, 4 (tis-fre) och 7 (mandag). Helgen den 5-6 raknas inte.
  ok("fem arbetsdagar till och med den 7:e", till7.length === 5, till7.join(" "));
  ok("dagen i dag ar med", till7.includes("2026-09-07"));
  ok("helgen ar inte med", !till7.includes("2026-09-05"));

  // En ledig dag som slutdatum tar inte med sig sjalv, men allt fore.
  const till6 = arbetsdagarTill("2026-09-01", "2026-09-06");
  ok("en sondag som slutdag ger fyra dagar", till6.length === 4, till6.join(" "));

  ok("hela manaden ger alla arbetsdagar", arbetsdagarTill("2026-09-01", "2026-09-30").length === 22);
}

// -----------------------------------------------------------------------------
console.log("\nDagsraknaren");
{
  const rader = [
    order({ id: "a", signerad: "2026-09-07", belopp: 1500 }),
    order({ id: "b", signerad: "2026-09-07", status: "inskickad" }),
    order({ id: "c", signerad: "2026-09-07", status: "utkast" }),
    order({ id: "d", signerad: "2026-09-07", status: "betald", belopp: 1500 }),
    order({ id: "e", signerad: "2026-09-06", belopp: 1500 }),
  ];

  const d = saltEnDag(rader, "2026-09-07", SATSER);

  ok("fyra order i dag", d.antal === 4, String(d.antal));
  ok("tva godkanda", d.godkanda === 2, String(d.godkanda));
  ok("tva vantande", d.vantande === 2, String(d.vantande));
  ok("kronorna galler bara de godkanda", d.kronor === 3000, String(d.kronor));
  ok("det vantande slas ur matrisen", d.kronorVantande === 3000, String(d.kronorVantande));
  ok("gardagens order raknas inte", !rader.some(() => d.antal === 5));

  // EN MAKULERAD ORDER RAKNAS INTE, aven om den tecknades i dag. Utan spärren
  // gar dagens siffra att blasa upp genom att lagga in och makulera.
  const medMakulerad = saltEnDag(
    [...rader, order({ id: "f", signerad: "2026-09-07", status: "makulerad", belopp: 1500, makuleradManad: "2026-09-01" })],
    "2026-09-07",
    SATSER,
  );
  ok("en makulerad order raknas inte in i dagen", medMakulerad.antal === 4, String(medMakulerad.antal));

  // Utan satser blir det vantande beloppet noll och inte NaN. En vy som skriver
  // "NaN kr" ar varre an en som skriver "0 kr".
  const utanSatser = saltEnDag(rader, "2026-09-07");
  ok("utan satser blir det vantande noll, inte NaN", utanSatser.kronorVantande === 0);
}

// -----------------------------------------------------------------------------
console.log("\nDagsserien");
{
  const rader = [
    order({ signerad: "2026-09-01", belopp: 1500 }),
    order({ signerad: "2026-09-01", belopp: 1500 }),
    order({ signerad: "2026-09-05", belopp: 1500 }), // lordag
    order({ signerad: "2026-09-07", belopp: 1500 }),
  ];

  const serie = dagsserie(rader, "2026-09-01");

  ok("en post per arbetsdag", serie.length === 22, String(serie.length));
  ok("den 1:a har tva", serie.find((s) => s.dag === "2026-09-01").antal === 2);
  ok("den 7:e har en", serie.find((s) => s.dag === "2026-09-07").antal === 1);
  ok("lordagen finns inte i serien", !serie.some((s) => s.dag === "2026-09-05"));
  ok("tomma dagar star som noll", serie.find((s) => s.dag === "2026-09-02").antal === 0);
}

// -----------------------------------------------------------------------------
console.log("\nTakten");
{
  const manadensOrder = (n, fran = 1) =>
    Array.from({ length: n }, (_, i) =>
      order({ signerad: `2026-09-${String(fran + (i % 20)).padStart(2, "0")}`, belopp: 1500 }),
    );

  // TROSKELN. Fore tre arbetsdagar finns ingen prognos, oavsett hur bra det gar.
  {
    const u = raknaUnderlag("s1", manadensOrder(3), "2026-09-01", TRAPPA);
    const t = takta(u, TRAPPA, "2026-09-01", "2026-09-02");
    ok("tva dagar in finns ingen prognos", t.prognos === null);
    ok("men dagarna raknas anda", t.gangna === 2 && t.totalt === 22);
    ok("troskeln ar tre dagar", MINSTA_DAGAR_FOR_PROGNOS === 3);
  }

  // Elva arbetsdagar in (t.o.m. den 15:e), 10 order: takten sager 20 order.
  {
    const u = raknaUnderlag("s1", manadensOrder(10), "2026-09-01", TRAPPA);
    const t = takta(u, TRAPPA, "2026-09-01", "2026-09-15");

    ok("elva av tjugotva arbetsdagar", t.gangna === 11 && t.totalt === 22, `${t.gangna}/${t.totalt}`);
    ok("halva manaden avverkad", Math.abs(t.andel - 0.5) < 1e-9);
    ok("takten sager 20 order", t.prognos.antal === 20, String(t.prognos.antal));
    ok("grundprovisionen skrivs fram till 30 000", t.prognos.grundprovision === 30000, String(t.prognos.grundprovision));
    ok("nivan blir 20", t.prognos.niva.threshold === 20);
    ok("bonusen blir 1 200", t.prognos.bonus === 1200);
    ok("totalen ar grund plus bonus", t.prognos.totalt === 31200);
  }

  // NOLL ORDER GER INGEN PROGNOS. En prognos ur noll ar inte noll, den ar
  // ingenting — och en nolla ser ut som ett resultat.
  {
    const u = raknaUnderlag("s1", [], "2026-09-01", TRAPPA);
    const t = takta(u, TRAPPA, "2026-09-01", "2026-09-15");
    ok("noll order ger ingen prognos", t.prognos === null);
  }

  // MANADEN AR SLUT: takten ar utfallet, inte en gissning om det.
  {
    const u = raknaUnderlag("s1", manadensOrder(17), "2026-09-01", TRAPPA);
    const t = takta(u, TRAPPA, "2026-09-01", "2026-09-30");
    ok("sista dagen ar allt avverkat", t.gangna === 22 && t.kvar === 0);
    ok("takten ar utfallet", t.prognos.antal === u.antal.netto, `${t.prognos.antal} mot ${u.antal.netto}`);
    ok("nivan ar den faktiska", t.prognos.niva.threshold === 15);
  }

  // ETT NEGATIVT SALDO ger ingen prognos. Fler makuleringar an order.
  {
    const rader = [
      order({ signerad: "2026-08-10", status: "makulerad", belopp: 1500, makuleradManad: "2026-09-01" }),
      order({ signerad: "2026-08-11", status: "makulerad", belopp: 1500, makuleradManad: "2026-09-01" }),
    ];
    const u = raknaUnderlag("s1", rader, "2026-09-01", TRAPPA);
    const t = takta(u, TRAPPA, "2026-09-01", "2026-09-15");
    ok("negativt saldo ger ingen prognos", t.prognos === null, String(u.antal.netto));
  }
}

// -----------------------------------------------------------------------------
console.log("\nMalet mot takten");
{
  const t = { gangna: 11, totalt: 22, kvar: 11, andel: 0.5, prognos: null };

  // Halva manaden gangen, mal 20: forvantat lage ar 10.
  {
    const m = motMal(20, 10, t);
    ok("forvantat lage ar halva malet", m.forvantat === 10);
    ok("exakt pa forvantat ar i takt", m.lage === "i_takt");
    ok("andelen ar halva", m.andel === 0.5);
    ok("noll mot takten", m.mot === 0);
    ok("kravet ar 10 pa 11 dagar", Math.abs(m.kravPerDag - 10 / 11) < 1e-9);
  }

  // BANDET. Fem procent av MALET, alltsa en order pa ett mal om tjugo.
  {
    ok("bandet ar fem procent", TAKTBAND === 0.05);
    ok("en order over ar fortfarande i takt", motMal(20, 11, t).lage === "i_takt");
    ok("tva over ar fore", motMal(20, 12, t).lage === "fore");
    ok("en order under ar fortfarande i takt", motMal(20, 9, t).lage === "i_takt");
    ok("tva under ar efter", motMal(20, 8, t).lage === "efter");
  }

  // "12 AV 20" DEN 8:e AR INTE ETT UNDERBETYG. Det ar hela skalet till att
  // kortet jamfor mot takten och inte mot hela malet.
  {
    const tidigt = { gangna: 5, totalt: 22, kvar: 17, andel: 5 / 22, prognos: null };
    const m = motMal(20, 12, tidigt);
    ok("tolv av tjugo tidigt i manaden ar FORE takten", m.lage === "fore");
    ok("andelen ar anda bara 60 procent", m.andel === 0.6);
  }

  // MALET NATT: inget krav per dag kvar att stalla.
  {
    ok("natt mal ger inget dagskrav", motMal(20, 20, t).kravPerDag === null);
    ok("overtraffat mal ger inget dagskrav", motMal(20, 25, t).kravPerDag === null);
    ok("overtraffat mal ger andel over ett", motMal(20, 25, t).andel === 1.25);
  }

  // SISTA DAGEN: noll dagar kvar ger inget krav, i stallet for en division med
  // noll som blir Infinity och skrivs ut som "Infinity order per dag".
  {
    const sista = { gangna: 22, totalt: 22, kvar: 0, andel: 1, prognos: null };
    ok("noll dagar kvar ger inget dagskrav", motMal(20, 15, sista).kravPerDag === null);
    ok("och laget ar efter", motMal(20, 15, sista).lage === "efter");
  }
}

// -----------------------------------------------------------------------------
console.log("\nMalet slas upp pa exakt manad");
{
  const mal = [
    { employee_id: "s1", period_month: "2026-09-01", mal_order: 20, mal_kronor: null },
    { employee_id: "s1", period_month: "2026-08-01", mal_order: 15, mal_kronor: null },
    { employee_id: "s2", period_month: "2026-09-01", mal_order: 10, mal_kronor: null },
  ];

  ok("ratt person och manad", malFor(mal, "s1", "2026-09-01").mal_order === 20);
  ok("annan manad ger den manadens mal", malFor(mal, "s1", "2026-08-01").mal_order === 15);
  ok("annan person blandas inte in", malFor(mal, "s2", "2026-09-01").mal_order === 10);

  // ARVS ALDRIG. Oktober har inget mal, och da ar svaret null — inte septembers.
  ok("malet arvs inte framat", malFor(mal, "s1", "2026-10-01") === null);
  ok("okand person ger null", malFor(mal, "s3", "2026-09-01") === null);
}

// -----------------------------------------------------------------------------
console.log("\nManaden i backspegeln");
{
  const serie = [
    { dag: "2026-09-01", antal: 2 },
    { dag: "2026-09-02", antal: 0 },
    { dag: "2026-09-03", antal: 5 },
    { dag: "2026-09-04", antal: 1 },
  ];

  const f = manadsfacit(serie, 8);
  ok("antalet kommer utifran, inte ur serien", f.antal === 8);
  ok("basta dagen ar den 3:e med fem", f.bastaDagen.dag === "2026-09-03" && f.bastaDagen.antal === 5);
  ok("tre dagar av fyra hade order", f.dagarMedOrder === 3 && f.arbetsdagar === 4);

  // SNITTET DELAS PA ALLA ARBETSDAGAR, inte bara pa dem med order. Delat pa
  // dagarna med order hade det blivit minst ett i alla lagen, alltsa ett tal
  // som inte kan saga nagot daligt.
  ok("snittet delas pa alla arbetsdagar", f.snittPerArbetsdag === 2, String(f.snittPerArbetsdag));

  const tom = manadsfacit([{ dag: "2026-09-01", antal: 0 }], 0);
  ok("ingen order ger ingen basta dag", tom.bastaDagen === null);
  ok("och snittet blir noll, inte NaN", tom.snittPerArbetsdag === 0);
  ok("tom serie ger noll, inte division med noll", manadsfacit([], 0).snittPerArbetsdag === 0);

  // ANTALET FAR VARA NEGATIVT. Fler makuleringar an order — serien vet inget om
  // makuleringar, sa talet MASTE komma utifran.
  ok("negativt netto slar igenom", manadsfacit(serie, -2).antal === -2);
}

// -----------------------------------------------------------------------------
console.log("\nLagets takt");
{
  const manadensOrder = (n, saljare) =>
    Array.from({ length: n }, (_, i) =>
      order({ saljare, signerad: `2026-09-${String(1 + (i % 20)).padStart(2, "0")}`, belopp: 1500 }),
    );

  const a = raknaUnderlag("s1", manadensOrder(10, "s1"), "2026-09-01", TRAPPA);
  const b = raknaUnderlag("s2", manadensOrder(6, "s2"), "2026-09-01", TRAPPA);

  const t = taktaFlera([a, b], TRAPPA, "2026-09-01", "2026-09-15");

  ok("kalenderdelen ar densamma som for en person", t.gangna === 11 && t.totalt === 22);

  // 10 -> 20 och 6 -> 12 vid halva manaden.
  ok("antalen summeras", t.prognos.antal === 32, String(t.prognos.antal));

  // NIVAN AR ALLTID NULL PA LAGNIVA. Femtio order pa tio personer ger ingen
  // bonus; femtio pa en ger niva 20. En gemensam niva hade ritat samma bild.
  ok("laget har ingen niva", t.prognos.niva === null);

  // Beloppet summeras daremot — var persons bonus ar rakad for sig forst.
  const ta = takta(a, TRAPPA, "2026-09-01", "2026-09-15");
  const tb = takta(b, TRAPPA, "2026-09-01", "2026-09-15");
  ok("bonusen ar summan av de enskilda", t.prognos.bonus === ta.prognos.bonus + tb.prognos.bonus);
  ok("totalen ar grund plus bonus", t.prognos.totalt === t.prognos.grundprovision + t.prognos.bonus);

  // DEN SOM SAKNAR PROGNOS BIDRAR MED SITT UTFALL, inte med noll — annars
  // sjunker lagets takt av att nagon borjar mitt i manaden.
  const ny = raknaUnderlag("s3", manadensOrder(1, "s3"), "2026-09-01", TRAPPA);
  const medNy = taktaFlera([a, b, ny], TRAPPA, "2026-09-01", "2026-09-15");
  ok("en ny saljare sanker inte lagets takt", medNy.prognos.totalt >= t.prognos.totalt,
     `${medNy.prognos.totalt} mot ${t.prognos.totalt}`);

  // INGEN MED PROGNOS betyder ingen lagprognos. Ett lag vars takt ar summan av
  // fem utfall ar inte en takt.
  const tidigt = taktaFlera([a, b], TRAPPA, "2026-09-01", "2026-09-02");
  ok("tva dagar in har laget ingen prognos", tidigt.prognos === null);
  ok("tomt lag ger ingen prognos", taktaFlera([], TRAPPA, "2026-09-01", "2026-09-15").prognos === null);
}

// -----------------------------------------------------------------------------
console.log("\nLagets mal");
{
  const u = (id, n) => raknaUnderlag(id,
    Array.from({ length: n }, (_, i) =>
      order({ saljare: id, signerad: `2026-09-${String(1 + (i % 20)).padStart(2, "0")}`, belopp: 1500 })),
    "2026-09-01", TRAPPA);

  const lag = [u("s1", 10), u("s2", 6), u("s3", 20)];
  const t = { gangna: 11, totalt: 22, kvar: 11, andel: 0.5, prognos: null };

  const mal = [
    { employee_id: "s1", period_month: "2026-09-01", mal_order: 20, mal_kronor: null },
    { employee_id: "s2", period_month: "2026-09-01", mal_order: 10, mal_kronor: null },
    // s3 har INGET mal, och ar med flit den som salt mest.
    { employee_id: "s1", period_month: "2026-08-01", mal_order: 99, mal_kronor: null },
  ];

  const m = samlatMal(lag, mal, "2026-09-01", t);

  ok("tva av tre har mal", m.medMal === 2);
  ok("malen summeras till 30", m.utfall.mal === 30, String(m.utfall.mal));

  // BADA SIDOR RAKNAS PA SAMMA KRETS. s3:s tjugo order far INTE raknas mot ett
  // mal hen inte har — annars hade kvoten stigit av att en chef glomde satta
  // ett mal.
  ok("utfallet ar 16, inte 36", m.utfall.nu === 16, String(m.utfall.nu));
  ok("annan manads mal blandas inte in", m.utfall.mal === 30);

  // Halva manaden gangen, 16 av 30 forvantat 15 -> inom bandet (30 x 5 % = 1,5).
  ok("laget ligger i takt", m.utfall.lage === "i_takt", `${m.utfall.mot}`);

  ok("inget mal alls ger null", samlatMal(lag, [], "2026-09-01", t) === null);
  ok("bara kronmal raknas inte in", samlatMal(lag,
    [{ employee_id: "s1", period_month: "2026-09-01", mal_order: null, mal_kronor: 5000 }],
    "2026-09-01", t) === null);
}

console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
