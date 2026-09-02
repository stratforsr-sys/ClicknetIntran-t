/**
 * Notiserna i klockan. Typer och sortering — ren logik, inga importer.
 *
 * Klockan lagrar ingenting. Varje post raknas fram ur raderna som redan finns:
 * en okvitterad rutin, en publicerad kurs du inte gjort, ett nyhetsinlagg som
 * riktar sig till dig, ett svar i ditt arende. Det enda som sparas ar nar du
 * senast oppnade klockan.
 *
 * Skalet star i migration 0018: en notistabell kraver att varje producent
 * kommer ihag att skriva sin rad, och den som glommer ger en tyst lucka. En
 * kurs som laggs upp utan att nagon far veta ser precis ut som en kurs ingen
 * brydde sig om.
 */

export type Notistyp = "arende" | "nyhet" | "rutin" | "kurs" | "franvaro" | "fel" | "guide" | "coachning";

/**
 * De tolv sorters post klockan kan visa, som de heter i ett notis-id.
 *
 * Listan ar inte samma sak som `Notistyp`. Typen avgor ikon och etikett; det har
 * avgor VILKEN RAD posten kom ur, och tva poster med samma typ kan komma ur
 * olika hall — `franvaro-lucka` ar en pamminelse och `franvaro-beslut` ett
 * besked, bada med typen "franvaro".
 *
 * Varfor den finns: `avfardaNotis()` maste kunna avgora om en strang fran
 * klienten ar ett notis-id innan den skrivs. Alternativet — att rakna fram alla
 * notiser igen och leta i listan — hade kostat sjutton databasfragor pa ett
 * klick som samtidigt navigerar bort.
 */
export const NOTIS_KALLOR = [
  "nyhet",
  "rutin",
  "kurs",
  "arende",
  "franvaro",
  "franvaro-beslut",
  "franvaro-lucka",
  "sjuk",
  // E13 steg 6. Tva olika poster ur samma tabell, som `franvaro-lucka` och
  // `franvaro-beslut`: forslaget ar chefens att ta stallning till, konsekvensen
  // ar den beromdas besked. Ett forslag nar ALDRIG den det galler — RLS i 0037
  // slapper fram raden forst nar den ar beslutad.
  "franvaro-forslag",
  "franvaro-konsekvens",
  "rollspel",
  "rollspel-bedomt",
  "fel",
  "fel-svar",
  /**
   * G6. Tre poster av samma typ men ur olika hall, som franvarons tre:
   * `guide` ar min egen paminnelse om det jag inte gjort, `guide-knuff` ar nagon
   * som sagt till mig, och `guide-team` ar chefens rad om nagon som stannat av.
   */
  "guide",
  "guide-knuff",
  "guide-team",
  /**
   * Coachningen. Fyra poster av samma typ men ur olika hall, precis som
   * guidernas tre: `coachning-ny` ar en uppgift jag NYSS fatt, `coachning` ar
   * min egen uppgift som statt still, `coachning-kvittering` ar nagon annans
   * uppgift som vantar pa MIN bock, och `coachning-team` ar chefens rad om
   * nagon som inte coachats pa en manad.
   *
   * `coachning-ny` och `coachning` ar avsiktligt TVA kallor och inte en.
   * Den forsta ar ett BESKED — nagon har lagt upp nagot at dig — och den andra
   * ar en PAMINNELSE om att det statt still. Samma id hade betytt att den som
   * klickar bort beskedet ocksa klickar bort paminnelsen tre dygn senare.
   */
  "coachning-ny",
  "coachning",
  "coachning-kvittering",
  "coachning-team",
] as const;

export type Notiskalla = (typeof NOTIS_KALLOR)[number];

/**
 * Bygger ett notis-id.
 *
 * ALLA ID:N GAR GENOM DEN HAR FUNKTIONEN, och det ar hela poangen: listan ovan
 * och listan i `notiser-server.ts` kan da inte glida isar, for det finns bara en
 * lista. Skrivs en ny sorts notis med ett hopskrivet `\`nagot-${id}\`` faller
 * typkontrollen i stallet for att avfardningen tyst slutar fungera for just den.
 *
 * DELARNA BAR ATERUPPSTANDELSEN. `notisId("rutin", dok.id, dok.version)` ger ett
 * nytt id nar rutinen far en ny version, sa den dyker upp igen aven for den som
 * klickade bort forra versionen. Samma sak med meddelandets id i ett arende.
 * Skicka darfor med det som gor posten ny — inte bara radens id.
 */
export function notisId(kalla: Notiskalla, ...delar: (string | number)[]): string {
  return [kalla, ...delar].join("-");
}

/**
 * Ar strangen formad som ett notis-id?
 *
 * Bara formen provas, aldrig att posten finns. Det varsta ett paitat men
 * valformat id kan stalla till ar en rad som doljer en notis som inte finns —
 * i den avfardandes egen tabell, som ingen annan laser.
 */
export function arNotisId(varde: unknown): varde is string {
  if (typeof varde !== "string" || varde.length < 3 || varde.length > 200) return false;
  const kalla = NOTIS_KALLOR.find((k) => varde.startsWith(k + "-"));
  if (!kalla) return false;
  // Delarna ar uuid:er och heltal. Allt annat ar nagon som provar.
  return /^[0-9a-zA-Z-]+$/.test(varde.slice(kalla.length + 1));
}

export type Notis = {
  /** Stabil over sidladdningar — den bar "last"-markeringen medan panelen ar oppen. */
  id: string;
  typ: Notistyp;
  rubrik: string;
  detalj: string;
  href: string;
  /** ISO. Nar saken dok upp, inte nar den lastes. */
  tidpunkt: string;
  olast: boolean;
};

export const TYP_ETIKETT: Record<Notistyp, string> = {
  coachning: "Coachning",
  guide: "Guide",
  arende: "Ärende",
  nyhet: "Nyhet",
  rutin: "Rutin",
  kurs: "Utbildning",
  franvaro: "Frånvaro",
  fel: "Fel",
};

export const TYP_IKON: Record<Notistyp, string> = {
  coachning: "kontroll",
  guide: "utbildning",
  arende: "meny",
  nyhet: "logg",
  rutin: "rutiner",
  kurs: "utbildning",
  franvaro: "klocka",
  fel: "varning",
};

/**
 * Hur manga poster klockan visar.
 *
 * En lista som aldrig tar slut ar en lista man slutar oppna. Det som inte far
 * plats har finns kvar i "Att gora" pa startsidan och i sin egen modul — inget
 * forsvinner, det slutar bara tranga sig fram.
 */
export const MAX_NOTISER = 15;

/** Nyast forst. Olasta gar fore lasta aven om de ar aldre. */
export function sortera(notiser: Notis[]): Notis[] {
  return [...notiser].sort((a, b) => {
    if (a.olast !== b.olast) return a.olast ? -1 : 1;
    return b.tidpunkt.localeCompare(a.tidpunkt);
  });
}

/** "3 min", "2 tim", "igår", "12 aug". Klockslag pa en veckogammal notis
 *  ar en precision ingen har nagon nytta av. */
export function narTid(iso: string, nu: Date = new Date()): string {
  const minuter = Math.floor((nu.getTime() - Date.parse(iso)) / 60000);
  if (minuter < 1) return "nyss";
  if (minuter < 60) return `${minuter} min`;
  if (minuter < 24 * 60) return `${Math.floor(minuter / 60)} tim`;
  if (minuter < 48 * 60) return "igår";

  const d = new Date(iso);
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}
