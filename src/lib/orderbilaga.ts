/**
 * E13 steg 9: vad som gar att lasa ut ur en uppladdad avtals-PDF.
 *
 * Ren logik — inga importer, ingen pdfjs. Texten kommer fran `pdfText()` i
 * `pdf.ts`, som ar den enda som ror biblioteket. Samma delning som
 * `pdftext.ts` gor, och av samma skal: det som har REGLER ska ga att prova
 * utan att starta Next. Se `tests/orderbilaga.mjs`.
 *
 * ===========================================================================
 * UTLASNINGEN FORIFYLLER ETT FORMULAR. DEN SPARAR ALDRIG NAGOT.
 *
 * Bestallarens krav, PROVISION_SPEC.md avsnitt 3.1: ett falt som fyllts i av
 * en maskin och godkants av en manniska ar nagot annat an ett falt ingen last.
 *
 * Det ar inte en artighet. En order bar ett provisionsbelopp som fryses vid
 * godkannandet och betalas ut som pengar. En maskinlast lopstid som ingen
 * kontrollerat hade blivit skillnaden mellan 1 500 och 4 500 kronor, och felet
 * hade upptackts forst nar nagon jamforde med papperet.
 *
 * Darfor returnerar den har filen ett FORSLAG med `sakerhet` per falt, och
 * anroparen far aldrig skriva det till databasen utan att en manniska tryckt.
 * ===========================================================================
 *
 * REGLERNA AR AVSIKTLIGT FORSIKTIGA. Ett falt som inte gar att lasa entydigt
 * lamnas TOMT i stallet for att gissas. Ett tomt falt syns; ett felgissat ser
 * ratt ut.
 */

export type Forslagsfalt =
  | "company_name"
  | "org_number"
  | "contact_name"
  | "phone"
  | "package_id"
  | "term_months"
  | "signed_on";

export type Forslag = {
  /** Faltets varde som en strang, redo att laggas i ett formularfalt. */
  varde: string;
  /**
   * Vad i texten som gav svaret. Visas for den som ska godkanna forslaget.
   *
   * Utan den ar forifyllningen en svart lada: den som ser "Paket 2" i rutan
   * kan inte avgora om det stod i avtalet eller om navet gissade.
   */
  kalla: string;
};

export type Orderforslag = Partial<Record<Forslagsfalt, Forslag>>;

// -----------------------------------------------------------------------------
// Hjalpare
// -----------------------------------------------------------------------------

/** Ett utdrag ur texten omkring en traff, for `kalla`. */
function omkring(text: string, index: number, langd: number): string {
  const fran = Math.max(0, index - 30);
  const till = Math.min(text.length, index + langd + 30);
  return (fran > 0 ? "…" : "") + text.slice(fran, till).trim() + (till < text.length ? "…" : "");
}

/**
 * Forsta traffen for ett monster, eller null.
 *
 * FLERA OLIKA TRAFFAR GER NULL. Star det tva olika organisationsnummer i
 * dokumentet vet ingen vilket som ar kundens — och da ska faltet vara tomt.
 * Samma varde flera ganger ar daremot inget problem: en avtalsmall upprepar
 * ofta bolagsnamnet i sidhuvudet.
 */
function entydig(
  text: string,
  monster: RegExp,
  normalisera: (m: RegExpExecArray) => string | null,
): Forslag | null {
  const re = new RegExp(monster.source, monster.flags.includes("g") ? monster.flags : monster.flags + "g");

  let forsta: { varde: string; index: number; langd: number } | null = null;

  for (const m of text.matchAll(re)) {
    const varde = normalisera(m as RegExpExecArray);
    if (varde === null) continue;

    if (!forsta) {
      forsta = { varde, index: m.index ?? 0, langd: m[0].length };
      continue;
    }
    if (varde !== forsta.varde) return null;
  }

  if (!forsta) return null;
  return { varde: forsta.varde, kalla: omkring(text, forsta.index, forsta.langd) };
}

// -----------------------------------------------------------------------------
// Falten
// -----------------------------------------------------------------------------

/**
 * Organisationsnummer: NNNNNN-NNNN.
 *
 * BINDESTRECKET KRAVS. Tio siffror i rad gar inte att skilja fran ett
 * telefonnummer, ett kundnummer eller ett belopp — samma resonemang som K27
 * redan drog at andra hallet i `0030` for intervjuanteckningar.
 *
 * `org_number` far bara ett personnummer nar kunden ar en enskild firma. Det
 * ar K27-undantaget i avsnitt 3.2 och det galler har ocksa: numret lases ut,
 * men det hamnar i ett formularfalt som en manniska ska titta pa, inte i
 * databasen.
 */
function orgnummer(text: string): Forslag | null {
  return entydig(text, /\b(\d{6})-(\d{4})\b/, (m) => `${m[1]}-${m[2]}`);
}

/**
 * Signeringsdatum: ISO, alltsa 2026-08-15.
 *
 * BARA ISO. Svensk text skriver ocksa "15 augusti 2026" och "15/8-26", och
 * bada gar att tolka — men "05/08/26" gar inte, och en tolkare som klarar
 * nastan alla format ar en tolkare som tyst tar fel pa den femte augusti och
 * den attonde maj. Datumet styr vilken PERIOD ordern hor till, alltsa vilken
 * manad nagon far betalt, sa hellre tomt an nastan ratt.
 *
 * Manaden och dagen kontrolleras: 2026-13-45 ar inte ett datum.
 */
function signeringsdatum(text: string): Forslag | null {
  return entydig(text, /\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => {
    const manad = Number(m[2]);
    const dag = Number(m[3]);
    if (manad < 1 || manad > 12 || dag < 1 || dag > 31) return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
  });
}

