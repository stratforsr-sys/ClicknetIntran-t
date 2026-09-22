#!/usr/bin/env node
/**
 * Veckogenomgangen (0066): de fem stegen, paminnelsen och veckolasten.
 *
 *   node --experimental-strip-types tests/genomgang.mjs
 *
 * INGEN DATABAS, av samma skal som upprepningens prov: allt som kan bli fel i
 * en genomgang ar urval och rakning, och bada gar att prova utan en Supabase.
 *
 * TVA KONTROLLER AR DE SOM RAKNAS:
 *
 *   1. "de fem stegen delar ingen rad med varandra utom med flit" — stegen ar
 *      filter over SAMMA rader, och en rad som rakas upp i tva steg far den som
 *      betar av den att undra vilket av dem som gallde. Overlappen ar tillaten
 *      dar den ar avsiktlig (forfallet och vantar), och provad dar den inte ar.
 *
 *   2. "paminnelsen tystnar nar veckan ar bokford" — en paminnelse som star
 *      kvar efter att man gjort saken ar en paminnelse man slutar lasa, och
 *      felet syns bara pa fredagar.
 */
import {
  PAMINN_FRAN_VECKODAG,
  STEG,
  STEG_RAKNAT,
  STEG_LEDTEXT,
  STEG_RUBRIK,
  STEG_TOMTEXT,
  STILLA_DAGAR,
  antalstext,
  arSteg,
  foregaendeSteg,
  forfallet,
  genomgangslage,
  nastaSteg,
  nastaVeckansDagar,
  nastaVeckansNummer,
  nastaVeckansRader,
  senasttext,
  stannadeProjekt,
  stapelandel,
  stegantal,
  totaltAttGaIgenom,
  utanDag,
  vantar,
  veckansDagsblock,
  veckolast,
} from "../src/lib/genomgang.ts";
import { veckodag } from "../src/lib/uppgifter.ts";
import { DAGSTAK, veckonummer } from "../src/lib/kalender.ts";

let fel = 0;
const ok = (namn, villkor, extra = "") => {
  console.log(`  ${villkor ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${namn}${extra ? "  " + extra : ""}`);
  if (!villkor) fel++;
};
const rubrik = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const JAG = "jag";
const ANNAN = "annan";

/** 2026-09-25 ar en fredag. Hela provet raknar fran den. */
const FREDAG = "2026-09-25";
const ONSDAG = "2026-09-23";

let raknare = 0;
const rad = (over = {}) => ({
  id: `u${++raknare}`,
  title: `Uppgift ${raknare}`,
  assignee_id: JAG,
  created_by: JAG,
  project_id: null,
  parent_id: null,
  due_date: null,
  due_time: null,
  starts_on: null,
  estimate_minutes: null,
  priority: 3,
  lage: "ej_paborjad",
  granskare: 0,
  stilla: 0,
  ...over,
});

// Grundantagandena hela provet vilar pa. Gar de sonder ljuger alla nedan.
ok("2026-09-25 ar en fredag", veckodag(FREDAG) === 5);
ok("2026-09-23 ar en onsdag", veckodag(ONSDAG) === 3);

// -----------------------------------------------------------------------------
rubrik("Stegen ar fem, och alla fem ar beskrivna");

ok("STEG har fem varden", STEG.length === 5, STEG.join(", "));
ok(
  "varje steg har en rubrik",
  STEG.every((s) => typeof STEG_RUBRIK[s] === "string" && STEG_RUBRIK[s].length > 0),
);
/**
 * LEDTEXTEN AR ETT KRAV OCH INTE EN UTSMYCKNING. Ett steg utan skal ar ett steg
 * man klickar forbi, och den som lagger till ett sjatte steg ska tvingas
 * formulera varfor det finns innan det gar att bygga.
 */
ok(
  "varje steg har en ledtext som sager VARFOR",
  STEG.every((s) => typeof STEG_LEDTEXT[s] === "string" && STEG_LEDTEXT[s].length > 40),
);
ok(
  "varje steg har en tomtext",
  STEG.every((s) => typeof STEG_TOMTEXT[s] === "string" && STEG_TOMTEXT[s].length > 0),
);
ok("arSteg slapper igenom de fem", STEG.every(arSteg));
ok("arSteg avvisar nagot annat", !arSteg("inkorgen"));

