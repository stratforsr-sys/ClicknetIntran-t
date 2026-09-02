/**
 * Delade regler for coachningsmodulen. Ligger i lib och inte i en server
 * action-fil eftersom en "use server"-modul exponerar varje export som en
 * anropbar slutpunkt — samma skal som `utbildning.ts`.
 *
 * Ren logik, inga importer. Allt harinne provas av tests/coachning.mjs.
 */

// -----------------------------------------------------------------------------
// Uppgiftstyperna
// -----------------------------------------------------------------------------

export const UPPGIFTSTYPER = [
  "kurs",
  "rollspel_inspelat",
  "lasning",
  "rollspel_live",
  "manus",
  "medlyssning",
  "uppgift",
] as const;

export type Uppgiftstyp = (typeof UPPGIFTSTYPER)[number];

export const TYP_ETIKETT: Record<Uppgiftstyp, string> = {
  kurs: "Utbildning",
  rollspel_inspelat: "Inspelat rollspel",
  lasning: "Läs och kvittera",
  rollspel_live: "Rollspel live",
  manus: "Manus",
  medlyssning: "Medlyssning",
  uppgift: "Uppgift",
};

/**
 * DE TRE TYPER SOM INTE GAR ATT BOCKA FOR HAND.
 *
 * Laget hamtas ur `certification`, `course_attempt` respektive `document_ack` —
 * tabeller som redan ar sanningen om samma sak. En bock bredvid dem hade varit
 * en andra sanning, och den dag de sager olika ar bocken den som ljuger.
 *
 * Listan speglar triggern `coaching_kvittens_vakt` i 0043. Lagger du till en
 * typ har maste den laggas till dar ocksa — annars slapper databasen igenom en
 * kvittering som koden tror ar omojlig.
 */
export const SJALVSANNA_TYPER: Uppgiftstyp[] = ["kurs", "rollspel_inspelat", "lasning"];

export function arSjalvsann(typ: Uppgiftstyp): boolean {
  return SJALVSANNA_TYPER.includes(typ);
}

/** Vilken kolumn som maste vara satt for varje typ. Speglar `coaching_task_kalla`. */
export const TYP_KRAVER_KALLA: Record<Uppgiftstyp, "course_id" | "module_id" | "document_id" | null> = {
  kurs: "course_id",
  rollspel_inspelat: "module_id",
  rollspel_live: "module_id",
  lasning: "document_id",
  manus: null,
  medlyssning: null,
  uppgift: null,
};

// -----------------------------------------------------------------------------
// Kvitteringen
// -----------------------------------------------------------------------------

export const KVITTERARE = ["sjalv", "motpart", "skapare", "chef"] as const;
export type Kvitterare = (typeof KVITTERARE)[number];

export const KVITTERARE_ETIKETT: Record<Kvitterare, string> = {
  sjalv: "Den som ska göra den",
  motpart: "Motparten",
  skapare: "Den som lade upp den",
  chef: "Närmaste chef",
};

export const BEVIS = ["ingen", "kommentar", "fil"] as const;
export type Bevis = (typeof BEVIS)[number];

export const BEVIS_ETIKETT: Record<Bevis, string> = {
  ingen: "Inget bevis",
  kommentar: "Kräver en kommentar",
  fil: "Kräver en fil",
};

export type Uppgift = {
  kind: Uppgiftstyp;
  assignee_id: string;
  partner_id: string | null;
  created_by: string;
  verify_by: Kvitterare;
  evidence: Bevis;
  due_date: string | null;
  cancelled_at: string | null;
};

/**
 * Far den har personen satta bocken?
 *
 * `arChef` ar en fraga till databasen (`leads_employee` eller
 * `can_read_all_employees`) och skickas darfor in — den gar inte att svara pa
 * har, och ett gissat svar hade blivit en behorighetsbrist.
 *
 * EN SJALVSANN UPPGIFT KVITTERAS AV INGEN. Det ar inte en behorighetsfraga utan
 * en fraga om var sanningen bor, sa den kontrollen kommer forst — annars hade
 * en chef med `verify_by = 'chef'` kunnat bocka av en kurs som inte ar gjord.
 */
