/**
 * Inkio in i Nav (0277) — den rena logiken. Inga importer utom mappningen,
 * inget nätverk, ingen databas, så att den går att prova utan Next. Se
 * `tests/inkio-inflode.mjs`. Servern (`inflode-server.ts`) läser Inkio och
 * skriver databasen; allt den bestämmer bestäms här.
 *
 * =============================================================================
 * KÄLLAN ÄR KUNDENS HISTORIK I INKIO (`get-customer-history`)
 *
 * Ett anrop per kund ger allt: anteckningar och aktiviteter på kunden, på
 * dess order, avtal, ärenden och leveranskort (Task), och posterna själva —
 * ordern med värde och status, avtalet, ärendet. Varje post har ett stabilt id
 * (`order:<id>`, `agreement:<id>:started`, ett Comment-id), och det är
 * nyckeln i `crm_handelse`. Ändras något i Inkio ändras postens avtryck, och
 * raden i Nav ändras med.
 * =============================================================================
 *
 * =============================================================================
 * TOLV TIMMAR AVGÖR OM EN NY RAD GER NOTIS
 *
 * En post Nav ser för första gången ger notis om den skapades i Inkio de
 * senaste tolv timmarna. Det gör första läsningen av en kund tyst för det
 * gamla (ingen ska få femtio notiser om september), och det gör att en
 * bevakning som stått still en natt ändå säger till om det som hände då. En
 * ÄNDRING av en order, ett avtal eller ett ärende ger alltid notis; en ändrad
 * eller raderad anteckning gör det inte (den uppdateras och märks).
 * =============================================================================
 *
 * =============================================================================
 * SORTEN AVGÖR OM DEN MEJLAS (beställaren 2026-11-02)
 *
 * Ärendet (posten, och varje anteckning på det), en makulerad order och ett
 * uppsagt avtal har egna sorter och mejlas. Allt annat är `order-inkio-anteckning`
 * eller `order-inkio-handelse` och står bara i klockan och telefonen. Vad som
 * mejlas bestäms i `MEJLKALLOR` och i Utskick, inte här.
 * =============================================================================
 */
import { aktivitetstext } from "./inkio-mappning.ts";

export const NOTIS_FONSTER_MS = 12 * 60 * 60 * 1000;

export type Niva = "salesperson" | "admin" | "superadmin";

/** En post i `get-customer-history` (`items[]`), som Inkio skickar den. */
export type Historikpost = {
  id: string;
  kind: string;
  area?: string | null;
  at: string;
  about?: { doctype?: string | null; id?: string | null; title?: string | null; subtitle?: string | null; route?: string | null } | null;
  data?: Record<string, unknown> | null;
  entry?: {
    id: string;
    content?: string | null;
    created_by?: string | null;
    created_by_full_name?: string | null;
    created_by_email?: string | null;
    created_by_is_service_account?: boolean | null;
    created_at?: string | null;
    comment_type?: string | null;
    import_unattributed?: boolean | null;
    activity_template?: string | null;
    activity_args?: string | null;
    reference_doctype?: string | null;
    reference_id?: string | null;
    edited_at?: string | null;
    deleted_at?: string | null;
    deleted_by_full_name?: string | null;
  } | null;
};

export type Slag = "anteckning" | "aktivitet" | "post";

/** En rad i `crm_handelse`, som den ska se ut efter den här läsningen. */
export type Rad = {
  extern_id: string;
  slag: Slag;
  sort: string;
  om_typ: string | null;
  om_id: string | null;
  om_titel: string | null;
  om_nummer: string | null;
  text: string;
  data: Record<string, unknown> | null;
  forfattare: string | null;
  forfattare_epost: string | null;
  fran_nav: boolean;
  skapad: string;
  andrad: string | null;
  raderad: string | null;
  avtryck: string;
};

// -----------------------------------------------------------------------------
// Tolkningen
// -----------------------------------------------------------------------------

/** Inkios rika text som ren text: radbrytningar behålls, taggar och entiteter försvinner, "@[Namn](ref:User/…)" blir "@Namn". */
export function renText(s: string | null | undefined): string {
  let t = String(s ?? "").replace(/@\[([^\]]+)\]\(ref:[^)]*\)/g, "@$1");
  if (/<[a-z/][^>]*>/i.test(t)) {
    t = t
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, "");
  }
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** Ett stabilt fingeravtryck (två FNV-1a, 64 bitar som hex). Ingen kryptografi behövs: det jämförs bara med sig självt. */
export function avtryck(v: unknown): string {
  const s = stabilJson(v);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 ^ 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

function stabilJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stabilJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stabilJson(o[k])}`)
    .join(",")}}`;
}

const STATUS_SV: Record<string, string> = {
  confirmed: "bekräftad",
  submitted: "inskickad",
  draft: "utkast",
  cancelled: "makulerad",
  active: "aktivt",
  scheduled: "schemalagt",
  terminated: "uppsagt",
  expired: "utgånget",
  ended: "avslutat",
  renewed: "förnyat",
  open: "öppet",
  replied: "besvarat",
  pending: "väntar",
  solved: "löst",
  resolved: "löst",
  closed: "stängt",
  paid: "betald",
  unpaid: "obetald",
  overdue: "förfallen",
  credited: "krediterad",
};