ok("forsta steget har inget foregaende", foregaendeSteg(STEG[0]) === null);
ok("sista steget har inget nasta", nastaSteg(STEG[4]) === null);
ok("kedjan gar hela vagen fram", nastaSteg(nastaSteg(nastaSteg(nastaSteg(STEG[0])))) === STEG[4]);
ok("och hela vagen tillbaka", foregaendeSteg(nastaSteg(STEG[0])) === STEG[0]);

// -----------------------------------------------------------------------------
rubrik("Steg 1 — det som forfallit");

{
  const rader = [
    rad({ due_date: "2026-09-20" }),
    rad({ due_date: "2026-09-18" }),
    rad({ due_date: FREDAG }),
    rad({ due_date: "2026-09-20", lage: "klar" }),
    rad({ due_date: "2026-09-20", assignee_id: ANNAN }),
    rad({ due_date: null }),
  ];
  const ut = forfallet(rader, JAG, FREDAG);

  ok("bara passerade frister rakans", ut.length === 2, `fick ${ut.length}`);
  ok("aldst forst", ut[0].due_date === "2026-09-18");
  ok("en avbockad rad ar inte forsenad", !ut.some((u) => u.lage === "klar"));
  ok("nagon annans rad star inte har", !ut.some((u) => u.assignee_id === ANNAN));
  ok("dagens datum ar inte forfallet", !ut.some((u) => u.due_date === FREDAG));
}

// -----------------------------------------------------------------------------
rubrik("Steg 2 — inkorgen och allt annat utan dag");

{
  const rader = [
    rad({ due_date: null, priority: 1 }),
    rad({ due_date: null, assignee_id: null }),
    rad({ due_date: null, assignee_id: null, created_by: ANNAN }),
    rad({ due_date: FREDAG }),
    rad({ due_date: null, lage: "klar" }),
    rad({ due_date: null, assignee_id: ANNAN, created_by: ANNAN }),
  ];
  const ut = utanDag(rader, JAG);

  ok("mina utan dag OCH min egen inkorg", ut.length === 2, `fick ${ut.length}`);
  ok("hogst prioritet forst", ut[0].priority === 1);
  ok("en rad med dag star inte har", !ut.some((u) => u.due_date));
  ok("en stangd rad star inte har", !ut.some((u) => u.lage === "klar"));
  ok(
    "nagon annans inkorg ar inte min",
    !ut.some((u) => u.assignee_id === null && u.created_by === ANNAN),
  );
}

// -----------------------------------------------------------------------------
rubrik("Steg 3 — det som ligger hos andra");

ok("troskeln ar tre dygn", STILLA_DAGAR === 3);

{
  const rader = [
    rad({ assignee_id: ANNAN, stilla: 9 }),
    rad({ assignee_id: ANNAN, stilla: 4 }),
    rad({ assignee_id: ANNAN, stilla: 2 }),
    rad({ assignee_id: ANNAN, stilla: 9, created_by: ANNAN }),
    rad({ assignee_id: ANNAN, stilla: 9, lage: "klar" }),
    rad({ assignee_id: JAG, stilla: 9 }),
    rad({ assignee_id: null, stilla: 9 }),
  ];
  const ut = vantar(rader, JAG);

  ok("bara det jag lamnat ifran mig", ut.length === 2, `fick ${ut.length}`);
  ok("langst stilla forst", ut[0].stilla === 9);
  ok("under troskeln star inte har", !ut.some((u) => u.stilla < STILLA_DAGAR));
  ok("min egen rad ar inte delegerad", !ut.some((u) => u.assignee_id === JAG));
  ok("en rad i inkorgen ligger inte hos nagon", !ut.some((u) => u.assignee_id === null));

  /**
   * OVERLAPPET MOT STEG 1 AR AVSIKTLIGT OCH PROVAS DARFOR.
   *
   * En uppgift jag delegerat, som dessutom ar forsenad, hor hemma i bada: i det
   * forsta for att fristen gatt ut, i det tredje for att den ligger hos nagon
   * annan. Handlingarna skiljer sig — flytta respektive paminna — och att valja
   * en av dem hade betytt att halva beslutet aldrig stalls.
   */
  const bade = rad({ assignee_id: ANNAN, stilla: 9, due_date: "2026-09-01" });
  ok(
    "en forsenad delegering star i BADE steg 1 och steg 3",
    forfallet([bade], ANNAN, FREDAG).length === 1 && vantar([bade], JAG).length === 1,
  );
}

