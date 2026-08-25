#!/usr/bin/env node
/**
 * K&V-protokollet. Fem saker star pa spel:
 *
 *   1. TORSDAGSREGELN (O9). En ISO-vecka som spanner over ett manadsskifte hor
 *      till den manad dar dess TORSDAG ligger. Gar den fel raknas en vecka i
 *      fel manads bonus, eller i bada.
 *   2. EN HALVBEDOMD VECKA HOPPAS OVER. Troskeln ar summan av BADA samtalen, sa
 *      en vecka med ett bedomt samtal kan aldrig na den — och veckan hade
 *      underkants av ett skal som ar chefens, inte saljarens.
 *   3. TAKET GALLER AVEN I EN FEMVECKORSMANAD (fraga 32).
 *   4. TROSKELN I PROCENT. Det ar kontrollen O4 handlade om: samma troskel
 *      betydde 6,7 %, 40 % eller 80 % beroende pa vilken skala som menades.
 *   5. MAXPOANG SOM SAKNAS GER NULL, aldrig ett tak raknat pa halva listan.
 *
 *   node --experimental-strip-types tests/kv.mjs
 */
import {
  gallandePolicy,
  konfigurationsfel,
  kurvaPerOmrade,
  kvManad,
  kvProcent,
  manadForVecka,
  maxpoangPerVecka,
  troskelIProcent,
  veckonummer,
  veckansTorsdag,
  veckorFor,
} from "../src/lib/kv.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(
    `  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`,
  );
  if (!villkor) fel++;
};

// Bestallarens svar ur 0036. Star har for att provet ska ga att lasa; logiken
// far dem som argument och kanner inga tal sjalv.
const POLICY = {
  id: "p1",
  calls_per_week: 2,
  threshold_points: 160,
  percent_per_week: 1.25,
  cap_percent: 5,
  valid_from: "2026-08-01",
  valid_to: null,
};

// O4: 200 totalt for bada samtalen, alltsa 100 per samtal fordelat pa sex
// omraden. Fordelningen nedan ar PROVETS, inte bestallarens — den ar ojamn med
// flit, sa att ett prov inte kan passera pa att alla tal ar lika.
const KRITERIER = [
  { id: "k1", label: "Intro", max_points: 15, sort: 1, active: true },
  { id: "k2", label: "Behovsanalys", max_points: 20, sort: 2, active: true },
  { id: "k3", label: "ROI", max_points: 20, sort: 3, active: true },
  { id: "k4", label: "Avslut", max_points: 20, sort: 4, active: true },
  { id: "k5", label: "Kvalitet på samtalet", max_points: 15, sort: 5, active: true },
  { id: "k6", label: "Korrekt avtalshantering", max_points: 10, sort: 6, active: true },
];

const samtal = (datum, poang, id = Math.random().toString(36).slice(2)) => ({
  id,
  employee_id: "s1",
  call_date: datum,
  customer: "Kund AB",
  poang,
});

console.log("\nTorsdagsregeln — vilken manad en vecka hor till");
{
  // Veckan 2026-08-31 (mandag) till 2026-09-06. Torsdagen ar 3 september.
  ok("torsdagen hittas fran mandagen", veckansTorsdag("2026-08-31") === "2026-09-03");
  ok("torsdagen hittas fran sondagen", veckansTorsdag("2026-09-06") === "2026-09-03");
  ok("torsdagen hittas fran sig sjalv", veckansTorsdag("2026-09-03") === "2026-09-03");

  // HELA VECKAN hor till september, aven mandagen och tisdagen som ligger i
  // augusti. Utan regeln hade veckan raknats i bada manaderna.
  ok("31 augusti hor till september", manadForVecka("2026-08-31") === "2026-09-01");
  ok("1 september hor till september", manadForVecka("2026-09-01") === "2026-09-01");

  // Veckan 2026-08-24 till 08-30 har torsdagen 27 augusti.
  ok("24 augusti hor till augusti", manadForVecka("2026-08-24") === "2026-08-01");
  ok("30 augusti hor till augusti", manadForVecka("2026-08-30") === "2026-08-01");

  ok("hela veckan hamnar i samma manad", ["2026-08-31","2026-09-01","2026-09-02","2026-09-03","2026-09-04","2026-09-05","2026-09-06"].every((d) => manadForVecka(d) === "2026-09-01"));
}

console.log("\nVeckonumret hor till torsdagens ar");
{
  ok("mitt i aret", veckonummer("2026-08-26") === 35, String(veckonummer("2026-08-26")));
  // 1 januari 2027 ar en fredag; dess ISO-vecka har torsdagen 31 december 2026,
  // alltsa vecka 53 i 2026. Ett veckonummer raknat pa datumets eget ar hade
  // sagt vecka 1.
  ok("arsskiftet foljer torsdagen", veckonummer("2027-01-01") === 53, String(veckonummer("2027-01-01")));
}