export function farKvittera(
  uppgift: Uppgift,
  betraktareId: string,
  arChef: boolean,
): boolean {
  if (arSjalvsann(uppgift.kind)) return false;
  if (uppgift.cancelled_at) return false;

  switch (uppgift.verify_by) {
    case "sjalv":
      return betraktareId === uppgift.assignee_id;
    case "motpart":
      return uppgift.partner_id !== null && betraktareId === uppgift.partner_id;
    case "skapare":
      return betraktareId === uppgift.created_by;
    case "chef":
      return arChef;
  }
}

/**
 * NODUTGANGEN. En uppgift med `verify_by = 'sjalv'` vars ansvariga slutat eller
 * ar langtidssjuk gar annars aldrig att stanga, och kon blir en logg som ingen
 * litar pa. Chefen far darfor alltid AVBRYTA — men aldrig godkanna at nagon
 * annan. Skillnaden ar hela poangen: ett avbrott ar arligt, en kvittering i
 * nagon annans namn ar det inte.
 */
export function farAvbryta(uppgift: Uppgift, betraktareId: string, arChef: boolean): boolean {
  if (uppgift.cancelled_at) return false;
  return arChef || betraktareId === uppgift.created_by;
}

/** Vad som saknas for att kvitteringen ska ga igenom. Null = inget. */
export function bevisSaknas(
  bevis: Bevis,
  inmatning: { kommentar: string | null; fil_id: string | null },
): string | null {
  if (bevis === "kommentar" && !inmatning.kommentar?.trim()) {
    return "Uppgiften kräver en kommentar.";
  }
  if (bevis === "fil" && !inmatning.fil_id) {
    return "Uppgiften kräver en bifogad fil.";
  }
  return null;
}

// -----------------------------------------------------------------------------
// Laget
// -----------------------------------------------------------------------------

export const HANDELSETYPER = [
  "tilldelad",
  "paborjad",
  "inlamnad",
  "kvitterad",
  "underkand",
  "avbruten",
] as const;

export type Handelsetyp = (typeof HANDELSETYPER)[number];

/**
 * `by` ar VALFRITT, och det ar inte slarv.
 *
 * `lageFor()` bryr sig bara om VAD som hant och NAR — vem som gjorde det andrar
 * aldrig laget. Falten som logiken inte anvander ska darfor inte vara
 * obligatoriska i den typ logiken tar emot, annars maste varje prov i
 * tests/coachning.mjs hitta pa en anvandare for att fa provet att kompilera.
 *
 * Vyerna som DAR skriver ut vem som kvitterade laser `by` och kraver darfor att
 * `bygg()` hamtar kolumnen. Det gor den.
 */
export type Handelse = { type: Handelsetyp; at: string; by?: string | null };

export type Uppgiftslage = "ej_paborjad" | "pagar" | "inlamnad" | "underkand" | "klar" | "avbruten";

export const LAGE_ETIKETT: Record<Uppgiftslage, string> = {
  ej_paborjad: "Ej påbörjad",
  pagar: "Pågår",
  inlamnad: "Väntar på kvittering",
  underkand: "Underkänd",
  klar: "Klar",
  avbruten: "Avbruten",
};

export const LAGE_TON: Record<Uppgiftslage, "ok" | "warn" | "danger" | "neutral"> = {
  ej_paborjad: "neutral",
  pagar: "warn",
  inlamnad: "warn",
  underkand: "danger",
  klar: "ok",
  avbruten: "neutral",
};

/**
 * FORSENING AR INTE ETT LAGE, DET AR EN ANDRA UPPGIFT OM SAMMA RAD.
 *
 * `kursLage()` i utbildning.ts vager ihop allt till ett enda varde, och det ar
 * ratt dar: en kurs kan inte vara bade certifierad och forsenad. En
 * coachningsuppgift kan daremot mycket val vara BADE underkand OCH forsenad,
 * och den som slar ihop dem far valja vilken av tva sanna saker som ska doljas.
 *
 * Darfor tva funktioner. Vyn ritar tva marken.
 */
