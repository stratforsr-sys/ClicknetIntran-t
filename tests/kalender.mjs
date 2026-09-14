#!/usr/bin/env node
/**
 * Kalendern (pass 2): nivåerna, rutnätet, utläggningen, dagssumman och plinget.
 *
 *   node --experimental-strip-types tests/kalender.mjs
 *
 * Behörigheten provas mot riktiga databasen i tests/rls.mjs — det är där
 * `kalender_niva()` och `kalender_poster()` hör hemma, eftersom de är SQL.
 *
 * HÄR PROVAS DET SOM INTE SYNS NÄR DET ÄR FEL. Två saker i filen har den
 * egenskapen, och de får därför mest utrymme:
 *
 *   1. `laggUt()`. En krock som ritas ovanpå en annan post SER PRYDLIG UT. Att
 *      kalendern döljer att man lovat två saker samma timme är precis det fel
 *      man öppnar den för att slippa, och det syns inte förrän klockan är
 *      fjorton och man sitter i fel samtal.
 *
 *   2. `dagssumma()`. "Planerat 4 h av 6 h" är ett tal man fattar beslut på. Är
 *      det räknat på gissningar i stället för på uppskattningar är det fel åt
 *      samma håll varje dag, och då slutar man tro på det — utan att någonsin
 *      kunna peka på vad som är trasigt.
 */
import {
  DAGSTAK,
  DAG_SLUT,
  DAG_START,
  DELNINGSNIVAER,
  GRUNDNIVA,
  KALENDERSLAG,
  NIVA_ETIKETT,
  NIVA_FORKLARING,
  PLING_VARSEL_MINUTER,
  RUTA,
  SLAG_ETIKETT,
  SLAG_TON,
  STANDARDLANGD,
  arDelningsniva,
  arHelg,
  arTidsatt,
  attPlinga,
  dagKort,
  dagPlus,
  dagarMellan,
  dagrubrik,
  dagssumma,
  farArbetaSomAgaren,
  farPlaneraOm,
  heldagsposter,
  iDygnet,
  langd,
  laggUt,
  minuterTillTid,
  nivaMinst,
  plingtext,
  rutor,
  serDetaljer,
  serRubrik,
  slut,
  snappa,
  start,
  tidTillMinuter,
  utanforDygnet,
  veckansDagar,
  veckodag,
  veckonummer,
  veckostart,
} from "../src/lib/kalender.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** En måndag. Veckoproven behöver en känd veckostart. */
const IDAG = "2026-09-14";

const post = (over = {}) => ({
  id: "p1",
  slag: "uppgift",
  ref: "u1",
  employee_id: "jag",
  dag: IDAG,
  tid: null,
  minuter: null,
  rubrik: "Ring Nordic",
  href: "/uppgifter/u1",
  flyttbar: true,
  forsenad: false,
  klar: false,
  ...over,
});

// =============================================================================
rubrik("Delningsnivåerna");
// =============================================================================

ok("fem nivåer, varken fler eller färre", DELNINGSNIVAER.length === 5, DELNINGSNIVAER.join(", "));
ok("grundläget är den lägsta", GRUNDNIVA === DELNINGSNIVAER[0]);
ok(
  "varje nivå har etikett och förklaring",
  DELNINGSNIVAER.every((n) => NIVA_ETIKETT[n] && NIVA_FORKLARING[n]),
);

ok("stigande ordning", nivaMinst("delegat", "upptagen") && nivaMinst("detaljer", "rubriker"));
ok("inte fallande", !nivaMinst("rubriker", "detaljer"));
ok("null når ingenstans", !nivaMinst(null, "upptagen"));

/**
 * DEN VIKTIGASTE RADEN I PROVET.
 *
 * Grundläget får aldrig visa en rubrik. Går den här sönder läcker varje
 * kollegas uppgiftsrubriker till hela huset utan att någon rör en policy —
 * `kalender_poster()` i 0057 bygger sin projektion på precis den här gränsen.
 */
