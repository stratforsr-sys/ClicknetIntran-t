// Explicit `.ts` i sokvagen, precis som `order.ts` och `provision.ts` sjalva
// gor. Utan den gar filen inte att importera med `node --experimental-strip-types`,
// och da gar provet i `tests/ordervy.mjs` inte att kora.
import { raknas, type Orderstatus } from "./order.ts";
import { manadFore, manadsnyckel } from "./provision.ts";

/**
 * Ordervyn: filtret i adressen, och kunden bakom ordern.
 *
 * =============================================================================
 * VARFOR EN EGEN, REN MODUL
 *
 * Ordersidan ar en serverkomponent som lases om vid varje filterbyte, och
 * filtret bor darfor i adressen. Det gor tolkningen av adressen till den mest
 * kansliga koden pa sidan: tolkas `?tid=` fel far nagon fel manads siffror, och
 * slipper en obestamd strang igenom till PostgREST kan den styra fragan.
 *
 * Bada de fragorna gar att svara pa UTAN databas, och da ska de ocksa gora det.
 * Allt harinne ar rena funktioner som `tests/ordervy.mjs` provar direkt.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// Filtret
// -----------------------------------------------------------------------------

/**
 * Tiden, i tre lagen.
 *
 * `alla` ar FORVALET, och det ar ett medvetet val mot "innevarande manad".
 *
 * Ett forval som doljer rader ger fragan "var blev min order av" — och den
 * fragan stalls till en manniska, inte till granssnittet. Priset ar att listan
 * kan bli lang, och det priset betalas med ett tak och ett besked om att taket
 * slog till (se `ORDERTAK`). Ett tak som SAGER att det skar av ar arligt; ett
 * forval som tiger ar det inte.
 */
export type Tidsval =
  | { slag: "alla" }
  /** En hel manad, nyckeln som `2026-09-01`. Matchas mot `period_month`. */
  | { slag: "manad"; manad: string }
  /** En enda dag, som `2026-09-24`. Matchas mot `signed_on`. */
  | { slag: "dag"; datum: string };

/** Statuslagena i filterraden. `vantar` ar kon — den har inget eget kort langre. */
export const STATUSVAL = ["alla", "vantar", "signerad", "betald", "makulerad", "utkast"] as const;
export type Statusval = (typeof STATUSVAL)[number];

/**
 * Lagena UTSKRIVNA, for raden under rutnatet och for det tomma laget.
 *
 * "Ingen order svarar mot väntar på godkännande · september 2026" ar en mening
 * nagon kan lasa. Det ar den har listan som anvands dar.
 */
export const STATUSVAL_ETIKETT: Record<Statusval, string> = {
  alla: "Alla",
  vantar: "Väntar på godkännande",
  signerad: "Signerade",
  betald: "Betalda",
  makulerad: "Makulerade",
  utkast: "Utkast",
};

/**
 * Lagena pa CHIPSEN, korta.
 *
 * =============================================================================
 * TVA UPPSATTNINGAR ORD FOR SAMMA SEX LAGEN, OCH DET AR INTE DUBBLERING.
 *
 * Ett chip ar en knapp i en rad av sex. "Väntar på godkännande" ar tjugoen
 * tecken, och sex sadana chips blir en rad som maste rullas i sidled pa en
 * dator — alltsa ett filter dar halva valen ligger utanfor skarmen.
 *
 * I en MENING ar det tvartom: "väntar" ensamt svarar inte pa vad ordern vantar
 * pa. Chipset har sitt sammanhang av att sta i en statusrad; meningen har det
 * inte.
 *
 * Bada listorna ar `Record<Statusval, string>`, sa ett nytt lage kan inte
 * laggas till i den ena utan att kompilatorn kraver det i den andra.
 * =============================================================================
 */
export const STATUSVAL_KORT: Record<Statusval, string> = {
  alla: "Alla",
  vantar: "Väntar",
  signerad: "Signerade",
  betald: "Betalda",
  makulerad: "Makulerade",
  utkast: "Utkast",
};

