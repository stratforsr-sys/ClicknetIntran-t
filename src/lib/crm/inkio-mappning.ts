/**
 * Nav-order → Inkios format. Ren logik — inga importer, inget nätverk — så
 * att den går att prova utan att starta Next. Se `tests/inkio.mjs`.
 *
 * =============================================================================
 * FORMEN ÄR INKIOS EGET FORMULÄRS, INTE SPECENS
 *
 * OpenAPI-beskrivningen (Downloads/inkio-openapi.json, 2026-10-07) säger bara
 * `customer: {}` och `doc: {}`. Fälten nedan är de Inkios egen kundvy och
 * orderformulär skickar, lästa ur crm.inkio.se:s klientpaket samma dag. Ändras
 * Inkios formulär är det här filen som ska följa med.
 * =============================================================================
 */

/** Tio siffror, eller null. Ett personnummer med sekel (tolv) kortas. */
export function orgnrSiffror(s: string | null | undefined): string | null {
  const d = (s ?? "").replace(/\D/g, "");
  if (d.length === 10) return d;
  if (d.length === 12) return d.slice(2);
  return null;
}

/** Inkios form, `XXXXXX-XXXX` — den formulärets valideringsregel kräver. */
export function inkioOrgnr(s: string | null | undefined): string | null {
  const d = orgnrSiffror(s);
  return d ? `${d.slice(0, 6)}-${d.slice(6)}` : null;
}

/**
 * Ett aktiebolag, en förening eller annan juridisk person har en tredje siffra
 * på minst 2; en enskild firma bär ägarens personnummer, där den är en
 * månadssiffra (0 eller 1). Bolagsverkets uppslag i Inkio tar bara det förra.
 */
export function arJuridiskPerson(orgnr: string | null | undefined): boolean {
  const d = orgnrSiffror(orgnr);
  return d !== null && Number(d[2]) >= 2;
}

/** "Anna Maria Svensson" → Anna Maria / Svensson. Inkio kräver ett förnamn. */
export function delaNamn(namn: string | null | undefined): { first_name: string; last_name: string } {
  const delar = (namn ?? "").trim().split(/\s+/).filter(Boolean);
  if (delar.length === 0) return { first_name: "", last_name: "" };
  if (delar.length === 1) return { first_name: delar[0], last_name: "" };
  return { first_name: delar.slice(0, -1).join(" "), last_name: delar[delar.length - 1] };
}

export type Inkioadress = {
  address_line_1: string;
  address_line_2: string;
  postal_code: string;
  city: string;
  country: string;
};

export type Kundunderlag = {
  bolag: string;
  orgnr: string;
  kontakt: string | null;
  telefon: string | null;
  epost: string | null;
};

/**
 * Inkios två bolagsformer. En enskild firma är en "Company" i Inkio med
 * ägarens nummer och formen "Sole Proprietorship" — Inkios eget formulär
 * erbjuder bara de två.
 */
export function inkioBolagsform(orgnr: string | null | undefined, franBolagsverket: string | null): string {
  if (!arJuridiskPerson(orgnr)) return "Sole Proprietorship";
  return franBolagsverket || "Limited Company";
}

/** Adressen från ordern, när alla tre fälten finns. */
export function orderadress(
  gata: string | null | undefined,
  postnummer: string | null | undefined,
  ort: string | null | undefined,
): Inkioadress | null {
  const g = gata?.trim();
  const p = postnummer?.trim();
  const o = ort?.trim();
  if (!g || !p || !o) return null;
  return { address_line_1: g, address_line_2: "", postal_code: p, city: o, country: "Sweden" };
}

/** Kroppen till `POST /api/customers/create-customer`. */
export function nyKund(k: Kundunderlag, adress: Inkioadress, juridiskForm: string | null) {
  const kontakt = delaNamn(k.kontakt);
  return {
    customer: {
      customer_type: "Company",
      first_name: "",
      last_name: "",
      company_name: k.bolag.trim(),
      legal_form: inkioBolagsform(k.orgnr, juridiskForm),
      tax_id: inkioOrgnr(k.orgnr) ?? k.orgnr,
      website: "",
      default_currency: "SEK",
      external_customer_id: "",
      notes: "Upplagd av Clicknet Nav när första ordern godkändes.",
    },
    address: adress,
    // Inkio kräver ett förnamn. Utan kontaktnamn på ordern står bolaget där,
    // så att kunden går att skapa och kontakten går att rätta i Inkio.
    contact: {
      first_name: kontakt.first_name || k.bolag.trim(),
      last_name: kontakt.last_name,
      email: k.epost ?? "",
      phone: k.telefon ?? "",
    },
  };
}