export function lageFor(args: {
  kind: Uppgiftstyp;
  handelser: Handelse[];
  /** For de sjalvsanna typerna: har certifikatet/bedomningen/kvittensen fallit ut? */
  kallanKlar?: boolean;
  cancelledAt?: string | null;
}): Uppgiftslage {
  if (args.cancelledAt) return "avbruten";

  if (arSjalvsann(args.kind)) {
    if (args.kallanKlar) return "klar";
    return harHandelse(args.handelser, "paborjad") ? "pagar" : "ej_paborjad";
  }

  const senast = senasteHandelse(args.handelser);
  if (!senast) return "ej_paborjad";

  switch (senast.type) {
    case "avbruten":
      return "avbruten";
    case "kvitterad":
      return "klar";
    case "underkand":
      return "underkand";
    case "inlamnad":
      return "inlamnad";
    case "paborjad":
      return "pagar";
    case "tilldelad":
      return "ej_paborjad";
  }
}

export function forsenad(lage: Uppgiftslage, dueDate: string | null, nu: Date = new Date()): boolean {
  if (!dueDate) return false;
  if (lage === "klar" || lage === "avbruten") return false;
  return slutetAvDagen(dueDate) < nu;
}

/**
 * Den senaste handelsen avgor, oavsett vilken ordning raderna kommer i.
 * `coaching_task_event` ar en logg och inte ett tillstand — en underkand
 * inlamning skrivs aldrig over, den ligger kvar under den nya.
 */
function senasteHandelse(handelser: Handelse[]): Handelse | null {
  if (handelser.length === 0) return null;
  return [...handelser].sort((a, b) => (a.at < b.at ? 1 : -1))[0];
}

function harHandelse(handelser: Handelse[], typ: Handelsetyp): boolean {
  return handelser.some((h) => h.type === typ);
}

/**
 * Fristen gar ut nar DAGEN ar slut, inte nar den borjar. Utan det ar en uppgift
 * som ska vara klar "i dag" forsenad redan vid midnatt, och den som oppnar
 * navet pa morgonen moter en rod rad hon inte kunnat gora nagot at.
 */