ok("grundläget ser INGEN rubrik", serRubrik(GRUNDNIVA) === false);
ok("grundläget öppnar ingen uppgift", serDetaljer(GRUNDNIVA) === false);
ok("'rubriker' ser rubriken men inte raden", serRubrik("rubriker") && !serDetaljer("rubriker"));
ok("'detaljer' öppnar raden", serDetaljer("detaljer"));

ok("bara nivå fyra och fem får planera om", !farPlaneraOm("detaljer") && farPlaneraOm("redigera") && farPlaneraOm("delegat"));
ok("bara delegaten arbetar som ägaren", !farArbetaSomAgaren("redigera") && farArbetaSomAgaren("delegat"));
ok("ingen nivå alls ger ingenting", !serRubrik(null) && !farPlaneraOm(null) && !farArbetaSomAgaren(null));

ok("okända strängar känns inte igen", !arDelningsniva("chef") && !arDelningsniva(null) && !arDelningsniva(4));
ok("alla fem känns igen", DELNINGSNIVAER.every(arDelningsniva));

// =============================================================================
rubrik("Klockslag och rutnät");
// =============================================================================

ok("14:30 blir 870", tidTillMinuter("14:30") === 870);
ok("sekunder i svansen stör inte", tidTillMinuter("09:05:00") === 545);
ok("null ger null", tidTillMinuter(null) === null && tidTillMinuter("") === null);
ok("skräp ger null", tidTillMinuter("halv tre") === null && tidTillMinuter("25:00") === null);
ok("870 blir 14:30", minuterTillTid(870) === "14:30");
ok("noll blir 00:00", minuterTillTid(0) === "00:00");
ok("över dygnet klipps", minuterTillTid(2000) === "23:59");

ok("fönstret börjar 06:00", minuterTillTid(DAG_START) === "06:00");
ok("fönstret slutar 20:00", minuterTillTid(DAG_SLUT) === "20:00");
ok("rutorna täcker fönstret", rutor().length === (DAG_SLUT - DAG_START) / RUTA);
ok("första rutan är dagens start", rutor()[0] === DAG_START);
ok("sista rutan slutar vid fönstrets kant", rutor()[rutor().length - 1] + RUTA === DAG_SLUT);

ok("snappning drar till närmaste halvtimme", snappa(9 * 60 + 8) === 9 * 60 && snappa(9 * 60 + 20) === 9 * 60 + 30);
ok("snappning går aldrig före fönstret", snappa(60) === DAG_START);
ok("snappning går aldrig förbi sista rutan", snappa(23 * 60) === DAG_SLUT - RUTA);

// =============================================================================
rubrik("Posternas geometri");
// =============================================================================

ok("heldagspost är inte tidsatt", !arTidsatt(post()) && arTidsatt(post({ tid: "09:00" })));
ok("heldagspost har ingen start", start(post()) === -1 && slut(post()) === -1);
ok("uppskattningen styr höjden", slut(post({ tid: "09:00", minuter: 90 })) - start(post({ tid: "09:00", minuter: 90 })) === 90);

/**
 * En uppgift utan uppskattning ritas i `STANDARDLANGD`, och det talet skrivs
 * ALDRIG till `estimate_minutes`. Skillnaden syns i dagssumman nedan: den här
 * posten är trettio minuter hög och noll minuter planerad.
 */
ok(
  "utan uppskattning ritas standardlängden",
  slut(post({ tid: "09:00" })) - start(post({ tid: "09:00" })) === STANDARDLANGD,
);
ok(
  "en post kortare än en ruta ritas ändå en ruta hög",
  slut(post({ tid: "09:00", minuter: 5 })) - start(post({ tid: "09:00", minuter: 5 })) === RUTA,
);

