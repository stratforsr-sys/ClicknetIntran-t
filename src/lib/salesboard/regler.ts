/**
 * Säljtavlans regler: namn och monogram, ljudmotiv, tröskeln för stor affär,
 * efterregistrerade order, de tysta tiderna och planeringen av vad som firas.
 *
 * Ren logik utan anrop och utan Next, så att den går att prova med node (se
 * `tests/salesboard.mjs`). Servern och klienten använder samma funktioner, och
 * därför importeras allt här relativt med `.ts`-ändelse.
 */

import { svensktDatum, svenskaMinuter } from "../klocka.ts";
import { dagarTill } from "../order.ts";
import { arArbetsdag } from "../saljtakt.ts";
import type { Namnform, Ogonblick, TavleHandelse, TavleOrder, TavlansInstallningar, Testtyp, Visning } from "./typer.ts";

// -----------------------------------------------------------------------------
// Namn och monogram
// -----------------------------------------------------------------------------

const DOLT_NAMN = "En säljare";
const DOLT_MONOGRAM = "·";

/**
 * Är säljaren dold? Bara de två uttryckliga valen "namn" och "initialer" visar något.
 * Allt annat är dolt: null, ett stavfel, en form som lagts till senare, ett värde ur
 * databasen som inte är en `Visning`.
 *
 * ===========================================================================
 * DET HÄR ÄR DET ENDA STÄLLET SOM AVGÖR DET.
 *
 * Den som bygger ögonblicksbilden (`byggTavlan`) ska fråga den här för att ge en dold
 * säljare `dold: true`, och inte jämföra med "dold" själv. Med `visning === "dold"`
 * skulle ett skräpvärde dölja namnet (namnfunktionerna nedan felar åt det dolda
 * hållet) men ändå ge säljaren en rad i topplistan och sin första order på tavlan.
 * ===========================================================================
 */
export function arDold(visning: unknown): boolean {
  return visning !== "namn" && visning !== "initialer";
}

/**
 * Ett namn utan blanka tecken runt och sammansatt (NFC). Det som inte är en sträng
 * räknas som tomt: ett `null` ur en felaktig sammanfogning får inte fälla bilden.
 *
 * NFC gör att ett Å som skrivits som A + kombinerande ring är ett Å. Utan det hade
 * första bokstaven blivit ett A, och monogrammet fel.
 */
function rensa(namn: unknown): string {
  return typeof namn === "string" ? namn.normalize("NFC").trim() : "";
}

/** Första bokstaven som versal, eller en tom sträng om namnet är tomt. */
function forstaBokstav(namn: string): string {
  const [bokstav = ""] = rensa(namn).toLocaleUpperCase("sv-SE");
  return bokstav;
}

/**
 * Namnet så som tavlan skriver det.
 *
 * ===========================================================================
 * SÄLJARENS EGET VAL GÅR FÖRE TAVLANS NAMNFORM, OCH "DOLD" GÅR FÖRE ALLT.
 *
 * Namnformen (`form`) gäller bara dem som visas med namn. Den som valt
 * initialer heter "A. H." i alla former, och den som valt att inte synas heter
 * "En säljare" hur tavlan än är inställd. Ingen del av det dolda namnet får
 * följa med, varken förnamnet eller en initial.
 *
 * Det är servern som ska anropa den här när ögonblicksbilden byggs, så att det
 * riktiga namnet aldrig lämnar den (se `typer.ts`). Att dölja i ritningen hade
 * inte räckt: då hade namnet funnits i JSON-svaret.
 *
 * FELET GÅR ÅT DET DOLDA HÅLLET. `arDold` avgör: bara de två uttryckliga valen
 * "namn" och "initialer" visar något. Allt annat (null, ett stavfel, en form som
 * lagts till senare, ett värde ur databasen som inte är en `Visning`) är dolt, så
 * att ett fel aldrig kan lämna ut en säljare som bett om att få vara dold.
 * ===========================================================================
 *
 * Ett tomt efternamn ger bara förnamnet, utan punkt och utan hängande mellanslag.
 * Blir hela namnet tomt (inga namn alls, eller bara ett efternamn med formen
 * "fornamn") gäller den dolda texten: en tom rad på en TV ser ut som ett fel.
 */