export function statusSv(s: unknown): string {
  const t = String(s ?? "").trim();
  return STATUS_SV[t.toLowerCase()] ?? t;
}

const AVTAL_SV: Record<string, string> = {
  started: "startade",
  terminated: "sades upp",
  notice: "sades upp",
  notice_given: "sades upp",
  ended: "löpte ut",
  expired: "löpte ut",
  renewed: "förnyades",
  amended: "ändrades",
  cancelled: "makulerades",
};

export function kr(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return `${Math.round(n).toLocaleString("sv-SE").replace(/ /g, " ")} kr`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** "SO-2026-00046 · 2026-09-17" → "SO-2026-00046". */
function nummerUr(p: Historikpost): string | null {
  return str(p.data?.number) ?? (str(p.about?.subtitle) ? String(p.about!.subtitle).split(" · ")[0].trim() : null);
}

/** Posten själv (order, avtal, ärende, faktura) i en mening. */
export function posttext(p: Pick<Historikpost, "kind" | "about" | "data" | "id">): string {
  const d = p.data ?? {};
  const nr = str(d.number) ?? (str(p.about?.subtitle) ? String(p.about!.subtitle).split(" · ")[0] : "");
  const tjanster = Array.isArray(d.services) ? (d.services as unknown[]).map(String).filter(Boolean).join(", ") : str(p.about?.title) ?? "";
  if (p.kind === "order") {
    const delar = [`Order ${nr}`.trim()];
    if (tjanster) delar.push(tjanster);
    if (d.value !== undefined && d.value !== null) delar.push(kr(d.value));
    if (d.cancelled === true) delar.push("makulerad");
    else if (str(d.status)) delar.push(statusSv(d.status));
    return delar.join(" · ");
  }
  if (p.kind === "agreement") {
    const andring = str(d.change) ?? String(p.id).split(":").pop() ?? "";
    // Ett avtal med startdag framåt har inte startat: "startar 2026-11-17".
    const framat = andring === "started" && str(d.start_date) && String(d.start_date) > new Date().toISOString().slice(0, 10);
    const verb = framat ? `startar ${d.start_date}` : (AVTAL_SV[andring] ?? statusSv(andring));
    const delar = [`Avtal ${nr} ${verb}`.replace(/\s+/g, " ").trim()];
    if (tjanster) delar.push(tjanster);
    if (str(d.start_date) && str(d.end_date)) delar.push(`${d.start_date} – ${d.end_date}`);
    if (str(d.status)) delar.push(statusSv(d.status));
    return delar.join(" · ");
  }
  if (p.kind === "ticket") {
    const delar = [`Ärende ${nr}: ${str(d.subject) ?? str(p.about?.title) ?? ""}`.trim()];
    if (str(d.status)) delar.push(statusSv(d.status));
    return delar.join(" · ");
  }
  if (p.kind === "invoice") {
    const delar = [`Faktura ${nr}`.trim()];
    const belopp = d.amount ?? d.total ?? d.grand_total ?? d.value;
    if (belopp !== undefined && belopp !== null) delar.push(kr(belopp));
    if (str(d.due_date)) delar.push(`förfaller ${d.due_date}`);
    if (str(d.status)) delar.push(statusSv(d.status));
    return delar.join(" · ");
  }
  return [str(p.about?.title), nr].filter(Boolean).join(" · ") || p.kind;
}

/**
 * En historikpost → en rad i `crm_handelse`. Null när posten saknar id eller tid.
 *
 * `roller` är svarets `roles` (Inkios användar-id → roll, "Utvecklare"). Rollen
 * och Inkios område (`area`: customer, sales, work) sparas i `data`, så att
 * kundkortet kan visa Inkios filter och vyn Per roll utan att fråga Inkio igen.
 * De ingår inte i avtrycket: en ny roll i Inkio är ingen ändring av posten.
 */
export function tolkaPost(p: Historikpost, roller: Readonly<Record<string, string>> = {}): Rad | null {
  if (!p || !p.id) return null;
  const e = p.entry ?? null;
  const om = p.about ?? null;

  if (e && e.id) {
    const skapad = e.created_at || p.at;
    if (!skapad) return null;
    const text = renText(aktivitetstext(String(e.content ?? ""), e.activity_template ?? null, e.activity_args ?? null));
    const rad: Rad = {
      extern_id: String(e.id),
      slag: e.comment_type === "Comment" ? "anteckning" : "aktivitet",
      sort: p.kind,
      om_typ: om?.doctype ?? e.reference_doctype ?? null,
      om_id: om?.id ?? e.reference_id ?? null,
      om_titel: om?.title ?? null,
      om_nummer: om ? nummerUr(p) : null,
      text,
      data: {
        ...(e.import_unattributed ? { import: true } : {}),
        ...(om?.route ? { route: om.route } : {}),
        ...(e.deleted_by_full_name ? { raderad_av: e.deleted_by_full_name } : {}),
        ...(p.area ? { omrade: p.area } : {}),
        ...(e.created_by && roller[e.created_by] ? { roll: roller[e.created_by] } : {}),
      },
      forfattare: e.created_by_full_name ?? null,
      forfattare_epost: e.created_by_email ? String(e.created_by_email).toLowerCase() : null,
      fran_nav: e.created_by_is_service_account === true,
      skapad,
      andrad: e.edited_at ?? null,
      raderad: e.deleted_at ?? null,
      avtryck: "",
    };
    rad.avtryck = avtryck([rad.text, rad.andrad, rad.raderad, rad.om_titel]);
    return rad;
  }

  if (!p.at) return null;
  const data = { ...(p.data ?? {}), ...(om?.route ? { route: om.route } : {}), ...(p.area ? { omrade: p.area } : {}) };
  const rad: Rad = {
    extern_id: String(p.id),
    slag: "post",
    sort: p.kind,
    om_typ: om?.doctype ?? null,
    om_id: om?.id ?? null,
    om_titel: om?.title ?? null,
    om_nummer: nummerUr(p),
    text: posttext(p),
    data,
    forfattare: null,
    forfattare_epost: null,
    fran_nav: false,
    skapad: p.at.length === 10 ? `${p.at}T00:00:00Z` : p.at,
    andrad: null,
    raderad: null,
    avtryck: "",
  };
  rad.avtryck = avtryck([rad.text, p.data ?? null]);
  return rad;
}

// -----------------------------------------------------------------------------
// Jämförelsen
// -----------------------------------------------------------------------------

export type Tidigare = { avtryck: string; text: string; data: Record<string, unknown> | null; raderad: string | null; andrad: string | null };

export type Forandring =
  | { typ: "ny" }
  | { typ: "samma" }
  | { typ: "raderad" }
  | { typ: "andrad"; vad: string[] };

/** Vad som hänt med posten sedan Nav läste den senast. `vad` är svenska meningar om en post (order, avtal, ärende). */
export function jamfor(gammal: Tidigare | undefined, ny: Rad): Forandring {
  if (!gammal) return { typ: "ny" };
  if (gammal.avtryck === ny.avtryck) return { typ: "samma" };
  if (ny.raderad && !gammal.raderad) return { typ: "raderad" };
  if (ny.slag !== "post") return { typ: "andrad", vad: [] };

  const f = gammal.data ?? {};
  const t = ny.data ?? {};
  const vad: string[] = [];
  const nr = ny.om_nummer ?? "";
  if (ny.sort === "order") {
    if (t.cancelled === true && f.cancelled !== true) vad.push(`Order ${nr} makulerades i Inkio`);
    else if (t.cancelled !== true && f.cancelled === true) vad.push(`Order ${nr} är inte makulerad längre i Inkio`);
    if (Number(t.value) !== Number(f.value) && t.value !== undefined) vad.push(`Ordervärdet på ${nr} ändrades i Inkio: ${kr(f.value)} → ${kr(t.value)}`);
    if (str(t.status) !== str(f.status) && t.cancelled !== true) vad.push(`Order ${nr} är ${statusSv(t.status)} i Inkio`);
    if (stabilJson(t.services ?? null) !== stabilJson(f.services ?? null)) vad.push(`Tjänsterna på ${nr} ändrades i Inkio: ${Array.isArray(t.services) ? (t.services as unknown[]).join(", ") : "–"}`);
    if (str(t.sold_by) !== str(f.sold_by) && str(t.sold_by)) vad.push(`Säljaren på ${nr} ändrades i Inkio till ${t.sold_by}`);
  } else if (ny.sort === "agreement") {
    if (str(t.status) !== str(f.status)) vad.push(`Avtal ${nr} är ${statusSv(t.status)} i Inkio`);
    if (str(t.end_date) !== str(f.end_date) && str(t.end_date)) vad.push(`Avtal ${nr} löper nu till ${t.end_date}`);
    if (Number(t.monthly) !== Number(f.monthly) && t.monthly !== undefined) vad.push(`Avtal ${nr} ändrades i Inkio: ${kr(f.monthly)} → ${kr(t.monthly)}`);
  } else if (ny.sort === "ticket") {
    if (str(t.status) !== str(f.status)) vad.push(`Ärende ${nr} är ${statusSv(t.status)}: ${str(t.subject) ?? ny.om_titel ?? ""}`.trim());
    else if (str(t.subject) !== str(f.subject)) vad.push(`Ärende ${nr} heter nu ${t.subject}`);
  } else if (ny.sort === "invoice") {
    if (str(t.status) !== str(f.status)) vad.push(`Faktura ${nr} är ${statusSv(t.status)}`);
  }
  if (!vad.length && ny.text !== gammal.text) vad.push(`Ändrat i Inkio: ${ny.text}`);
  return { typ: "andrad", vad };
}

// -----------------------------------------------------------------------------
// Notisen
// -----------------------------------------------------------------------------

export type Notisbeslut = {
  kalla: "order-inkio-anteckning" | "order-inkio-arende" | "order-inkio-makulerad" | "order-inkio-uppsagt" | "order-inkio-handelse";
  rubrik: string;
  detalj: string;
};

/** Var posten sitter, för människor: "Kunden", "Order SO-2026-00046", "Ärende Kunden vill bestrida". */
export function etikett(r: Pick<Rad, "om_typ" | "om_nummer" | "om_titel">): string {
  const nr = r.om_nummer || r.om_titel || "";
  switch (r.om_typ) {
    case null:
    case "Customer":
      return "Kunden";
    case "Sales Order":
      return `Order ${nr}`.trim();
    case "Contract":
      return `Avtal ${nr}`.trim();
    case "Invoice":
      return `Faktura ${nr}`.trim();
    case "Ticket":
      return `Ärende ${r.om_titel || nr}`.trim();
    case "Task":
      return `Leveranskort ${r.om_titel || nr}`.trim();
    default:
      return `${r.om_typ} ${nr}`.trim();
  }
}

/**
 * Ska raden ge notis, och vad står det i den? Null = tyst.
 *
 * `forsta`: kundens första läsning (inget i Nav än).
 * `navSkapadeNyss`: kunden fick en order från Nav de senaste två timmarna.
 * Då är ordern och avtalet som dyker upp i Inkio Navs egen godkännande-notis
 * i en annan form, och de tystas.
 */
export function notisFor(r: Rad, f: Forandring, o: { bolag: string; nu: number; navSkapadeNyss: boolean; forsta?: boolean }): Notisbeslut | null {
  if (r.fran_nav) return null;
  if (f.typ === "samma" || f.typ === "raderad") return null;
  // En post daterad framåt (ett avtal som startar nästa vecka) är inte "ny nu"
  // bara för att Nav ser den första gången: vid kundens första läsning är den tyst.
  const alder = o.nu - Date.parse(r.skapad);
  const farsk = alder <= NOTIS_FONSTER_MS && !(o.forsta && alder < 0);
  const var_ = etikett(r);

  if (r.slag === "anteckning") {
    if (f.typ !== "ny" || !farsk || !r.text) return null;
    // En anteckning på ett ärende räknas som ärendet, och mejlas.
    if (r.om_typ === "Ticket") {
      const arende = r.om_titel || r.om_nummer;
      return {
        kalla: "order-inkio-arende",
        rubrik: `${o.bolag}: ${r.forfattare ?? "Någon"} skrev i ${arende ? `ärendet ${arende}` : "ett ärende"}`,
        detalj: r.text,
      };
    }
    return {
      kalla: "order-inkio-anteckning",
      rubrik: `${o.bolag}: ${r.forfattare ?? "Någon"} skrev i Inkio`,
      detalj: var_ === "Kunden" ? r.text : `${var_}: ${r.text}`,
    };
  }

  if (r.slag === "aktivitet") {
    if (f.typ !== "ny" || !farsk || !r.text) return null;
    return {
      kalla: "order-inkio-handelse",
      rubrik: `${o.bolag}: ${r.text}`,
      detalj: `${r.forfattare ?? "Inkio"} i Inkio${var_ === "Kunden" ? "" : ` · ${var_}`}`,
    };
  }

  // En post: order, avtal, ärende, faktura.
  if (f.typ === "ny") {
    if (!farsk) return null;
    if (o.navSkapadeNyss && (r.sort === "order" || r.sort === "agreement")) return null;
    return { kalla: postkalla(r, f, o.nu), rubrik: `${o.bolag}: ${r.text}`, detalj: "Nytt i Inkio" };
  }
  if (!f.vad.length) return null;
  return { kalla: postkalla(r, f, o.nu), rubrik: `${o.bolag}: ${f.vad[0]}`, detalj: f.vad.slice(1).join(" · ") || r.text };
}

/**
 * Sorten för en post. Makulerad och uppsagt avgörs av samma övergång som
 * ändrar ordern i Nav (`statusFranInkio`), så att brevet och ändringen alltid
 * gäller samma sak.
 */
function postkalla(r: Rad, f: Forandring, nu: number): Notisbeslut["kalla"] {
  if (r.sort === "ticket") return "order-inkio-arende";
  const s = statusFranInkio(r, f, nu);
  if (s?.vad === "makulerad") return "order-inkio-makulerad";
  if (s?.vad === "uppsagt") return "order-inkio-uppsagt";
  return "order-inkio-handelse";
}

/**
 * Vem som får notisen (beställaren 2026-11-02):
 *   - alla superadmin, alltid
 *   - säljaren på varje order Nav har på kunden
 *   - admin som leder någon av de säljarna (chef eller teamledare)
 * Aldrig den som skrev i Inkio (`av`), och bara aktiva — det sållar
 * `notifieraFlera`, som tar bort aktören.
 */
export function kretsen(o: { superadmin: readonly string[]; saljare: readonly string[]; chefer: ReadonlyMap<string, readonly string[]>; niva: ReadonlyMap<string, Niva> }): string[] {
  const ut = new Set<string>(o.superadmin);
  for (const s of o.saljare) {
    ut.add(s);
    for (const c of o.chefer.get(s) ?? []) {
      const n = o.niva.get(c);
      if (n === "admin" || n === "superadmin") ut.add(c);
    }
  }
  return [...ut];
}

/**
 * PREVIEWEN NOTIFIERAR INGEN (utom den som provar). Den delar databas med
 * produktionen, och en prövning av bevakningen eller en anteckning där hade
 * annars gett riktiga notiser till riktiga säljare. Utanför produktionen går
 * notiserna bara till dem i `NOTIS_PROV_TILL` (anställningarnas id, kommaskilda),
 * och utan den till ingen.
 *
 * I PRODUKTIONEN gäller samma filter så länge `NOTIS_PROV_TILL` är satt där
 * (beställaren 2026-11-02: provet görs i produktionen, där Inkio-nycklarna
 * finns, och ingen annan får en notis). Ta bort variabeln när bevakningen
 * slås på för alla. Satt men tom (blanksteg, bara kommatecken) är provläge
 * med ingen på listan, inte alla: ett felskrivet värde får aldrig släppa ut
 * notiserna till alla.
 */
export function provfilter(ids: readonly (string | null | undefined)[], env: Readonly<Record<string, string | undefined>> = process.env): string[] {
  const rena = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (env.VERCEL_ENV === "production" && env.NOTIS_PROV_TILL === undefined) return rena;
  const till = new Set((env.NOTIS_PROV_TILL ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  return rena.filter((id) => till.has(id));
}

// -----------------------------------------------------------------------------
// Ändringar i Inkio som ändrar ordern i Nav
// -----------------------------------------------------------------------------

export type Statusandring =
  | { vad: "makulerad"; inkioOrder: string; skal: string }
  | { vad: "betald"; inkioOrder: string; skal: string }
  | { vad: "uppsagt"; inkioAvtal: string; skal: string };

const BETALD = new Set(["paid", "betald"]);
/** Uttryckligen uppsagt. Ett avtal som bara löpt ut kan ha förnyats med ett nytt — det är inte "förlänger inte". */
const UPPSAGT = new Set(["terminated", "cancelled"]);

/**
 * Det Inkio säger som Nav har en egen status för. Bara en ÖVERGÅNG räknas —
 * en ändring Nav såg hända, eller en ny post från de senaste tolv timmarna —
 * aldrig ett gammalt läge Nav ser för första gången: en order som makulerades i
 * Inkio i september ska inte makuleras i Nav i dag och dra provisionen i
 * november (de listas i stället, se ARBETSLOGG 2026-11-02).
 */
export function statusFranInkio(r: Rad, f: Forandring, nu: number): Statusandring | null {
  if (f.typ === "samma" || f.typ === "raderad") return null;
  if (f.typ === "ny" && nu - Date.parse(r.skapad) > NOTIS_FONSTER_MS) return null;
  const d = r.data ?? {};

  if (r.sort === "order" && r.om_id && d.cancelled === true) {
    if (f.typ === "andrad" && !f.vad.some((v) => v.includes("makulerades"))) return null;
    return { vad: "makulerad", inkioOrder: r.om_id, skal: `Makulerad i Inkio (${r.om_nummer ?? "ordern"}).` };
  }
  if (r.sort === "invoice" && BETALD.has(String(d.status ?? "").toLowerCase())) {
    const order = str(d.sales_order) ?? str(d.order) ?? str(d.source_sales_order);
    if (!order) return null;
    return { vad: "betald", inkioOrder: order, skal: `Faktura ${r.om_nummer ?? ""} betald i Inkio.`.replace(/\s+/g, " ") };
  }
  if (r.sort === "agreement" && r.om_id) {
    const andring = (str(d.change) ?? r.extern_id.split(":").pop() ?? "").toLowerCase();
    const status = String(d.status ?? "").toLowerCase();
    if (andring === "started" && !UPPSAGT.has(status)) return null;
    if (!UPPSAGT.has(status) && !["terminated", "notice", "notice_given", "cancelled"].includes(andring)) return null;
    return { vad: "uppsagt", inkioAvtal: r.om_id, skal: `Avtal ${r.om_nummer ?? ""} ${AVTAL_SV[andring] ?? "sades upp"} i Inkio.`.replace(/\s+/g, " ") };
  }
  return null;
}

/**
 * Inkio sa makulerad, betald eller uppsagt, men databasen avvisade ändringen i
 * Nav. Larmet till superadmin. Förut svaldes felet: 0277 kastade på två villkor
 * för makulerad och uppsagt (rättat i 0279), och ingen märkte något.
 */
export function statusfelNotis(s: Statusandring, bolag: string, fel: string): { rubrik: string; detalj: string } {
  return {
    rubrik: `${bolag}: ${s.vad} i Inkio, men inte i Nav`,
    detalj: `${s.skal} Nav kunde inte ändra ordern: ${fel.slice(0, 300)}. Gör det för hand i Nav.`,
  };
}

// -----------------------------------------------------------------------------
// Vilka kunder som läses det här varvet
// -----------------------------------------------------------------------------

/** Något nytt i Inkio de senaste två dygnen: kunden läses varje minut. */
export const VARM_MS = 48 * 60 * 60 * 1000;
/** En order godkänd i Nav de senaste två veckorna: Inkio fylls på (avtal, leveranskort), läses varje minut. */
export const NAV_VARM_MS = 14 * 24 * 60 * 60 * 1000;
/** Alla andra läses minst så här ofta. */
export const KALL_MS = 5 * 60 * 1000;
/** Varje kund jämförs rad för rad med Navs kopia minst så här ofta, även när Inkios svar är detsamma. */
export const JAMFOR_MS = 60 * 60 * 1000;

export type Lasbar = {
  org: string;
  /** Kunden är hittad i Inkio och läst en gång. */
  klar: boolean;
  /** När Nav senast såg kundens historik ändras (`crm_kund.andrad_at`). */
  andrad: string | null;
  /** När kunden senast lästes (`crm_kund.senast_last`). */
  last: string | null;
  /** Senast en order på kunden godkändes i Nav. */
  godkand: string | null;
};

/**
 * VARMA VARJE MINUT, KALLA VAR FEMTE (beställaren frågade 2026-11-02 vad
 * bevakningen kostar). Inkio har ingen lista över senaste anteckningar —
 * `get-latest-notes` gäller en kund, och kundens `modified_at` rörs inte av
 * en anteckning — så varje kund måste läsas för sig för att inget ska missas.
 * Men de flesta kunder är tysta en vanlig dag. En kund med något nytt de
 * senaste två dygnen, eller en nyss godkänd order, läses varje minut. Övriga
 * läses när de inte lästs på fem minuter, de äldsta först och högst en
 * fjärdedel per varv, så att de sprids ut över minuterna i stället för att
 * komma alla på en gång. Ingenting missas; det tysta kan dröja fem minuter.
 */
/**
 * När något senast hände hos kunden i Inkio. Första läsningen sätter
 * `andrad_at` till den, inte till läsningens tid — annars hade varje kund varit
 * varm i två dygn efter påslaget. Avtal med startdag framåt räknas inte.
 */
export function senastHant(items: readonly Pick<Historikpost, "at">[], nu: number): string {
  let senast = 0;
  for (const p of items) {
    const t = Date.parse(p.at);
    if (Number.isFinite(t) && t <= nu && t > senast) senast = t;
  }
  return new Date(senast).toISOString();
}

export function attLasa(kunder: readonly Lasbar[], nu: number): string[] {
  const varma: string[] = [];
  const kalla: { org: string; last: number }[] = [];
  const inom = (t: string | null, ms: number) => t !== null && nu - Date.parse(t) < ms;
  for (const k of kunder) {
    if (!k.klar || inom(k.andrad, VARM_MS) || inom(k.godkand, NAV_VARM_MS)) varma.push(k.org);
    else kalla.push({ org: k.org, last: k.last ? Date.parse(k.last) : 0 });
  }
  // Trettio sekunders marginal: ett varv som började 4:59 efter det förra ska inte vänta till 5:59.
  const forfallna = kalla.filter((k) => nu - k.last >= KALL_MS - 30_000).sort((a, b) => a.last - b.last);
  return [...varma, ...forfallna.slice(0, Math.ceil(kalla.length / 4)).map((k) => k.org)];
}

/**
 * KOPIAN LAGAS ÄVEN NÄR INKIO ÄR TYST (provet i produktionen 2026-11-02). Är
 * avtrycket detsamma hoppar varvet över jämförelsen med `crm_handelse`, så en
 * rad som försvunnit ur Navs kopia kom inte tillbaka förrän något ändrades hos
 * kunden i Inkio. Därför jämförs varje kund rad för rad en gång i timmen ändå,
 * vid första läsningen efter att kundens timme slagit om. Timmen slår om på
 * olika minut för olika kunder, så att de inte jämförs i samma varv.
 */
export function attJamfora(org: string, last: string | null, nu: number): boolean {
  const t = last ? Date.parse(last) : NaN;
  if (!Number.isFinite(t)) return true;
  let h = 0;
  for (let i = 0; i < org.length; i++) h = (Math.imul(h, 31) + org.charCodeAt(i)) >>> 0;
  const timme = (x: number) => Math.floor((x + (h % JAMFOR_MS)) / JAMFOR_MS);
  return timme(t) !== timme(nu);
}

// -----------------------------------------------------------------------------
// Koppla äldre order på organisationsnummer
// -----------------------------------------------------------------------------

export type NavOrder = { id: string; varde: number | null; kopplad: boolean };
export type InkioOrder = { id: string; nummer: string | null; varde: number | null; makulerad: boolean };

/**
 * 22 av Navs 30 kunder lades i Inkio genom importen 2026-10-01, utan Navs id.
 * Bevakningen kopplar dem när det är entydigt: samma värde (på kronan), och
 * bara en order med det värdet på var sida. Allt annat lämnas — en felkopplad
 * order hade fått fel rader i Inkio, och en makulering där hade makulerat fel
 * order här. Strajv AB (11 940 kr i Nav, 5 970 kr i Inkio) kopplades alltså
 * inte; beställaren sa att Inkio var rätt, och den rättades och kopplades för
 * hand 2026-11-02 (`kopplad = 'hand'`).
 */
export function kopplaPaOrgnr(nav: readonly NavOrder[], inkio: readonly InkioOrder[], upptagna: ReadonlySet<string>): { navId: string; inkioId: string; nummer: string | null }[] {
  const lediga = inkio.filter((i) => !i.makulerad && !upptagna.has(i.id));
  const okopplade = nav.filter((n) => !n.kopplad);
  const ut: { navId: string; inkioId: string; nummer: string | null }[] = [];
  const tagna = new Set<string>();

  for (const n of okopplade) {
    if (n.varde === null) continue;
    const lika = lediga.filter((i) => i.varde !== null && Math.round(i.varde) === Math.round(n.varde!) && !tagna.has(i.id));
    const navLika = okopplade.filter((m) => m.varde !== null && Math.round(m.varde) === Math.round(n.varde!));
    if (lika.length === 1 && navLika.length === 1) {
      ut.push({ navId: n.id, inkioId: lika[0].id, nummer: lika[0].nummer });
      tagna.add(lika[0].id);
    }
  }
  return ut;
}

// -----------------------------------------------------------------------------
// Kundkortets flik Aktivitet, ur Navs kopia
// -----------------------------------------------------------------------------

/** Inkios tre områden, som filtren i Inkios historik: Kunden, Ordrar och avtal, Ärenden och produktion. */
export type Omrade = "kund" | "forsaljning" | "arbete";

/** Vad raden är, för kortets tre sorters rader: post (order, avtal …), anteckning, och systemrad (aktivitet). */
export type Radsort = "anteckning" | "aktivitet" | "order" | "avtal" | "arende" | "faktura" | "post";

/** En order, ett avtal, ett ärende eller en faktura, som kortet ritar den: nummer, belopp, tid och status. */
export type Postuppgifter = {
  nummer: string | null;
  tjanster: string[];
  varde: number | null;
  manad: number | null;
  start: string | null;
  slut: string | null;
  /** Avtalets händelse: started, terminated … */
  andring: string | null;
  /** Statusen på svenska ("bekräftad"), och Inkios kod i gemener ("confirmed"). */
  status: string | null;
  kod: string | null;
  makulerad: boolean;
  saljare: string | null;
};

export type Aktivitetsrad = {
  id: string;
  nar: string;
  vem: string;
  anteckning: boolean;
  text: string;
  kalla: { etikett: string; lank: string | null };
  // Kundkortets tidslinje (0278). Fälten ovan står kvar för dem som läser dem.
  sort: Radsort;
  omrade: Omrade;
  /** Det raden gäller i Inkio, när det inte är kunden själv. */
  om: { typ: string; titel: string | null; nummer: string | null } | null;
  post: Postuppgifter | null;
  /** Författarens roll i Inkio ("Utvecklare"), och nivån i Nav när hen finns där. */
  roll: string | null;
  niva: Niva | null;
  /** Skriven i Nav (`kundanteckning`). */
  nav: boolean;
  /** Navs eget eko i Inkio (godkänd, rättad …), skrivet av tjänstekontot och inte av en person: en systemrad. */
  tjanst: boolean;
  andrad: boolean;
  raderad: boolean;
  /** Nav-ordern en anteckning från Nav gäller (`kundanteckning.om_order`). */
  order: string | null;
  // Ändra och ta bort sin egen anteckning (0283). Bara för anteckningar skrivna i Nav.
  /** Vem i Nav som skrev den (`employee.id`): kortet visar Ändra och Ta bort för hen. */
  av: string | null;
  /** Det den sagt förut, äldst först. */
  versioner: { text: string; nar: string }[];
  /** När den togs bort och av vem (bara superadmin ser en borttagen). */
  raderadNar: string | null;
  raderadAv: string | null;
};

export type Lagrad = Rad & { id?: number | string };

export type Navanteckning = {
  id: string;
  text: string;
  skriven_namn: string;
  skriven_at: string;
  crm_id: string | null;
  crm_state: string;
  skriven_av?: string | null;
  om_order?: string | null;
  // 0283: finns först när migrationen körts (kortet läser med `*`).
  andrad_at?: string | null;
  versioner?: unknown;
  raderad_at?: string | null;
  raderad_av?: string | null;
};

/** Versionerna som de står i `kundanteckning.versioner` (0283), tåliga mot det som inte är en lista. */
export function anteckningsversioner(v: unknown): { text: string; nar: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is { text: unknown; at: unknown } => typeof x === "object" && x !== null)
    .map((x) => ({ text: String(x.text ?? ""), nar: String(x.at ?? "") }))
    .filter((x) => x.text && x.nar);
}

/** Vem som skrev, för Navs nivå: e-posten (Inkio), anställnings-id:t (Nav) eller namnet (Navs eko i Inkio). */
export type Forfattarnyckel = { epost?: string | null; id?: string | null; namn?: string | null };

/** "**Zen Alzzabti** (via Nav): Ringde, inget svar" → namnet och texten. */
export function navForfattare(text: string): { namn: string; text: string } | null {
  const m = /^\*\*(.+?)\*\*\s*\(via Nav\):\s*([\s\S]*)$/.exec(text.trim());
  return m ? { namn: m[1].trim(), text: m[2].trim() } : null;
}

const OMRADE_FRAN: Record<string, Omrade> = { customer: "kund", sales: "forsaljning", work: "arbete" };

/** Inkios område, eller härlett ur vad raden gäller för rader lästa före 0278. */
export function omradeFor(r: Pick<Rad, "om_typ" | "data">): Omrade {
  const a = typeof r.data?.omrade === "string" ? OMRADE_FRAN[String(r.data.omrade)] : undefined;
  if (a) return a;
  switch (r.om_typ) {
    case "Sales Order":
    case "Contract":
    case "Invoice":
      return "forsaljning";
    case "Task":
    case "Ticket":
      return "arbete";
    default:
      return "kund";
  }
}

const SORT_FRAN: Record<string, Radsort> = { order: "order", agreement: "avtal", ticket: "arende", invoice: "faktura" };

function radsort(r: Pick<Rad, "slag" | "sort">): Radsort {
  if (r.slag === "anteckning") return "anteckning";
  if (r.slag === "aktivitet") return "aktivitet";
  return SORT_FRAN[r.sort] ?? "post";
}

function tal(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Postens uppgifter ur det Inkio skickade (`data`), för kortets postrad. */
export function postuppgifter(r: Pick<Rad, "om_nummer" | "data">): Postuppgifter {
  const d = r.data ?? {};
  const status = str(d.status);
  return {
    nummer: r.om_nummer ?? str(d.number),
    tjanster: Array.isArray(d.services) ? (d.services as unknown[]).map(String).filter(Boolean) : [],
    varde: tal(d.value ?? d.amount ?? d.total ?? d.grand_total),
    manad: tal(d.monthly),
    start: str(d.start_date),
    slut: str(d.end_date),
    andring: str(d.change),
    status: status ? statusSv(status) : null,
    kod: status ? status.toLowerCase() : null,
    makulerad: d.cancelled === true,
    saljare: str(d.sold_by),
  };
}

/**
 * Raderna i fliken, i samma form som Inkio-läsningen gav (`Aktivitetsrad`),
 * så att kundkortet inte märker skillnaden. Navs egna anteckningar står med
 * sitt riktiga namn; ekot av dem i Inkio visas inte två gånger. En raderad
 * post visas bara för superadmin.
 *
 * `nivaAv` säger vilken nivå i Nav författaren har (Per roll i kortet), eller
 * null när hen inte finns i Nav — EffektivMedias personal, till exempel.
 * `namnAv` ger namnet på den som tog bort en anteckning (0283).
 */
export function aktivitetsrader(
  rader: readonly Lagrad[],
  anteckningar: readonly Navanteckning[],
  o: { superadmin: boolean; inkioBas: string; nivaAv?: (k: Forfattarnyckel) => Niva | null; namnAv?: (id: string) => string | null },
): Aktivitetsrad[] {
  // En borttagen antecknings eko i Inkio göms också: den är borttagen där med, eller på väg att bli det.
  const ekon = new Set(anteckningar.map((a) => a.crm_id).filter(Boolean) as string[]);
  const nivaAv = o.nivaAv ?? (() => null);
  const ut: Aktivitetsrad[] = [];

  for (const a of anteckningar) {
    if (a.raderad_at && !o.superadmin) continue;
    const order = a.om_order ?? null;
    ut.push({
      id: `nav:${a.id}`,
      nar: a.skriven_at,
      vem: a.skriven_namn,
      anteckning: true,
      text: a.text,
      kalla: { etikett: a.raderad_at ? "Kunden · borttagen" : a.crm_state === "skickad" ? "Kunden" : a.crm_state === "ko" ? "Kunden · skrivs till Inkio" : "Kunden · bara i Nav", lank: null },
      sort: "anteckning",
      omrade: order ? "forsaljning" : "kund",
      om: null,
      post: null,
      roll: null,
      niva: nivaAv({ id: a.skriven_av ?? null, namn: a.skriven_namn }),
      nav: true,
      tjanst: false,
      andrad: Boolean(a.andrad_at),
      raderad: Boolean(a.raderad_at),
      order,
      av: a.skriven_av ?? null,
      versioner: anteckningsversioner(a.versioner),
      raderadNar: a.raderad_at ?? null,
      raderadAv: a.raderad_at && a.raderad_av ? (o.namnAv?.(a.raderad_av) ?? null) : null,
    });
  }

  for (const r of rader) {
    if (ekon.has(r.extern_id)) continue;
    if (r.raderad && !o.superadmin) continue;
    const route = typeof r.data?.route === "string" ? String(r.data?.route) : null;
    const lank = route ? `${o.inkioBas}${route}` : r.om_typ === "Customer" && r.om_id ? `${o.inkioBas}/customers/${encodeURIComponent(r.om_id)}` : null;
    const fran = r.fran_nav ? navForfattare(r.text) : null;
    const vem = r.slag === "post" ? "Inkio" : fran ? fran.namn : r.fran_nav ? "Clicknet Nav" : r.data?.import ? `${r.forfattare ?? "Inkio"} (import)` : (r.forfattare ?? "Inkio");
    const text = fran ? fran.text : r.text;
    const tillagg = r.raderad ? " · raderad i Inkio" : r.andrad && r.slag !== "post" ? " · ändrad" : "";
    const sort = radsort(r);
    ut.push({
      id: r.extern_id,
      nar: r.skapad,
      vem,
      anteckning: r.slag === "anteckning",
      text: r.raderad ? `Raderad i Inkio: ${text}` : text,
      kalla: { etikett: `${etikett(r)}${tillagg}`, lank },
      sort,
      omrade: omradeFor(r),
      om: r.om_typ && r.om_typ !== "Customer" ? { typ: r.om_typ, titel: r.om_titel, nummer: r.om_nummer } : null,
      post: r.slag === "post" ? postuppgifter(r) : null,
      roll: typeof r.data?.roll === "string" && !r.fran_nav ? String(r.data.roll) : null,
      niva: r.slag === "post" ? null : fran ? nivaAv({ namn: fran.namn }) : r.fran_nav ? null : nivaAv({ epost: r.forfattare_epost, namn: r.forfattare }),
      nav: false,
      tjanst: r.fran_nav && !fran,
      andrad: Boolean(r.andrad) && r.slag !== "post",
      raderad: Boolean(r.raderad),
      order: null,
      av: null,
      versioner: [],
      raderadNar: null,
      raderadAv: null,
    });
  }

  ut.sort((a, b) => (a.nar < b.nar ? 1 : a.nar > b.nar ? -1 : 0));
  return ut;
}
