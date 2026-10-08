import "server-only";

import type { CrmAdapter, Crmkoppling, Crmorder, Crmstatus } from "./adapter";
import {
  KALLETIKETT,
  aktivitetstext,
  INKIO_MAX_BYTE,
  INKIO_STANDARD_URL,
  arJuridiskPerson,
  inkioOrgnr,
  inkioBolagsform,
  nyKund,
  nyOrder,
  orderrader,
  orgnrSiffror,
  overenskommet,
  sakerAdress,
  sidlage,
  landningsadress,
  type Inkioadress,
  type Sidlage,
} from "./inkio-mappning";

/**
 * Inkio — Clicknets egna CRM, crm.inkio.se.
 *
 * =============================================================================
 * NYCKELN ÄR ETT TJÄNSTEKONTOS, OCH DEN ÄR ADMIN I BOLAGET CLICKNET
 *
 * `Authorization: token <nyckel>:<hemlighet>` (specens `token`-schema). Kontot
 * har full läs- och skrivrätt i Inkio-bolaget Clicknet — allt Nav gör syns där
 * som gjort av tjänstekontot. Nycklarna ligger i Vercel som `INKIO_API_KEY`
 * och `INKIO_API_SECRET`; lokalt i `~/.clicknet/crm.env`.
 * =============================================================================
 *
 * =============================================================================
 * ETT ANDRA FÖRSÖK FÅR INTE SKAPA EN ANDRA ORDER
 *
 * Utkorgen försöker igen när något kastar, och ett anrop kan ha gått igenom i
 * Inkio fast svaret aldrig kom fram. Därför börjar `skapa` alltid med att
 * fråga: kunden slås upp på organisationsnumret, ordern på
 * `external_order_id` = Nav-orderns id. Finns de används de.
 * =============================================================================
 */

export function inkioKonfigurerad(): boolean {
  return Boolean(process.env.INKIO_API_KEY?.trim() && process.env.INKIO_API_SECRET?.trim());
}

/**
 * LÄSA FÅR ALLA MILJÖER, SKRIVA BARA PRODUKTIONEN (Inkio, varv 3).
 *
 * Previewen pekar på produktionens databas och har samma nycklar — så att
 * kundkortets aktivitet och adressuppslaget går att granska där. Men en order,
 * en makulering eller en rad på en tidslinje i Inkio skrivs bara av
 * produktionen: `adapter()` ger den manuella överallt annars, och
 * `tomUtkorgen()` lämnar tillbaka CRM-raderna orörda.
 */
export function inkioFarSkriva(): boolean {
  return inkioKonfigurerad() && process.env.VERCEL_ENV === "production";
}

export function inkioUrl(): string {
  return (process.env.INKIO_URL?.trim() || INKIO_STANDARD_URL).replace(/\/+$/, "");
}

/** Sidan i Inkio för en kund eller en order — för länkarna i Nav. */
export function inkioLank(typ: "kund" | "order", id: string): string {
  return `${inkioUrl()}/${typ === "kund" ? "customers" : "sales-orders"}/${encodeURIComponent(id)}`;
}

export class Inkiofel extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kod: string,
  ) {
    super(message);
  }
}

type Anrop = {
  query?: Record<string, unknown>;
  json?: unknown;
  form?: FormData;
};

