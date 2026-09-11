/**
 * Delade regler för uppgiftsmodulen. Ren logik, inga importer.
 *
 * Ligger i lib och inte i en server action-fil eftersom en "use server"-modul
 * exponerar varje export som en anropbar slutpunkt — samma skäl som
 * `coachning.ts` och `utbildning.ts`. Allt härinne provas av tests/uppgifter.mjs.
 */

// -----------------------------------------------------------------------------
// Prioritet
// -----------------------------------------------------------------------------

/**
 * 1 är högst, 4 lägst, 3 är normalläget.
 *
 * SKALAN ÄR VALD EFTER VAD FOLK SKRIVER, inte efter vad som är logiskt. Den som
 * kommer från Todoist skriver `!1` och menar "brådskande", och en skala där 1
 * var lägst hade gjort snabbinmatningen till en fälla. Att 3 och inte 4 är
 * normalläget följer av samma sak: `!4` ska betyda "det här kan vänta", och det
 * betyder det bara om det finns ett steg under det vanliga.
 */
export const PRIORITETER = [1, 2, 3, 4] as const;
export type Prioritet = (typeof PRIORITETER)[number];

export const PRIORITET_ETIKETT: Record<Prioritet, string> = {
  1: "Brådskande",
  2: "Hög",
  3: "Normal",
  4: "Låg",
};

/** Tonen i piller och prickar. Normal och låg får ingen färg alls — se nedan. */
export const PRIORITET_TON: Record<Prioritet, "danger" | "warn" | "neutral"> = {
  1: "danger",
  2: "warn",
  3: "neutral",
  4: "neutral",
};

/**
 * Ska prioriteten alls visas?
 *
 * Nej för 3 och 4, och det är hela poängen med att ha en skala. Om varje rad
 * bär ett prioritetsmärke är ingen rad märkt — märket betyder "den här sticker
 * ut", och då får de som inte sticker ut vara omärkta. Samma regel som
 * primärknappen i UI-PRD §5.4: en per vy, annars ingen.
 */
export function visaPrioritet(p: Prioritet): boolean {
  return p <= 2;
}

// -----------------------------------------------------------------------------
// De inbjudna
// -----------------------------------------------------------------------------

export const MEDLEMSROLLER = ["redigerare", "visare", "granskare"] as const;
export type Medlemsroll = (typeof MEDLEMSROLLER)[number];

export const ROLL_ETIKETT: Record<Medlemsroll, string> = {
  redigerare: "Redigerare",
  visare: "Kan se",
  granskare: "Granskare",
};

export const ROLL_FORKLARING: Record<Medlemsroll, string> = {
  redigerare: "Ändrar uppgiften, lägger till deluppgifter och bockar av.",
  visare: "Läser uppgiften och kommenterar. Ändrar ingenting.",
  granskare: "Måste godkänna innan uppgiften räknas som klar.",
};

// -----------------------------------------------------------------------------
// Läget
// -----------------------------------------------------------------------------

export const HANDELSETYPER = [
  "skapad",
  "tilldelad",
  "paborjad",
  "inlamnad",
  "godkand",
  "returnerad",
  "klar",
  "ateroppnad",
  "avbruten",
  "kommentar",
] as const;
export type Handelsetyp = (typeof HANDELSETYPER)[number];

export const LAGEN = [
  "ej_paborjad",
  "pagar",
  "granskas",
  "returnerad",
  "klar",
  "avbruten",
] as const;
export type Lage = (typeof LAGEN)[number];

export const LAGE_ETIKETT: Record<Lage, string> = {
  ej_paborjad: "Ej påbörjad",
  pagar: "Pågår",
  granskas: "Väntar på godkännande",
  returnerad: "Returnerad",
  klar: "Klar",
  avbruten: "Avbruten",
};

export const LAGE_TON: Record<Lage, "neutral" | "info" | "warn" | "danger" | "ok"> = {
  ej_paborjad: "neutral",
  pagar: "info",
  granskas: "warn",
  returnerad: "danger",
  klar: "ok",
  avbruten: "neutral",
};

/** Lägen där ingen väntar sig något mer. */
export function arStangd(lage: Lage): boolean {
  return lage === "klar" || lage === "avbruten";
}

