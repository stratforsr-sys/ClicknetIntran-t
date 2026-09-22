import { datumPlusDagar, veckodag } from "./uppgifter.ts";

/**
 * Upprepningen: regeln, och datumen den betyder.
 *
 * =============================================================================
 * INGENTING HÄRINNE RÖR DATABASEN, OCH DET ÄR HELA POÄNGEN
 *
 * Den farliga delen av en upprepning är inte skrivningen — det är räknandet.
 * En regel som ger ett datum för mycket föder en uppgift ingen bad om; en som
 * ger ett för lite tappar en måndag utan att någonstans se fel ut. Båda felen
 * upptäcks först veckor senare, av en människa som undrar varför.
 *
 * Därför bor räknandet här, i rena funktioner med prov (`tests/upprepning.mjs`),
 * och `upprepning-server.ts` gör bara det som återstår: frågar databasen vad
 * som redan finns och skriver det som saknas.
 *
 * FÖNSTRET RÄKNAS OCKSÅ HÄR, och det är inte självklart. `fonster()` ser ut som
 * jobbets ensak — men den är den enda funktion i hela bygget som kan skriva
 * åtta veckors uppgifter två gånger, och den ska gå att prova utan att någon
 * behöver en databas och ett dygn.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// Mönstren
// -----------------------------------------------------------------------------

/**
 * TRE MÖNSTER. Beställarens ord 2026-09-17:
 *
 *   "om man kan välja en dag, så tex måndag, då upprepas ju den varje måndag
 *    tex oså, så dagligen, vardagar, eller veckovis där man kan välja en dag"
 *
 * Månadsvis, "första måndagen i månaden" och årligen efterfrågades INTE och
 * står därför inte här. Det är inte snålhet: varje mönster som finns måste
 * räkna rätt över årsskiften, skottdagar och månader som saknar den 31:e, och
 * ett mönster ingen bett om är en sådan räkning som aldrig blir provad på
 * riktigt.
 */
export const MONSTER = ["dagligen", "vardagar", "veckovis"] as const;
export type Monster = (typeof MONSTER)[number];

export const MONSTER_ETIKETT: Record<Monster, string> = {
  dagligen: "Varje dag",
  vardagar: "Varje vardag",
  veckovis: "Vissa veckodagar",
};

/**
 * `vardagar` OCH `veckovis` MED FEM KRYSS FÖDER SAMMA DATUM, och är ändå två
 * mönster. Skillnaden syns när någon LÄSER regeln ett halvår senare: "varje
 * vardag" är en avsikt, "måndag, tisdag, onsdag, torsdag och fredag" är en
 * uppräkning som ser ut att ha valts dag för dag — och den som ska ändra den
 * vet inte om lördagen saknas för att den valdes bort eller för att den aldrig
 * var med.
 */
const VARDAGAR: readonly number[] = [1, 2, 3, 4, 5];

export const VECKODAG_NAMN: Record<number, string> = {
  1: "måndag",
  2: "tisdag",
  3: "onsdag",
  4: "torsdag",
  5: "fredag",
  6: "lördag",
  7: "söndag",
};

/**
 * Hur långt fram förekomsterna föds.
 *
 * ÅTTA VECKOR, och talet är valt mot vyerna och inte mot magkänslan:
 * planeringsvyn och veckovyn visar tillsammans som mest en månad framåt, och
 * den som bläddrar vidare gör det för att planera — då ska raderna stå där.
 *
 * Längre fram hade kostat mer än det gav. En daglig rutin är 365 rader om året,
 * och varje rad är en rad i `task_event`, i sorteringen och i varje fråga som
 * läser hela tabellen (morgonbrevet gör det). Åtta veckor är 56 rader, och
 * nattjobbet fyller på var natt.
 */
export const HORISONT_DAGAR = 56;

/**
 * Taket för en enda körning.
 *
 * Spärr och inte gräns: fönstret är 56 dagar, så en daglig serie ger 57 datum
 * och ingen serie kan nå hit. Den finns för dagen någon råkar sätta
 * `starts_on` till 2019 och `materialized_to` till null — då ska en slinga inte
 * skriva tvåtusen uppgifter innan någon hinner läsa kvittot.
 */
export const TAK_PER_KORNING = 400;