export function visningsnamn(fornamn: string, efternamn: string, form: Namnform, visning: Visning): string {
  if (arDold(visning)) return DOLT_NAMN;

  const f = rensa(fornamn);
  const e = rensa(efternamn);

  if (visning === "initialer") {
    const initialer = [forstaBokstav(f), forstaBokstav(e)]
      .filter(Boolean)
      .map((bokstav) => `${bokstav}.`)
      .join(" ");
    return initialer || DOLT_NAMN;
  }

  const delar = form === "fornamn" ? [f] : form === "hela" ? [f, e] : [f, e && `${forstaBokstav(e)}.`];
  return delar.filter(Boolean).join(" ") || DOLT_NAMN;
}

/**
 * Monogrammet i cirkeln: "AH". Den som valt initialer har samma monogram som den
 * som visas med namn, och den som är dold får en neutral punkt.
 *
 * Samma fel åt samma håll som `visningsnamn` (`arDold` avgör): bara "namn" och
 * "initialer" visar bokstäver, och inga bokstäver alls ger den neutrala punkten.
 */
export function initialerFor(fornamn: string, efternamn: string, visning: Visning): string {
  if (arDold(visning)) return DOLT_MONOGRAM;
  return forstaBokstav(fornamn) + forstaBokstav(efternamn) || DOLT_MONOGRAM;
}

// -----------------------------------------------------------------------------
// Vem som kan stå i topplistan
// -----------------------------------------------------------------------------

/** Anställda med de här statusarna är aktiva (som Golvet och inställningarnas kort). */
export const AKTIVA_STATUSAR = ["active", "onboarding"] as const;

/**
 * Rollerna som kan sälja: samma tre som orderformuläret väljer säljare bland
 * (`SALJANDE_ROLLER` i src/lib/nav2/order.ts och på /order, som inte exporterar
 * sin). Provet läser den filen och håller de två i takt (R30).
 */
export const SALJANDE_ROLLER: ReadonlySet<string> = new Set(["salesperson", "sales_manager", "ceo"]);

// -----------------------------------------------------------------------------
// Stor affär
// -----------------------------------------------------------------------------

/**
 * Så många godkända order krävs i underlaget innan "auto" litar på percentilen.
 * Exporterad för `troskelFranStatistik` i `forma.ts`, som räknar p90 i databasen.
 */
export const MINSTA_UNDERLAG = 20;

/** Tröskeln när underlaget är för litet: specens 30 000 kr. Exporterad av samma skäl. */
export const RESERV_TROSKEL = 30_000;

/**
 * 90:e percentilen med linjär interpolering, som `percentile_cont(0.9)`.
 *
 * Positionen 0,9 × (n − 1) räknas i heltal, som 9 × (n − 1) delat med tio, och
 * inte i flyttal. 0,9 × 99 blir 89,10000000000001 och ger 90 100,00000000001
 * där Postgres ger 90 100.
 *
 * Förutsätter minst två värden. `storAffarTroskel` kräver tjugo.
 */
function percentil90(varden: number[]): number {
  const sorterade = [...varden].sort((a, b) => a - b);
  const steg = 9 * (sorterade.length - 1);
  const under = Math.floor(steg / 10);
  const tiondelar = steg % 10;

  return sorterade[under] + ((sorterade[under + 1] - sorterade[under]) * tiondelar) / 10;
}

/**
 * Ordervärdet från vilket en order är en stor affär.
 *
 * "Auto" är 90:e percentilen av de senaste 90 dagarnas godkända ordervärden
 * ("topp 10 %"), men först när det finns minst 20. En percentil av nitton order
 * är ett par enstaka affärer som råkade ligga överst, och gränsen hade flyttat
 * sig från vecka till vecka. Före dess gäller 30 000 kr, och det oavsett det
 * fasta beloppet: det hör till läget "belopp".
 *
 * `varden` rörs inte. Percentilen sorteras på en kopia.
 */
export function storAffarTroskel(varden: number[], val: TavlansInstallningar["firande"]["storAffar"]): number {
  if (val.lage === "belopp") return val.belopp;
  if (varden.length < MINSTA_UNDERLAG) return RESERV_TROSKEL;
  return percentil90(varden);
}

// -----------------------------------------------------------------------------
// Efterregistrerade order
// -----------------------------------------------------------------------------