/**
 * Vilket läge händelserna lägger sig i.
 *
 * `kommentar` och `tilldelad` står inte med: en kommentar på en klar uppgift
 * gör den inte ogjord, och att byta ansvarig på något som pågår avbryter inte
 * arbetet. Det är exakt den sortens tyst tillbakarullning en status-kolumn
 * hade gjort omöjlig att upptäcka.
 *
 * Listan förutsätter att händelserna kommer i tidsordning, äldst först.
 */
const LAGE_AV_HANDELSE: Partial<Record<Handelsetyp, Lage>> = {
  skapad: "ej_paborjad",
  paborjad: "pagar",
  inlamnad: "granskas",
  godkand: "klar",
  klar: "klar",
  returnerad: "returnerad",
  ateroppnad: "ej_paborjad",
  avbruten: "avbruten",
};

export function lageAv(handelser: readonly { type: Handelsetyp }[]): Lage {
  let lage: Lage = "ej_paborjad";
  for (const h of handelser) {
    const nytt = LAGE_AV_HANDELSE[h.type];
    if (nytt) lage = nytt;
  }
  return lage;
}

// -----------------------------------------------------------------------------
// Vem som får göra vad
//
// SKRIVNING GÅR VIA SERVICE ROLE OCH FÖRBI RLS (D-T1). Funktionerna här är
// alltså inte en bekvämlighet för gränssnittet utan den enda kontrollen som
// finns, och de anropas från server action innan varje skrivning.
// -----------------------------------------------------------------------------

export type Krets = {
  /** Den inloggades employee-id. */
  mig: string;
  assignee_id: string | null;
  created_by: string;
  /** Rollen den inloggade har som inbjuden, om någon. */
  minRoll: Medlemsroll | null;
};

/** Ändra rubrik, frist, koppling, inbjudna. */
export function farRedigera(k: Krets): boolean {
  return k.created_by === k.mig || k.assignee_id === k.mig || k.minRoll === "redigerare";
}

/**
 * Bjuda in andra och peka ut granskare.
 *
 * SNÄVARE ÄN REDIGERA, med flit. En redigerare som får bjuda in fler
 * redigerare kan bygga ut kretsen kring någon annans anteckning utan att
 * ägaren märker det, och kretsen är hela integritetslöftet i den här modulen.
 */
export function farBjudaIn(k: Krets): boolean {
  return k.created_by === k.mig || k.assignee_id === k.mig;
}

/** Markera klar, eller lämna in till granskning om det finns granskare. */
export function farArbeta(k: Krets): boolean {
  return farRedigera(k);
}

/**
 * Godkänna eller returnera.
 *
 * FÖRST TILL KVARN — beställarens beslut 2026-09-11. Vem som helst av
 * granskarna räcker, och den som godkänner stänger uppgiften för alla.
 * Skälet är driften: en granskare på semester ska inte kunna stoppa ett
 * projekt, och rollen "någon i ledningen ska sanktionera det här" är den
 * vanligaste av dem.
 *
 * Den som lade upp uppgiften får INTE godkänna av att vara skapare. Vill hen
 * kunna det får hen stå med som granskare — annars vore granskarlistan en
 * rekommendation.
 */
export function farGranska(k: Krets): boolean {
  return k.minRoll === "granskare";
}

// -----------------------------------------------------------------------------
// Frister
// -----------------------------------------------------------------------------

export type Uppgiftsrad = {
  id: string;
  title: string;
  assignee_id: string | null;
  created_by: string;
  project_id: string | null;
  parent_id: string | null;
  due_date: string | null;
  due_time: string | null;
  starts_on: string | null;
  estimate_minutes: number | null;
  priority: Prioritet;
  lage: Lage;
  /** Antal granskare på uppgiften. Noll betyder att den bockas av direkt. */
  granskare: number;
};

/** Försenad = har en frist, den har passerat, och den är inte avklarad. */
export function forsenad(u: { due_date: string | null; lage: Lage }, idag: string): boolean {
  if (!u.due_date || arStangd(u.lage)) return false;
  return u.due_date < idag;
}

/**
 * Ordningen i listan.
 *
 * FÖRSENAT FÖRST, sedan dagens, sedan resten efter frist, och odaterat sist.
 * Prioriteten skiljer bara mellan rader som har samma dag — annars hade en
 * `!1` utan datum stått över något som skulle varit gjort i förrgår, och det
 * är rangordning efter hur det kändes när man skrev raden i stället för efter
 * vad som faktiskt brinner.
 */
