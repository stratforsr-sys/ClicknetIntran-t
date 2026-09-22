/**
 * Veckogenomgången. Ren logik, inga importer utom systerfilerna i lib.
 *
 * Ligger här och inte i en server action-fil av samma skäl som `uppgifter.ts`
 * och `kalender.ts`: en "use server"-modul exponerar varje export som en
 * anropbar slutpunkt. Allt härinne provas av tests/genomgang.mjs, utan databas.
 *
 * =============================================================================
 * GENOMGÅNGEN ÄR EN HANDLING, INTE EN VY
 *
 * Beställarens val 2026-09-22, av tre alternativ. Skillnaden mot ett kort som
 * räknar upp vad som glidit är hela poängen: ett kort läser man, en genomgång
 * gör man klart. Sidan tar därför ETT STEG I TAGET, har handlingarna på plats i
 * varje steg, och slutar med ett kvitto.
 *
 * Konstruktionen vilar på samma fynd som bär hela uppgiftsmodulen: en uppgift
 * med ett utskrivet NÄR blir gjord ungefär dubbelt så ofta (Gollwitzer, d =
 * 0,65 över 94 studier). Steg 2 finns bara för att förvandla rader utan dag
 * till rader med dag, och knapparna står på raden så att det ska vara mindre
 * arbete att ge den en dag än att skrolla förbi.
 *
 * =============================================================================
 * STEGEN RÄKNAS FRAM VID VARJE LÄSNING. INGENTING LAGRAS.
 *
 * `weekly_review` (0066) bär EN sak: att genomgången är gjord den här veckan.
 * Vilket steg man står på och vilka rader man betat av lagras inte, och det är
 * ett val — se rubriken i migrationen. Kort sagt: raderna ändras MEDAN man går
 * igenom dem, eftersom det är precis det man gör, och ett lagrat tillstånd hade
 * sagt "två kvar" om en tom lista.
 * =============================================================================
 */

import {
  arStangd,
  dagarMellan,
  datumPlusDagar,
  forsenad,
  veckodag,
  type Uppgiftsrad,
} from "./uppgifter.ts";
import { DAGSTAK, arHelg, veckansDagar, veckonummer, veckostart } from "./kalender.ts";

// -----------------------------------------------------------------------------
// Raden
// -----------------------------------------------------------------------------

/**
 * `Uppgiftsrad` plus hur länge den stått still.
 *
 * `stilla` räknas INTE här, och det är inte slarv: talet kommer ur
 * `updated_at`, som är en tidpunkt och inte ett kalenderdatum — att göra om den
 * till en svensk dag kräver `svensktDatum()`, som läser en tidszon. Serverns
 * `stilla()` i uppgifter-server.ts gör det redan för delegeringslistan, och ett
 * andra räknesätt här hade varit ett andra svar på samma fråga.
 */
export type Genomgangsrad = Uppgiftsrad & { stilla: number };

export type Genomgangsprojekt = {
  id: string;
  name: string;
  color: string;
  due_date: string | null;
  archived_at: string | null;
};

// -----------------------------------------------------------------------------
// Stegen
// -----------------------------------------------------------------------------

export const STEG = ["forfallet", "utanDag", "vantar", "projekt", "nastaVecka"] as const;
export type Stegid = (typeof STEG)[number];

export const STEG_RUBRIK: Record<Stegid, string> = {
  forfallet: "Förfallet",
  utanDag: "Inkorgen",
  vantar: "Väntar på andra",
  projekt: "Projekt som stannat",
  nastaVecka: "Nästa vecka",
};

/**
 * Ledtexten i varje steg — VARFÖR steget finns, inte vad man ska klicka på.
 *
 * Skriven till den som står mitt i genomgången och undrar om det här steget är
 * värt en minut till. "Flytta eller stryk" säger vad knapparna gör; "en frist
 * som passerat utan att någon flyttat den är en frist ingen längre tror på"
 * säger varför man ska orka.
 */