export type Orderunderlag = {
  navId: string;
  signerad: string;
  startar: string | null;
  manadsbelopp: number | null;
  bindningManader: number;
  paketnamn: string;
  utkop: number | null;
  /** 0079. Finansavgiften i kronor. Frivillig: underlag byggda fore 0079 saknar den. */
  finans?: number | null;
  anteckning: string | null;
  navlank: string;
  tjanster: {
    namn: string;
    fakturering: "manad" | "engang";
    belopp: number;
    manader: number | null;
  }[];
};

export type Orderrad = {
  service: string;
  type: "Recurring" | "One Time";
  quantity: number;
  rate: number;
  description?: string;
  term_length: number;
  term_unit: "Month";
  value_mode?: "Per Period";
  billing_interval: number;
  billed_periods?: number;
};

/**
 * Orderraderna. Paketet är tjänsten Optimerad Kampanjsida med månadsbeloppet
 * som pris och bindningstiden som löptid — så som 33 av Inkios 40 senaste
 * order ser ut. En tilläggstjänst hamnar på tjänsten med samma namn, och på
 * "Övrigt" när ingen heter så.
 */
export function orderrader(
  o: Orderunderlag,
  tjanst: { kampanjsida: string; ovrigt: string; efterNamn: (namn: string) => string | null },
): Orderrad[] {
  const rader: Orderrad[] = [];

  if (o.manadsbelopp !== null && o.manadsbelopp > 0) {
    rader.push({
      service: tjanst.kampanjsida,
      type: "Recurring",
      quantity: 1,
      rate: o.manadsbelopp,
      description: o.paketnamn,
      term_length: o.bindningManader,
      term_unit: "Month",
      value_mode: "Per Period",
      billing_interval: 1,
      billed_periods: 0,
    });
  }

  for (const t of o.tjanster) {
    const id = tjanst.efterNamn(t.namn);
    const lopande = t.fakturering === "manad";
    rader.push({
      service: id ?? tjanst.ovrigt,
      type: lopande ? "Recurring" : "One Time",
      quantity: 1,
      rate: t.belopp,
      description: id ? undefined : t.namn,
      term_length: lopande ? (t.manader ?? o.bindningManader) : 1,
      term_unit: "Month",
      value_mode: lopande ? "Per Period" : undefined,
      billing_interval: 1,
      billed_periods: lopande ? 0 : undefined,
    });
  }

  return rader;
}

/** `doc` till `POST /api/salesorder/create-sales-order`. */
export function nyOrder(o: Orderunderlag, kundId: string, saljareId: string | null, rader: Orderrad[]) {
  const anteckning = [
    `Från Clicknet Nav: ${o.navlank}`,
    o.utkop ? `Utköp: ${o.utkop} kr.` : null,
    o.finans ? `Finans: ${o.finans} kr till finanspartnern.` : null,
    o.anteckning?.trim() || null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    customer: kundId,
    billing_contact: "",
    sales_person: saljareId ?? "",
    order_date: o.signerad,
    delivery_date: o.startar ?? o.signerad,
    currency: "SEK",
    // Nav-orderns id. Det är så ett andra försök ser att ordern redan finns.
    external_order_id: o.navId,
    notes: anteckning,
    split_contracts: 0,
    items: rader,
  };
}

/**
 * "Vad som avtalats" — fältet Inkio kräver när en order skickas in. Det är
 * det kunden sa ja till, så som Nav godkände det.
 */
export function overenskommet(o: Orderunderlag, godkandAv: string | null, godkandDag: string | null): string {
  const delar = [
    o.paketnamn,
    o.manadsbelopp !== null ? `${kr(o.manadsbelopp)}/mån` : null,
    `${o.bindningManader} mån`,
    `signerad ${o.signerad}`,
  ].filter(Boolean);
  const tillagg = o.tjanster.map((t) => `${t.namn} ${kr(t.belopp)}${t.fakturering === "manad" ? "/mån" : ""}`);
  const godkand = godkandAv ? ` Godkänd i Clicknet Nav av ${godkandAv}${godkandDag ? ` ${godkandDag}` : ""}.` : "";
  return `${delar.join(" · ")}${tillagg.length ? ` + ${tillagg.join(", ")}` : ""}.${godkand}`;
}