/**
 * Telefonnummer, normaliserat till siffror och ett eventuellt inledande plus.
 *
 * Kraver minst atta siffror och nagon avgransare eller ett landsprefix, sa att
 * ett organisationsnummer eller ett belopp inte plockas upp.
 */
function telefon(text: string): Forslag | null {
  return entydig(text, /(?:\+46|0)\s?\d{1,3}[-\s]\d{2,3}\s?\d{2}\s?\d{2}\b/, (m) =>
    m[0].replace(/[\s-]/g, ""),
  );
}

/** "Paket 2" -> "2". Bara 1, 2 och 3 finns (avsnitt 4.1). */
function paket(text: string): Forslag | null {
  return entydig(text, /\bpaket\s*([123])\b/i, (m) => m[1]);
}

/** "24 månader" eller "24 mån" -> "24". Bara 12, 24 och 36 finns. */
function loptid(text: string): Forslag | null {
  return entydig(text, /\b(12|24|36)\s*(?:månader|manader|mån|man)\b/i, (m) => m[1]);
}

/**
 * Bolagsnamnet.
 *
 * Letar efter en bolagsform — AB, HB, KB — och tar orden fore den. Det ar det
 * enda i ett avtal som pekar ut ett bolagsnamn utan att man vet hur mallen ser
 * ut, och det ar med flit smalt: en enskild firma har ingen bolagsform i
 * namnet och far darfor inget forslag alls.
 *
 * SALJARENS EGET BOLAG STAR OCKSA I AVTALET. Darfor lamnas faltet tomt sa
 * fort tva OLIKA namn hittas — se `entydig`. Hellre ett tomt falt an kundens
 * plats ifylld med vart eget namn.
 */
function bolagsnamn(text: string): Forslag | null {
  return entydig(
    text,
    /\b((?:[A-ZÅÄÖ][\wÅÄÖåäö&.'-]*\s+){0,3}[A-ZÅÄÖ][\wÅÄÖåäö&.'-]*)\s+(AB|HB|KB)\b/,
    (m) => `${m[1].trim()} ${m[2]}`,
  );
}

/**
 * Kontaktpersonen.
 *
 * Kraver en LEDTEXT — "Kontaktperson:", "Kontakt:", "Attention:". Utan den
 * hade vilket egennamn som helst i dokumentet kunnat bli kontaktperson, och
 * ett avtal ar fullt av dem: vart eget bolag, var egen firmatecknare, en
 * ortsangivelse.
 *
 * NASTA LEDTEXT AVSLUTAR NAMNET. Det ar inte en finess utan en nodvandighet:
 * `tolkaAvtalstext` kollapsar all blanksteg, sa radbrytningen mellan
 * "Kontaktperson: Lena Sjoberg" och "Telefon: 070-..." blir ett mellanslag —
 * och da ser "Telefon" ut som ett tredje namn. Lookaheaden `(?!\s*:)` sallar
 * bort varje ord som foljs av kolon, vilket ar precis vad en ledtext gor och
 * ett efternamn inte gor.
 *
 * DE TVA LOOKAHEADERNA BEHOVS BADA, och den forsta ar den som ar latt att
 * glomma. Utan `(?![\wÅÄÖåäö])` backar motorn ett tecken och matchar "Telefo",
 * som mycket riktigt inte foljs av kolon — kolonet star efter "n". Den forsta
 * tvingar traffen att ta HELA ordet, den andra provar sedan om ordet ar en
 * ledtext.
 *
 * `\b` duger inte i den forsta rollen: `\w` i JavaScript ar ASCII, sa det
 * finns en ordgrans mitt i "Åsa" och namn med a-ring, a-umlaut och o-umlaut
 * hade klippts av.
 */
const NAMNORD = String.raw`[A-ZÅÄÖ][\wÅÄÖåäö-]+(?![\wÅÄÖåäö])(?!\s*:)`;

function kontaktperson(text: string): Forslag | null {
  return entydig(
    text,
    new RegExp(
      String.raw`\b(?:kontaktperson|kontakt|attention|att)\s*:\s*(${NAMNORD}(?:\s+${NAMNORD}){0,3})`,
      "i",
    ),
    (m) => m[1].trim(),
  );
}

// -----------------------------------------------------------------------------
// Utlasningen
// -----------------------------------------------------------------------------

/**
 * Laser ut det som gar att lasa ut. Fyller INGENTING som inte star i texten.
 *
 * `null` in — en inskannad PDF utan textlager — ger ett tomt forslag och inte
 * ett fel. Bilagan ska ga att ladda upp anda; den forifyller bara ingenting.
 */
export function tolkaAvtalstext(text: string | null): Orderforslag {
  if (!text) return {};

  // Blanksteg kollapsas: pdfjs delar ofta ett ord i flera bitar, och
  // `sammanfogaSidor` fogar dem med mellanslag. Ett monster som kraver exakta
  // avstand hade traffat pa ett dokument och missat pa nasta.
  const t = text.replace(/\s+/g, " ");

  const falt: [Forslagsfalt, Forslag | null][] = [
    ["company_name", bolagsnamn(t)],
    ["org_number", orgnummer(t)],
    ["contact_name", kontaktperson(t)],
    ["phone", telefon(t)],
    ["package_id", paket(t)],
    ["term_months", loptid(t)],
    ["signed_on", signeringsdatum(t)],
  ];

  const ut: Orderforslag = {};
  for (const [namn, forslag] of falt) if (forslag) ut[namn] = forslag;
  return ut;
}

/** Hur manga falt som gick att lasa ut. For texten "4 av 7 fält ifyllda". */
export function antalIfyllda(forslag: Orderforslag): number {
  return Object.keys(forslag).length;
}
