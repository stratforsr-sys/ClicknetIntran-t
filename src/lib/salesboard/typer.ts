/**
 * Säljtavlans typer: inställningarna och ögonblicksbilden.
 *
 * Bara typer, ingen körtidskod. Servern bygger bilden (`tavlan.ts`) och
 * klienten ritar den (`Tavla.tsx`), så filen får inte importera något som bara
 * finns på ena sidan. Det enda som hämtas är en typ ur `saljtakt.ts`.
 *
 * ===========================================================================
 * ÖGONBLICKSBILDEN ÄR DISPLAY-SÄKER, OCH DEN HÄR FILEN ÄR DEN FÖRSTA SPÄRREN.
 *
 * Bilden går till en TV på en vägg och till webbläsarens utvecklarverktyg.
 * Därför finns här inget employee-id, ingen provision, ingen kund, ingen
 * e-post och inga telefonnummer, och det finns inget fält att lägga dem i.
 * Ordervärdet och månadens mål i kronor står här med flit: beställaren
 * bestämde 2026-10-24 att tavlan mäter i ordervärde (R35, R36).
 * Personer och order identifieras av hashade nycklar. En dold säljare har sitt
 * namn ersatt redan på servern, så att det inte går att läsa ur JSON-svaret.
 *
 * Lägg inte till ett fält utan att fråga om det får synas på en TV. Det som
 * saknas här saknas med flit.
 * ===========================================================================
 *
 * Tider är ISO-strängar. Dagar är svenska kalenderdagar, som "2026-10-23".
 */

// -----------------------------------------------------------------------------
// Inställningarna
// -----------------------------------------------------------------------------

/** Hur ett namn skrivs: "Amira", "Amira H." eller "Amira Haddad". */
export type Namnform = "fornamn" | "fornamn_e" | "hela";

/**
 * Hur en enskild säljare visas. Valet görs per person (`salesboard_person`) och
 * bara på säljarens begäran. "Dold" visas som "En säljare" med ett neutralt
 * monogram.
 */
export type Visning = "namn" | "initialer" | "dold";

/** Topplistans ordning. Målet är alltid ordervärde, ordningen ändrar bara raderna. */
export type Ordning = "varde" | "antal";

/** Testhändelserna admin kan skicka från inställningarna. */
export type Testtyp = "order" | "stor" | "forsta" | "serie" | "malet";

/**
 * Tavlans inställningar, som de ligger i `nav_setting` under nyckeln
 * `salesboard` (jsonb, version 1).
 *
 * Det som läses ur databasen har inte den här formen förrän det gått genom
 * `normalisera()`, som fyller i standarder och klipper bort det som inte hör
 * hit. Läs aldrig raden direkt.
 */
export type TavlansInstallningar = {
  version: 1;
  /** Lagets id (`team.id`), eller null för alla. */
  lag: string | null;
  namn: Namnform;
  /** Topplistans ordning. Tangenten V växlar på skärmen utan att spara. */
  ordning: Ordning;
  /**
   * Månadens mål i ordervärde, kronor, per månad ("2026-10" → 550 000). En månad
   * utan eget mål har det senaste målet före sig (`malFor`), så att ett mål gäller
   * tills någon ändrar det.
   */
  mal: Record<string, number>;
  /** Arbetsdagen för vilan, "HH:MM" svensk tid. */
  arbetsdag: { fran: string; till: string };
  rorelse: "full" | "lugn";
  firande: {
    storAffar: { lage: "auto" | "belopp"; belopp: number };
    forstaOrdern: boolean;
    dagensForsta: boolean;
    personbasta: boolean;
    dagsrekord: boolean;
    halvvags: boolean;
    maletNatt: boolean;
    /** En order som signerats fler dagar än så här före godkännandet firas inte. */
    efterregistreradDagar: number;
  };
  /** Ljudtiden är "HH:MM" svensk tid. */
  ljud: { pa: boolean; volym: number; fran: string; till: string; helgTyst: boolean };
};

// -----------------------------------------------------------------------------
// Ögonblicksbilden
// -----------------------------------------------------------------------------

/** En säljare så som tavlan får se hen. */
export type TavlePerson = {
  /** Hash av säljarens id, och nyckeln i `Ogonblick.personer`. Själva id:t lämnar aldrig servern. */
  nyckel: string;
  /** Färdigt efter namnform och visning. En dold säljare heter "En säljare". */
  namn: string;
  /** Monogrammet, till exempel "AH", eller "·" för en dold säljare. */
  initialer: string;
  /** Avgörs av `arDold(visning)` i `regler.ts` (felar åt det dolda hållet), aldrig av en jämförelse med "dold". */
  dold: boolean;
};