// -----------------------------------------------------------------------------
rubrik("Steg 4 — projekt som stannat");

{
  const projekt = [
    { id: "p1", name: "Massan", color: "brand", due_date: null, archived_at: null },
    { id: "p2", name: "Avtalen", color: "info", due_date: null, archived_at: null },
    { id: "p3", name: "Tomt", color: "ok", due_date: null, archived_at: null },
    { id: "p4", name: "Gammalt", color: "warn", due_date: null, archived_at: "2026-01-01T00:00:00Z" },
  ];
  const rader = [
    rad({ project_id: "p1" }),
    rad({ project_id: "p2", lage: "klar" }),
    rad({ project_id: "p4" }),
  ];
  const ut = stannadeProjekt(projekt, rader);

  ok("projekt utan oppen uppgift rakans", ut.length === 2, ut.map((p) => p.name).join(", "));
  ok("ett projekt med en oppen uppgift star inte har", !ut.some((p) => p.id === "p1"));
  ok("ett projekt dar allt ar avbockat HAR stannat", ut.some((p) => p.id === "p2"));
  ok("ett projekt utan uppgifter alls har ocksa stannat", ut.some((p) => p.id === "p3"));
  ok("ett arkiverat projekt ar inte stannat, det ar avslutat", !ut.some((p) => p.id === "p4"));
  ok("bokstavsordning", ut[0].name === "Avtalen");
}

// -----------------------------------------------------------------------------
rubrik("Steg 5 — nasta vecka");

{
  const dagar = nastaVeckansDagar(FREDAG);

  ok("sju dagar", dagar.length === 7);
  ok("borjar pa en mandag", veckodag(dagar[0]) === 1, dagar[0]);
  ok("slutar pa en sondag", veckodag(dagar[6]) === 7, dagar[6]);
  ok("det ar NASTA vecka och inte den har", dagar[0] === "2026-09-28");
  ok(
    "veckonumret hor till samma vecka",
    nastaVeckansNummer(FREDAG) === veckonummer(dagar[0]),
    String(nastaVeckansNummer(FREDAG)),
  );

  /**
   * ONSDAGEN OCH FREDAGEN SKA GE SAMMA SVAR. En genomgang som gors pa torsdagen
   * i stallet for fredagen ska planera samma vecka — ett fonster som rullar per
   * dag hade gjort "nasta vecka" till "de sju dagar som kommer", och da hade
   * mandagen forsvunnit ur bilden pa tisdagen.
   */
  ok("onsdag och fredag pekar pa samma vecka", nastaVeckansDagar(ONSDAG)[0] === dagar[0]);

  const rader = [
    rad({ due_date: dagar[0], estimate_minutes: 240 }),
    rad({ due_date: dagar[0], estimate_minutes: 180 }),
    rad({ due_date: dagar[1], estimate_minutes: 60 }),
    rad({ due_date: dagar[1] }),
    rad({ due_date: dagar[0], estimate_minutes: 600, lage: "klar" }),
    rad({ due_date: dagar[0], estimate_minutes: 600, assignee_id: ANNAN }),
    rad({ due_date: FREDAG, estimate_minutes: 600 }),
  ];
  const last = veckolast(rader, JAG, dagar);

  ok("en post per dag", last.length === 7);
  ok("mandagen summerar sina tva rader", last[0].minuter === 420);
  ok("och ar overbokad", last[0].over === true, `${last[0].minuter} > ${DAGSTAK}`);
  ok("tisdagen ar inte overbokad", last[1].over === false);
  ok("en oskattad rad raknas som noll minuter", last[1].minuter === 60);
  ok("men den rakans som oskattad", last[1].oskattade === 1);
  ok("en avbockad rad tynger ingen dag", last[0].antal === 2);
  ok("nagon annans rad tynger inte min dag", last[0].minuter === 420);
  ok("den har veckans rader star utanfor", last.every((d) => d.minuter < 600));
  ok("lordag och sondag ar markta som helg", last[5].helg && last[6].helg);
  ok("mandag ar det inte", !last[0].helg);

  const lista = nastaVeckansRader(rader, JAG, dagar);
  ok("raderna under stapeln ar bara mina och bara oppna", lista.length === 4, `fick ${lista.length}`);
  ok("sorterade pa dag", lista[0].due_date === dagar[0]);

  // --- Dagen som rad, inte som stapel i ett diagram -------------------------
  const block = veckansDagsblock(rader, JAG, dagar);

  ok("ett block per dag", block.length === 7);
  ok("mandagens rader hanger med mandagens last", block[0].rader.length === 2 && block[0].minuter === 420);
  ok("tisdagen har tva rader", block[1].rader.length === 2);
  ok("en tom dag har ett tomt block och forsvinner inte", block[2].rader.length === 0 && block[2].antal === 0);
  /**
   * SUMMAN AV BLOCKENS RADER ==. PLATTA LISTAN. Paret far inte tappa en rad,
   * och det ar precis vad en gruppering pa fel nyckel gor — tyst, och bara for
   * den dag som rakade sta utanfor.
   */
  ok(
    "ingen rad forsvinner i grupperingen",
    block.reduce((s, d) => s + d.rader.length, 0) === lista.length,
  );

  // --- Stapelns hojd --------------------------------------------------------
  ok("en tom dag ritas som noll", stapelandel(block[2]) === 0);
  ok("en overbokad dag klipps vid hundra", stapelandel(block[0]) === 100);
  ok("en halv dag ar femtio procent", stapelandel({ minuter: 180, tak: DAGSTAK }) === 50);
  /**
   * GOLVET PA TVA PROCENT. Utan det ritas en tjugominutersdag som exakt
   * ingenting — alltsa likadant som en tom dag — och skillnaden mellan "inget
   * planerat" och "nagot litet planerat" ar hela poangen med att titta.
   */
  ok("en kort dag syns anda", stapelandel({ minuter: 5, tak: DAGSTAK }) === 2);
}

