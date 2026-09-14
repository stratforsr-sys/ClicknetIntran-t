/**
 * Kalenderns delade regler. Ren logik, inga importer.
 *
 * Ligger i lib och inte i en server action-fil av samma skäl som
 * `uppgifter.ts`: en "use server"-modul exponerar varje export som en anropbar
 * slutpunkt. Allt härinne provas av tests/kalender.mjs.
 *
 * =============================================================================
 * KALENDERN VISAR DET NAVET REDAN VET. DEN BOKAR INGA MÖTEN.
 *
 * Beställarens beslut 2026-09-11, och det är den enda meningen som behöver stå
 * kvar om allt annat glöms bort. En mötesbokning kräver inbjudan, ja/nej-svar,
 * ombokning, motförslag och en kalender hos mottagaren som svarar på dem — och
 * den mottagaren sitter i Outlook, inte i navet. Det som byggs här är i stället
 * en vy över sådant som REDAN finns i systemet: uppgifter, beviljad ledighet,
 * coachningssamtal, kursfrister och månadens orderfrist.
 *
 * Följden är att ingen post i den här filen har en "deltagare" eller ett
 * "svar". En post har en dag, ibland ett klockslag, och en längd.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// Delningen — Outlooks fem nivåer
//
// =============================================================================
// LEDIG/UPPTAGEN ÄR GRUNDLÄGE FÖR ALLA, OCH DET KRÄVER INGEN RAD
//
// Beställarens beslut 2026-09-11. Att alla ser varandras upptagenhet är hela
// skälet att en delad kalender är värd något: den som ska fråga en kollega om
// fem minuter vill veta om hon sitter i ett samtal, inte be om lov att få veta
// det. Ett grundläge som kräver att var och en aktivt delar med var och en ger
// i praktiken noll delning — alla sådana system slutar som tomma kalendrar.
//
// Grundläget är därför FRÅNVARON AV EN RAD i `calendar_share`, inte en rad per
// par. Med fjorton anställda hade det senare betytt 182 rader som måste skrivas
// när någon anställs och städas när någon slutar, och den dagen någon glöms
// bort syns det som att hennes kalender är tom — inte som att något är trasigt.
//
// En rad i tabellen betyder alltså alltid "mer än grundläget", aldrig mindre.
// Att stänga av ledig/upptagen för en enskild kollega går inte, och det är
// medvetet: en kalender där vissa är osynliga är en kalender man slutar lita på.
// =============================================================================

export const DELNINGSNIVAER = ["upptagen", "rubriker", "detaljer", "redigera", "delegat"] as const;
export type Delningsniva = (typeof DELNINGSNIVAER)[number];

/** Vad alla ser av alla, utan att någon delat något. */
export const GRUNDNIVA: Delningsniva = "upptagen";

export const NIVA_ETIKETT: Record<Delningsniva, string> = {
  upptagen: "Kan se när jag är upptagen",
  rubriker: "Kan se rubriker",
  detaljer: "Kan se alla detaljer",
  redigera: "Kan planera om",
  delegat: "Delegat",
};

/**
 * Förklaringarna är skrivna till den som DELAR, inte till den som läser.
 *
 * "Kan se alla detaljer" säger ingenting om vad det kostar. "Hon ser hela
 * uppgiften, inklusive beskrivning, historik och vilka som är inbjudna" säger
 * det — och den meningen är skälet till att de flesta stannar på nivå två.
 */
export const NIVA_FORKLARING: Record<Delningsniva, string> = {
  upptagen:
    "Ser att tiden är bokad, men inte vad det gäller. Gäller alla i navet och går inte att stänga av.",
  rubriker: "Ser vad posterna heter. Kommer inte in i uppgiften och ser varken beskrivning eller historik.",
  detaljer: "Ser hela uppgiften — beskrivning, historik, inbjudna och kopplingar — och kan öppna den.",
  redigera: "Ser allt, och kan dessutom flytta dina uppgifter i tiden. Ändrar inte vad de handlar om.",
  delegat: "Arbetar som du: planerar om, bockar av och lämnar in. Ge den bara till någon som svarar för dig.",
};

/** Högre tal = mer. Bara ordningen, aldrig lagrad. */
const NIVA_VIKT: Record<Delningsniva, number> = {
  upptagen: 0,
  rubriker: 1,
  detaljer: 2,
  redigera: 3,
  delegat: 4,
};