/**
 * Signerades ordern så långt före godkännandet att den räknas men inte firas?
 *
 * "Mer än `dagar` dagar": exakt N dagar firas fortfarande. Datan visar att order
 * ofta läggs in en vecka i efterhand, och tavlan ska inte fira i klump när
 * någon tar igen pappersarbetet. En order utan signeringsdatum firas som vanligt.
 *
 * Dagarna är kalenderdagar mellan två datum. `dagarTill` räknar mitt på dagen i
 * UTC, så att varken sommartid eller serverns zon kan göra två dygn till något
 * annat.
 */
export function arEfterregistrerad(signedOn: string | null, godkandDag: string, dagar: number): boolean {
  if (!signedOn) return false;
  return dagarTill(godkandDag, signedOn) > dagar;
}

// -----------------------------------------------------------------------------
// Tysta tider
//
// ===========================================================================
// KLOCKAN OCH DAGEN ÄR SVENSKA, INTE SERVERNS.
//
// Vercel står i UTC. `ljudTillatet` och `inomArbetsdag` får därför aldrig fråga
// `Date` om timme eller veckodag: klockslaget och dagen räknas ut mot
// `Europe/Stockholm` (`klocka.ts`), och helger och röda dagar kommer från
// `arArbetsdag`, samma kalender som takten räknar på. Julafton, midsommarafton
// och nyårsafton är lediga där, och därmed tysta här.
// ===========================================================================
// -----------------------------------------------------------------------------

/** Svensk dag och svenska minuter sedan midnatt, eller null när tiden inte går att läsa. */
function svenskTid(nuIso: string): { dag: string; minuter: number } | null {
  if (Number.isNaN(Date.parse(nuIso))) return null;
  return { dag: svensktDatum(nuIso), minuter: svenskaMinuter(nuIso) };
}

/** "08:30" som minuter sedan midnatt. NaN för det som inte är ett klockslag. */
function tillMinuter(klockslag: string): number {
  const [timme, minut] = klockslag.split(":").map(Number);
  return timme * 60 + minut;
}

/**
 * Ligger klockan i fönstret från och med `fran` till men inte med `till`?
 *
 * Ett fönster som går över midnatt (22:00–06:00) är tiden efter `fran` och tiden
 * före `till`. Lika tider är ett tomt fönster och inte ett dygn: felet ska gå
 * åt det tysta hållet.
 */
function iFonster(minuter: number, fran: string, till: string): boolean {
  const start = tillMinuter(fran);
  const slut = tillMinuter(till);

  if (start === slut) return false;
  return start < slut ? minuter >= start && minuter < slut : minuter >= start || minuter < slut;
}

/**
 * Får tavlan låta just nu?
 *
 * Tyst om ljudet är av, om volymen är noll, utanför ljudtiden och, när
 * `helgTyst` gäller, på helger och röda dagar. En tid som inte går att läsa är
 * också tyst, aldrig ett fel.
 *
 * Dagen är den svenska kalenderdagen, även för ett fönster över midnatt: natten
 * efter en fredag hör till lördagen.
 */
export function ljudTillatet(nuIso: string, ljud: TavlansInstallningar["ljud"]): boolean {
  if (!ljud.pa || ljud.volym <= 0) return false;

  const nu = svenskTid(nuIso);
  if (!nu) return false;
  if (ljud.helgTyst && !arArbetsdag(nu.dag)) return false;

  return iFonster(nu.minuter, ljud.fran, ljud.till);
}

/**
 * Är det arbetsdag just nu: en vardag som inte är röd, mellan `fran` och `till`?
 *
 * Tavlan dämpas, hämtar sällan och laddar om vid ett nytt bygge utanför
 * arbetsdagen. En lördag eller en julafton är utanför på samma sätt som natten.
 */
export function inomArbetsdag(nuIso: string, arbetsdag: TavlansInstallningar["arbetsdag"]): boolean {
  const nu = svenskTid(nuIso);
  return nu !== null && arArbetsdag(nu.dag) && iFonster(nu.minuter, arbetsdag.fran, arbetsdag.till);
}