// -----------------------------------------------------------------------------
// Regeln
// -----------------------------------------------------------------------------

export type Serieregel = {
  monster: Monster;
  /** 1 = måndag … 7 = söndag. Tom för alla mönster utom `veckovis`. */
  veckodagar: readonly number[];
  starts_on: string;
  /** Null = serien löper vidare. */
  ends_on: string | null;
};

export function arMonster(v: unknown): v is Monster {
  return typeof v === "string" && (MONSTER as readonly string[]).includes(v);
}

/**
 * Sorterade, avdubblade och inom 1–7.
 *
 * Sorteringen är inte kosmetik. Fältet läses tillbaka av formuläret och av
 * `monstertext()`, och "torsdag och måndag" är samma regel som "måndag och
 * torsdag" men ser ut som ett slarvfel. Avdubblingen behövs för att en
 * FormData kan bära samma kryssruta två gånger om markup:en råkar rita den så.
 */
export function normaliseraVeckodagar(dagar: readonly (number | string)[]): number[] {
  const rena = new Set<number>();
  for (const d of dagar) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 1 && n <= 7) rena.add(n);
  }
  return [...rena].sort((a, b) => a - b);
}

/**
 * Går regeln att använda? Null när den gör det, annars en mening för en
 * människa.
 *
 * SAMMA SVAR SOM VILLKOREN I 0062, med flit. Databasen är sista ordet, men ett
 * villkorsnamn i en felruta (`task_series_veckodagar`) är inte ett besked —
 * och en serie som faller vid födseln faller i nattjobbets kvitto klockan halv
 * tre, långt från den som kunde ha rättat den.
 */
export function granskaRegel(regel: Serieregel): string | null {
  if (!arMonster(regel.monster)) return "Välj hur ofta den ska återkomma.";

  if (regel.monster === "veckovis" && regel.veckodagar.length === 0) {
    return "Kryssa i minst en veckodag.";
  }
  if (regel.monster !== "veckovis" && regel.veckodagar.length > 0) {
    return "Veckodagar hör bara till mönstret ”vissa veckodagar”.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(regel.starts_on)) return "Välj vilken dag serien börjar.";
  if (regel.ends_on !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(regel.ends_on)) return "Slutdatumet går inte att tolka.";
    if (regel.ends_on < regel.starts_on) return "Serien kan inte sluta innan den börjar.";
  }

  /**
   * EN REGEL SOM ALDRIG INFALLER ÄR ETT FEL, inte en tom serie.
   *
   * "Varje lördag, 1 mars till 3 mars" ser giltig ut i varje enskilt fält och
   * föder noll uppgifter. Utan den här kontrollen sparas den, ser riktig ut i
   * listan, och den som lade upp den upptäcker först om ett halvår att
   * ingenting någonsin hände.
   */
  if (regel.ends_on !== null && nastaForekomst(regel, regel.starts_on) === null) {
    return "Mönstret infaller aldrig mellan de datumen. Välj en annan dag eller ett senare slut.";
  }

  return null;
}

/**
 * Formulärets fält till en regel. Null när inget kryss satts för upprepning.
 *
 * DEN STÅR HÄR OCH INTE I DE TVÅ ACTION-FILERNA, trots att `FormData` inte hör
 * hemma i en räknefil. Uppgiftsmodulen och coachningsmodulen skapar var sin
 * sorts serie ur samma formulär (`NyPost.tsx`), och fältnamnen är kontraktet
 * mellan dem. Två kopior av den här funktionen hade varit två tolkningar av
 * samma kryssrutor — och den dagen de skiljer sig får den ena modulen en regel
 * som ser ut att komma från något användaren fyllde i.
 */
export function regelUrFormular(form: FormData, forvaldStart: string): Serieregel | null {
  if (String(form.get("upprepas") ?? "") !== "ja") return null;

  const monster = String(form.get("monster") ?? "");
  const start = String(form.get("serie_starts_on") ?? "").trim() || forvaldStart;
  const slut = String(form.get("serie_ends_on") ?? "").trim() || null;

  return {
    monster: arMonster(monster) ? monster : "veckovis",
    veckodagar:
      monster === "veckovis" ? normaliseraVeckodagar(form.getAll("veckodag").map(String)) : [],
    starts_on: start,
    ends_on: slut,
  };
}