function slutetAvDagen(datum: string): Date {
  const d = new Date(datum);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function dagarKvar(dueDate: string | null, nu: Date = new Date()): number | null {
  if (!dueDate) return null;
  const diff = slutetAvDagen(dueDate).getTime() - nu.getTime();
  return Math.ceil(diff / 86_400_000);
}

// -----------------------------------------------------------------------------
// Paminnelsetrappan
//
// Samma trappa som systemguiderna fick 2026-08-31, och medvetet inte en egen:
// den ar provad i drift, och tva olika trappor i samma nav hade betytt att en
// paminnelse inte langre sager nagot om hur bradskande saken ar.
//
//   3 dygn utan rorelse   -> en post i personens egen klocka
//   7 dygn utan rorelse   -> en post i chefens
//   14 dagar OVER fristen -> ett arende till narmaste chef
//
// Notera skillnaden mellan de tva forsta och den tredje: de raknar STILLESTAND,
// den sista raknar OVERSKRIDANDE. En uppgift med lang frist som nagon arbetar
// med varje vecka ska inte paminnas om, och en uppgift vars frist gatt ut ska
// eskaleras aven om den ror pa sig.
// -----------------------------------------------------------------------------

export const PAMINNELSE_PERSON_DYGN = 3;
export const PAMINNELSE_CHEF_DYGN = 7;
export const ARENDE_EFTER_DAGAR = 14;

export type Paminnelse = "person" | "chef" | "arende" | null;

export function paminnelseFor(args: {
  lage: Uppgiftslage;
  senasteRorelse: string | null;
  dueDate: string | null;
  nu?: Date;
}): Paminnelse {
  const nu = args.nu ?? new Date();
  if (args.lage === "klar" || args.lage === "avbruten") return null;

  // Overskridandet vager tyngst och provas forst. En uppgift som ar bade
  // forsenad i tre veckor och rord i gar ska ge ett arende, inte tystnad.
  const kvar = dagarKvar(args.dueDate, nu);
  if (kvar !== null && kvar <= -ARENDE_EFTER_DAGAR) return "arende";

  if (!args.senasteRorelse) return null;
  const stillestand = dygnMellan(new Date(args.senasteRorelse), nu);

  if (stillestand >= PAMINNELSE_CHEF_DYGN) return "chef";
  if (stillestand >= PAMINNELSE_PERSON_DYGN) return "person";
  return null;
}

function dygnMellan(fran: Date, till: Date): number {
  return Math.floor((till.getTime() - fran.getTime()) / 86_400_000);
}

// -----------------------------------------------------------------------------
// Lagvyn
// -----------------------------------------------------------------------------

/**
 * U3. Larmet som faktiskt andrar nagot — och det andrar beteendet hos CHEFEN,
 * inte hos den som coachas. Underlaget ar entydigt: veckovis coachning ger
 * markbart battre utfall an kvartalsvis, sa det enda tal lagvyn behover visa
 * ar hur lange sedan det var.
 */
export const LARMGRANS_DAGAR = 30;

/**
 * Dagar sedan personen senast coachades. Null = aldrig.
 *
 * VAD SOM RAKNAS SOM COACHNING ar en avgorande detalj. Att NAGON LADE UPP en
 * uppgift ar inte coachning — da hade en chef kunnat nolla sin egen siffra
 * genom att skapa tio uppgifter och aldrig folja upp dem. Det som raknas ar att
 * nagot faktiskt HANDE: ett kvitterat moment, en bedomning, ett hallet samtal.
 */
export function dagarSedanCoachning(
  handelser: { at: string }[],
  nu: Date = new Date(),
): number | null {
  if (handelser.length === 0) return null;
  const senast = handelser.reduce((a, b) => (a.at > b.at ? a : b));
  return Math.max(0, dygnMellan(new Date(senast.at), nu));
}

export function larmar(dagar: number | null): boolean {
  return dagar === null || dagar >= LARMGRANS_DAGAR;
}

export type Lagrad = {
  employee_id: string;
  dagarSedan: number | null;
  forsenade: number;
  oppna: number;
};

/**
 * Behover den har personen nagot av mig just nu?
 *
 * Filtret i lagvyn stallar samma fraga som ordningen ovan besvarar, och den ska
 * darfor inte formuleras en andra gang i React. Tre saker raknas, och bara tre:
 * en frist som gatt ut, en inlamning som ligger och vantar pa min bock, och en
 * person ingen rort pa en manad.
 *
 * ANTALET OPPNA UPPGIFTER RAKNAS INTE. Den som har sju uppgifter som alla loper
 * pa i tid behover ingenting — och hade listan slappt fram henne hade filtret
 * visat halva laget och slutat betyda nagot.
 */
export function behoverNagot(rad: {
  dagarSedan: number | null;
  forsenade: number;
  vantarPaMig?: number;
}): boolean {
  return rad.forsenade > 0 || (rad.vantarPaMig ?? 0) > 0 || larmar(rad.dagarSedan);
}

/**
 * Ordningen INUTI ett personkort.
 *
 * Overst det som kraver en handling av DEN SOM TITTAR — en inlamning som vantar
 * pa min bock ar det enda pa hela sidan jag kan gora nagot at pa tio sekunder.
 * Sedan det som gatt over tiden, sedan narmaste frist. Uppgifter utan frist
 * sist: de brinner inte, och de ska inte trangas fore nagot som gor det.
 *
 * Datumen jamfors som strangar. `due_date` ar en `date` i databasen och kommer
 * alltid som `YYYY-MM-DD`, ett format dar bokstavsordning ar datumordning — och
 * en `new Date()` per jamforelse i en sortering som kors for varje kort i laget
 * ar en kostnad utan motprestation.
 */
export type Uppgiftsordning = {
  kraverDinBock: boolean;
  forsenad: boolean;
  due_date: string | null;
  title: string;
};

export function sorteraUppgifter<T extends Uppgiftsordning>(rader: T[]): T[] {
  return [...rader].sort((a, b) => {
    if (a.kraverDinBock !== b.kraverDinBock) return a.kraverDinBock ? -1 : 1;
    if (a.forsenad !== b.forsenad) return a.forsenad ? -1 : 1;
    if (a.due_date !== b.due_date) {
      if (a.due_date === null) return 1;
      if (b.due_date === null) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    return a.title.localeCompare(b.title, "sv");
  });
}

/**
 * Ordningen i lagvyn ar hela vyns budskap.
 *
 * Forsenade uppgifter forst, sedan lange sedan coachad, sist alfabetiskt. Den
 * som aldrig coachats (null) sorteras som oandligt lange sedan och hamnar
 * overst — det ar precis den person vyn finns for att hitta.
 *
 * DETTA AR INTE EN RANGORDNING. Ordningen sager vem som behover nagot, inte vem
 * som ar samst, och listan bar darfor inga poang och ingen placering. Se
 * avsnitt 7 i utredningen och 0029.
 */
export function sorteraLag<T extends Lagrad>(rader: T[], namn: (r: T) => string): T[] {
  return [...rader].sort((a, b) => {
    if (a.forsenade !== b.forsenade) return b.forsenade - a.forsenade;
    const ad = a.dagarSedan ?? Number.POSITIVE_INFINITY;
    const bd = b.dagarSedan ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return bd - ad;
    return namn(a).localeCompare(namn(b), "sv");
  });
}

// -----------------------------------------------------------------------------
// Mallarna (U1)
// -----------------------------------------------------------------------------

export type Mallpost = {
  sort: number;
  kind: Uppgiftstyp;
  title: string;
  description_md: string;
  verify_by: Kvitterare;
  evidence: Bevis;
  offset_days: number;
  course_id: string | null;
  module_id: string | null;
  document_id: string | null;
  focus_ids: string[];
};

export type Planerad = Mallpost & { due_date: string };

/**
 * En mall blir uppgifter. Fristen ar RELATIV och raknas fran den dag mallen
 * tillampas, sa samma rampplan fungerar for den som borjar i mars och den som
 * borjar i november.
 *
 * Datumet skrivs som `YYYY-MM-DD` och inte som en tidsstampel: `due_date` ar en
 * `date` i databasen, och en tidsstampel hade dragit in tidszonen i en fraga
 * som inte handlar om klockslag.
 */
export function planera(poster: Mallpost[], startdatum: string): Planerad[] {
  return [...poster]
    .sort((a, b) => a.sort - b.sort)
    .map((p) => ({ ...p, due_date: laggTill(startdatum, p.offset_days) }));
}

export function laggTill(datum: string, dagar: number): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dagar);
  return d.toISOString().slice(0, 10);
}