export const STEG_LEDTEXT: Record<Stegid, string> = {
  forfallet:
    "En frist som passerat utan att någon flyttat den är en frist ingen längre tror på — och en lista med sex sådana är en lista man slutar öppna. Ge dem en ny dag, eller stryk dem.",
  utanDag:
    "En uppgift med ett utskrivet NÄR blir gjord ungefär dubbelt så ofta som en utan. Det är den enda siffran i den här modulen som är hämtad ur forskning och inte ur tyckande.",
  vantar:
    "Det du lämnat ifrån dig är det du själv slutar tänka på. Siffran är hur länge det stått still — inte hur länge sedan du la upp det.",
  projekt:
    "Ett projekt utan en enda öppen uppgift har inget nästa steg. Det är antingen färdigt eller glömt, och båda svaren kräver att någon säger det.",
  nastaVecka:
    "Sex timmar är vad en arbetsdag rymmer när möten och avbrott räknats bort. En dag som redan är full på måndag blir inte tommare av att du lägger dit en sak till.",
};

/**
 * Stegets namn när det står EFTER ETT TAL.
 *
 * "6 inkorgen" och "1 nästa vecka" är inte svenska. Rubrikerna ovan är
 * substantiv som namnger en vy; de här är räkneord som beskriver rader, och det
 * är två olika texter även när de handlar om samma sak.
 *
 * Används av kortet på `/uppgifter` och av posten i klockan — alltså av de två
 * ställen där talen står utan sin rubrik och ändå måste gå att läsa i en
 * mening. `antalstext()` nedan böjer efter ental och flertal.
 */
export const STEG_RAKNAT: Record<Stegid, [ental: string, flertal: string]> = {
  forfallet: ["förfallen", "förfallna"],
  utanDag: ["utan dag", "utan dag"],
  vantar: ["väntar på svar", "väntar på svar"],
  projekt: ["stannat projekt", "stannade projekt"],
  nastaVecka: ["överbokad dag", "överbokade dagar"],
};

/** "3 förfallna · 6 utan dag · 1 stannat projekt". Tomma steg står inte med. */
export function antalstext(antal: Stegantal): string {
  return STEG.filter((id) => antal[id] > 0)
    .map((id) => `${antal[id]} ${STEG_RAKNAT[id][antal[id] === 1 ? 0 : 1]}`)
    .join(" · ");
}

/** Tomtexten när ett steg inte har något att visa. Beröm, inte tystnad. */
export const STEG_TOMTEXT: Record<Stegid, string> = {
  forfallet: "Ingenting har förfallit. Det är ovanligt nog att vara värt att notera.",
  utanDag: "Varje uppgift har en dag. Inkorgen är tom.",
  vantar: "Du väntar inte på någon.",
  projekt: "Alla projekt har minst en öppen uppgift.",
  nastaVecka: "Ingenting är planerat på nästa vecka än.",
};

export function nastaSteg(steg: Stegid): Stegid | null {
  const i = STEG.indexOf(steg);
  return i >= 0 && i < STEG.length - 1 ? STEG[i + 1] : null;
}

export function foregaendeSteg(steg: Stegid): Stegid | null {
  const i = STEG.indexOf(steg);
  return i > 0 ? STEG[i - 1] : null;
}

export function arSteg(varde: unknown): varde is Stegid {
  return typeof varde === "string" && (STEG as readonly string[]).includes(varde);
}

// -----------------------------------------------------------------------------
// Innehållet i varje steg
//
// FEM FILTER ÖVER SAMMA RADER, aldrig fem frågor. Samma val som vyerna i
// uppgifter-server.ts gjorde: en uppgift ska kunna räknas i två steg utan att
// hämtas två gånger, och en förfallen uppgift som dessutom ligger hos någon
// annan hör hemma i båda.
// -----------------------------------------------------------------------------

/**
 * Steg 1. Mina egna, öppna, med en frist som passerat.
 *
 * `forsenad()` och inte `due_date < idag`, för den frågan har redan ett svar i
 * uppgifter.ts som väger in läget — en inlämnad uppgift som väntar på en
 * granskare är inte försenad av mig.
 */
export function forfallet(rader: readonly Genomgangsrad[], mig: string, idag: string): Genomgangsrad[] {
  return rader
    .filter((u) => u.assignee_id === mig && forsenad(u, idag))
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
}