async function anrop<T>(metod: "GET" | "POST" | "PUT" | "DELETE", sokvag: string, a: Anrop = {}): Promise<T> {
  const url = new URL(sokvag, inkioUrl());
  for (const [k, v] of Object.entries(a.query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }

  const headers: Record<string, string> = {
    Authorization: `token ${process.env.INKIO_API_KEY?.trim()}:${process.env.INKIO_API_SECRET?.trim()}`,
    Accept: "application/json",
  };
  let body: BodyInit | undefined;
  if (a.json !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    body = JSON.stringify(a.json);
  } else if (a.form) {
    body = a.form;
  }

  const svar = await fetch(url, { method: metod, headers, body, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (svar.status === 204) return undefined as T;

  const text = await svar.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!svar.ok) {
    const fel = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new Inkiofel(
      `Inkio svarade ${svar.status} på ${metod} ${url.pathname}: ${fel?.message ?? String(text).slice(0, 200)}`,
      svar.status,
      fel?.code ?? "error",
    );
  }
  return data as T;
}

// -----------------------------------------------------------------------------
// Uppslag
// -----------------------------------------------------------------------------

type Kundrad = { id: string; number: string; customer_name: string; status: string | null; website?: string | null };

async function kundMedOrgnr(orgnr: string): Promise<Kundrad | null> {
  const siffror = orgnrSiffror(orgnr);
  if (!siffror) return null;
  // `tax_id_key` är numret utan bindestreck — samma nyckel Inkio själv
  // använder för att neka en dubblett.
  const rader = await anrop<Kundrad[]>("GET", "/api/records/customer", {
    query: {
      filters: [["tax_id_key", "=", siffror]],
      fields: ["id", "number", "customer_name", "status", "website"],
      limit: 2,
    },
  });
  return rader[0] ?? null;
}

type Orderhuvud = { id: string; number: string; state: string; customer: string };

async function orderMedNavId(navId: string): Promise<Orderhuvud | null> {
  const rader = await anrop<Orderhuvud[]>("GET", "/api/records/sales-order", {
    query: {
      filters: [["external_order_id", "=", navId]],
      fields: ["id", "number", "state", "customer"],
      limit: 2,
    },
  });
  return rader[0] ?? null;
}

/** Tjänsterna, en gång per tömning. */
async function tjanster(): Promise<{ kampanjsida: string; ovrigt: string; efterNamn: (n: string) => string | null }> {
  const rader = await anrop<{ id: string; service_name: string; is_active: boolean }[]>("GET", "/api/records/service", {
    query: { fields: ["id", "service_name", "is_active"], limit: 200 },
  });
  const aktiva = rader.filter((r) => r.is_active !== false);
  const efterNamn = (n: string) =>
    aktiva.find((r) => r.service_name.trim().toLowerCase() === n.trim().toLowerCase())?.id ?? null;

  const kampanjsida = process.env.INKIO_TJANST_PAKET?.trim() || efterNamn("Optimerad Kampanjsida");
  const ovrigt = efterNamn("Övrigt / se beskrivning") ?? kampanjsida;
  if (!kampanjsida || !ovrigt) {
    throw new Error("Inkio har ingen tjänst som heter \"Optimerad Kampanjsida\". Sätt INKIO_TJANST_PAKET till rätt tjänst-id.");
  }
  return { kampanjsida, ovrigt, efterNamn };
}

/** Inkio-användaren som får affären: samma e-postadress som säljaren i Nav. */
async function saljareMedEpost(epost: string | null): Promise<string | null> {
  if (!epost) return null;
  const rader = await anrop<{ id: string; email: string }[]>("GET", "/api/sales/get-sellers");
  return rader.find((r) => r.email.trim().toLowerCase() === epost.trim().toLowerCase())?.id ?? null;
}

type Bolagsverket = {
  found: boolean;
  company_name: string | null;
  legal_form: string | null;
  address: Inkioadress | null;
  error: string | null;
};

// -----------------------------------------------------------------------------
// Kunden
// -----------------------------------------------------------------------------

async function hittaEllerSkapaKund(o: Crmorder): Promise<Kundrad> {
  const finns = await kundMedOrgnr(o.orgnr);
  if (finns) return finns;

  const orgnr = inkioOrgnr(o.orgnr);
  if (!orgnr) throw new Error(`Organisationsnumret "${o.orgnr}" går inte att läsa. Rätta det på ordern i Nav.`);

  // Adressen är obligatorisk i Inkio. Sedan 0075 skriver säljaren den på
  // ordern (förifylld från Bolagsverket) — den gäller först. Bolagsverket
  // direkt är reserven för order lagda innan dess.
  const forHand = `Lägg upp kunden i Inkio för hand (org.nr ${orgnr}) och tryck "Försök igen" på ordern i Nav.`;
  let adress = o.adress;
  let bolagsform: string | null = null;
  if (arJuridiskPerson(orgnr)) {
    const bv = await bolagsverket(orgnr).catch(() => null);
    bolagsform = bv?.legal_form ?? null;
    if (!adress && bv?.found && bv.address?.address_line_1.trim()) adress = bv.address;
  }
  if (!adress) {
    throw new Error(
      arJuridiskPerson(orgnr)
        ? `Bolagsverket har ingen gatuadress för ${orgnr}, och ordern saknar adress. ${forHand}`
        : `${o.bolag} är en enskild firma och ordern saknar adress — Bolagsverket har ingen för den. ${forHand}`,
    );
  }

  return anrop<Kundrad>("POST", "/api/customers/create-customer", {
    json: nyKund(
      { bolag: o.bolag, orgnr, kontakt: o.kontakt, telefon: o.telefon, epost: o.epost },
      adress,
      inkioBolagsform(orgnr, bolagsform),
    ),
  });
}

function bolagsverket(orgnr: string): Promise<Bolagsverket> {
  return anrop<Bolagsverket>("GET", "/api/bolagsverket/api/lookup-organisation", { query: { org_number: orgnr } });
}

/**
 * Orderformulärets uppslag (0075): namn och adress från Bolagsverket, och om
 * kunden redan finns i Inkio. Null när Inkio inte är kopplat eller numret inte
 * går att slå upp — formuläret fylls då i för hand.
 */
export async function bolagsuppslag(
  orgnrIn: string,
): Promise<{ namn: string | null; adress: Inkioadress | null; enskildFirma: boolean; iInkio: string | null } | null> {
  if (!inkioKonfigurerad()) return null;
  const orgnr = inkioOrgnr(orgnrIn);
  if (!orgnr) return null;
  const enskildFirma = !arJuridiskPerson(orgnr);
  const [kund, bv] = await Promise.all([
    kundMedOrgnr(orgnr).catch(() => null),
    enskildFirma ? Promise.resolve(null) : bolagsverket(orgnr).catch(() => null),
  ]);
  const adress = bv?.found && bv.address?.address_line_1.trim() ? bv.address : null;
  return { namn: bv?.found ? bv.company_name : null, adress, enskildFirma, iInkio: kund?.customer_name ?? null };
}

// -----------------------------------------------------------------------------
// Adaptern
// -----------------------------------------------------------------------------

export const inkio: CrmAdapter = {
  namn: "inkio",

  async skapa(o: Crmorder): Promise<Crmkoppling> {
    const kund = await hittaEllerSkapaKund(o);

    const finns = await orderMedNavId(o.underlag.navId);
    if (finns) {
      return {
        kundId: kund.id,
        kundnummer: kund.number,
        orderId: finns.id,
        ordernummer: finns.number,
        lage: finns.state === "draft" ? "utkast" : "inskickad",
      };
    }

    const [tj, saljare] = await Promise.all([tjanster(), saljareMedEpost(o.saljarEpost)]);
    const rader = orderrader(o.underlag, tj);
    if (rader.length === 0) throw new Error("Ordern har varken månadsbelopp eller tjänster — det finns inget att lägga in.");

    // Inkio skickar bara in en order med bevis. Finns det inget — eller är det
    // för stort — läggs den som utkast, och den som skickar in den i Inkio
    // bifogar beviset där.
    const bevis = o.bevis && o.bevis.data.byteLength <= INKIO_MAX_BYTE ? o.bevis : null;

    const form = new FormData();
    form.append("doc", JSON.stringify(nyOrder(o.underlag, kund.id, saljare, rader)));
    form.append("submit", bevis ? "1" : "0");
    if (bevis) {
      form.append("agreed", overenskommet(o.underlag, o.godkandAv, o.godkandDag));
      form.append("files", new Blob([new Uint8Array(bevis.data)], { type: bevis.typ }), bevis.filnamn);
    }

    const ny = await anrop<{ id: string; number: string; state: string }>("POST", "/api/salesorder/create-sales-order", {
      form,
    });

    if (!bevis) {
      await anrop("POST", "/api/activity/log-activity", {
        json: {
          doctype: "Sales Order",
          record_id: ny.id,
          content: o.bevis
            ? `Från Clicknet Nav. Beviset (${o.bevis.filnamn}) är större än 10 MB och kom inte med — bifoga det och skicka in ordern här.`
            : "Från Clicknet Nav, utan avtal eller samtalsinspelning att skicka med — bifoga beviset och skicka in ordern här.",
        },
      }).catch(() => {});
    }

    return {
      kundId: kund.id,
      kundnummer: kund.number,
      orderId: ny.id,
      ordernummer: ny.number,
      lage: ny.state === "draft" ? "utkast" : "inskickad",
    };
  },

  async makulera(orderId: string, orsak: string | null): Promise<"makulerad" | "borta"> {
    let order: Orderhuvud;
    try {
      order = await anrop<Orderhuvud>("GET", `/api/records/sales-order/${encodeURIComponent(orderId)}`);
    } catch (e) {
      if (e instanceof Inkiofel && e.status === 404) return "borta";
      throw e;
    }

    if (order.state === "cancelled") return "makulerad";

    if (order.state === "draft") {
      // Ett utkast går inte att makulera, bara att radera — och inte så länge
      // en fil hänger på det.
      const innehall = await anrop<{ documents: { id: string }[] }>("GET", "/api/filehandler/get-record-contents", {
        query: { doctype: "Sales Order", record_id: order.id },
      });
      for (const d of innehall.documents ?? []) {
        await anrop("DELETE", `/api/records/document/${encodeURIComponent(d.id)}`);
      }
      await anrop("DELETE", `/api/records/sales-order/${encodeURIComponent(order.id)}`);
      return "borta";
    }

    await anrop("POST", `/api/records/sales-order/${encodeURIComponent(order.id)}/cancel`);
    await anrop("POST", "/api/activity/log-activity", {
      json: {
        doctype: "Sales Order",
        record_id: order.id,
        content: `Makulerad i Clicknet Nav${orsak?.trim() ? `: ${orsak.trim()}` : "."}`,
      },
    }).catch(() => {});
    return "makulerad";
  },

  async sattStatus(kundId: string, status: Crmstatus): Promise<void> {
    // Inkio har ingen leveransstatus på kunden. Det som hänt skrivs på kundens
    // tidslinje, där den som arbetar i Inkio ser det.
    const text: Record<Crmstatus, string> = {
      valkomnad: "Leverans: välkomstsamtalet är genomfört (Clicknet Nav).",
      kickoff_bokad: "Leverans: kickoff är bokad (Clicknet Nav).",
      i_produktion: "Leverans: kunden är i produktion (Clicknet Nav).",
    };
    await anrop("POST", "/api/activity/log-activity", {
      json: { doctype: "Customer", record_id: kundId, content: text[status] ?? `Leverans: ${status} (Clicknet Nav).` },
    });
  },

  async tidslinje(kundId: string, text: string): Promise<void> {
    await anrop("POST", "/api/activity/log-activity", {
      json: { doctype: "Customer", record_id: kundId, content: text },
    });
  },

  async hamta(kundId: string) {
    try {
      const k = await anrop<Kundrad>("GET", `/api/records/customer/${encodeURIComponent(kundId)}`);
      return { externtId: k.id, status: k.status };
    } catch (e) {
      if (e instanceof Inkiofel && e.status === 404) return null;
      throw e;
    }
  },
};

// -----------------------------------------------------------------------------
// Kundens aktivitet (Inkio, varv 3) — kundkortets flik "Aktivitet"
// -----------------------------------------------------------------------------

export type Aktivitetsrad = {
  id: string;
  nar: string;
  vem: string;
  anteckning: boolean;
  text: string;
  kalla: { etikett: string; lank: string | null };
};

export type Kundaktivitet =
  | { kund: null }
  | { kund: { id: string; nummer: string; namn: string; lank: string }; rader: Aktivitetsrad[]; avkortad: boolean };

type Tradkalla = {
  key: string;
  doctype: string;
  label: string;
  route: string | null;
  docs: { id: string; title: string; comment_count: number }[];
};

type Inkiorad = {
  id: string;
  content: string;
  created_by_full_name: string | null;
  created_by_is_service_account: boolean;
  import_unattributed: boolean;
  created_at: string;
  comment_type: string;
  activity_template: string | null;
  activity_args: string | null;
};

/** Högst så här många poster läses per kund. En kund med fler visar de senaste. */
const MAX_POSTER = 60;

/**
 * ALLT SOM HÄNT MED KUNDEN I INKIO: kundens egen tidslinje och tidslinjen för
 * varje post som hänger på den — order, avtal, fakturor, ärenden. Inkio säger
 * själv vilka (`get-thread-sources`), så en ny sorts post följer med utan att
 * koden ändras. Läses när fliken öppnas, aldrig i förväg: kundkortet ska inte
 * vänta på Inkio, och det som visas ska vara det som står där nu.
 *
 * Kunden hittas på organisationsnumret — också för order lagda innan Nav
 * började skriva till Inkio.
 */
export async function kundaktivitet(orgnr: string): Promise<Kundaktivitet> {
  const kund = await kundMedOrgnr(orgnr);
  if (!kund) return { kund: null };

  const kallor = await anrop<Tradkalla[]>("GET", "/api/comments/get-thread-sources", {
    query: { reference_doctype: "Customer", reference_id: kund.id },
  });

  const poster = kallor.flatMap((k) =>
    k.docs.map((d) => ({
      doctype: k.doctype,
      id: d.id,
      etikett: k.key === "self" ? KALLETIKETT.self : `${KALLETIKETT[k.key] ?? k.label} ${d.title}`,
      lank:
        k.key === "self"
          ? inkioLank("kund", d.id)
          : k.route
            ? `${inkioUrl()}${k.route.replace("{id}", encodeURIComponent(d.id))}`
            : null,
    })),
  );
  const lasta = poster.slice(0, MAX_POSTER);

  const svar = await Promise.all(
    lasta.map((p) =>
      anrop<Inkiorad[]>("GET", "/api/comments/get-comments", {
        query: { reference_doctype: p.doctype, reference_id: p.id },
      }).then((rader) => rader.map((r) => ({ r, p }))),
    ),
  );

  const sedda = new Set<string>();
  const rader: Aktivitetsrad[] = [];
  for (const { r, p } of svar.flat()) {
    if (sedda.has(r.id)) continue;
    sedda.add(r.id);
    rader.push({
      id: r.id,
      nar: r.created_at,
      vem: r.created_by_is_service_account
        ? "Clicknet Nav"
        : r.import_unattributed
          ? `${r.created_by_full_name ?? "Inkio"} (import)`
          : (r.created_by_full_name ?? "Inkio"),
      anteckning: r.comment_type === "Comment",
      text: aktivitetstext(r.content, r.activity_template, r.activity_args),
      kalla: { etikett: p.etikett, lank: p.lank },
    });
  }
  rader.sort((a, b) => (a.nar < b.nar ? 1 : a.nar > b.nar ? -1 : 0));

  return {
    kund: { id: kund.id, nummer: kund.number, namn: kund.customer_name, lank: inkioLank("kund", kund.id) },
    rader,
    avkortad: poster.length > lasta.length,
  };
}

// -----------------------------------------------------------------------------
// Kundens landningssida (Inkio, varv 4) — överst i fliken "Aktivitet"
// -----------------------------------------------------------------------------

export type Landningssida =
  | { kund: null }
  | {
      kund: { nummer: string; lank: string };
      /** Null när kundens "Webbplats" i Inkio är tom eller inte går att läsa. */
      adress: string | null;
      lage: Sidlage | null;
    };

/** Så många vidarekopplingar följs (http → https → www → /kampanj räcker gott). */
const MAX_HOPP = 5;

/**
 * ÄR KAMPANJSIDAN UPPE? Beställaren 2026-10-08: "se ifall kampanjsidan är
 * aktiv eller inte". Adressen är kundens "Webbplats" i Inkio — Inkio har ingen
 * egen uppgift om kampanjsidan, och Leadsportalen är inte kopplad — och "aktiv"
 * betyder att sidan svarar när Nav anropar den, nu.
 *
 * Vidarekopplingarna följs för hand, så att varje hopp prövas mot
 * `sakerAdress` innan Nav går dit. Kroppen läses aldrig.
 */
export async function landningssida(orgnr: string): Promise<Landningssida> {
  const kund = await kundMedOrgnr(orgnr);
  if (!kund) return { kund: null };
  const adress = landningsadress(kund.website);
  return {
    kund: { nummer: kund.number, lank: inkioLank("kund", kund.id) },
    adress,
    lage: adress ? await provaSidan(adress) : null,
  };
}

async function provaSidan(adress: string): Promise<Sidlage> {
  let url = new URL(adress);
  for (let hopp = 0; hopp <= MAX_HOPP; hopp++) {
    let svar: Response;
    try {
      svar = await fetch(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ClicknetNav/1.0)", Accept: "text/html,*/*" },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (e) {
      return sidlage(
        null,
        e instanceof Error && e.name === "TimeoutError"
          ? "Sidan svarade inte inom åtta sekunder."
          : "Sidan går inte att nå — domänen pekar ingenstans, eller certifikatet är fel.",
      );
    }
    await svar.body?.cancel().catch(() => {});

    const till = svar.status >= 300 && svar.status < 400 ? svar.headers.get("location") : null;
    if (!till) return sidlage(svar.status);
    let nasta: URL;
    try {
      nasta = new URL(till, url);
    } catch {
      return sidlage(svar.status);
    }
    if (!sakerAdress(nasta)) return { aktiv: false, text: "Sidan skickar vidare till en adress Nav inte följer." };
    url = nasta;
  }
  return sidlage(310);
}