export type Orderfilter = {
  /** Anstallnings-id, eller `alla`. `jag` loeses upp mot den inloggade. */
  vem: string;
  tid: Tidsval;
  status: Statusval;
  /**
   * Fritext mot BOLAGSNAMNET. Aldrig mot organisationsnummer — K27-undantaget
   * later kolumnen bara ett personnummer, och DECISIONS.md sager att numret
   * aldrig far hamna i en sokning. Se `hamtaOrderUrval`.
   */
  sok: string;
};

export const TOMT_FILTER: Orderfilter = {
  vem: "alla",
  tid: { slag: "alla" },
  status: "alla",
  sok: "",
};

/**
 * Taket pa listan.
 *
 * `tid=alla` betyder alla order som RLS slapper fram, och det talet vaxer med
 * bolaget. Taket star i koden och inte i webblasaren sa att en handskriven
 * adress inte kan bestalla tiotusen rader.
 */
export const ORDERTAK = 300;

/** Hur manga manader bakat manadsvaljaren racker. Tva ar ar ett avtals langd. */
export const MANADSVAL_ANTAL = 24;

/**
 * Sokstrangen, rensad.
 *
 * =============================================================================
 * DEN HAR FUNKTIONEN AR EN SAKERHETSSPARR, INTE EN BEKVAMLIGHET.
 *
 * Texten gar in i ett PostgREST-filter, och tva teckenklasser ar farliga dar:
 *
 *   `%` och `_` ar JOKERTECKEN i `ilike`. En sokning pa `%` hade traffat varje
 *   rad RLS slapper fram — alltsa en knapp som tommer hela tabellen i listan.
 *
 *   `,` `(` `)` `.` och `:` ar SYNTAX i PostgREST:s filteruttryck. Sokningen gar
 *   i dag genom `.ilike()`, som kodas av URLSearchParams och darfor ar sakert i
 *   sig — men villkoret ligger en rad ifran manadsfiltrets `.or()`, och den dag
 *   nagon flyttar sokningen dit ska tecknen redan vara borta. En sparr som bara
 *   haller sa lange ingen andrar koden ar ingen sparr.
 *
 * Tecknen tas BORT i stallet for att flys: en soktext ar ett bolagsnamn nagon
 * skriver, och ingen letar efter ett bolag som heter `%_(`.
 * =============================================================================
 */