/**
 * Steg 2. Allt öppet utan dag — mina egna OCH inkorgen.
 *
 * TVÅ LISTOR SLÅS IHOP TILL ETT STEG, och det är avsiktligt. `/uppgifter` har
 * dem som skilda flikar, för där svarar de på olika frågor: "vad ligger på mig"
 * och "vad har jag skrivit ner utan att ta ställning till". I en genomgång är
 * frågan densamma för båda — vilken dag ska det här ske? — och två steg som
 * ställer samma fråga är ett steg för mycket i ett flöde man ska orka igenom.
 *
 * DEN SOM SAKNAR ANSVARIG FÅR EN EXTRA KNAPP i vyn ("ta den själv"). Skillnaden
 * finns kvar i raden, den har bara inte fått ett eget steg.
 */
export function utanDag(rader: readonly Genomgangsrad[], mig: string): Genomgangsrad[] {
  return rader
    .filter(
      (u) =>
        !arStangd(u.lage) &&
        u.due_date === null &&
        (u.assignee_id === mig || (u.assignee_id === null && u.created_by === mig)),
    )
    .sort((a, b) => a.priority - b.priority || b.stilla - a.stilla);
}

/** Så länge får något ligga hos någon annan innan genomgången tar upp det. */
export const STILLA_DAGAR = 3;

/**
 * Steg 3. Det jag delegerat som stått still.
 *
 * TRE DYGN OCH INTE FEM, till skillnad från klockans `uppgift-vantar`. Talen
 * skiljer sig för att posterna gör olika saker: klockan AVBRYTER en arbetsdag
 * och ska bara göra det när något verkligen fastnat, medan genomgången är något
 * man redan bestämt sig för att sitta med. Tröskeln får därför vara lägre här —
 * den kostar en blick, inte ett avbrott.
 */
export function vantar(rader: readonly Genomgangsrad[], mig: string): Genomgangsrad[] {
  return rader
    .filter(
      (u) =>
        u.created_by === mig &&
        u.assignee_id !== null &&
        u.assignee_id !== mig &&
        !arStangd(u.lage) &&
        u.stilla >= STILLA_DAGAR,
    )
    .sort((a, b) => b.stilla - a.stilla);
}

/**
 * Steg 4. Projekt utan en enda öppen uppgift.
 *
 * ARKIVERADE PROJEKT STÅR UTANFÖR. Ett arkiverat projekt SKA vara tomt — det är
 * vad arkivering betyder — och att räkna upp dem hade gjort steget till en
 * lista över allt man någonsin avslutat.
 *
 * ETT TOMT PROJEKT RÄKNAS MED. Det är den vanligaste formen av stannat projekt:
 * någon lade upp behållaren, tänkte lägga in arbetet sedan, och gjorde aldrig
 * det. Ett projekt som aldrig fick en uppgift är precis lika stannat som ett där
 * den sista bockades av.
 */
export function stannadeProjekt(
  projekt: readonly Genomgangsprojekt[],
  rader: readonly Genomgangsrad[],
): Genomgangsprojekt[] {
  const oppnaPerProjekt = new Set(
    rader.filter((u) => u.project_id && !arStangd(u.lage)).map((u) => u.project_id as string),
  );

  return projekt
    .filter((p) => !p.archived_at && !oppnaPerProjekt.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));
}

// -----------------------------------------------------------------------------
// Steg 5 — nästa vecka
// -----------------------------------------------------------------------------

export type Dagslast = {
  dag: string;
  /** Uppskattade minuter. Rader utan uppskattning räknas som noll, se nedan. */
  minuter: number;
  antal: number;
  /** Hur många av dagens rader som saknar sin uppskattning. */
  oskattade: number;
  tak: number;
  over: boolean;
  helg: boolean;
};

/**
 * Måndag till söndag i veckan EFTER den `idag` ligger i.
 *
 * Genomgången görs på fredagen, och frågan man ställer då gäller nästa vecka —
 * inte den som håller på att ta slut. Helgen står med och ritas nedtonad: en
 * uppgift som råkat hamna på en lördag ska synas i steget som handlar om att
 * hitta sådant, inte gömmas av att vyn tycker att lördagar inte finns.
 */
export function nastaVeckansDagar(idag: string): string[] {
  return veckansDagar(datumPlusDagar(veckostart(idag), 7));
}