/** En godkänd order. */
export type TavleOrder = {
  /** Hash av order-id:t. Tavlan minns vilka nycklar den sett. */
  nyckel: string;
  /** Säljarens nyckel i `Ogonblick.personer`. */
  person: string;
  /** När ordern godkändes, ISO. */
  tid: string;
  /** Svensk dag för `tid`. */
  dag: string;
  /** Paketets namn, "Hemsida Pro", eller "Fri order". */
  paket: string;
  /** Bindningstiden i månader, eller null när den saknas. */
  bindning: number | null;
  /** Ordervärdet i kronor, eller null när ordern saknar ett. Aldrig provisionen. */
  belopp: number | null;
  niva: "vanlig" | "stor";
  /** Signerad så långt före godkännandet att den räknas men inte firas. */
  efterreg: boolean;
  /** Säljarens första godkända order någonsin. */
  forstaNagonsin: boolean;
  /** Säljarens antal godkända i dag, den här ordern inräknad. */
  saljarensDagsantal: number;
  /** Säljarens största antal på en dag före i dag. 0 när det inte finns någon tidigare dag: då finns inget personbästa att slå. */
  saljarensBasta: number;
  /**
   * Räknas ordern i månadens tal (signerad i månaden)? En order som godkänns i dag men
   * signerades förra månaden står i flödet men ändrar inte månadens antal och värde.
   */
  manaden: boolean;
};

/**
 * En rad i topplistan: en säljare som inte är dold. Talen är månadens netto, som
 * lagets (godkända i månaden minus makulerade i den), och veckans streck.
 */
export type TavleSaljare = {
  /** Nyckeln i `Ogonblick.personer`. */
  person: string;
  antal: number;
  /** Ordervärdet i kronor. */
  varde: number;
  /** Godkända per arbetsdag i veckan, måndag till fredag. */
  vecka: [number, number, number, number, number];
  /** Godkända i dag. */
  idag: number;
};

/** En tidigare månad i grafen. */
export type TavleManad = {
  /** "2026-09". */
  nyckel: string;
  /** "sep". */
  namn: string;
  antal: number;
  /** Ordervärdet i kronor, netto. */
  varde: number;
  /** Månadens mål i kronor, eller null utan mål. */
  mal: number | null;
};

/** En testhändelse från inställningarna. Spelas med märket TEST och räknas aldrig. */
export type TavleHandelse = { id: number; typ: Testtyp; tid: string };

/** Allt tavlan behöver för att rita sig, och inget mer. */
export type Ogonblick = {
  v: 1;
  /** Servertiden när bilden byggdes. Klockan, "i dag" och färskheten räknas på den. */
  nu: string;
  /** Commit-sha för bygget som svarade. Ett nytt bygge laddar om tavlan. */
  bygge: string;
  /** Lagets namn, eller null när tavlan visar alla. */
  lag: string | null;
  /** Skärmen som frågar, om den är parad. */
  skarm: { namn: string; ljud: boolean } | null;
  /**
   * Utan `lag`: lagets id (`team.id`) är internt och ska inte ut på en TV eller i
   * utvecklarverktygen. Lagets namn står i `lag` ovan.
   */
  installningar: Omit<TavlansInstallningar, "lag" | "mal">;
  manad: {
    /** "2026-10". Ett nytt värde nollställer det tavlan kommit ihåg om månaden. */
    nyckel: string;
    /** "Oktober". */
    namn: string;
    /** Godkända order netto i månaden, som Golvet räknar dem (`nettoAntal`). Statistik, inget mål. */
    antal: number;
    /** Ordervärdet netto i månaden, kronor: godkända i månaden minus makulerade i den. */
    varde: number;
    /** Månadens mål i ordervärde, kronor, eller null utan mål. */
    mal: number | null;
    /** Var laget borde stå i dag i kronor (målet gånger andelen arbetsdagar). Null utan mål. */
    forvantat: number | null;
    /** Vad månaden landar på i samma takt, kronor. Null före arbetsdag tre och utan order. */
    prognos: number | null;
    /** Arbetsdagar som passerat (dagen i dag inräknad) och i hela månaden. */
    dagar: { gangna: number; totalt: number };
    /** När laget nådde målet, ISO: godkännandet som tog värdet över gränsen. */
    natt: string | null;
    /** Månadens största enskilda affär i kronor, eller null utan order. */
    storsta: number | null;
  };
  idag: {
    /** Svensk dag, "2026-10-23". */
    datum: string;
    /** Måndag 0 till fredag 4, null en helgdag: kolumnen i topplistan som är i dag. */
    veckodag: number | null;
    antal: number;
    /** Ordervärdet i kronor. */
    summa: number;
    /** Lagets största dagsantal tidigare i månaden. */
    bastaDag: number;
  };
  /** Topplistan: lagets säljare utan de dolda, i ingen särskild ordning. Tavlan rangordnar. */
  saljare: TavleSaljare[];
  /** De elva månaderna före den här, den äldsta först. */
  historik: TavleManad[];
  /** Alla godkända i dag och de senaste, den nyaste först. */
  order: TavleOrder[];
  personer: Record<string, TavlePerson>;
  handelser: TavleHandelse[];
};
