export const DOC_TYPES = [
  "routine",
  "policy",
  "work_env_policy",
  "risk_assessment",
  "task_allocation",
  "script",
  "price_list",
  "case",
  "interest_assessment",
  "staff_information",
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  routine: "Rutin",
  policy: "Policy",
  work_env_policy: "Arbetsmiljöpolicy",
  risk_assessment: "Riskbedömning",
  task_allocation: "Uppgiftsfördelning",
  script: "Manus",
  price_list: "Prislista",
  case: "Referenscase",
  interest_assessment: "Intresseavvägning",
  staff_information: "Information till personalen",
};

/**
 * Typerna som bär en spärr. En intresseavvägning utan beslutsdatum duger inte
 * som grund för behandling, och informationen till personalen är inte
 * information förrän någon kvitterat den — se `compliance_gate`.
 */
export const SPARRTYPER: DocType[] = ["interest_assessment", "staff_information"];

/**
 * AC-5.9. De tre forsta ar de dokumenttyper AFS 2023:1 kraver, och de ar
 * ocksa de enda som har ett lagkrav pa arlig genomgang. Standardvardet ar
 * darfor inte en bekvamlighet utan den mekanism som gor att K24 och K32 inte
 * glommas bort nasta ar.
 */
export const LAGKRAVDA_TYPER: DocType[] = [
  "work_env_policy",
  "risk_assessment",
  "task_allocation",
];

export const STATUS_LABEL: Record<string, string> = {
  draft: "Utkast",
  published: "Publicerad",
  archived: "Arkiverad",
};

export type Granskningslage =
  | { lage: "forfallen"; dagar: number; text: string }
  | { lage: "snart"; dagar: number; text: string }
  | { lage: "ok"; dagar: number; text: string };

/** AC-5.2: forfallet dokument marks tydligt for ALLA lasare, inte bara agaren. */
export function granskningslage(reviewDue: string): Granskningslage {
  const idag = new Date();
  idag.setHours(0, 0, 0, 0);
  const due = new Date(reviewDue + "T00:00:00");
  const dagar = Math.round((due.getTime() - idag.getTime()) / 86_400_000);

  if (dagar < 0) return { lage: "forfallen", dagar, text: `Ej granskad sedan ${reviewDue}` };
  if (dagar <= 30) return { lage: "snart", dagar, text: `Granskas senast ${reviewDue}` };
  return { lage: "ok", dagar, text: `Granskad, nästa ${reviewDue}` };
}

/** Slug utan svenska tecken, sa att URL:en gar att lasa upp i telefon. */
export function tillSlug(titel: string): string {
  return titel
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** 'HR/Anställning/Introduktion' -> ['HR', 'Anställning', 'Introduktion'] */
export function kategoridelar(path: string): string[] {
  return path.split("/").map((d) => d.trim()).filter(Boolean);
}

export function arstalDatum(manader: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + manader);
  return d.toISOString().slice(0, 10);
}

/**
 * Svenska bestamda och plurala andelser som Postgres snowball-stemmer inte
 * tar bort. Empiriskt uppmatt mot databasen: "bilen" och "rutinen" stammas
 * till "bil" och "rutin", men "huset", "avtalet" och "lakarintyget" lamnas
 * oforandrade. Foljden ar att ett dokument som innehaller "lakarintyg" inte
 * hittas av nagon som skriver "lakarintyget" — ett ord de nyss last.
 */
const ANDELSER = ["erna", "arna", "orna", "et", "en", "ar", "er", "or", "n", "t"];

function stamvarianter(ord: string): string[] {
  const ut = [ord];
  for (const a of ANDELSER) {
    if (ord.length > a.length + 3 && ord.endsWith(a)) {
      ut.push(ord.slice(0, -a.length));
      break;
    }
  }
  return ut;
}

/**
 * Fritext -> tsquery med prefix och avklippta andelser.
 *
 * Anvands som andra forsok nar den vanliga sokningen inte gav nagot. Varje ord
 * blir "(ord:* | stam:*)", sa bade den som skriver for mycket ("lakarintyget")
 * och den som skriver for lite ("sjukanm") far traff. Orden ar redan rensade
 * till bokstaver och siffror, sa ingenting av anvandarens text nar tsquery-
 * syntaxen.
 *
 * Returnerar null om ingenting sokbart aterstar efter rensningen.
 */
export function prefixfraga(q: string): string | null {
  const ord = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((o) => o.length >= 2)
    .slice(0, 8);
  if (ord.length === 0) return null;
  return ord
    .map((o) => {
      const varianter = stamvarianter(o).map((v) => `${v}:*`);
      return varianter.length > 1 ? `(${varianter.join(" | ")})` : varianter[0];
    })
    .join(" & ");
}

/**
 * AC-1.3: vilka rutiner som ar obligatoriska for en person.
 *
 * Samma regel som RLS-funktionen `matches_audience()` i 0003, men uttryckt i
 * TypeScript sa att den gar att stalla en fraga om NAGON ANNAN an sig sjalv —
 * databasen svarar alltid utifran den som fragar. Tom lista betyder alla, i
 * bada leden.
 *
 * Halls de tva i otakt blir foljden att en nyanstalld far en lista som inte
 * stammer med vad hon faktiskt ser. Andras den ena maste den andra folja med.
 */
export function riktarSigTill(
  dok: { audience_roles: string[] | null; audience_teams: string[] | null },
  roller: string[],
  teamId: string | null,
): boolean {
  const rollkrav = dok.audience_roles ?? [];
  const teamkrav = dok.audience_teams ?? [];

  const rollOk = rollkrav.length === 0 || rollkrav.some((r) => roller.includes(r));
  const teamOk = teamkrav.length === 0 || (teamId !== null && teamkrav.includes(teamId));

  return rollOk && teamOk;
}