export function arDelningsniva(varde: unknown): varde is Delningsniva {
  return typeof varde === "string" && varde in NIVA_VIKT;
}

/** Når nivån minst så här långt? `nivaMinst("delegat", "detaljer")` är sant. */
export function nivaMinst(niva: Delningsniva | null, minst: Delningsniva): boolean {
  if (!niva) return false;
  return NIVA_VIKT[niva] >= NIVA_VIKT[minst];
}

/** Ser rubriken? Allt från nivå två och uppåt. */
export function serRubrik(niva: Delningsniva | null): boolean {
  return nivaMinst(niva, "rubriker");
}

/** Kommer in i uppgiften? Kräver "alla detaljer". */
export function serDetaljer(niva: Delningsniva | null): boolean {
  return nivaMinst(niva, "detaljer");
}

/**
 * Får flytta posten i tiden?
 *
 * SKILD FRÅN "FÅR ÄNDRA", och det är hela poängen med att nivå fyra heter
 * "kan planera om" och inte "kan redigera" i den här texten. Outlook kallar
 * steget "Kan redigera", men i navet betyder en kalender bara NÄR något ska
 * göras — vad det handlar om bestäms i uppgiften, och den har sin egen krets
 * sedan 0054. Nivå fyra ger därför exakt kalenderns verb och inget mer.
 */
export function farPlaneraOm(niva: Delningsniva | null): boolean {
  return nivaMinst(niva, "redigera");
}

/** Arbetar som ägaren: bockar av, lämnar in, ändrar. Bara delegaten. */
export function farArbetaSomAgaren(niva: Delningsniva | null): boolean {
  return niva === "delegat";
}

// -----------------------------------------------------------------------------
// Dygnet
//
// FÖNSTRET ÄR 06–20 OCH INTE 00–24. Ett dygn ritat i sin helhet lägger halva
// höjden på timmar ingen planerar i, och då blir varje arbetstimme hälften så
// hög — alltså hälften så lätt att träffa med en uppgift man drar. Poster som
// hamnar utanför fönstret försvinner inte: `utanforDygnet()` nedan samlar dem
// i en rad över rutnätet, så en frukost 05:30 syns även om den inte ritas i
// sitt klockslag.
// -----------------------------------------------------------------------------

export const DAG_START = 6 * 60;
export const DAG_SLUT = 20 * 60;

/** Rutans höjd i minuter. Halvtimmar — kvartar ger ett rutnät man inte träffar. */
export const RUTA = 30;

/**
 * Så lång blir en uppgift utan tidsuppskattning när den läggs i kalendern.
 *
 * Den skrivs INTE till `estimate_minutes`. En uppgift som får en gissad längd
 * av att dras till ett klockslag hade sedan sett ut som om någon uppskattat
 * den, och dagssumman hade räknat den som en uppskattning. Talet finns bara
 * för att posten ska gå att rita och gå att träffa med musen.
 */
export const STANDARDLANGD = 30;

/**
 * Vad en dag rymmer.
 *
 * SEX TIMMAR OCH INTE ÅTTA, samma vägg som `Dagsumma` på uppgiftssidan satte
 * upp 2026-09-11. En arbetsdag är åtta timmar, men två av dem går åt till
 * möten, avbrott och det som dyker upp. Den som planerar åtta timmars uppgifter
 * i en åttatimmarsdag planerar att misslyckas, och en kalender som låter henne
 * göra det utan att säga något är medskyldig.
 */
export const DAGSTAK = 6 * 60;

/** "14:30" → 870. Null in, null ut. */
export function tidTillMinuter(tid: string | null | undefined): number | null {
  if (!tid) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(tid);
  if (!m) return null;
  const timme = Number(m[1]);
  const minut = Number(m[2]);
  if (timme < 0 || timme > 23 || minut < 0 || minut > 59) return null;
  return timme * 60 + minut;
}