// -----------------------------------------------------------------------------
// Planeringen: vad som firas när en ny bild kommer
//
// ===========================================================================
// TAVLAN FIRAR BARA DET SOM ÄR NYTT, OCH HELLRE FÖR LITE ÄN FÖR MYCKET.
//
// Ett firande som uteblir syns inte. Ett som spelas två gånger, eller för något
// som hände i går, ser hela rummet. Därför gäller:
//
//  - Vid start, vid en ny månad och när minnet inte går att läsa räknas allt som
//    redan finns som sett. Ingenting firas.
//  - En order firas bara om den är ny, från i dag, färsk och inte
//    efterregistrerad. Alla nya order blir kända, också de som inte firas.
//  - Det som passerats är firat, också när det inte spelades (brytaren av, ett
//    ändrat mål). En makulering följd av en ny order firar aldrig om det.
//  - Planeringen är ren: den ändrar ingenting av det som skickas in.
// ===========================================================================
// -----------------------------------------------------------------------------

/**
 * En order som godkändes för längre sedan än så när tavlan såg den läggs in tyst
 * (spec §5.5). Samma tid gäller luckan mellan två bilder: har det gått längre än så
 * firas inte en korsning av målet eller halva målet i efterhand.
 */
export const FARSK_MS = 600_000;

/** En testhändelse som är äldre än så har tavlan missat, och den spelas inte. */
export const TEST_FARSK_MS = 120_000;

/** Hornet spelas högst en gång per så här lång tid (spec §5.5, R38). Bilden spelas ändå. */
export const HORN_SPARR_MS = 20_000;

/** Så många order på en gång (i samma bild eller samma samlingsfönster) blir en serie. */
const SERIE_FRAN = 3;

/** Så många order krävs i dag för att laget ska kunna slå dagsrekordet. */
const REKORD_FRAN = 3;

/** Så många order krävs i dag för att en säljare ska kunna slå sitt personbästa. */
const PERSONBASTA_FRAN = 2;

/**
 * En etikett på en order, som en konturpiller. Ordningen i `Firande.taggar` är
 * visningsordningen (dagsrekord, personbästa, dagens första), och ritningen visar
 * högst två.
 */
export type Tagg =
  | { typ: "dagsrekord"; nu: number; forra: number }
  | { typ: "personbasta"; antal: number }
  | { typ: "dagensForsta" };

/** Ett ögonblick som ska spelas. */
export type Firande =
  | { typ: "order"; order: TavleOrder; variant: "vanlig" | "stor" | "forsta"; taggar: Tagg[] }
  | { typ: "serie"; order: TavleOrder[] }
  | { typ: "halvvags" }
  | { typ: "malet"; natt: string }
  | { typ: "test"; testtyp: Testtyp; id: number };

/**
 * Vad tavlan kommer ihåg mellan två bilder. Den sparas i `localStorage` som JSON
 * (därför är `kanda` en lista och inte en mängd), per månad.
 */
export type Minne = {
  /**
   * Nycklarna till order som setts under dagen `dag`. Städas när dagen byts och inte
   * förr: en order som lämnar bilden under dagen (en makulering, ett försenat svar)
   * står kvar, så att den inte firas igen om den kommer tillbaka, och det gäller även
   * över en omladdning. Bilden har alla dagens order och de åtta senaste, så en dags
   * nycklar är begränsade och listan växer inte över tid.
   */
  kanda: string[];
  /**
   * Den svenska dag (`idag.datum`, "2026-10-23") som `kanda` hör till. Det är minnet som
   * vet vilken dag listan gäller, och inte förra bilden: ett försenat svar som tas emot
   * som förra bild kan då inte få listan att städas en andra gång, och en omladdning
   * samma dag glömmer inget. Null när dagen inte är känd (ett minne i äldre form, utan
   * fältet): listan städas då som vid ett dagsbyte.
   */
  dag: string | null;
  /** Högsta testhändelse som setts. */
  handelse: number;
  /** Månaden minnet gäller, "2026-10". Ett nytt värde nollställer resten. */
  manad: string;
  /** Halvvägs är passerat och firat. */
  halvvags: boolean;
  /** Målet är passerat och firat. */
  malet: boolean;
  /** Dagen då dagsrekordet har sagts, så att det sägs en gång per dag. */
  dagsrekord: string | null;
};

/** Klockslaget som millisekunder, eller NaN när det inte går att läsa. */
const ms = (iso: string): number => Date.parse(iso);

/** Listan utan dubbletter, i den ordning de först förekommer. */
const unika = <T>(lista: readonly T[]): T[] => [...new Set(lista)];

/** Finns det ett mål att räkna mot? Inget mål, noll och det som inte är ett tal är inget mål. */
const harMal = (mal: number | null): mal is number => typeof mal === "number" && mal > 0;