/** Infaller regeln på det här datumet? Tar ingen hänsyn till start eller slut. */
export function traffar(regel: Serieregel, datum: string): boolean {
  const dag = veckodag(datum);
  switch (regel.monster) {
    case "dagligen":
      return true;
    case "vardagar":
      return VARDAGAR.includes(dag);
    case "veckovis":
      return regel.veckodagar.includes(dag);
    default:
      return false;
  }
}

/**
 * Datumen regeln ger i `[fran, till]`, båda inklusive.
 *
 * Serien egna gränser gäller ovanpå: ingenting före `starts_on`, ingenting
 * efter `ends_on`. Anroparen får alltså skicka ett grovt fönster utan att
 * behöva känna till regeln.
 */
export function forekomster(regel: Serieregel, fran: string, till: string): string[] {
  const start = fran < regel.starts_on ? regel.starts_on : fran;
  const slut = regel.ends_on && regel.ends_on < till ? regel.ends_on : till;

  const ut: string[] = [];
  let dag = start;
  while (dag <= slut && ut.length < TAK_PER_KORNING) {
    if (traffar(regel, dag)) ut.push(dag);
    dag = datumPlusDagar(dag, 1);
  }
  return ut;
}

/** Första datumet regeln ger från och med `fran`. Null när det inte finns något. */
export function nastaForekomst(regel: Serieregel, fran: string): string | null {
  const start = fran < regel.starts_on ? regel.starts_on : fran;

  /**
   * Åtta dygn räcker för varje mönster som finns: den glesaste regeln är en
   * enda veckodag, och den infaller minst en gång per sjudagarsperiod. Talet
   * måste ändras den dag ett månadsmönster läggs till — och då fäller provet
   * "nästa hittas för varje mönster" i tests/upprepning.mjs.
   */
  for (let i = 0; i < 8; i++) {
    const dag = datumPlusDagar(start, i);
    if (regel.ends_on && dag > regel.ends_on) return null;
    if (traffar(regel, dag)) return dag;
  }
  return null;
}

/**
 * "Varje måndag och torsdag", "Varje vardag", "Varje dag".
 *
 * Egen ihopsättning och inte `Intl.ListFormat`, av samma skäl som `FRIA_ORD` i
 * NyPost.tsx: den senare faller tillbaka på engelskt "and" om bygget kör med
 * skalad ICU, och ett "and" mitt i en svensk mening är precis den sortens
 * detalj ingen upptäcker.
 */
export function monstertext(regel: Serieregel): string {
  if (regel.monster === "dagligen") return "Varje dag";
  if (regel.monster === "vardagar") return "Varje vardag";

  const namn = normaliseraVeckodagar(regel.veckodagar).map((d) => VECKODAG_NAMN[d]);
  if (namn.length === 0) return "Varje vecka";
  if (namn.length === 1) return `Varje ${namn[0]}`;
  return `Varje ${namn.slice(0, -1).join(", ")} och ${namn[namn.length - 1]}`;
}

/** Hela regeln i en rad: "Varje måndag · till 2026-12-31". */
export function serietext(regel: Serieregel): string {
  return [monstertext(regel), regel.ends_on ? `till ${regel.ends_on}` : null]
    .filter(Boolean)
    .join(" · ");
}

// -----------------------------------------------------------------------------
// Fönstret
// -----------------------------------------------------------------------------

export type Fonster = { fran: string; till: string };

/**
 * Vilka datum som ska födas NU.
 *
 * =============================================================================
 * DEN HÄR FUNKTIONEN ÄR DEN ENDA SOM KAN SKRIVA SAMMA UPPGIFT TVÅ GÅNGER
 *
 * Tre gränser möts, och var och en finns av ett skäl:
 *
 *   `materialized_to` ÄR DEN VIKTIGASTE. Den som tar bort torsdagens förekomst
 *   ska inte få den tillbaka på natten. Unikindexet i 0062 stoppar en dubblett
 *   bara så länge raden finns kvar — en BORTTAGEN rad har ingen som stoppar
 *   den. Fältet flyttas därför bara framåt, och ingenting bakom det föds om.
 *
 *   `idag` HINDRAR EFTERSLÄPNING. Har jobbet inte kört på tre dygn ska de tre
 *   dygnen inte komma som tre försenade uppgifter i morgon bitti. En missad
 *   måndag är missad; att bokföra den i efterhand är att ljuga om kalendern.
 *
 *   HORISONTEN är takets höjd. Se `HORISONT_DAGAR`.
 *
 * Null betyder "ingenting att göra", vilket är det normala: en serie som är
 * född till horisonten föder en enda ny dag per natt, och de flesta nätter
 * ingen alls.
 * =============================================================================
 */