export function sorteraUppgifter<T extends Uppgiftsrad>(rader: readonly T[], idag: string): T[] {
  const vikt = (u: T) => {
    if (arStangd(u.lage)) return 4;
    if (forsenad(u, idag)) return 0;
    if (u.due_date === idag) return 1;
    if (u.due_date) return 2;
    return 3;
  };

  return [...rader].sort((a, b) => {
    const va = vikt(a);
    const vb = vikt(b);
    if (va !== vb) return va - vb;

    // Inom samma fack: tidigast frist först, sedan klockslag, sedan prioritet.
    const da = a.due_date ?? "9999-12-31";
    const db = b.due_date ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;

    const ta = a.due_time ?? "99:99";
    const tb = b.due_time ?? "99:99";
    if (ta !== tb) return ta < tb ? -1 : 1;

    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.title.localeCompare(b.title, "sv");
  });
}

/** "Idag", "I morgon", "3 dagar sen", "fre 12 sep". Kort nog att stå i en lista. */
export function fristtext(due: string | null, idag: string): string | null {
  if (!due) return null;
  const dagar = dagarMellan(idag, due);
  if (dagar === 0) return "Idag";
  if (dagar === 1) return "I morgon";
  if (dagar === -1) return "I går";
  if (dagar < 0) return `${Math.abs(dagar)} dagar sen`;
  if (dagar < 7) return `${VECKODAG_KORT[veckodag(due)]} ${dagNummer(due)} ${MANAD_KORT[manadNummer(due)]}`;
  return `${dagNummer(due)} ${MANAD_KORT[manadNummer(due)]}`;
}