/**
 * Vad som gor en mallpost obrukbar. Kontrollen finns i tre lager — check-villkor
 * i 0043, den har funktionen, och formularet — eftersom en mall skrivs EN gang
 * och tillampas hundra. Ett fel i en mall ar hundra trasiga uppgifter.
 */
export function granskaMallpost(post: Mallpost): string | null {
  if (!post.title.trim()) return "Varje moment behöver en rubrik.";
  if (post.offset_days < 0) return `"${post.title}": förfallodagen kan inte ligga före starten.`;

  const kravs = TYP_KRAVER_KALLA[post.kind];
  if (kravs === "course_id" && !post.course_id) return `"${post.title}": välj vilken kurs som avses.`;
  if (kravs === "module_id" && !post.module_id) return `"${post.title}": välj vilken rollspelsmodul som avses.`;
  if (kravs === "document_id" && !post.document_id) return `"${post.title}": välj vilket dokument som ska läsas.`;

  // `verify_by = 'motpart'` gar inte att satta i en mall: motparten ar okand
  // forran mallen tillampas pa en person. Databasen nekar raden, sa den maste
  // fangas har — annars faller hela tillampningen mitt i.
  if (post.verify_by === "motpart") {
    return `"${post.title}": motparten är inte känd förrän mallen används. Välj en annan kvitterare.`;
  }

  if (arSjalvsann(post.kind) && post.verify_by !== "sjalv") {
    return `"${post.title}": ${TYP_ETIKETT[post.kind].toLowerCase()} kvitteras inte för hand.`;
  }

  return null;
}