export function nastaVeckansNummer(idag: string): number {
  return veckonummer(datumPlusDagar(veckostart(idag), 7));
}

/**
 * Lasten per dag.
 *
 * EN OSKATTAD UPPGIFT RÄKNAS SOM NOLL MINUTER, aldrig som en gissning. Det är
 * samma linje som `dagssumma()` i kalender.ts drar, och av samma skäl: ett tal
 * som kommer ur fyra gissningar är ett tal man slutar tro på. `oskattade` bär i
 * stället antalet, och vyn säger det rakt ut.
 *
 * BARA MINA EGNA RADER. Steget svarar på om MIN vecka är överbokad; kollegans
 * kalender har en egen sida och en egen delningsnivå.
 */
export function veckolast(
  rader: readonly Genomgangsrad[],
  mig: string,
  dagar: readonly string[],
): Dagslast[] {
  return dagar.map((dag) => {
    const pa = rader.filter((u) => u.assignee_id === mig && !arStangd(u.lage) && u.due_date === dag);
    const minuter = pa.reduce((s, u) => s + (u.estimate_minutes ?? 0), 0);

    return {
      dag,
      minuter,
      antal: pa.length,
      oskattade: pa.filter((u) => !u.estimate_minutes).length,
      tak: DAGSTAK,
      over: minuter > DAGSTAK,
      helg: arHelg(dag),
    };
  });
}

/** Raderna som ligger på en dag i nästa vecka. Steget listar dem under stapeln. */
export function nastaVeckansRader(
  rader: readonly Genomgangsrad[],
  mig: string,
  dagar: readonly string[],
): Genomgangsrad[] {
  const inom = new Set(dagar);
  return rader
    .filter((u) => u.assignee_id === mig && !arStangd(u.lage) && u.due_date && inom.has(u.due_date))
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.priority - b.priority);
}

export type Dagsblock = Dagslast & { rader: Genomgangsrad[] };

/**
 * Lasten och raderna PARADE PER DAG.
 *
 * =============================================================================
 * EN DAG ÄR EN RAD, INTE EN STAPEL I ETT DIAGRAM
 *
 * Steget ritades först som sju lodräta staplar med uppgifterna i en platt lista
 * under. Två saker var fel med det, och båda syntes först när det fanns riktig
 * data i vyn:
 *
 *   1. STAPLARNA SVARADE PÅ FRÅGAN, LISTAN LÖSTE PROBLEMET, OCH DE STOD LÅNGT
 *      IFRÅN VARANDRA. Man ser att torsdagen är överbokad, och måste sedan leta
 *      i en lista på fjorton rader efter vad som ligger på torsdagen.
 *
 *   2. SJU KOLUMNER RYMS INTE I EN TELEFON. Etiketterna blev tre tecken breda
 *      och talen under dem oläsliga — alltså precis den information steget
 *      finns för.
 *
 * Med dagen som rad står lasten och sakerna som orsakar den på samma ställe,
 * och man kan flytta en uppgift från den fulla dagen utan att först lista ut
 * vilken den var. Funktionen finns här och inte i komponenten för att paret
 * ska gå att prova utan en webbläsare.
 * =============================================================================
 */
export function veckansDagsblock(
  rader: readonly Genomgangsrad[],
  mig: string,
  dagar: readonly string[],
): Dagsblock[] {
  const per = new Map<string, Genomgangsrad[]>();
  for (const u of nastaVeckansRader(rader, mig, dagar)) {
    const lista = per.get(u.due_date as string);
    if (lista) lista.push(u);
    else per.set(u.due_date as string, [u]);
  }

  return veckolast(rader, mig, dagar).map((d) => ({ ...d, rader: per.get(d.dag) ?? [] }));
}

/**
 * Hur hög stapeln ska ritas, i procent av dagstaket.
 *
 * KLIPPS VID 100 OCH INTE VID DEN FULLASTE DAGEN. En relativ skala hade gjort
 * veckans värsta dag fullhög varje vecka — också en vecka med fyrtio minuter om
 * dagen — och då säger bilden bara vilken dag som är värst, aldrig om någon dag
 * är för full. Det är den andra frågan steget finns för.
 *
 * EN DAG MED NÅGOT PÅ SIG FÅR ALLTID MINST TVÅ PROCENT. Utan golvet ritas en
 * tjugominutersdag som exakt ingenting, alltså likadant som en tom dag, och
 * skillnaden mellan "inget planerat" och "något litet planerat" är hela poängen
 * med att titta.
 */