function kr(n: number): string {
  return `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(n)} kr`;
}

/** Inkios adress när `INKIO_URL` inte säger annat. Länkarna i klientkomponenter använder den. */
export const INKIO_STANDARD_URL = "https://crm.inkio.se";

/** Inkio tar bevis upp till 10 MB per fil (tenantens gräns, standardvärdet). */
export const INKIO_MAX_BYTE = 10 * 1024 * 1024;

/** Ett Inkio-id ur det någon klistrat in — id:t självt eller sidans adress. */
export function inkioIdUr(text: string): string | null {
  const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

// -----------------------------------------------------------------------------
// Leveransens steg på kundens tidslinje i Inkio (0075)
// -----------------------------------------------------------------------------

export const LEVERANSSTEG: Record<string, string> = {
  valkomstsamtal: "Välkomstsamtal",
  tillgangar: "Tillgångar",
  kickoff: "Kickoff",
  leveransstart: "Leveransstart",
  avstamning_30: "Avstämning efter 30 dagar",
  avstamning_90: "Avstämning efter 90 dagar",
};

export type Leveranshandelse = "bokad" | "genomford" | "ej_svar" | "installd" | "flyttad";

/** "tis 14 okt kl. 10:00", i svensk tid oavsett serverns zon. */
export function nar(iso: string): string {
  const d = new Date(iso);
  const dag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", weekday: "short", day: "numeric", month: "short" }).format(d);
  const tid = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", hour: "2-digit", minute: "2-digit" }).format(d);
  return `${dag} kl. ${tid}`;
}

/**
 * Raden på kundens tidslinje. Den står som skriven i Inkio, så den ska gå att
 * läsa utan att känna Nav: vilket steg, vad som hände, när och med vem.
 */
export function leveransrad(a: {
  steg: string | null;
  handelse: Leveranshandelse;
  startar: string;
  vem: string | null;
  forsok: number;
}): string {
  const steg = (a.steg && LEVERANSSTEG[a.steg]) || "Leveransmöte";
  const forsok = a.forsok > 1 ? ` (försök ${a.forsok})` : "";
  const med = a.vem ? ` med ${a.vem}` : "";
  const text: Record<Leveranshandelse, string> = {
    bokad: `${steg}${forsok} bokat ${nar(a.startar)}${med}.`,
    genomford: `${steg} genomfört${a.vem ? ` (${a.vem})` : ""}.`,
    ej_svar: `${steg}${forsok}: kunden svarade inte.`,
    installd: `${steg} ${nar(a.startar)} är inställt.`,
    flyttad: `${steg} flyttat till ${nar(a.startar)}${med}.`,
  };
  return `Leverans · ${text[a.handelse]} — Clicknet Nav`;
}


// -----------------------------------------------------------------------------
// Kundens aktivitet i Inkio, för kundkortet i Nav (Inkio, varv 3)
// -----------------------------------------------------------------------------

/**
 * Inkios händelser är skrivna på engelska efter en mall ("{0} submitted order
 * {1} ({2})"). De som fanns 2026-10-07 — sex stycken, över alla 78 kunder —
 * står här på svenska. En mall som tillkommer (fakturor när Fortnox kopplas,
 * ärenden) visas som Inkio skrev den tills den läggs till här: hellre engelska
 * än en rad som saknas.
 */
export const AKTIVITETSMALLAR: Record<string, string> = {
  "{0} submitted order {1} ({2})": "{0} skickade in order {1} ({2})",
  "{0} created order {1} ({2})": "{0} skapade order {1} ({2})",
  "{0} created customer {1}": "{0} lade upp kunden {1}",
  "Customer {0} was created": "Kunden {0} lades upp",
  "Order {0} was submitted ({1})": "Order {0} skickades in ({1})",
  "Order {0} was created ({1})": "Order {0} skapades ({1})",
};

/** Raden på svenska när mallen är känd, annars som Inkio skrev den. */
export function aktivitetstext(innehall: string, mall: string | null, argJson: string | null): string {
  const sv = mall ? AKTIVITETSMALLAR[mall] : undefined;
  if (!sv) return innehall;
  let arg: unknown;
  try {
    arg = JSON.parse(argJson ?? "[]");
  } catch {
    return innehall;
  }
  if (!Array.isArray(arg)) return innehall;
  return sv.replace(/\{(\d+)\}/g, (_, i) => String(arg[Number(i)] ?? ""));
}

/** Inkios sidor per posttyp — för länkarna inne i texten. */
const RUTT: Record<string, string> = {
  Customer: "customers",
  "Sales Order": "sales-orders",
  Contract: "contracts",
  Invoice: "invoices",
  Ticket: "tickets",
};

export type Aktivitetsdel = { text: string; lank?: string };

/**
 * Texten i delar: vanlig text, och Inkios hänvisningar `#[SO-2026-00071](ref:Sales Order/<id>)`
 * som länkar dit. En hänvisning till en posttyp utan känd sida blir bara sin etikett.
 */
export function aktivitetsdelar(text: string, bas: string): Aktivitetsdel[] {
  const delar: Aktivitetsdel[] = [];
  const re = /[#@]?\[([^\]]*)\]\((ref|user|mention):([^/)]+)\/?([^)]*)\)/g;
  let sist = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > sist) delar.push({ text: text.slice(sist, i) });
    const [, etikett, sort, typ, id] = m;
    const rutt = sort === "ref" ? RUTT[typ] : undefined;
    delar.push(rutt && id ? { text: etikett, lank: `${bas}/${rutt}/${encodeURIComponent(id)}` } : { text: etikett });
    sist = i + m[0].length;
  }
  if (sist < text.length) delar.push({ text: text.slice(sist) });
  return delar;
}