export function granskaMall(poster: Mallpost[]): string | null {
  if (poster.length === 0) return "En mall behöver minst ett moment.";
  for (const p of poster) {
    const fel = granskaMallpost(p);
    if (fel) return fel;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Mallen skrivs som text
//
// Samma val som quizfragorna (`tolkaFragor`) och rollspelsrubriken
// (`tolkaKriterier`) gjorde, och av samma skal: en rampplan skrivs i ETT svep,
// ofta genom att klistra in fran ett underlag. Ett formular med "lagg till
// moment" tolv ganger gor samma arbete tio ganger langsammare.
//
//   Las manuset          | lasning     | 2  | oppningen | Intro
//   Rollspel med Anna    | manus       | 5  |           | Intro, Behovsanalys
//   Ring 20 bolag        | uppgift     | 10
//
// Rubrik | typ | dagar | kalla | fokusomraden
//
// Bara rubriken ar obligatorisk. Typen blir `uppgift`, dagarna noll.
//
// KALLAN ANGES SOM SLUG, inte som id. En mall ska ga att skriva av en manniska
// som lasar en lista, och ett uuid gar inte att skriva av. Slugen slas upp nar
// mallen sparas, sa ett stavfel fangas dar och inte forst nar mallen tillamps
// pa en riktig person.
//
// ROLLSPEL GAR INTE ATT LAGGA I EN MALL AN. Modulerna har inga slugar — de
// identifieras av kurs plus ordning — och en mall som pekar pa "modul 3" hade
// gatt sonder den dagen nagon lade in en modul mellan tva andra. Det ar en
// medveten lucka, inte ett forbiseende.
// -----------------------------------------------------------------------------

/** Typerna som gar att skriva i en mall, med det ord man skriver. */
export const MALLTYPER: Uppgiftstyp[] = ["uppgift", "manus", "medlyssning", "kurs", "lasning"];

/** Vilka av dem som kraver en slug efter dagarna. */
export const MALLTYP_KRAVER_SLUG: Uppgiftstyp[] = ["kurs", "lasning"];

export type Mallrad = {
  sort: number;
  title: string;
  kind: Uppgiftstyp;
  offset_days: number;
  kalla_slug: string | null;
  fokus: string[];
};

export function tolkaMall(text: string): { rader: Mallrad[]; fel: string | null } {
  const rader = text
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);

  if (rader.length === 0) return { rader: [], fel: null };
  if (rader.length > 50) return { rader: [], fel: "Högst 50 moment i en mall." };

  const ut: Mallrad[] = [];

  for (const [i, rad] of rader.entries()) {
    const d = rad.split("|").map((x) => x.trim());
    const nr = i + 1;

    const title = d[0];
    if (!title) return { rader: [], fel: `Rad ${nr} saknar rubrik.` };

    const typord = (d[1] || "uppgift") as Uppgiftstyp;
    if (!MALLTYPER.includes(typord)) {
      return {
        rader: [],
        fel: `Rad ${nr}: "${d[1]}" är ingen malltyp. Skriv en av ${MALLTYPER.join(", ")}.`,
      };
    }

    let offset = 0;
    if (d[2]) {
      const tal = Number(d[2]);
      if (!Number.isInteger(tal) || tal < 0 || tal > 365) {
        return { rader: [], fel: `Rad ${nr}: dagarna ska vara ett heltal mellan 0 och 365.` };
      }
      offset = tal;
    }

    const slug = d[3] || null;
    if (MALLTYP_KRAVER_SLUG.includes(typord) && !slug) {
      return {
        rader: [],
        fel: `Rad ${nr}: ${TYP_ETIKETT[typord].toLowerCase()} behöver en slug i fjärde fältet.`,
      };
    }

    const fokus = (d[4] ?? "")
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    ut.push({ sort: nr, title, kind: typord, offset_days: offset, kalla_slug: slug, fokus });
  }

  return { rader: ut, fel: null };
}

/** Baklanges, for redigeringsvyn. */
export function skrivMall(rader: Mallrad[]): string {
  return [...rader]
    .sort((a, b) => a.sort - b.sort)
    .map((r) =>
      [r.title, r.kind, String(r.offset_days), r.kalla_slug ?? "", r.fokus.join(", ")]
        .join(" | ")
        .replace(/(\s*\|\s*)+$/, ""),
    )
    .join("\n");
}