export function stapelandel(last: Dagslast): number {
  if (last.minuter <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((last.minuter / last.tak) * 100)));
}

// -----------------------------------------------------------------------------
// Räkningen och påminnelsen
// -----------------------------------------------------------------------------

export type Stegantal = Record<Stegid, number>;

/**
 * Hur många rader varje steg har. Bär prickraden överst och kortet på
 * uppgiftssidan, och är det enda stället som vet att de fem är fem.
 *
 * `nastaVecka` RÄKNAR ÖVERBOKADE DAGAR och inte rader, och det är inte en
 * inkonsekvens. De fyra första stegen räknar sådant som kräver ett beslut per
 * rad; det femte kräver ett beslut per DAG — en dag med nio timmar planerat är
 * ett problem oavsett om det är två uppgifter eller elva.
 */
export function stegantal(
  rader: readonly Genomgangsrad[],
  projekt: readonly Genomgangsprojekt[],
  mig: string,
  idag: string,
): Stegantal {
  return {
    forfallet: forfallet(rader, mig, idag).length,
    utanDag: utanDag(rader, mig).length,
    vantar: vantar(rader, mig).length,
    projekt: stannadeProjekt(projekt, rader).length,
    nastaVecka: veckolast(rader, mig, nastaVeckansDagar(idag)).filter((d) => d.over).length,
  };
}

export function totaltAttGaIgenom(antal: Stegantal): number {
  return STEG.reduce((s, id) => s + antal[id], 0);
}

/**
 * Veckodagen påminnelsen tänds.
 *
 * FREDAG. GTD:s veckogenomgång läggs traditionellt på fredag eftermiddag, och
 * skälet håller här: det som beslutas då gäller en vecka man ännu inte börjat,
 * och beslutet att flytta en uppgift till tisdag är lättare att fatta innan
 * tisdagen redan har fyra saker i sig. En påminnelse på måndag morgon kommer i
 * stället mitt i den vecka den skulle ha planerat.
 */
export const PAMINN_FRAN_VECKODAG = 5;

export type Genomgangslage = {
  /** Måndagen i veckan `idag` ligger i. Nyckeln i `weekly_review`. */
  vecka: string;
  gjord: boolean;
  /** Ska navet säga till? Sant från fredag, tills veckan är avbetad. */
  dagsFor: boolean;
  /** Hela veckor sedan senaste genomgången. Null när ingen någonsin gjorts. */
  veckorSedan: number | null;
};

/**
 * Läget, givet dagens datum och måndagen i den senast avbetade veckan.
 *
 * `senasteVecka` är en `week_start` ur `weekly_review` eller null — ALDRIG
 * `completed_at`. Skillnaden syns när någon gör förra veckans genomgång på en
 * måndag: dagen hon klickade är den här veckan, men veckan hon betade av är den
 * förra, och en påminnelse som räknar på klickdagen hade tystnat för fel vecka.
 */
export function genomgangslage(idag: string, senasteVecka: string | null): Genomgangslage {
  const vecka = veckostart(idag);
  const gjord = senasteVecka === vecka;

  return {
    vecka,
    gjord,
    dagsFor: !gjord && veckodag(idag) >= PAMINN_FRAN_VECKODAG,
    veckorSedan: senasteVecka ? Math.round(dagarMellan(senasteVecka, vecka) / 7) : null,
  };
}

/**
 * Texten under "Senast gjord" på kortet.
 *
 * SÄGER ALDRIG "0 veckor sedan". Den som gjorde genomgången i går ska läsa
 * "den här veckan", inte ett tal som kräver att man räknar ut vad det betyder.
 */
export function senasttext(lage: Genomgangslage): string {
  if (lage.veckorSedan === null) return "Aldrig gjord";
  if (lage.veckorSedan === 0) return "Gjord den här veckan";
  if (lage.veckorSedan === 1) return "Gjord förra veckan";
  return `${lage.veckorSedan} veckor sedan`;
}