/**
 * Har laget slagit månadens bästa dag så att det är ett dagsrekord att fira? Minst tre
 * i dag, fler än den bästa tidigare dagen, och en bästa dag att slå. Första arbetsdagen
 * i månaden finns ingen (0), och då ska aldrig "DAGSREKORD · 3 (FÖRRA 0)" synas.
 */
const slarDagsrekord = (idag: Ogonblick["idag"]): boolean =>
  idag.bastaDag > 0 && idag.antal > idag.bastaDag && idag.antal >= REKORD_FRAN;

/**
 * Slår säljarens dag hens bästa tidigare dag så att det är ett personbästa att fira?
 * Minst två i dag, fler än den bästa tidigare dagen, och en bästa dag att slå.
 * "Hens bästa tidigare dag" förutsätter att det fanns en tidigare dag. Är bästa 0
 * finns den inte, och tills statistiken finns är den 0 för alla, så annars hade
 * varje säljares andra order fått taggen. (Golvet på två följer nu av de två första
 * villkoren för heltal, men står kvar: det är specens regel och går att ändra här.)
 */
const slarPersonbasta = (order: TavleOrder): boolean =>
  order.saljarensBasta > 0 && order.saljarensDagsantal > order.saljarensBasta && order.saljarensDagsantal >= PERSONBASTA_FRAN;

/** Halva målet i kronor. */
const halvaMalet = (mal: number): number => mal / 2;

/** En kopia av minnet, utan någon lista gemensam med det som kom in. */
const kopiera = (m: Minne): Minne => ({
  kanda: [...m.kanda],
  dag: m.dag,
  handelse: m.handelse,
  manad: m.manad,
  halvvags: m.halvvags,
  malet: m.malet,
  dagsrekord: m.dagsrekord,
});

/** Högsta id bland testhändelserna, eller 0. */
const hogstaId = (handelser: readonly TavleHandelse[]): number =>
  handelser.reduce((hogst, h) => (h.id > hogst ? h.id : hogst), 0);

/**
 * Minnet om det går att läsa, annars null. Det ligger i `localStorage` och kan
 * vara vad som helst: en äldre form, ett trasigt värde, något annat än tavlan
 * skrev dit. Ett minne som inte går att läsa är inget minne. Det betyder en start
 * (ingenting firas) och inte ett undantag mitt i ritningen på en TV ingen rör.
 *
 * `dag` är undantaget: det är ett hjälpfält som ett minne i äldre form saknar, och
 * det avgör bara om nycklarna städas. Saknas det, eller är det inte en sträng, är dagen
 * okänd (null) och minnet läses i övrigt som vanligt.
 */
function lasMinne(minne: unknown): Minne | null {
  if (typeof minne !== "object" || minne === null) return null;
  const m = minne as Record<string, unknown>;
  const giltigt =
    Array.isArray(m.kanda) &&
    typeof m.handelse === "number" &&
    Number.isFinite(m.handelse) &&
    typeof m.manad === "string" &&
    typeof m.halvvags === "boolean" &&
    typeof m.malet === "boolean" &&
    (m.dagsrekord === null || typeof m.dagsrekord === "string");
  return giltigt ? { ...(minne as Minne), dag: typeof m.dag === "string" ? m.dag : null } : null;
}

/**
 * Bildens order med den äldsta först, utan dubbletter. Order med exakt samma tid
 * står kvar i den ordning listan gav dem. En tid som inte går att läsa räknas som
 * den senaste: den order kan inte placeras, och ska inte ta dagens första ifrån
 * en order vars tid går att läsa.
 */
function tidsordnade(order: readonly TavleOrder[]): TavleOrder[] {
  const sedda = new Set<string>();
  const unikaOrder = order.filter((o) => {
    if (sedda.has(o.nyckel)) return false;
    sedda.add(o.nyckel);
    return true;
  });
  const tid = (o: TavleOrder): number => (Number.isNaN(ms(o.tid)) ? Infinity : ms(o.tid));
  return unikaOrder.sort((a, b) => (tid(a) < tid(b) ? -1 : tid(a) > tid(b) ? 1 : 0));
}

/** Första ordern någonsin vinner, sedan stor affär, annars vanlig. */
export function variantFor(order: TavleOrder, forstaOrdern: boolean, dold: boolean): "vanlig" | "stor" | "forsta" {
  if (forstaOrdern && order.forstaNagonsin && !dold) return "forsta";
  return order.niva === "stor" ? "stor" : "vanlig";
}