/** Varifrån raden kom: kunden själv eller en kopplad post. */
export const KALLETIKETT: Record<string, string> = {
  self: "Kunden",
  orders: "Order",
  contracts: "Avtal",
  invoices: "Faktura",
  tickets: "Ärende",
};

// -----------------------------------------------------------------------------
// Kundens landningssida (Inkio, varv 4)
// -----------------------------------------------------------------------------

/**
 * Bara vanliga webbplatser: http(s), ett riktigt domännamn, standardport och
 * inga inloggningsuppgifter i adressen.
 *
 * Nav anropar adressen FRÅN SERVERN, och den kommer från ett fritextfält i
 * Inkio. En IP-adress, `localhost` eller ett internt namn hade gjort Nav till
 * ett ombud in i nätet det står i — därför nekas de, också när en
 * vidarekoppling pekar dit.
 */
export function sakerAdress(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password || url.port) return false;
  const vard = url.hostname.toLowerCase();
  // Minst två led, och toppdomänen innehåller en bokstav — så faller både
  // 127.0.0.1 och [::1] bort. `URL` har redan gjort ett IDN till xn--.
  if (!/^([a-z0-9-]+\.)+(?=[a-z0-9-]*[a-z])[a-z0-9-]{2,}$/.test(vard)) return false;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|arpa)$/.test(vard)) return false;
  return true;
}

/**
 * Kundens webbplats i Inkio som en adress Nav kan anropa och länka till —
 * eller null. Fältet är fritext: "mmgrav.se" blir https://mmgrav.se/, och
 * skräp som "." blir null i stället för en trasig knapp.
 */
export function landningsadress(webbplats: string | null | undefined): string | null {
  const t = (webbplats ?? "").trim();
  if (!t || /\s/.test(t)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
  return sakerAdress(url) ? url.toString() : null;
}

export type Sidlage = { aktiv: boolean; text: string };

/**
 * Vad svaret betyder. `status` är null när inget svar kom alls.
 *
 * 401, 403 och 429 räknas som AKTIV: sidan är uppe, men skyddet framför den
 * (oftast Cloudflare) släpper inte in ett automatiskt besök. En besökare i en
 * webbläsare kommer in.
 */
export function sidlage(status: number | null, orsak?: string): Sidlage {
  if (status === null) return { aktiv: false, text: orsak ?? "Sidan svarar inte." };
  if (status >= 200 && status < 300) return { aktiv: true, text: "Sidan svarar." };
  if (status === 401 || status === 403 || status === 429) {
    return { aktiv: true, text: `Sidan är uppe men släpper inte in automatiska besök (${status}).` };
  }
  if (status >= 300 && status < 400) return { aktiv: false, text: "Sidan skickar vidare i en slinga." };
  if (status === 404 || status === 410) return { aktiv: false, text: `Sidan finns inte (${status}).` };
  if (status >= 500) return { aktiv: false, text: `Servern svarar med fel (${status}).` };
  return { aktiv: false, text: `Sidan svarar med fel (${status}).` };
}