/** 870 → "14:30". Klipps till dygnet; 1440 och uppåt är inte ett klockslag. */
export function minuterTillTid(minuter: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(minuter)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Klockslagen rutnätet ritar, i minuter. 06:00, 06:30, … 19:30. */
export function rutor(): number[] {
  const ut: number[] = [];
  for (let m = DAG_START; m < DAG_SLUT; m += RUTA) ut.push(m);
  return ut;
}

/** Närmaste ruta. Det man släpper mellan två rader ska landa i en av dem. */
export function snappa(minuter: number): number {
  const rundat = Math.round(minuter / RUTA) * RUTA;
  return Math.max(DAG_START, Math.min(DAG_SLUT - RUTA, rundat));
}

// -----------------------------------------------------------------------------
// Posterna
// -----------------------------------------------------------------------------

/**
 * Vad en post kommer ur.
 *
 * Ordningen är den de ritas i när de ligger samma dag utan klockslag, och den
 * är vald efter hur mycket de styr dagen: är man ledig spelar resten mindre
 * roll, och en frist är en vägg medan en uppgift är ett åtagande.
 */
export const KALENDERSLAG = [
  "franvaro",
  "coachning",
  "order",
  "kurs",
  "coachningsuppgift",
  "uppgift",
] as const;
export type Kalenderslag = (typeof KALENDERSLAG)[number];

export const SLAG_ETIKETT: Record<Kalenderslag, string> = {
  franvaro: "Ledighet",
  coachning: "Coachningssamtal",
  order: "Orderfrist",
  kurs: "Kursfrist",
  coachningsuppgift: "Coachningsuppgift",
  uppgift: "Uppgift",
};

/**
 * Tonen posten ritas i. Samma namn som färgtokens i globals.css.
 *
 * COACHNINGSSAMTALET OCH COACHNINGSUPPGIFTEN DELAR TON MED FLIT. De kommer ur
 * samma modul och betyder samma sak för den som tittar — "det här är sådant jag
 * ska träna på". En sjätte färg hade tvingat in en distinktion i ögat som inte
 * finns i huvudet, och en kalender med sex färger är en kalender där färgen
 * slutar betyda något.
 */
export const SLAG_TON: Record<Kalenderslag, "brand" | "info" | "accent" | "warn" | "ok"> = {
  franvaro: "ok",
  coachning: "info",
  order: "warn",
  kurs: "accent",
  coachningsuppgift: "info",
  uppgift: "brand",
};

/**
 * Är posten något NÅGON HAR LOVAT ATT GÖRA, till skillnad från något som
 * inträffar?
 *
 * Skillnaden bär dagssumman nedan, och den är hela skälet att funktionen finns
 * i stället för en hårdkodad jämförelse mot `"uppgift"`. En ledighetsdag, en
 * kursfrist och en orderfrist TAR ingen tid — de infaller. Ett coachningssamtal
 * har ingen längd alls (`held_on` är en dag, 0043). En uppgift och en
 * coachningsuppgift är däremot båda åtaganden med en uppskattad längd, och den
 * som lagt ut fyra timmars coachning på en dag har fyra timmar mindre kvar av
 * den — vare sig talet under dagen räknar det eller inte.
 */
export function arAtagande(slag: Kalenderslag): boolean {
  return slag === "uppgift" || slag === "coachningsuppgift";
}

/**
 * Vad "Ny post" kan bli.
 *
 * TVÅ VÄRDEN OCH INTE SEX. De andra fyra slagen är sådant navet RÄKNAR FRAM —
 * en beviljad ledighet kommer ur en ansökan, en kursfrist ur ett
 * anställningsdatum, en orderfrist ur kalendariet, ett coachningssamtal ur en
 * bokning i sin egen modul. Ingen av dem är något man skriver i en kalender,
 * och den dag en av dem dyker upp här har kalendern börjat äga något.
 *
 * Listan bor i den här filen och inte i `kalender/actions.ts` av samma skäl som
 * allt annat härinne: en "use server"-modul får bara exportera asynkrona
 * funktioner, och provet ska kunna läsa värdena utan att dra in en server-fil.
 */
export const POSTTYPER = ["uppgift", "coachning"] as const;
export type Posttyp = (typeof POSTTYPER)[number];

export type Kalenderpost = {
  /** Stabil över hämtningar. Bär slaget, så två tabeller inte kan kollidera. */
  id: string;
  slag: Kalenderslag;
  /**
   * Raden posten kom ur, när den har en. Uppgiftens `task.id`.
   *
   * SKILD FRÅN `id`, som bär slaget och ibland en dag — två tabeller får inte
   * kunna kollidera i en React-nyckel. `ref` är det som skickas till
   * `planera()` när posten dras, och den är NULL så snart nivån inte öppnar
   * raden: utan den går det inte att bygga ett anrop mot något man inte får se.
   */
  ref: string | null;
  /** Vems dag posten hör till. */
  employee_id: string;
  /** Svenskt kalenderdatum. */
  dag: string;
  /** "14:30", eller null för en post som gäller hela dagen. */
  tid: string | null;
  /** Längd i minuter. Null när posten saknar uppskattning. */
  minuter: number | null;
  /**
   * Vad posten heter. NULL BETYDER "UPPTAGEN" — se `serRubrik()`. Fältet är
   * nullbart just för att grundläget ska gå att bära i samma typ som allt
   * annat; en separat "hemlig post"-typ hade betytt två vägar genom vyn, och
   * den dag de skiljer sig är det den hemliga som ritas fel.
   */
  rubrik: string | null;
  /** Dit man klickar, när posten alls går att öppna. */
  href: string | null;
  /** Kan den dras till ett annat klockslag? Bara uppgifter, och bara egna. */
  flyttbar: boolean;
  /** Har passerat utan att bli gjord. Ritas som en vägg och inte som en plan. */
  forsenad: boolean;
  /** Avbockad. Ritas nedtonad — dagen ska visa vad man gjorde, inte bara vad som återstår. */
  klar: boolean;
};

/** Har posten ett klockslag, alltså en plats i rutnätet? */
export function arTidsatt(p: Kalenderpost): boolean {
  return p.tid !== null;
}

/** Startminut i dygnet. −1 för en heldagspost, som inte har någon. */
export function start(p: Kalenderpost): number {
  return tidTillMinuter(p.tid) ?? -1;
}

/** Slutminut. En post utan uppskattad längd får `STANDARDLANGD` att ritas i. */
export function slut(p: Kalenderpost): number {
  const b = start(p);
  if (b < 0) return -1;
  return b + Math.max(RUTA, p.minuter ?? STANDARDLANGD);
}

/** Poster med klockslag utanför det ritade fönstret. Samlas ovanför rutnätet. */
export function utanforDygnet(poster: readonly Kalenderpost[]): Kalenderpost[] {
  return poster.filter((p) => arTidsatt(p) && (start(p) < DAG_START || start(p) >= DAG_SLUT));
}

export function iDygnet(poster: readonly Kalenderpost[]): Kalenderpost[] {
  return poster.filter((p) => arTidsatt(p) && start(p) >= DAG_START && start(p) < DAG_SLUT);
}

export function heldagsposter(poster: readonly Kalenderpost[]): Kalenderpost[] {
  return [...poster.filter((p) => !arTidsatt(p))].sort(
    (a, b) => KALENDERSLAG.indexOf(a.slag) - KALENDERSLAG.indexOf(b.slag),
  );
}

export type Utlagd = Kalenderpost & {
  /** Spalt 0..spalter-1. Två poster på samma tid delar bredden. */
  spalt: number;
  spalter: number;
};

/**
 * Två uppgifter på samma klockslag ska ligga BREDVID varandra, inte ovanpå.
 *
 * ===========================================================================
 * ATT DÖLJA EN KROCK ÄR ATT BYGGA IN DEN
 *
 * En kalender som ritar den andra posten ovanpå den första ser prydlig ut och
 * ljuger om precis den sak man öppnar den för att få veta. Krocken är inte ett
 * fel i vyn — den är ett fel i planen, och den syns bara om båda posterna ritas.
 *
 * Algoritmen är den vanliga: sortera på starttid, samla poster som överlappar
 * i en klunga, och ge klungan lika många spalter som dess värsta samtidighet.
 * Spaltantalet räknas per KLUNGA och inte per post, så två poster som krockar
 * klockan nio inte gör hela dagen tvåspaltig.
 * ===========================================================================
 */
export function laggUt(poster: readonly Kalenderpost[]): Utlagd[] {
  const tidsatta = [...iDygnet(poster)].sort((a, b) => {
    const s = start(a) - start(b);
    if (s !== 0) return s;
    // Lika start: den längre först, så den korta hamnar till höger om den.
    const l = slut(b) - slut(a);
    if (l !== 0) return l;
    return a.id < b.id ? -1 : 1;
  });

  const ut: Utlagd[] = [];
  let klunga: Utlagd[] = [];
  let klungansSlut = -1;

  const stang = () => {
    for (const p of klunga) p.spalter = Math.max(1, ...klunga.map((k) => k.spalt + 1));
    ut.push(...klunga);
    klunga = [];
    klungansSlut = -1;
  };

  for (const p of tidsatta) {
    // Ingen överlappning med klungan som byggs? Då är den färdig.
    if (klunga.length > 0 && start(p) >= klungansSlut) stang();

    // Första lediga spalten bland dem som fortfarande pågår.
    const upptagna = new Set(klunga.filter((k) => slut(k) > start(p)).map((k) => k.spalt));
    let spalt = 0;
    while (upptagna.has(spalt)) spalt++;

    klunga.push({ ...p, spalt, spalter: 1 });
    klungansSlut = Math.max(klungansSlut, slut(p));
  }

  if (klunga.length > 0) stang();
  return ut;
}

// -----------------------------------------------------------------------------
// Dagssumman
// -----------------------------------------------------------------------------

/**
 * "Planerat 4 h av 6 h" — beställarens ord, och siffran är hela poängen.
 *
 * BARA ÅTAGANDEN RÄKNAS, och bara de som inte är klara. En ledighetsdag är inte
 * fyra timmars planerat arbete, och en kursfrist tar inte tid — den infaller.
 * Räknades de med hade talet blivit en mätare på hur full kalendern ser ut i
 * stället för på hur mycket man lovat sig själv att göra, och det är den andra
 * frågan som gör att man planerar om i tid.
 *
 * COACHNINGSUPPGIFTEN KOM MED 2026-09-14, i samma pass som den blev möjlig att
 * skapa härifrån. Villkoret hette `p.slag === "uppgift"` fram till dess, och det
 * hade räknat en timmes rollspel klockan tio som noll — alltså lovat dagen sex
 * timmar till som inte fanns. Se `arAtagande()`.
 *
 * EN UPPGIFT UTAN UPPSKATTNING RÄKNAS SOM NOLL, inte som `STANDARDLANGD`. Den
 * ritas i trettio minuter för att gå att se, men att räkna en gissning in i
 * summan hade gjort talet till något annat än vad användaren skrivit — och
 * "planerat 6 h av 6 h" som kommer ur fyra gissningar är ett tal man slutar tro
 * på. `oskattade` nedan bär i stället hur många som saknar sitt tal, och vyn
 * säger det rakt ut.
 */
export function dagssumma(poster: readonly Kalenderpost[]): {
  minuter: number;
  oskattade: number;
  antal: number;
  tak: number;
  over: boolean;
} {
  const uppgifter = poster.filter((p) => arAtagande(p.slag) && !p.klar);
  const minuter = uppgifter.reduce((s, p) => s + (p.minuter ?? 0), 0);

  return {
    minuter,
    oskattade: uppgifter.filter((p) => !p.minuter).length,
    antal: uppgifter.length,
    tak: DAGSTAK,
    over: minuter > DAGSTAK,
  };
}

/** "4 h", "30 min", "1 h 30 min". Samma form som `tidstext` i uppgifter.ts. */
export function langd(minuter: number): string {
  const h = Math.floor(minuter / 60);
  const m = minuter % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// -----------------------------------------------------------------------------
// Datumräkning
//
// Egen och inte klockans, av samma skäl som i uppgifter.ts: här räknas
// KALENDERDYGN mellan två datumsträngar, vilket är en annan fråga än vilken
// svensk väggtid en tidpunkt motsvarar. Datumen är redan svenska när de kommer.
// -----------------------------------------------------------------------------

function tal(datum: string): number {
  const [a, m, d] = datum.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

function fran(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function dagPlus(datum: string, dagar: number): string {
  return fran(tal(datum) + dagar * 86_400_000);
}

export function dagarMellan(fransta: string, till: string): number {
  return Math.round((tal(till) - tal(fransta)) / 86_400_000);
}

/** 1 = måndag … 7 = söndag. */
export function veckodag(datum: string): number {
  return ((new Date(tal(datum)).getUTCDay() + 6) % 7) + 1;
}

/** Måndagen i datumets vecka. */
export function veckostart(datum: string): string {
  return dagPlus(datum, 1 - veckodag(datum));
}

/** Veckans sju dagar, måndag först. */
export function veckansDagar(datum: string): string[] {
  const start = veckostart(datum);
  return [0, 1, 2, 3, 4, 5, 6].map((i) => dagPlus(start, i));
}

/**
 * ISO-veckonummer.
 *
 * Torsdagsregeln: veckan hör till det år dess torsdag ligger i. Utan den blir
 * nyårsveckan fel vartannat år, och ett veckonummer som är fel en vecka om året
 * är ett veckonummer ingen litar på resten av året heller.
 */
export function veckonummer(datum: string): number {
  const torsdag = dagPlus(datum, 4 - veckodag(datum));
  const ar = Number(torsdag.slice(0, 4));
  const forstaJan = `${ar}-01-01`;
  return Math.floor(dagarMellan(forstaJan, torsdag) / 7) + 1;
}

const VECKODAG_KORT: Record<number, string> = {
  1: "mån", 2: "tis", 3: "ons", 4: "tors", 5: "fre", 6: "lör", 7: "sön",
};

const VECKODAG_LANG: Record<number, string> = {
  1: "Måndag", 2: "Tisdag", 3: "Onsdag", 4: "Torsdag", 5: "Fredag", 6: "Lördag", 7: "Söndag",
};

const MANAD_KORT: Record<number, string> = {
  1: "jan", 2: "feb", 3: "mar", 4: "apr", 5: "maj", 6: "jun",
  7: "jul", 8: "aug", 9: "sep", 10: "okt", 11: "nov", 12: "dec",
};

export function dagKort(datum: string): string {
  return `${VECKODAG_KORT[veckodag(datum)]} ${Number(datum.slice(8, 10))} ${MANAD_KORT[Number(datum.slice(5, 7))]}`;
}

/**
 * Dagens rubrik över kolumnen.
 *
 * "Idag" och "I morgon" står i stället för veckodagen, och det är inte en
 * artighet: den som tittar på en dagvy behöver först och främst veta OM det är
 * idag, eftersom det avgör om en försenad post går att göra något åt.
 */
export function dagrubrik(datum: string, idag: string): string {
  const d = dagarMellan(idag, datum);
  if (d === 0) return "Idag";
  if (d === 1) return "I morgon";
  if (d === -1) return "I går";
  return `${VECKODAG_LANG[veckodag(datum)]} ${Number(datum.slice(8, 10))} ${MANAD_KORT[Number(datum.slice(5, 7))]}`;
}

export function arHelg(datum: string): boolean {
  return veckodag(datum) >= 6;
}

// -----------------------------------------------------------------------------
// Plinget
// -----------------------------------------------------------------------------

/**
 * Så lång varsel ett pling har.
 *
 * TIO MINUTER. Kortare och beskedet kommer efter att man redan börjat något
 * annat; längre och det kommer medan man fortfarande arbetar med det förra, och
 * då är det ett avbrott utan handling. Talet står här och inte i komponenten
 * för att provet ska kunna räkna med det.
 */
export const PLING_VARSEL_MINUTER = 10;

/**
 * Vilka poster som ska pinga, givet vad klockan är.
 *
 * FÖNSTRET HAR BÅDA ÄNDARNA. Ett pling som bara frågar "är det mindre än tio
 * minuter kvar" plingar om nio timmar gamla poster också, eftersom skillnaden
 * blir negativ. Nedre gränsen är noll: en post vars klockslag redan passerat
 * har man antingen sett eller missat, och ett pling efteråt är en tillsägelse.
 */
export function attPlinga(
  poster: readonly Kalenderpost[],
  idag: string,
  nuMinuter: number,
): Kalenderpost[] {
  return poster.filter((p) => {
    if (p.dag !== idag || p.klar) return false;
    const b = start(p);
    if (b < 0) return false;
    const kvar = b - nuMinuter;
    return kvar >= 0 && kvar <= PLING_VARSEL_MINUTER;
  });
}

/** Texten i webbläsarens ruta. "Om 10 min", "Nu". */
export function plingtext(p: Kalenderpost, nuMinuter: number): string {
  const kvar = start(p) - nuMinuter;
  const nar = kvar <= 0 ? "Nu" : `Om ${kvar} min`;
  return `${nar} · ${p.tid}${p.minuter ? ` · ${langd(p.minuter)}` : ""}`;
}