/**
 * Är säljaren bakom ordern dold på tavlan? Felar åt det dolda hållet: en person som
 * saknas i bilden, eller vars `dold` inte uttryckligen är falskt, räknas som dold.
 *
 * ===========================================================================
 * EN DOLD SÄLJARE FÅR INGET PERSONLIGT PÅ TAVLAN (beslut R23).
 *
 * Ingen personbästa-tagg och ingen "första ordern" med välkomnande: i ett lag på elva
 * hade de pekat ut den som bett om att inte synas. Lagets ögonblick (dagsrekordet,
 * dagens första) står kvar, och en stor affär är fortfarande en stor affär.
 * ===========================================================================
 */
export function arDoldPa(ny: Ogonblick, order: TavleOrder): boolean {
  const person = ny.personer?.[order.person];
  return !person || person.dold !== false;
}

/**
 * Minnet vid en start: allt som finns är sett.
 *
 * Nycklarna är bildens, och har minnet SAMMA dag (`dag`) står dess nycklar kvar: en
 * omladdning mitt på dagen glömmer inte vilka order som setts, så en order som
 * makulerades före omladdningen och ångras efter den firas inte om. Ett minne från en
 * annan dag, eller utan dag, städas till bildens nycklar. `handelse` är högsta id,
 * och halvvägs, målet och dagsrekordet är satta om de redan passerats. Dagsrekordet räknas som passerat bara
 * om det hade firats (se `slarDagsrekord`): en omstart med 2 mot bästa 1 ska inte ta
 * ifrån dagen rekordet när laget når tre. Ett minne från SAMMA månad bär det
 * som firats med sig över en omstart: en order makulerades, TV:n startades om
 * och en ny order tog antalet tillbaka över målet, och då ska inte målet firas en
 * gång till. Ett minne från en annan månad räknas inte, men `handelse` gäller
 * oavsett månad eftersom id:n aldrig går tillbaka.
 */
function borja(ny: Ogonblick, fore: Minne | null): Minne {
  const samma = fore !== null && fore.manad === ny.manad.nyckel ? fore : null;
  const { varde, mal } = ny.manad;
  const { datum } = ny.idag;
  const bildensNycklar = ny.order.map((o) => o.nyckel);

  return {
    kanda: unika(fore !== null && fore.dag === datum ? [...fore.kanda, ...bildensNycklar] : bildensNycklar),
    dag: datum,
    handelse: Math.max(fore?.handelse ?? 0, hogstaId(ny.handelser)),
    manad: ny.manad.nyckel,
    halvvags: (samma?.halvvags ?? false) || (harMal(mal) && varde >= halvaMalet(mal)),
    malet: (samma?.malet ?? false) || (harMal(mal) && varde >= mal),
    dagsrekord: slarDagsrekord(ny.idag) || samma?.dagsrekord === datum ? datum : null,
  };
}