{
  const poster = [
    post({ id: "a", tid: "05:00" }),
    post({ id: "b", tid: "09:00" }),
    post({ id: "c", tid: "21:00" }),
    post({ id: "d", tid: null }),
  ];
  ok("i dygnet: bara den inom fönstret", iDygnet(poster).map((p) => p.id).join() === "b");
  ok("utanför dygnet: de två i kanterna", utanforDygnet(poster).map((p) => p.id).join() === "a,c");
  ok("heldag: den utan klockslag", heldagsposter(poster).map((p) => p.id).join() === "d");
}

{
  // Heldagsraden sorteras efter hur mycket posten styr dagen, inte efter namn.
  const blandat = [post({ id: "u", slag: "uppgift" }), post({ id: "f", slag: "franvaro" }), post({ id: "k", slag: "kurs" })];
  ok("ledighet står först bland heldagsposterna", heldagsposter(blandat)[0].id === "f");
  ok("uppgiften står sist", heldagsposter(blandat).at(-1).id === "u");
}

ok("varje slag har etikett och ton", KALENDERSLAG.every((s) => SLAG_ETIKETT[s] && SLAG_TON[s]));

// =============================================================================
rubrik("Utläggningen — krockar får INTE döljas");
// =============================================================================

{
  const ensam = laggUt([post({ id: "a", tid: "09:00", minuter: 60 })]);
  ok("en ensam post tar hela bredden", ensam.length === 1 && ensam[0].spalter === 1 && ensam[0].spalt === 0);
}

{
  // Två poster som inte rör varandra ska INTE dela bredd. Gör de det ser dagen
  // dubbelt så trång ut som den är.
  const efter = laggUt([
    post({ id: "a", tid: "09:00", minuter: 60 }),
    post({ id: "b", tid: "11:00", minuter: 60 }),
  ]);
  ok("två poster efter varandra tar full bredd var", efter.every((p) => p.spalter === 1));
}

{
  const krock = laggUt([
    post({ id: "a", tid: "09:00", minuter: 60 }),
    post({ id: "b", tid: "09:30", minuter: 60 }),
  ]);
  ok("en krock ger två spalter", krock.every((p) => p.spalter === 2));
  ok("de hamnar i olika spalter", new Set(krock.map((p) => p.spalt)).size === 2);
  ok("ingen post försvann", krock.length === 2);
}

{
  const tre = laggUt([
    post({ id: "a", tid: "09:00", minuter: 120 }),
    post({ id: "b", tid: "09:30", minuter: 30 }),
    post({ id: "c", tid: "09:45", minuter: 30 }),
  ]);
  ok("tre som verkligen krockar ger tre spalter", tre.every((p) => p.spalter === 3), tre.map((p) => `${p.id}:${p.spalt}`).join(" "));
  ok("alla tre ritas", tre.length === 3);
}

{
  /**
   * SPALTEN ÅTERANVÄNDS NÄR DEN BLIVIT LEDIG, och det är inte en optimering
   * utan skillnaden mellan en läsbar dag och tre nålar bredvid varandra.
   *
   * a 09:00–11:00, b 09:30–10:00, c 10:00–10:30: b och c krockar INTE med
   * varandra, bara med a. Klungan är alltså tvåspaltig, och c ärver b:s spalt.
   * En algoritm som i stället räknar "tre poster i klungan = tre spalter" hade
   * gjort varje post en tredjedel bred utan att någon minut var trippelbokad.
   *
   * Provet stod först här med förväntan tre — och hade det fått gälla vore
   * felet omöjligt att se i vyn: tre smala rutor ser ut som ett designval.
   */
  const staffel = laggUt([
    post({ id: "a", tid: "09:00", minuter: 120 }),
    post({ id: "b", tid: "09:30", minuter: 30 }),
    post({ id: "c", tid: "10:00", minuter: 30 }),
  ]);
  ok("bara två spalter behövs", staffel.every((p) => p.spalter === 2), staffel.map((p) => `${p.id}:${p.spalt}`).join(" "));
  ok("c ärver b:s spalt", staffel.find((p) => p.id === "c").spalt === staffel.find((p) => p.id === "b").spalt);
}