export function fonster(
  regel: Serieregel,
  idag: string,
  materializedTo: string | null,
  horisontDagar: number = HORISONT_DAGAR,
): Fonster | null {
  const horisont = datumPlusDagar(idag, horisontDagar);
  const till = regel.ends_on && regel.ends_on < horisont ? regel.ends_on : horisont;

  let fran = regel.starts_on < idag ? idag : regel.starts_on;
  if (materializedTo) {
    const efter = datumPlusDagar(materializedTo, 1);
    if (efter > fran) fran = efter;
  }

  return fran > till ? null : { fran, till };
}

// -----------------------------------------------------------------------------
// Tystnaden
// -----------------------------------------------------------------------------

export type Forekomstrad = {
  id: string;
  series_id: string | null;
  due_date: string | null;
  /** Bockad, godkänd eller avbruten — något som inte längre väntar på någon. */
  stangd: boolean;
};

/**
 * Vilka förekomster som INTE får notisera.
 *
 * =============================================================================
 * BARA NÄRMASTE FÖREKOMSTEN SÄGER TILL. BESTÄLLARENS VAL 2026-09-17.
 *
 * Utan den här funktionen är upprepningen en notisfabrik. En coachningsrutin
 * som läggs på en säljare föder åtta veckors rader i samma sekund, och varje
 * rad är i `ej_paborjad` med någon annan som skapare — alltså åtta stycken
 * "Ny uppgift: …" i klockan, alla på en gång, för något som ska ske en gång i
 * veckan. Den som fått det slutar titta i klockan, och då slutar klockan
 * fungera för allt annat också.
 *
 * REGELN ÄR "NÄRMAST" OCH INTE "IDAG". Nästa måndag är fortfarande det som ska
 * göras härnäst, även om den ligger fyra dagar bort — och beskedet ska komma
 * medan det går att planera för, inte samma morgon.
 *
 * DE STÄNGDA RÄKNAS INTE SOM NÄRMAST. Bockas måndagen av blir tisdagen veckan
 * därpå närmast och får tala. Annars hade en avklarad serie tystat sig själv
 * för all framtid.
 *
 * FÖRSENAT OCH DAGENS GÅR UTANFÖR DEN HÄR FUNKTIONEN, och det är med flit. De
 * posterna är redan hopsamlade till EN rad var (`uppgiftsnotiser`), räknas ur
 * `due_date`, och en framtida förekomst kan varken vara försenad eller vara
 * idag. Det finns alltså ingenting att tysta där.
 * =============================================================================
 */
export function tystadeForekomster(rader: readonly Forekomstrad[]): Set<string> {
  const perSerie = new Map<string, Forekomstrad[]>();

  for (const r of rader) {
    if (!r.series_id || r.stangd) continue;
    const lista = perSerie.get(r.series_id);
    if (lista) lista.push(r);
    else perSerie.set(r.series_id, [r]);
  }

  const tystade = new Set<string>();

  for (const lista of perSerie.values()) {
    if (lista.length < 2) continue;

    /**
     * Utan frist är ingenting "närmast". En sådan rad kan inte vara den som
     * står på tur — den står inte på tur alls — och den tystas därför som
     * vilken senare förekomst som helst. Att låta den vinna hade betytt att en
     * serie med en odaterad rad tystade hela sin egen framtid.
     */
    let narmast: Forekomstrad | null = null;
    for (const r of lista) {
      if (!r.due_date) continue;
      if (!narmast || r.due_date < narmast.due_date!) narmast = r;
    }

    for (const r of lista) {
      if (narmast && r.id === narmast.id) continue;
      tystade.add(r.id);
    }
  }

  return tystade;
}