/**
 * Vad ska firas när `ny` kommer efter `forra`, och vad kommer tavlan ihåg efteråt?
 *
 * - **Start** (ingen förra bild, inget minne som går att läsa, en ny månad): allt
 *   som finns är sett och inget firas. Se `borja`.
 * - **Variant**: första ordern någonsin (inte för en dold säljare, R23), annars stor
 *   affär efter nivån, annars vanlig.
 * - **Ny order**: en nyckel som minnet inte känner, från i dag, inte
 *   efterregistrerad och högst `FARSK_MS` gammal. Den firas i tidsordning, och
 *   varje ny nyckel blir känd också när den inte firas. Tre eller fler som firas
 *   på en gång blir en `serie`.
 * - **Taggar** (varje kräver sin brytare): `dagensForsta` på den tidigaste ordern
 *   i dag, `personbasta` när säljarens dag slår hens bästa tidigare dag, som måste
 *   finnas (fler än 0), och är minst två, och aldrig för en dold säljare (R23),
 *   `dagsrekord` på den SISTA nya ordern när laget slår månadens bästa dag med
 *   minst tre och det finns en bästa dag att slå (fler än 0), en gång per dag. En
 *   serie har ingen plats för taggar och förbrukar därför inte dagsrekordet.
 * - **Målet** och **halvvägs** firas när antalet passerar gränsen, en gång per
 *   månad. Halvvägs gäller vid halva målet avrundat uppåt och bara om målet inte
 *   nås i samma bild. Att passera är att ha firat, också när brytaren är av eller
 *   målet ändrats under antalet, så att en makulering och en ny order inte firar
 *   det igen. Ligger det mer än `FARSK_MS` mellan bilderna (ett avbrott) firas ingen
 *   korsning: den noteras tyst, så att inget mål spelas i efterhand.
 * - **Test**: id över `minne.handelse` och yngre än `TEST_FARSK_MS`.
 *
 * Ordningen i svaret är order eller serie, sedan halvvägs eller målet, sedan test.
 *
 * En order som försvinner ur bilden (en makulering) firas aldrig och dras av tyst.
 * Dess nyckel står kvar resten av dagen, också över en omladdning, så att den inte
 * firas om den kommer tillbaka. Minnet städas när dagen byts, så att det inte växer
 * på en TV som går i månader. Vilken dag nycklarna gäller står i minnet (`Minne.dag`).
 *
 * En bild som är äldre än den förra (`nu` före förra bildens) är ett försenat svar:
 * två servrar har var sin processcache (spec §8), och en hämtning kan få ett äldre
 * bygge än den förra. Den ändrar ingenting. Inga firanden, och minnet kommer tillbaka
 * som det var (som en kopia). Anroparen behöver varken släppa den eller välja vilken
 * bild som blir `forra`: dagen avgörs av minnet och inte av förra bilden, så ett
 * försenat svar från gårdagen som tas emot som förra bild kan inte få minnet att
 * städas en andra gång.
 *
 * Ren: ingenting av det som skickas in ändras, och minnet i svaret delar ingen
 * lista med minnet som kom in.
 */
export function planera(
  forra: Ogonblick | null,
  ny: Ogonblick,
  minne: Minne | null,
): { firanden: Firande[]; minne: Minne } {
  const fore = lasMinne(minne);

  // Ett försenat svar ändrar ingenting. Utan ett minne som går att läsa är minnet som det var
  // vid förra bilden det närmaste vi har.
  if (forra !== null && ms(ny.nu) < ms(forra.nu)) {
    return { firanden: [], minne: fore !== null ? kopiera(fore) : borja(forra, null) };
  }

  // Antalen går inte att jämföra över ett månadsskifte, så en förra bild från en
  // annan månad räknas som ingen förra bild.
  if (forra === null || fore === null || fore.manad !== ny.manad.nyckel || forra.manad.nyckel !== ny.manad.nyckel) {
    return { firanden: [], minne: borja(ny, fore) };
  }

  const brytare = ny.installningar.firande;
  const { datum, antal: idagAntal, bastaDag } = ny.idag;
  const nuMs = ms(ny.nu);
  const firanden: Firande[] = [];
  // Ett avbrott mellan bilderna: då har tavlan inte sett korsningen när den hände. En tid som
  // inte går att läsa räknas som ett avbrott.
  const utanAvbrott = nuMs - ms(forra.nu) <= FARSK_MS;

  // --- Order --------------------------------------------------------------
  const iBilden = tidsordnade(ny.order);
  const kanda = new Set(fore.kanda);
  const nya = iBilden.filter((o) => !kanda.has(o.nyckel));
  // En tid som inte går att läsa ger NaN, och NaN <= FARSK_MS är falskt: inget firas.
  const firas = nya.filter((o) => o.dag === datum && !o.efterreg && nuMs - ms(o.tid) <= FARSK_MS);
  const dagensTidigaste = iBilden.find((o) => o.dag === datum)?.nyckel;

  const slarRekord = brytare.dagsrekord && slarDagsrekord(ny.idag) && fore.dagsrekord !== datum;
  let dagsrekord = fore.dagsrekord;

  if (firas.length >= SERIE_FRAN) {
    firanden.push({ typ: "serie", order: firas });
  } else {
    firas.forEach((order, i) => {
      const taggar: Tagg[] = [];
      if (slarRekord && i === firas.length - 1) {
        taggar.push({ typ: "dagsrekord", nu: idagAntal, forra: bastaDag });
        dagsrekord = datum;
      }
      const dold = arDoldPa(ny, order);
      if (brytare.personbasta && !dold && slarPersonbasta(order)) {
        taggar.push({ typ: "personbasta", antal: order.saljarensDagsantal });
      }
      if (brytare.dagensForsta && order.nyckel === dagensTidigaste) taggar.push({ typ: "dagensForsta" });

      firanden.push({ typ: "order", order, variant: variantFor(order, brytare.forstaOrdern, dold), taggar });
    });
  }

  // --- Målet och halvvägs ----------------------------------------------------
  let halvvags = fore.halvvags;
  let malet = fore.malet;
  const mal = ny.manad.mal;

  if (harMal(mal)) {
    const halva = halvaMalet(mal);
    const tidigare = forra.manad.varde;
    const varde = ny.manad.varde;

    if (tidigare < mal && mal <= varde) {
      // Målet nås i den här bilden. Halvvägs hör till samma steg och firas inte särskilt.
      if (!fore.malet && brytare.maletNatt && utanAvbrott) firanden.push({ typ: "malet", natt: ny.manad.natt || ny.nu });
    } else if (tidigare < halva && halva <= varde) {
      if (!fore.halvvags && brytare.halvvags && utanAvbrott) firanden.push({ typ: "halvvags" });
    }

    // Passerat är firat, också utan firande (brytaren av, ett avbrott, ett ändrat mål).
    malet ||= varde >= mal;
    halvvags ||= varde >= halva;
  }

  // --- Testhändelser -----------------------------------------------------------
  let sistaId = -Infinity;
  for (const h of [...ny.handelser].sort((a, b) => a.id - b.id)) {
    if (h.id === sistaId) continue; // en post två gånger spelas en gång
    sistaId = h.id;
    if (h.id > fore.handelse && nuMs - ms(h.tid) < TEST_FARSK_MS) firanden.push({ typ: "test", testtyp: h.typ, id: h.id });
  }

  // --- Minnet -------------------------------------------------------------------
  // Nycklarna städas bara när dagen byts, och det är minnet som vet vilken dag de gäller
  // (`fore.dag`), inte förra bilden. Under dagen står en order som lämnat bilden kvar, och
  // bildens alla nycklar läggs till. En okänd eller annan dag städas till bildens nycklar.
  const sammaDag = fore.dag === datum;
  return {
    firanden,
    minne: {
      kanda: unika([...(sammaDag ? fore.kanda : []), ...iBilden.map((o) => o.nyckel)]),
      dag: datum,
      handelse: Math.max(fore.handelse, hogstaId(ny.handelser)),
      manad: fore.manad,
      halvvags,
      malet,
      dagsrekord,
    },
  };
}