{
  /**
   * SPALTANTALET RÄKNAS PER KLUNGA. En krock klockan nio ska inte göra hela
   * dagen tvåspaltig — eftermiddagens ensamma post har ingen den krockar med.
   */
  const blandat = laggUt([
    post({ id: "a", tid: "09:00", minuter: 60 }),
    post({ id: "b", tid: "09:30", minuter: 60 }),
    post({ id: "c", tid: "15:00", minuter: 60 }),
  ]);
  const c = blandat.find((p) => p.id === "c");
  ok("eftermiddagens ensamma post är enspaltig", c.spalter === 1, `blev ${c.spalter}`);
  ok("förmiddagens två är tvåspaltiga", blandat.filter((p) => p.id !== "c").every((p) => p.spalter === 2));
}

{
  /**
   * Två poster som slutar respektive börjar på exakt samma minut KROCKAR INTE.
   * 09:00–10:00 och 10:00–11:00 är efter varandra, inte samtidigt, och en vy
   * som halverar bredden där tar halva utrymmet av två poster i onödan.
   */
  const kant = laggUt([
    post({ id: "a", tid: "09:00", minuter: 60 }),
    post({ id: "b", tid: "10:00", minuter: 60 }),
  ]);
  ok("kant mot kant är ingen krock", kant.every((p) => p.spalter === 1));
}

{
  const utanfor = laggUt([post({ id: "a", tid: "05:00", minuter: 60 }), post({ id: "b", tid: null })]);
  ok("utläggningen rör bara poster inne i fönstret", utanfor.length === 0);
}

// =============================================================================
rubrik("Dagssumman — talet man fattar beslut på");
// =============================================================================

{
  const summa = dagssumma([
    post({ id: "a", tid: "09:00", minuter: 120 }),
    post({ id: "b", tid: "13:00", minuter: 120 }),
  ]);
  ok("fyra timmar planerat", summa.minuter === 240 && langd(summa.minuter) === "4 h");
  ok("taket är sex timmar", summa.tak === DAGSTAK && langd(summa.tak) === "6 h");
  ok("fyra av sex är inte över", summa.over === false);
}

{
  const summa = dagssumma([post({ tid: "08:00", minuter: 400 })]);
  ok("över taket flaggas", summa.over === true);
}

{
  /** Gissningen får inte smyga in i talet. Se rubriken överst. */
  const summa = dagssumma([post({ id: "a", tid: "09:00", minuter: 60 }), post({ id: "b", tid: "11:00" })]);
  ok("oskattad post räknas som noll minuter", summa.minuter === 60, `blev ${summa.minuter}`);
  ok("men den räknas som en uppgift", summa.antal === 2);
  ok("och den syns som oskattad", summa.oskattade === 1);
}

{
  const summa = dagssumma([
    post({ id: "a", tid: "09:00", minuter: 60 }),
    post({ id: "b", tid: "10:00", minuter: 60, klar: true }),
    post({ id: "c", slag: "franvaro", minuter: 240 }),
    post({ id: "d", slag: "coachning" }),
    post({ id: "e", slag: "kurs" }),
    post({ id: "f", slag: "order" }),
  ]);
  ok("avbockat räknas inte", summa.antal === 1);
  ok("ledighet är inte planerat arbete", summa.minuter === 60, `blev ${summa.minuter}`);
}

ok("tom dag ger noll och ingen ruta", dagssumma([]).antal === 0 && dagssumma([]).minuter === 0);

ok("längder skrivs kort", langd(30) === "30 min" && langd(60) === "1 h" && langd(90) === "1 h 30 min");

// =============================================================================
rubrik("Datum och veckor");
// =============================================================================

ok("2026-09-14 är en måndag", veckodag(IDAG) === 1);
ok("veckostart är dagen själv på en måndag", veckostart(IDAG) === IDAG);
ok("veckostart backar från en torsdag", veckostart("2026-09-17") === IDAG);
ok("veckan har sju dagar", veckansDagar(IDAG).length === 7);
ok("veckan börjar på måndag och slutar på söndag", veckansDagar(IDAG)[0] === IDAG && veckansDagar(IDAG)[6] === "2026-09-20");