export function rensaSok(text: string): string {
  return text
    .replace(/[,().*:%_"'\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** Ar strangen en manadsnyckel, `2026-09-01`? */
function arManad(text: string): boolean {
  return /^\d{4}-\d{2}-01$/.test(text) && Number(text.slice(5, 7)) >= 1 && Number(text.slice(5, 7)) <= 12;
}

/** Ar strangen ett kalenderdatum, `2026-09-24`? */
function arDatum(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/**
 * Adressen till ett filter.
 *
 * ALLT OKANT BLIR FORVALET. En adress som nagon skrivit av for hand, en gammal
 * bokmarkning eller en lank fran ett chattfonster far aldrig ge ett fel — den
 * ger den ofiltrerade listan. Det ar ocksa vad som gor `tolkaFilter` provbar:
 * det finns inget kastat undantag att fanga.
 */
export function tolkaFilter(
  sp: Record<string, string | string[] | undefined>,
  mig: string,
): Orderfilter {
  const en = (nyckel: string): string => {
    const v = sp[nyckel];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const vem = en("vem");
  const tid = en("tid");
  const status = en("status");

  return {
    // `jag` skrivs ut till ett riktigt id har, sa att resten av kedjan bara
    // kanner ett fall. Den som lankar `?vem=jag` far sina egna order oavsett vem
    // som oppnar lanken — det ar en genvag, inte en behorighet.
    vem: vem === "jag" ? mig : /^[0-9a-f-]{36}$/i.test(vem) ? vem : "alla",
    tid: arManad(tid)
      ? { slag: "manad", manad: tid }
      : arDatum(tid)
        ? { slag: "dag", datum: tid }
        : { slag: "alla" },
    status: (STATUSVAL as readonly string[]).includes(status) ? (status as Statusval) : "alla",
    sok: rensaSok(en("sok")),
  };
}

/**
 * Filtret tillbaka till en fragestrang.
 *
 * FORVALEN SKRIVS INTE UT. `/order` och `/order?vem=alla&tid=alla&status=alla`
 * ar samma vy, och da ska de ha samma adress — annars blir "dela lanken" en
 * fraga om vilken av dem man rakade kopiera. Det ar ocksa det som gor att
 * `?kund=` och `?ny=1` kan laggas till utan att filtret svaller.
 */
export function filtretSomFraga(f: Orderfilter, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  if (f.vem !== "alla") p.set("vem", f.vem);
  if (f.tid.slag === "manad") p.set("tid", f.tid.manad);
  if (f.tid.slag === "dag") p.set("tid", f.tid.datum);
  if (f.status !== "alla") p.set("status", f.status);
  if (f.sok) p.set("sok", f.sok);
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);

  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Ar nagot alls valt? Styr om "Rensa filtret" ritas. */
export function harFilter(f: Orderfilter): boolean {
  return f.vem !== "alla" || f.tid.slag !== "alla" || f.status !== "alla" || f.sok !== "";
}

/**
 * Statuslaget till de statusar det slapper fram.
 *
 * Tom lista betyder "alla" — och det ar med flit inte `ORDERSTATUSAR`, eftersom
 * en tom lista later fragan slippa villkoret helt i stallet for att rakna upp
 * sex varden PostgREST anda inte behover se.
 */
export function statusarnaI(val: Statusval): Orderstatus[] {
  if (val === "alla") return [];
  if (val === "vantar") return ["inskickad"];
  return [val as Orderstatus];
}

/** Manadsnycklarna i valjaren, nyast forst. */
export function manadsval(idag: string, antal = MANADSVAL_ANTAL): string[] {
  const nu = manadsnyckel(idag);
  return Array.from({ length: antal }, (_, i) => manadFore(nu, i));
}

// -----------------------------------------------------------------------------
// Kunden bakom ordern
// -----------------------------------------------------------------------------

/**
 * Det minsta en orderrad behover vara for att harunder ska kunna rakna pa den.
 *
 * Star som en egen typ och inte som `Orderrad` eftersom den typen bor i
 * `order-server.ts`, som ar `server-only`. En ren modul som importerar den kan
 * inte provas i node, och ett prov som inte gar att kora ar inget prov.
 */
export type Kundrad = {
  id: string;
  company_name: string;
  org_number: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  status: Orderstatus;
  signed_on: string;
  starts_on: string;
  ends_on: string;
  term_months: number;
  monthly_amount: number | null;
  order_value: number | null;
  buyout_amount?: number | null;
  commission_amount: number | null;
  renewal_outcome: "forlangd" | "avslutad" | null;
  salesperson_id: string;
};

/**
 * Nyckeln som avgor om tva order ar samma kund.
 *
 * =============================================================================
 * ORGANISATIONSNUMRET FORST, BOLAGSNAMNET SOM RESERV.
 *
 * Numret ar den riktiga identiteten — tva bolag kan heta likadant, och ett bolag
 * kan byta namn mitt i en avtalsperiod utan att bli en annan kund. Det skrivs
 * daremot in for hand, och samma bolag kan darfor ligga som `556677-8899` pa en
 * order och `5566778899` pa nasta. Siffrorna plockas ut och resten kastas, sa
 * att de tva blir samma nyckel.
 *
 * Saknas numret — eller ar det for kort att vara ett nummer — faller nyckeln
 * tillbaka pa bolagsnamnet, gemener och utan mellanslag i kanterna. Det ar
 * samre, men det ar battre an att varje sadan order blir en egen kund.
 *
 * NYCKELN AR ALDRIG EN ADRESS. K27-undantaget later kolumnen bara ett
 * personnummer for en enskild firma, och ett personnummer far inte ligga i en
 * fragestrang, i en webblasarhistorik eller i en serverlogg. Kundkortet oppnas
 * darfor med en ORDERS id — se `hamtaKundensOrder` i `order-server.ts`.
 * =============================================================================
 */
export function kundnyckel(o: { org_number: string; company_name: string }): string {
  const siffror = (o.org_number ?? "").replace(/\D/g, "");
  if (siffror.length >= 10) {
    // Tolv siffror med sekel kortas till tio, precis som `normaliseraOrgnr`.
    return `nr:${siffror.length === 12 ? siffror.slice(2) : siffror}`;
  }
  // `namn:` UTAN NAGOT EFTER ar en nyckel som inte identifierar nagon. Se
  // `TOM_NYCKEL` och guarden i `sammaKund` — utan den slogs varje rad som
  // saknade bade nummer och namn ihop till en enda kund, och provet i
  // tests/ordervy.mjs fangade det.
  return `namn:${(o.company_name ?? "").trim().toLowerCase()}`;
}

/**
 * Nyckeln en rad far nar den varken har nummer eller namn.
 *
 * Den ar INTE en identitet, och det ar hela poangen: tva rader som bada saknar
 * allt ar inte samma kund, de ar tva rader vi inte vet nagot om. `company_name`
 * ar `not null` i 0034 sa laget ska inte kunna uppsta — men en likhetsjamforelse
 * som svarar "ja" pa tva tomma varden ar fel oavsett om den nas.
 */
const TOM_NYCKEL = "namn:";

/**
 * Hor de tva raderna till samma kund? Namnet raknas ocksa, se `kundnyckel`.
 *
 * Tar de TVA FALT den behover och inte en hel `Kundrad`. Funktionen anropas fran
 * `order-server.ts` med en `Orderrad`, och en bredare signatur an nodvandigt
 * hade last som att den bryr sig om belopp och datum.
 */
export function sammaKund(
  a: { org_number: string; company_name: string },
  b: { org_number: string; company_name: string },
): boolean {
  const nyckelA = kundnyckel(a);
  const nyckelB = kundnyckel(b);

  // En rad utan bade nummer och namn hor inte till nagon kund — allra minst till
  // en annan lika tom rad.
  if (nyckelA === TOM_NYCKEL || nyckelB === TOM_NYCKEL) return false;
  if (nyckelA === nyckelB) return true;

  // Samma namn men olika nummer raknas ocksa: numret skrivs in for hand, och ett
  // felskrivet nummer ska inte dela en kunds historik i tva kort.
  const namnA = a.company_name.trim().toLowerCase();
  const namnB = b.company_name.trim().toLowerCase();
  return namnA !== "" && namnA === namnB;
}

/**
 * Kunden, med sina order kvar i sin egen typ.
 *
 * GENERISK OVER RADTYPEN, och det ar inte en abstraktionsovning. `Kundrad` ovan
 * ar det MINSTA en rad behover vara for att rakningen harunder ska ga — men
 * kundkortet ritar hela raden, med anteckning, provisionskalla och
 * makuleringsskal. Var typen last till `Kundrad` hade de falten fallit bort pa
 * vagen ut, och kortet hade tvingats hamta om samma rader for att fa dem
 * tillbaka.
 */
export type Kund<T extends Kundrad = Kundrad> = {
  bolag: string;
  orgnr: string;
  /** Nyast signerad forst. */
  order: T[];
  antal: number;
  /** Levande avtal: signerade eller betalda, inte makulerade. */
  levande: number;
  makulerade: number;
  /** Summa ordervarde pa det som nagon gang godkants, minus det makulerade. */
  ordervarde: number;
  /** Hur manga av dem som saknar varde. Order fran fore 0050 har inget. */
  utanVarde: number;
  provision: number;
  /** Vad kunden betalar i manaden just nu: summan over levande avtal. */
  manadsintakt: number;
  /** Tidigaste signeringsdatum. "Kund sedan". */
  kundSedan: string;
  /** Senaste slutdatum bland levande avtal, eller null om inget lever. */
  slutdatum: string | null;
  /** Senaste kanda kontaktuppgifterna, ur den nyaste ordern som har dem. */
  kontakt: { namn: string; telefon: string; mejl: string | null };
};

/**
 * Kunden, rakad ur sina order.
 *
 * TALEN AR KUNDENS HELA HISTORIK och inte en manads. Det ar skillnaden mot
 * `ordervarde()` i `order.ts`, som svarar pa vad en PERIOD bar — den fragan har
 * en manad i sig och den har inte. Bada finns, och de ska inte blandas: ett
 * kundkort som visade septembers siffror hade sett ut som om kunden vart kund i
 * en manad.
 *
 * MAKULERINGAR DRAS AV UTAN HANSYN TILL MANAD, av samma skal. Kundkortet fragar
 * "vad har den har kunden gett oss", och da ar en makulerad order inte en intakt
 * i mars och ett avdrag i augusti — den ar noll.
 */
export function slaSammanKund<T extends Kundrad>(order: T[]): Kund<T> {
  const sorterade = [...order].sort((a, b) =>
    a.signed_on === b.signed_on ? b.id.localeCompare(a.id) : b.signed_on.localeCompare(a.signed_on),
  );

  const levande = sorterade.filter((o) => raknas(o.status));
  const makulerade = sorterade.filter((o) => o.status === "makulerad");

  const summa = (rader: T[], falt: (o: T) => number | null | undefined) =>
    rader.reduce((s, o) => s + (falt(o) ?? 0), 0);

  // Den nyaste ordern som faktiskt HAR en mejladress far ge den. Order fran fore
  // 2026-09-15 saknar kolumnen, och da ska kortet visa den adress som finns pa
  // en aldre order i stallet for en tom rad pa den nyaste.
  const medMejl = sorterade.find((o) => o.contact_email);
  const nyaste = sorterade[0];

  return {
    bolag: nyaste?.company_name ?? "",
    orgnr: nyaste?.org_number ?? "",
    order: sorterade,
    antal: sorterade.length,
    levande: levande.length,
    makulerade: makulerade.length,
    // SUMMERAS OVER DE LEVANDE, inte over de godkanda minus de makulerade.
    //
    // De tva ar samma tal — en makulerad order har alltid varit signerad — men
    // bara det ena gar att lasa. Forsta forsoket drog av makuleringen fran en
    // summa den redan lag i och blev darfor ett avdrag for mycket.
    ordervarde: summa(levande, (o) => o.order_value),
    utanVarde: levande.filter((o) => o.order_value === null).length,
    provision: summa(levande, (o) => o.commission_amount),
    manadsintakt: summa(levande, (o) => o.monthly_amount),
    kundSedan: sorterade.length
      ? sorterade.reduce((tidigast, o) => (o.signed_on < tidigast ? o.signed_on : tidigast), sorterade[0].signed_on)
      : "",
    slutdatum: levande.length
      ? levande.reduce((senast, o) => (o.ends_on > senast ? o.ends_on : senast), levande[0].ends_on)
      : null,
    kontakt: {
      namn: nyaste?.contact_name ?? "",
      telefon: nyaste?.contact_phone ?? "",
      mejl: medMejl?.contact_email ?? null,
    },
  };
}

/**
 * Hur langt in i bindningstiden avtalet har kommit.
 *
 * =============================================================================
 * TALET FINNS FOR ATT TIDSLINJEN PA KUNDKORTET SKA GA ATT LASA UTAN ATT RAKNA.
 *
 * "Avtalet löper 2025-03-01 – 2027-03-01" ar sant och sager ingenting om hur
 * bradskande kunden ar. Samma tva datum som en fylld stapel svarar direkt: nio
 * tiondelar fylld betyder ring nu.
 *
 * `andel` klipps till 0–1 med flit. Ett avtal som gatt ut ligger pa 1 och inte
 * pa 1,3 — stapeln kan inte bli langre an sin ranna, och ett tal over ett hade
 * ritat utanfor. Att det GATT ut sags av `dagarKvar`, som far vara negativt.
 * =============================================================================
 */
export function avtalsforlopp(
  startdatum: string,
  slutdatum: string,
  idag: string,
): { andel: number; dagarKvar: number; dagarTotalt: number } {
  const dag = (d: string) => Date.parse(`${d}T12:00:00Z`);
  const start = dag(startdatum);
  const slut = dag(slutdatum);
  const nu = dag(idag);

  const totalt = Math.round((slut - start) / 86_400_000);
  const gatt = Math.round((nu - start) / 86_400_000);

  return {
    // EN LOPTID PA NOLL DAGAR GER EN FULL STAPEL, inte en tom.
    //
    // Fallet ska inte kunna uppsta — `ends_on` genereras ur
    // `starts_on + term_months` och bindningstiden ar minst en manad (0068) —
    // men divisionen maste anda ta stallning, och forsta forsoket tog fel
    // stallning: det golvade namnaren till ett och fick `0 / 1`, alltsa en TOM
    // stapel over texten "0 dagar kvar". En stapel som sager att avtalet nyss
    // borjat over en text som sager att det ar slut ar det varsta av de tva.
    //
    // Samma gren fangar bakvant satta datum, alltsa ett slut fore sin borjan.
    // Ett dataproblem ska ritas som "slut" och inte som en stapel med negativ
    // bredd.
    andel: totalt <= 0 ? 1 : Math.min(1, Math.max(0, gatt / totalt)),
    dagarKvar: Math.round((slut - nu) / 86_400_000),
    // Golvas till ett forst HAR, dar talet bara ska skrivas ut ("183 av 365
    // dagar kvar"). En nolla i den meningen laser som ett fel i vyn.
    dagarTotalt: Math.max(1, totalt),
  };
}

/**
 * Handelserna pa en order, aldst forst.
 *
 * SIDAN RAKNAR INTE FRAM NAGON HISTORIK SOM INTE STAR I RADEN. Varje post nedan
 * har en egen kolumn bakom sig — `created_at`, `approved_at`, `cancelled_on`,
 * `renewal_at`. En "inskickad"-post finns darfor INTE: ogonblicket har ingen
 * tidsstampel, och en uppdiktad tidpunkt i en tidslinje ar samre an ett hal.
 * Handelseloggen ar stallet dar hela kedjan star.
 */
export function orderhandelser(o: {
  created_at: string;
  signed_on: string;
  approved_at: string | null;
  cancelled_on: string | null;
  cancel_reason?: string | null;
  renewal_outcome: "forlangd" | "avslutad" | null;
  renewal_at?: string | null;
  renewal_reason?: string | null;
}): { datum: string; rubrik: string; text?: string; ton: "neutral" | "ok" | "danger" | "brand" }[] {
  const poster: { datum: string; rubrik: string; text?: string; ton: "neutral" | "ok" | "danger" | "brand" }[] = [
    { datum: o.created_at.slice(0, 10), rubrik: "Ordern lades upp", ton: "neutral" },
  ];

  if (o.signed_on !== o.created_at.slice(0, 10)) {
    poster.push({ datum: o.signed_on, rubrik: "Signerad av kunden", ton: "neutral" });
  }

  if (o.approved_at) {
    poster.push({ datum: o.approved_at.slice(0, 10), rubrik: "Godkänd", ton: "ok" });
  }

  if (o.renewal_outcome === "forlangd" && o.renewal_at) {
    poster.push({ datum: o.renewal_at.slice(0, 10), rubrik: "Avtalet förlängdes", ton: "brand" });
  }

  if (o.renewal_outcome === "avslutad" && o.renewal_at) {
    poster.push({
      datum: o.renewal_at.slice(0, 10),
      rubrik: "Kunden förlängde inte",
      text: o.renewal_reason ?? undefined,
      ton: "danger",
    });
  }

  if (o.cancelled_on) {
    poster.push({
      datum: o.cancelled_on,
      rubrik: "Makulerad",
      text: o.cancel_reason ?? undefined,
      ton: "danger",
    });
  }

  return poster.sort((a, b) => a.datum.localeCompare(b.datum));
}