console.log("\nEn vecka raknas forst nar bada samtalen ar bedomda");
{
  const vecka = [
    samtal("2026-08-24", 90),
    samtal("2026-08-26", 80),
  ];
  ok("tva bedomda samtal ger en fullstandig vecka", veckorFor(vecka, "2026-08-01", POLICY)[0].fullstandig);
  ok("och 170 poang godkanner den", veckorFor(vecka, "2026-08-01", POLICY)[0].godkand);

  // ETT bedomt samtal. Med maxpoang 100 per samtal ar troskeln 160 omojlig, sa
  // veckan hade underkants av ett skal som ar chefens och inte saljarens.
  const halv = [samtal("2026-08-24", 95), samtal("2026-08-26", null)];
  const v = veckorFor(halv, "2026-08-01", POLICY)[0];
  ok("ett bedomt samtal ger INGEN fullstandig vecka", !v.fullstandig);
  ok("och veckan ar varken godkand eller underkand", !v.godkand);
  ok("men bada samtalen syns i veckan", v.samtal.length === 2 && v.bedomda === 1);

  const inget = [samtal("2026-08-24", null), samtal("2026-08-26", null)];
  ok("en obedomd vecka hoppas over", !veckorFor(inget, "2026-08-01", POLICY)[0].fullstandig);
}

console.log("\nTroskeln raknas pa SUMMAN av bada samtalen");
{
  const under = [samtal("2026-08-24", 80), samtal("2026-08-26", 79)];
  ok("159 poang racker inte", !veckorFor(under, "2026-08-01", POLICY)[0].godkand);

  const precis = [samtal("2026-08-24", 80), samtal("2026-08-26", 80)];
  ok("exakt 160 godkanner", veckorFor(precis, "2026-08-01", POLICY)[0].godkand);
}

console.log("\nProcenten och taket");
{
  ok("ingen godkand vecka ger 0 %", kvProcent(0, POLICY) === 0);
  ok("en vecka ger 1,25 %", kvProcent(1, POLICY) === 1.25);
  ok("fyra veckor ger 5 %", kvProcent(4, POLICY) === 5);

  // TAKET GALLER AVEN I EN MANAD MED FEM VECKOR (fraga 32). Den femte godkanda
  // veckan ger ingenting, och det ar avsiktligt.
  ok("fem veckor ger fortfarande 5 %", kvProcent(5, POLICY) === 5);
  ok("sex veckor ger fortfarande 5 %", kvProcent(6, POLICY) === 5);
}

console.log("\nManadens utfall");
{
  const alla = [
    // Vecka 35: godkand.
    samtal("2026-08-24", 90), samtal("2026-08-26", 80),
    // Vecka 34: under troskeln.
    samtal("2026-08-17", 70), samtal("2026-08-19", 60),
    // Vecka 33: halvbedomd, hoppas over.
    samtal("2026-08-10", 100), samtal("2026-08-12", null),
    // Veckan som borjar 31 augusti hor till SEPTEMBER och ska inte med.
    samtal("2026-08-31", 100), samtal("2026-09-02", 100),
  ];

  const m = kvManad(alla, "2026-08-01", POLICY);

  ok("tre veckor i augusti", m.veckor.length === 3, m.veckor.map((v) => v.nummer).join(", "));
  ok("en godkand", m.godkanda === 1);
  ok("tva fullstandigt bedomda", m.bedomda === 2);
  ok("1,25 %", m.procent === 1.25);

  const sep = kvManad(alla, "2026-09-01", POLICY);
  ok("septemberveckan hamnade i september", sep.veckor.length === 1 && sep.godkanda === 1);
  ok("och raknas inte tva ganger", m.veckor.every((v) => v.start !== "2026-08-31"));
}

