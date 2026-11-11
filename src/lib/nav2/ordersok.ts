/**
 * Ordersökningen (2026-11-11): kundens nummer i Inkio, så att en order går att
 * hitta på fakturanumret, avtalet, Inkio-ordern eller ärendet.
 *
 * Numren läses ur Inkio-bevakningens kopia (`crm_handelse`, 0277), som tar in
 * varje post i kundens historik i Inkio varje eller var femte minut. Inget nytt
 * anrop till Inkio och ingen ny tabell: en faktura som Inkio lagt upp går att
 * söka på så fort bevakningen har läst in den.
 *
 * Posterna hör till kunden (org.nr), inte till en viss order, så numren gäller
 * kundens alla order. Det är samma krets som kundkortets tidslinje: den som ser
 * en av kundens order ser kundens historik.
 *
 * Ren logik utan databas. Prov: tests/nav2-ordersok.mjs.
 */
import { AVTALSTATUS, FAKTURASTATUS, ORDERSTATUS } from "../crm/ekonomi.ts";

/** En post i `crm_handelse`, så långt sökningen läser den. */
export type RaNummer = {
  org_number: string;
  om_typ: string | null;
  om_titel: string | null;
  om_nummer: string | null;
  slag: string;
  skapad: string;
  data: Record<string, unknown> | null;
};

export type NdNummerEtikett = "Faktura" | "Kreditfaktura" | "Avtal" | "Order i Inkio" | "Ärende";

/** Ett sökbart nummer på kunden, med det som visas bredvid en träff. */
export type NdNummer = {
  etikett: NdNummerEtikett;
  nr: string;
  /** Avtalets tjänst, Inkio-orderns rubrik eller ärendets ämne. */
  titel: string | null;
  /** Fakturans belopp i kronor. */
  belopp: number | null;
  /** Fakturans förfallodag, "YYYY-MM-DD". */
  datum: string | null;
  /** Läget med Inkios svenska ord ("Skickad", "Aktiv"), eller Inkios eget ord när det är okänt. */
  status: string | null;
};

const TYPER = ["Invoice", "Contract", "Sales Order", "Ticket"] as const;
/** Posttyperna som bär ett nummer, för frågan mot `crm_handelse`. */
export const NUMMERTYPER: string[] = [...TYPER];

/** Fakturor först, sedan avtal, Inkio-order och ärenden. */
const RANG: Record<NdNummerEtikett, number> = { Faktura: 0, Kreditfaktura: 0, Avtal: 1, "Order i Inkio": 2, "Ärende": 3 };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const tal = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Org.nr som i Nav, "NNNNNN-NNNN". Ett nummer med sekel tappar seklet. */
export function navOrgnr(s: string | null | undefined): string {
  let d = String(s ?? "").replace(/\D/g, "");
  if (d.length === 12) d = d.slice(2);
  return d.length === 10 ? `${d.slice(0, 6)}-${d.slice(6)}` : String(s ?? "").trim();
}

function tolka(r: RaNummer): NdNummer | null {
  const d = r.data ?? {};
  const lage = (karta: Record<string, { text: string }>) => {
    const s = text(d.status);
    return s ? karta[s]?.text ?? s : null;
  };
  switch (r.om_typ) {
    case "Invoice": {
      const nr = text(d.invoice_number) ?? text(r.om_titel);
      if (!nr) return null;
      return {
        etikett: d.is_credit_note === true ? "Kreditfaktura" : "Faktura",
        nr,
        titel: null,
        belopp: tal(d.total),
        datum: text(d.due_date),
        status: lage(FAKTURASTATUS),
      };
    }
    case "Contract":
    case "Sales Order":
    case "Ticket": {
      const nr = text(r.om_nummer);
      if (!nr) return null;
      const etikett: NdNummerEtikett = r.om_typ === "Contract" ? "Avtal" : r.om_typ === "Sales Order" ? "Order i Inkio" : "Ärende";
      return {
        etikett,
        nr,
        titel: text(r.om_titel),
        belopp: null,
        datum: null,
        status: r.om_typ === "Contract" ? lage(AVTALSTATUS) : r.om_typ === "Sales Order" ? lage(ORDERSTATUS) : null,
      };
    }
    default:
      return null;
  }
}

/**
 * Kundernas nummer, per org.nr i Navs form.
 *
 * Samma faktura står ofta på flera poster (fakturan, påminnelsen, en
 * anteckning): den blir en rad. Uppgifterna tas ur fakturans egen post, och en
 * nyare post utan läge suddar inte ut läget.
 */
export function formaNummer(rader: RaNummer[]): Record<string, NdNummer[]> {
  // Posten först (den bär fakturans uppgifter), sedan nyast först.
  const ordnade = [...rader].sort(
    (a, b) => Number(b.slag === "post") - Number(a.slag === "post") || String(b.skapad).localeCompare(String(a.skapad)),
  );
  const perKund = new Map<string, Map<string, { n: NdNummer; nar: string }>>();
  for (const r of ordnade) {
    const n = tolka(r);
    if (!n) continue;
    const org = navOrgnr(r.org_number);
    if (!org) continue;
    let kund = perKund.get(org);
    if (!kund) perKund.set(org, (kund = new Map()));
    const nyckel = `${RANG[n.etikett]}|${n.nr}`;
    const fore = kund.get(nyckel);
    if (!fore) {
      kund.set(nyckel, { n, nar: String(r.skapad) });
      continue;
    }
    if (fore.n.titel === null) fore.n.titel = n.titel;
    if (fore.n.belopp === null) fore.n.belopp = n.belopp;
    if (fore.n.datum === null) fore.n.datum = n.datum;
    if (fore.n.status === null) fore.n.status = n.status;
  }
  const ut: Record<string, NdNummer[]> = {};
  for (const [org, kund] of perKund) {
    ut[org] = [...kund.values()]
      .sort((a, b) => RANG[a.n.etikett] - RANG[b.n.etikett] || b.nar.localeCompare(a.nar))
      .map((x) => x.n);
  }
  return ut;
}