/** "30 min", "1 h", "1 h 30 min". */
export function tidstext(minuter: number | null): string | null {
  if (!minuter || minuter <= 0) return null;
  const h = Math.floor(minuter / 60);
  const m = minuter % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

// -----------------------------------------------------------------------------
// Datumräkning
//
// Egen och inte klockans: här räknas KALENDERDYGN mellan två datumsträngar, och
// det är en annan fråga än vilken svensk vägg-tid en tidpunkt motsvarar. Båda
// datumen är redan svenska datum när de kommer hit.
// -----------------------------------------------------------------------------

function tal(datum: string): number {
  const [a, m, d] = datum.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

function fran(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function dagarMellan(fransta: string, till: string): number {
  return Math.round((tal(till) - tal(fransta)) / 86_400_000);
}

export function datumPlusDagar(datum: string, dagar: number): string {
  return fran(tal(datum) + dagar * 86_400_000);
}

/** 1 = måndag … 7 = söndag. */
export function veckodag(datum: string): number {
  return ((new Date(tal(datum)).getUTCDay() + 6) % 7) + 1;
}

function dagNummer(datum: string): number {
  return Number(datum.slice(8, 10));
}

function manadNummer(datum: string): number {
  return Number(datum.slice(5, 7));
}

const VECKODAG_KORT: Record<number, string> = {
  1: "mån", 2: "tis", 3: "ons", 4: "tors", 5: "fre", 6: "lör", 7: "sön",
};

const MANAD_KORT: Record<number, string> = {
  1: "jan", 2: "feb", 3: "mar", 4: "apr", 5: "maj", 6: "jun",
  7: "jul", 8: "aug", 9: "sep", 10: "okt", 11: "nov", 12: "dec",
};

// -----------------------------------------------------------------------------
// Snabbinmatningen
//
// =============================================================================
// DEN HÄR FUNKTIONEN ÄR SKILLNADEN MELLAN ETT VERKTYG OCH EN POST-IT-LAPP
//
// Forskningen bakom modulen säger två saker. Det ena är att en uppgift med ett
// utskrivet NÄR blir gjord ungefär dubbelt så ofta som en utan (Gollwitzer,
// d = 0,65 över 94 studier). Det andra är att infångandet måste vara nästan
// gratis — kostar det mer än några sekunder att skriva ner en tanke skrivs den
// någon annanstans, och då finns den inte i systemet alls.
//
// De två kraven drar åt olika håll: ett datumfält, ett personfält och en
// prioritetsväljare är fem klick, och fem klick är inte gratis. Lösningen är
// att låta EN RAD bära allt, och att tolka den.
//
// "Ring Nordic AB på tisdag 14:00 30 min !1 #Mässan @Anna"
//   → titel "Ring Nordic AB", tisdagens datum, 14:00, 30 minuter,
//     prioritet 1, projektet Mässan, ansvarig Anna.
//
// DET SOM INTE KÄNNS IGEN BLIR TITEL. Det är hela säkerhetsnätet: en tolk som
// gissar fel på ett ord ska förlora ett ord ur rubriken, aldrig tappa raden.
// =============================================================================
// -----------------------------------------------------------------------------

export type Snabbrad = {
  titel: string;
  due_date: string | null;
  due_time: string | null;
  estimate_minutes: number | null;
  priority: Prioritet;
  /** Rå text efter `#` respektive `@`. Slås upp mot databasen av anroparen. */
  projekt: string | null;
  person: string | null;
};

/**
 * Bara de utskrivna formerna. Förkortningar som "må" och "on" står med flit
 * INTE med: "on" är ett ord i en mening, och "må" likaså. En tolk som äter
 * ordet "må" ur "hoppas hon mår bättre" har gjort rubriken obegriplig för att
 * spara fyra tecken.
 */
const VECKODAGAR: Record<string, number> = {
  "måndag": 1, "mandag": 1,
  "tisdag": 2,
  "onsdag": 3,
  "torsdag": 4,
  "fredag": 5,
  "lördag": 6, "lordag": 6,
  "söndag": 7, "sondag": 7,
};

const PRIORITETSORD: Record<string, Prioritet> = {
  "1": 1, "brådskande": 1, "bradskande": 1, "akut": 1,
  "2": 2, "hög": 2, "hog": 2, "viktig": 2,
  "3": 3, "normal": 3,
  "4": 4, "låg": 4, "lag": 4,
};

export function tolkaSnabbrad(rad: string, idag: string): Snabbrad {
  let text = ` ${rad} `;

  const ut: Snabbrad = {
    titel: "",
    due_date: null,
    due_time: null,
    estimate_minutes: null,
    priority: 3,
    projekt: null,
    person: null,
  };

  /** Plockar bort det som matchat, så att titeln blir det som blev över. */
  const plocka = (re: RegExp, ta: (m: RegExpMatchArray) => boolean): void => {
    const m = text.match(re);
    if (!m) return;
    if (ta(m)) text = text.replace(m[0], " ");
  };

  // --- Projekt och person. Först, för de är otvetydiga. ---------------------
  plocka(/\s#([^\s#@]+)/u, (m) => {
    ut.projekt = m[1];
    return true;
  });
  plocka(/\s@([^\s#@]+)/u, (m) => {
    ut.person = m[1];
    return true;
  });

  // --- Prioritet -----------------------------------------------------------
  plocka(/\s!([a-zA-ZåäöÅÄÖ1-4]+)/u, (m) => {
    const p = PRIORITETSORD[m[1].toLowerCase()];
    if (!p) return false;
    ut.priority = p;
    return true;
  });

  // --- Tidsuppskattning ----------------------------------------------------
  // FÖRE klockslaget: "1h" och "14:00" krockar inte, men "90 min" och "90"
  // gör det, och den som skriver en siffra följd av "min" menar längd.
  plocka(/\s(\d+(?:[.,]\d+)?)\s*(minuter|minut|min|m|timmar|timme|tim|h)(?![a-zåäö])/iu, (m) => {
    const antal = Number(m[1].replace(",", "."));
    if (!Number.isFinite(antal) || antal <= 0) return false;

    const enhet = m[2].toLowerCase();
    const perTimme = enhet === "h" || enhet.startsWith("tim");
    const avrundat = Math.round(perTimme ? antal * 60 : antal);

    if (avrundat <= 0 || avrundat > 1440) return false;
    ut.estimate_minutes = avrundat;
    return true;
  });

  // --- Datum ---------------------------------------------------------------
  // Absolut form först: den som skrivit ut ett datum har inte menat något annat.
  plocka(/\s(\d{4}-\d{2}-\d{2})\b/u, (m) => {
    ut.due_date = m[1];
    return true;
  });

  if (!ut.due_date) {
    // "3/10" och "3/10-27". Svensk läsordning: dag före månad.
    plocka(/\s(\d{1,2})\/(\d{1,2})(?:-(\d{2}|\d{4}))?\b/u, (m) => {
      const dag = Number(m[1]);
      const manad = Number(m[2]);
      if (dag < 1 || dag > 31 || manad < 1 || manad > 12) return false;

      let ar = Number(idag.slice(0, 4));
      if (m[3]) ar = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);

      const kandidat = `${ar}-${String(manad).padStart(2, "0")}-${String(dag).padStart(2, "0")}`;
      // Ett datum som redan passerat i år menas nästa år. Den som skriver 3/1
      // i december menar januari, inte elva månader bakåt.
      ut.due_date = !m[3] && kandidat < idag ? `${ar + 1}${kandidat.slice(4)}` : kandidat;
      return true;
    });
  }

  if (!ut.due_date) {
    plocka(/\s(i\s?dag|idag)\b/iu, () => {
      ut.due_date = idag;
      return true;
    });
  }

  if (!ut.due_date) {
    plocka(/\s(i\s?morgon|imorgon)\b/iu, () => {
      ut.due_date = datumPlusDagar(idag, 1);
      return true;
    });
  }

  if (!ut.due_date) {
    plocka(/\s(i\s?övermorgon|övermorgon|overmorgon)\b/iu, () => {
      ut.due_date = datumPlusDagar(idag, 2);
      return true;
    });
  }

  if (!ut.due_date) {
    plocka(/\som\s+(\d+|en|ett|två|tva|tre)\s+(dag|dagar|vecka|veckor)\b/iu, (m) => {
      const ord: Record<string, number> = { en: 1, ett: 1, två: 2, tva: 2, tre: 3 };
      const antal = ord[m[1].toLowerCase()] ?? Number(m[1]);
      if (!Number.isFinite(antal) || antal <= 0 || antal > 365) return false;
      const steg = m[2].toLowerCase().startsWith("v") ? 7 : 1;
      ut.due_date = datumPlusDagar(idag, antal * steg);
      return true;
    });
  }

  if (!ut.due_date) {
    /**
     * Veckodag, med valfritt "på" eller "nästa" före.
     *
     * SAMMA DAG SOM IDAG BETYDER IDAG. Den som skriver "fredag" på en fredag
     * menar den här fredagen — och vill man den nästa finns "nästa fredag",
     * som lägger på en vecka. Alternativet, att alltid hoppa till nästa vecka,
     * hade gjort "fredag" oanvändbart exakt den dag ordet är som vanligast.
     */
    plocka(
      /\s(?:(nästa|nasta)\s+)?(?:på\s+|pa\s+)?(måndag|mandag|tisdag|onsdag|torsdag|fredag|lördag|lordag|söndag|sondag)\b/iu,
      (m) => {
        const mal = VECKODAGAR[m[2].toLowerCase()];
        if (!mal) return false;
        const nu = veckodag(idag);
        let steg = (mal - nu + 7) % 7;
        if (m[1]) steg += 7;
        ut.due_date = datumPlusDagar(idag, steg);
        return true;
      },
    );
  }

  if (!ut.due_date) {
    plocka(/\s(nästa|nasta)\s+vecka\b/iu, () => {
      // Måndagen i nästa vecka. "Nästa vecka" är inte en dag, och att lägga
      // den på samma veckodag sju dagar fram hade gjort en fredagsanteckning
      // till en fredagsfrist — alltså sist i veckan man tänkte börja den.
      const till = 8 - veckodag(idag);
      ut.due_date = datumPlusDagar(idag, till);
      return true;
    });
  }

  // --- Klockslag -----------------------------------------------------------
  // Sist, och bara om det finns ett datum: ett klockslag utan dag är ingen
  // tidpunkt, och databasen vägrar raden (`task_tid_kraver_datum` i 0054).
  plocka(/\s(?:kl\.?\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/u, (m) => {
    if (!ut.due_date) return false;
    ut.due_time = `${m[1].padStart(2, "0")}:${m[2]}`;
    return true;
  });

  if (!ut.due_time) {
    // "kl 14" — timmen ensam, och bara med "kl" framför. Utan det ordet hade
    // "ring 20 bolag" blivit klockan 20.
    plocka(/\skl\.?\s*([01]?\d|2[0-3])\b/iu, (m) => {
      if (!ut.due_date) return false;
      ut.due_time = `${m[1].padStart(2, "0")}:00`;
      return true;
    });
  }

  ut.titel = text.replace(/\s+/g, " ").trim();
  return ut;
}