console.log("\nMaxpoangen och troskeln i procent — kontrollen O4 handlade om");
{
  // Sex omraden som summerar till 100 per samtal, tva samtal per vecka.
  ok("maxpoangen per vecka ar 200", maxpoangPerVecka(KRITERIER, POLICY) === 200);
  ok("troskeln 160 ar 80 %", troskelIProcent(KRITERIER, POLICY) === 80);
  ok("konfigurationen haller", konfigurationsfel(KRITERIER, POLICY) === null);

  // De tva lasningar av O4 som inte valdes, for att visa att kontrollen skiljer
  // dem at. 200 per omrade ger maxpoang 2 400 och troskeln blir meningslos.
  const perOmrade = KRITERIER.map((k) => ({ ...k, max_points: 200 }));
  ok("200 per omrade ger maxpoang 2400", maxpoangPerVecka(perOmrade, POLICY) === 2400);
  ok(
    "och troskeln blir 6,7 %",
    Math.round(troskelIProcent(perOmrade, POLICY) * 10) / 10 === 6.7,
    String(troskelIProcent(perOmrade, POLICY)),
  );

  // En skala dar troskeln ar OMOJLIG. Max 5 poang per omrade ger taket 60.
  const for_lag = KRITERIER.map((k) => ({ ...k, max_points: 5 }));
  ok("max 5 per omrade ger taket 60", maxpoangPerVecka(for_lag, POLICY) === 60);
  ok(
    "och konfigurationen nekas",
    (konfigurationsfel(for_lag, POLICY) ?? "").includes("går inte att nå"),
    konfigurationsfel(for_lag, POLICY) ?? "",
  );
}

console.log("\nSaknad maxpoang ger null, aldrig ett tak raknat pa halva listan");
{
  const halvt = KRITERIER.map((k, i) => (i < 3 ? k : { ...k, max_points: null }));

  // Att summera de tre ifyllda hade gett 55 x 2 = 110, ett tak som ser ratt ut
  // och ar for lagt — och da hade troskeln 160 sett omojlig ut av fel skal.
  ok("maxpoangen ar null", maxpoangPerVecka(halvt, POLICY) === null);
  ok("troskeln i procent ar null", troskelIProcent(halvt, POLICY) === null);
  ok(
    "och felmeddelandet namner omradena",
    (konfigurationsfel(halvt, POLICY) ?? "").includes("Avslut"),
    konfigurationsfel(halvt, POLICY) ?? "",
  );

  const tomt = KRITERIER.map((k) => ({ ...k, active: false }));
  ok("inga aktiva omraden ger ett eget fel", (konfigurationsfel(tomt, POLICY) ?? "").includes("Inga områden"));
}

console.log("\nEtt avstangt omrade raknas inte med");
{
  const utan = KRITERIER.map((k) => (k.id === "k6" ? { ...k, active: false } : k));
  ok("taket sjunker till 180", maxpoangPerVecka(utan, POLICY) === 180);
  ok("men konfigurationen haller anda", konfigurationsfel(utan, POLICY) === null);
}

console.log("\nVersioneringen: reglerna slas upp pa manaden");
{
  const versionerat = [
    { ...POLICY, id: "g", threshold_points: 160, valid_to: "2026-10-01" },
    { ...POLICY, id: "n", threshold_points: 140, valid_from: "2026-10-01", valid_to: null },
  ];

  ok("augusti far den gamla troskeln", gallandePolicy(versionerat, "2026-08-01")?.threshold_points === 160);
  ok("september ocksa", gallandePolicy(versionerat, "2026-09-01")?.threshold_points === 160);
  ok("oktober far den nya", gallandePolicy(versionerat, "2026-10-01")?.threshold_points === 140);
  ok("fore allt finns ingen policy", gallandePolicy(versionerat, "2026-07-01") === null);
}

console.log("\nUtvecklingskurvan raknar SNITT, inte summa");
{
  const rader = [
    // Augusti: tva samtal, omrade k1 far 10 och 14.
    { call_date: "2026-08-24", criterion_id: "k1", points: 10 },
    { call_date: "2026-08-26", criterion_id: "k1", points: 14 },
    // September: ETT samtal, omrade k1 far 15.
    { call_date: "2026-09-07", criterion_id: "k1", points: 15 },
    { call_date: "2026-08-24", criterion_id: "k2", points: 20 },
  ];

  const kurva = kurvaPerOmrade(rader);
  const k1 = kurva.get("k1");

  ok("tva punkter for k1", k1.length === 2);
  ok("aldst forst", k1[0].manad === "2026-08-01" && k1[1].manad === "2026-09-01");

  // SNITT och inte summa: augusti hade fatt 24 och september 15, alltsa en
  // fallande kurva trots att varje samtal blev battre.
  ok("augusti ger snittet 12", k1[0].snitt === 12);
  ok("september ger snittet 15", k1[1].snitt === 15);
  ok("kurvan stiger", k1[1].snitt > k1[0].snitt);
  ok("antalet star med", k1[0].antal === 2 && k1[1].antal === 1);

  ok("varje omrade har sin egen kurva", kurva.get("k2").length === 1);
  ok("omraden utan poang finns inte i kurvan", kurva.get("k6") === undefined);
}

console.log(fel === 0 ? "\n\x1b[32mAllt gront.\x1b[0m\n" : `\n\x1b[31m${fel} fel.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