ok("dagPlus över månadsskifte", dagPlus("2026-09-30", 1) === "2026-10-01");
ok("dagPlus bakåt över årsskifte", dagPlus("2027-01-01", -1) === "2026-12-31");
ok("dagarMellan räknar dygn", dagarMellan(IDAG, "2026-09-20") === 6);

ok("helg är lördag och söndag", arHelg("2026-09-19") && arHelg("2026-09-20") && !arHelg("2026-09-18"));

/**
 * Torsdagsregeln. Utan den blir nyårsveckan fel vartannat år — och ett
 * veckonummer som är fel en vecka om året litar ingen på resten heller.
 */
ok("vecka 38 år 2026", veckonummer(IDAG) === 38, `blev ${veckonummer(IDAG)}`);
ok("2027-01-01 är en fredag i vecka 53", veckonummer("2027-01-01") === 53, `blev ${veckonummer("2027-01-01")}`);
ok("2026-01-01 ligger i vecka 1", veckonummer("2026-01-01") === 1, `blev ${veckonummer("2026-01-01")}`);

ok("idag heter Idag", dagrubrik(IDAG, IDAG) === "Idag");
ok("i morgon heter I morgon", dagrubrik("2026-09-15", IDAG) === "I morgon");
ok("i går heter I går", dagrubrik("2026-09-13", IDAG) === "I går");
ok("längre bort får veckodag och datum", dagrubrik("2026-09-18", IDAG) === "Fredag 18 sep");
ok("kort form för veckovyn", dagKort(IDAG) === "mån 14 sep");

// =============================================================================
rubrik("Plinget");
// =============================================================================

{
  const nio = 9 * 60;
  const poster = [
    post({ id: "strax", tid: "09:05" }),
    post({ id: "nu", tid: "09:00" }),
    post({ id: "sent", tid: "09:30" }),
    post({ id: "passerad", tid: "08:50" }),
    post({ id: "imorgon", tid: "09:05", dag: "2026-09-15" }),
    post({ id: "klar", tid: "09:05", klar: true }),
    post({ id: "heldag", tid: null }),
  ];

  const traffar = attPlinga(poster, IDAG, nio).map((p) => p.id);

  ok("fem minuter fram plingar", traffar.includes("strax"));
  ok("exakt nu plingar", traffar.includes("nu"));
  ok(`mer än ${PLING_VARSEL_MINUTER} min fram plingar inte`, !traffar.includes("sent"));

  /**
   * DEN HÄR ÄR HELA SKÄLET ATT FÖNSTRET HAR BÅDA ÄNDARNA. En kontroll som bara
   * frågar "är det mindre än tio minuter kvar" ger ett negativt tal för allt som
   * passerat, och då plingar hela förmiddagen igen varje gång någon öppnar en
   * flik efter lunch.
   */
  ok("passerad tid plingar INTE", !traffar.includes("passerad"));

  ok("en annan dag plingar inte", !traffar.includes("imorgon"));
  ok("avbockat plingar inte", !traffar.includes("klar"));
  ok("heldagspost plingar inte", !traffar.includes("heldag"));
  ok("exakt två träffar, och inga fler", traffar.length === 2, traffar.join(", "));
}

ok("plingtexten säger Nu när tiden är inne", plingtext(post({ tid: "09:00" }), 9 * 60).startsWith("Nu"));
ok(
  "plingtexten räknar ned",
  plingtext(post({ tid: "09:10", minuter: 30 }), 9 * 60) === "Om 10 min · 09:10 · 30 min",
  plingtext(post({ tid: "09:10", minuter: 30 }), 9 * 60),
);

console.log(fel === 0 ? "\n\x1b[32mAlla kontroller gick igenom.\x1b[0m" : `\n\x1b[31m${fel} fel.\x1b[0m`);
process.exit(fel === 0 ? 0 : 1);