// -----------------------------------------------------------------------------
rubrik("Rakningen som bar kortet och klockan");

{
  const dagar = nastaVeckansDagar(FREDAG);
  const projekt = [{ id: "p1", name: "Tomt", color: "brand", due_date: null, archived_at: null }];
  const rader = [
    rad({ due_date: "2026-09-01" }),
    rad({ due_date: null }),
    rad({ assignee_id: ANNAN, stilla: 8 }),
    rad({ due_date: dagar[0], estimate_minutes: 500 }),
  ];
  const antal = stegantal(rader, projekt, JAG, FREDAG);

  ok("ett tal per steg", STEG.every((s) => typeof antal[s] === "number"));
  ok("forfallet: 1", antal.forfallet === 1);
  ok("utan dag: 1", antal.utanDag === 1);
  ok("vantar: 1", antal.vantar === 1);
  ok("stannade projekt: 1", antal.projekt === 1);
  /**
   * DET FEMTE TALET RAKNAR DAGAR OCH INTE RADER, och det ar medvetet — en dag
   * med nio timmar planerat ar ett problem oavsett om det ar tva uppgifter
   * eller elva. Provet star har for att skillnaden ska vara ett beslut nasta
   * gang nagon laser summan och tycker att den ser fel ut.
   */
  ok("nasta vecka: 1 overbokad DAG, inte 1 rad", antal.nastaVecka === 1);
  ok("summan ar fem", totaltAttGaIgenom(antal) === 5);

  /**
   * TEXTEN SOM STAR EFTER TALEN ar en egen strang och inte rubriken i gemener.
   * "6 inkorgen" och "1 nasta vecka" ar inte svenska, och bada raderna gick ut
   * i kortet pa /uppgifter OCH i klockan innan den har kontrollen fanns.
   */
  const text = antalstext(antal);
  ok("raknetexten boejer ental", text.includes("1 förfallen"), text);
  ok("och namner inte rubriken rakt av", !text.includes("Inkorgen") && !text.includes("Nästa vecka"), text);
  ok("stannat projekt i ental", text.includes("1 stannat projekt"), text);
  ok("overbokad dag i ental", text.includes("1 överbokad dag"), text);
  ok("tomma steg star inte med", antalstext({ ...antal, vantar: 0 }).includes("väntar") === false);
  ok("allt tomt ger tom strang", antalstext({ forfallet: 0, utanDag: 0, vantar: 0, projekt: 0, nastaVecka: 0 }) === "");

  const flera = antalstext({ forfallet: 3, utanDag: 0, vantar: 0, projekt: 2, nastaVecka: 2 });
  ok("flertal boejs", flera === "3 förfallna · 2 stannade projekt · 2 överbokade dagar", flera);

  ok(
    "varje steg har bade ental och flertal",
    STEG.every((s) => STEG_RAKNAT[s].length === 2 && STEG_RAKNAT[s].every((x) => x.length > 0)),
  );
}

