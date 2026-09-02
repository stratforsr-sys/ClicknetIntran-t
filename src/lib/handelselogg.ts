/**
 * E6.1 / AC-12.1. De sju handelsetyperna. Ren logik, inga importer.
 *
 * ===========================================================================
 * VARFOR EN TYPINDELNING OCH INTE BARA FLER LOGGRADER
 *
 * AC-12.1 sager att `audit_log` ska tacka samtliga sju handelsetyper. Loggen
 * hade 57 olika actions och 171 rader nar den har filen skrevs, men INGEN kunde
 * svara pa om de sju var tackta — det fanns ingen indelning att mata mot, bara
 * en lista strangar som vuxit modul for modul.
 *
 * En tackning som ingen kan kontrollera ar ett pastaende. Den har filen gor den
 * till en fraga med ett svar, och `tests/handelselogg.mjs` haller efter den.
 * Samma konstruktion som KALLOR/UNDANTAG i `registerutdrag.ts`, och av samma
 * skal: en lista som underhalls for hand slutar stamma tyst.
 *
 * ===========================================================================
 * TYPEN SAGER VAD SLAGS HANDELSE DET AR — INTE VILKEN MODUL DEN KOM UR
 *
 * Forsta forsoket delade in loggen efter modul: tid, franvaro, lon, dokument.
 * Det foll pa `case.*`, personalarendena, som inte ar nagon av dem — och det
 * var inte ett hal i listan utan i ideen. En modulindelning vaxer med navet, sa
 * "sju" hade blivit atta vid nasta modul och nio vid den darpa. Ett krav som
 * andrar innebord varje gang nagot byggs ar inget krav.
 *
 * De sju typerna beskriver i stallet vad som HANDE: nagot skapades, andrades,
 * raderades, nagon fick eller forlorade en behorighet, nagon loggade in, nagon
 * lamnade ut uppgifter, eller systemet gjorde nagot sjalvt. Det ar den
 * indelning en granskning fragar efter, och den ar stangd — en ny modul far
 * plats utan att listan vaxer.
 * ===========================================================================
 */

export type Handelsetyp =
  | "autentisering"
  | "behorighet"
  | "skapande"
  | "andring"
  | "radering"
  | "utlamnande"
  | "system";

/** Exakt sju. Ordningen ar den som visas i filtret pa /logg. */
export const TYPER: Handelsetyp[] = [
  "autentisering",
  "behorighet",
  "skapande",
  "andring",
  "radering",
  "utlamnande",
  "system",
];

export const TYP_ETIKETT: Record<Handelsetyp, { rubrik: string; beskrivning: string }> = {
  autentisering: {
    rubrik: "Inloggning",
    beskrivning:
      "Inloggning, utloggning, misslyckade försök, lösenordsbyte och bekräftade enheter.",
  },
  behorighet: {
    rubrik: "Behörighet",
    beskrivning: "Roller och behörigheter som tilldelats eller återkallats.",
  },
  skapande: {
    rubrik: "Nytt registrerat",
    beskrivning: "Något lades till: en anställd, en stämpling, en ansökan, en order, ett ärende.",
  },
  andring: {
    rubrik: "Ändring",
    beskrivning: "Något ändrade värde eller status — beslut, publicering, attest, avslut.",
  },
  radering: {
    rubrik: "Radering",
    beskrivning: "Något togs bort.",
  },
  utlamnande: {
    rubrik: "Utlämnande och insyn",
    beskrivning:
      "Export av uppgifter och öppning av vyer som visar en enskild persons uppgifter.",
  },
  system: {
    rubrik: "Systemhändelse",
    beskrivning: "Nattjobbet och felrapporteringen — det navet gjorde utan att någon bad om det.",
  },
};

/**
 * MODULREGISTRET.
 *
 * Prefixen navet kanner igen, med sitt svenska namn. Listan styr INTE typen —
 * den finns for tva andra saker:
 *
 *   1. `/logg` skriver ut modulens namn pa svenska i stallet for prefixet.
 *   2. `tests/handelselogg.mjs` faller nar en action dyker upp med ett prefix
 *      som inte star har. Det ar den enda kontroll som marker att en HELT ny
 *      modul borjat logga — typreglerna nedan ar avsiktligt totala och hade
 *      annars svalt den tyst.
 */