/**
 * Slår ihop de order som samlats under samlingsfönstret till en serie när de är
 * tre eller fler, och lämnar resten i ordning.
 *
 * Serien tar den första ordens plats, så att målet och halvvägs fortfarande
 * kommer efter ordrarna. Order som redan ligger i en serie räknas med: en serie
 * på tre och en order till är en serie på fyra. Färre än tre order lämnas som de är.
 */
export function samla(firanden: readonly Firande[]): Firande[] {
  const order: TavleOrder[] = [];
  for (const f of firanden) {
    if (f.typ === "order") order.push(f.order);
    else if (f.typ === "serie") order.push(...f.order);
  }
  if (order.length < SERIE_FRAN) return [...firanden];

  const ut: Firande[] = [];
  let lagd = false;
  for (const f of firanden) {
    if (f.typ !== "order" && f.typ !== "serie") ut.push(f);
    else if (!lagd) {
      ut.push({ typ: "serie", order });
      lagd = true;
    }
  }
  return ut;
}

/**
 * Får hornet spelas nu? Högst en gång per `HORN_SPARR_MS`: inom spärren hoppas
 * det över, och bilden och kassan spelas ändå. Det är tavlans högsta ljud, och
 * ett horn vid varje order i en rusning är det som får någon att stänga av ljudet
 * för gott. `senastMs` är när hornet spelades senast, eller null.
 *
 * Exakt `HORN_SPARR_MS` efter är fortfarande inom spärren. En klocka som gått
 * bakåt (`nuMs` före `senastMs`) spärrar inte: då hade hornet varit tyst tills
 * klockan hunnit ikapp.
 */
export function hornTillatet(senastMs: number | null, nuMs: number): boolean {
  if (senastMs === null) return true;
  const gatt = nuMs - senastMs;
  return gatt < 0 || gatt > HORN_SPARR_MS;
}