// -----------------------------------------------------------------------------
rubrik("Paminnelsen");

ok("tands pa fredagen", PAMINN_FRAN_VECKODAG === 5);

{
  const mandag = "2026-09-21";
  const tisdag = "2026-09-22";
  const sondag = "2026-09-27";
  const forraVeckan = "2026-09-14";

  ok("veckan ar mandagen", genomgangslage(FREDAG, null).vecka === mandag);

  ok("tisdag sager inte till", genomgangslage(tisdag, null).dagsFor === false);
  ok("fredag sager till", genomgangslage(FREDAG, null).dagsFor === true);
  ok("lordag och sondag ocksa", genomgangslage(sondag, null).dagsFor === true);

  /**
   * DEN KONTROLL SOM RAKNAS. En paminnelse som star kvar sedan saken ar gjord
   * ar en paminnelse man slutar lasa — och felet gar bara att se pa en fredag,
   * alltsa en dag av sju.
   */
  ok("bokford vecka tystar fredagen", genomgangslage(FREDAG, mandag).dagsFor === false);
  ok("och raknas som gjord", genomgangslage(FREDAG, mandag).gjord === true);
  ok("forra veckans kvitto tystar inte den har", genomgangslage(FREDAG, forraVeckan).dagsFor === true);

  ok("aldrig gjord ger null", genomgangslage(FREDAG, null).veckorSedan === null);
  ok("samma vecka ger noll", genomgangslage(FREDAG, mandag).veckorSedan === 0);
  ok("forra veckan ger ett", genomgangslage(FREDAG, forraVeckan).veckorSedan === 1);

  /**
   * ETT KVITTO SKRIVET PA EN MANDAG FOR FORRA VECKAN. `week_start` och inte
   * `completed_at` ar hela skillnaden: hade dagen hon klickade rakants hade
   * den har veckan sett bokford ut.
   */
  ok(
    "en genomgang gjord pa mandagen galler den vecka den gallde",
    genomgangslage(mandag, forraVeckan).gjord === false,
  );

  ok("texten sager aldrig noll veckor", senasttext(genomgangslage(FREDAG, mandag)) === "Gjord den här veckan");
  ok("aldrig gjord har en egen text", senasttext(genomgangslage(FREDAG, null)) === "Aldrig gjord");
  ok("forra veckan har en egen text", senasttext(genomgangslage(FREDAG, forraVeckan)) === "Gjord förra veckan");
  ok(
    "tre veckor raknas ut",
    senasttext(genomgangslage(FREDAG, "2026-08-31")) === "3 veckor sedan",
    senasttext(genomgangslage(FREDAG, "2026-08-31")),
  );
}

// -----------------------------------------------------------------------------
rubrik("Tomma listor faller inte");

{
  const antal = stegantal([], [], JAG, FREDAG);
  ok("alla steg ar noll", totaltAttGaIgenom(antal) === 0);
  ok("veckolasten har anda sju dagar", veckolast([], JAG, nastaVeckansDagar(FREDAG)).length === 7);
  ok("och ingen dag ar overbokad", veckolast([], JAG, nastaVeckansDagar(FREDAG)).every((d) => !d.over));
}

// -----------------------------------------------------------------------------
console.log(fel === 0 ? "\n\x1b[32mAlla prov gick igenom.\x1b[0m\n" : `\n\x1b[31m${fel} prov foll.\x1b[0m\n`);
process.exit(fel === 0 ? 0 : 1);