export const MODUL: Record<string, string> = {
  employee: "Anställd",
  role: "Roll",
  permission: "Behörighet",
  team: "Team",
  auth: "Konto",
  account: "Konto",
  onboarding: "Onboarding",
  offboarding: "Offboarding",
  candidate: "Kandidat",

  time: "Stämpling",
  schedule: "Schema",
  deviation: "Rastavvikelse",
  attendance_incident: "Frånvarohändelse",
  consequence_rule: "Konsekvenstrappa",
  gate: "Spärr",
  journal: "Arbetstidsjournal",

  absence: "Frånvaro",
  sick: "Sjukanmälan",
  calendar: "Kalenderflöde",

  case: "Personalärende",

  document: "Rutin",
  course: "Kurs",
  contract: "Avtal",
  contract_template: "Avtalsmall",
  news: "Nyhet",
  roleplay: "Rollspel",

  payroll: "Löneperiod",
  commission: "Provision",
  commission_period: "Provisionsperiod",
  commission_bonus_level: "Volymtrappa",
  cost: "Lönekostnad",
  sales_order: "Kundorder",
  kv_call: "K&V-samtal",
  kv_criterion: "K&V-kriterium",
  kv_policy: "K&V-regel",
  kv_assessment: "K&V-bedömning",

  job: "Nattjobbet",
  error: "Felrapport",

  coaching_task: "Coachningsuppgift",
  coaching_session: "Coachningssamtal",
  coaching_template: "Coachningsmall",
};

/** Andelser som betyder att nagot lamnades ut eller lastes. */
const UTLAMNANDE = ["exported", "viewed", "data_export"];

/** Andelser som betyder att nagot skapades. */
const SKAPANDE = [
  "created",
  "added",
  "registered",
  "requested",
  "submitted",
  "entered",
  "suggested",
  "generated",
  "acked",
  "hired",
  "in",
  "out",
];

/** Andelser som betyder att nagot togs bort. */
const RADERING = ["deleted", "removed"];

/** Slutar andelsen pa nagot i listan, med eller utan ett understreck fore? */
function slutarPa(andelse: string, lista: string[]): boolean {
  return lista.some((l) => andelse === l || andelse.endsWith(`_${l}`));
}

/**
 * Vilken typ en action tillhor.
 *
 * ORDNINGEN AR REGELN. Varje steg tar over fran det forra, och de tre forsta
 * ar prefixbaserade for att de handlar om VAD objektet ar, inte vad som hande
 * med det:
 *
 *   1. `auth.*` ar alltid autentisering. Ett losenordsbyte ar en andring i
 *      teknisk mening och en autentiseringshandelse i varje annan.
 *   2. `job.*` och `error.*` ar alltid system. Ingen manniska bad om dem.
 *   3. `role.*` och `permission.*` ar alltid behorighet. Att indelningen gar pa
 *      PREFIXET och inte pa andelsen "revoked" ar viktigt:
 *      `attendance_incident.revoked` ar en tillbakadragen franvarohandelse och
 *      har ingenting med behorighet att gora.
 *   4. Utlamnande gar fore skapande och andring. `payroll.exported` hor
 *      sakligt hemma bade under lon och under utlamnande, och det ar den senare
 *      fragan loggen ska kunna besvara: VEM HAR SETT VAD. En export begravd
 *      bland trettio andra lonehandelser gar inte att svara pa artikel 15 med.
 *   5. Radering fore skapande, sa att `blackout_removed` inte fastnar pa
 *      nagot annat.
 *   6. Skapande.
 *   7. Allt annat ar en andring. Det ar ett MEDVETET uppsamlingslage: reglerna
 *      ska vara totala, sa att en ny handelse i en kand modul hamnar nagonstans
 *      rimligt i stallet for att falla ur loggvyn. Det som far fanga en ny
 *      MODUL ar `MODUL`-registret och provet, inte den har funktionen.
 */
export function typFor(action: string | null | undefined): Handelsetyp | null {
  if (!action) return null;
  const bitar = String(action).split(".");
  if (bitar.length < 2) return null;

  const prefix = bitar[0];
  const andelse = bitar.slice(1).join(".");
  if (prefix === "" || andelse === "") return null;

  if (prefix === "auth") return "autentisering";
  if (prefix === "job" || prefix === "error") return "system";
  if (prefix === "role" || prefix === "permission") return "behorighet";

  if (slutarPa(andelse, UTLAMNANDE)) return "utlamnande";
  if (slutarPa(andelse, RADERING)) return "radering";
  if (slutarPa(andelse, SKAPANDE)) return "skapande";

  return "andring";
}

/** Modulens namn pa svenska, eller prefixet nar den inte ar registrerad. */
export function modulNamn(action: string): string {
  const prefix = String(action).split(".")[0];
  return MODUL[prefix] ?? prefix;
}

/** Ar modulen registrerad? Provet faller pa den som inte ar det. */
export function arModulKand(action: string): boolean {
  return String(action).split(".")[0] in MODUL;
}
