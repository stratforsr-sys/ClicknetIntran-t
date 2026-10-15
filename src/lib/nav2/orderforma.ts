/**
 * Nav 2.0: order i den form utkastet ritar, och provisionen den ger.
 *
 * Ren logik. Importerar bara repots egna rena moduler (order, chefsprovision,
 * utkop, finans, samtal-order, ordervy), sa att filen kors bade i Next och i
 * provet lokalt mot riktig data.
 *
 * ===========================================================================
 * PROVISIONEN AR REPOTS, INTE UTKASTETS.
 *
 * Utkastet raknade med en egen matris (`OMATRIS`) och egna procentsatser. Har
 * galler tva fall och inget tredje:
 *
 *   GODKAND, BETALD ELLER MAKULERAD  `commission_amount`, fryst vid
 *                                    godkannandet. Den lases, den raknas aldrig.
 *   UTKAST ELLER INSKICKAD           det godkannandet SKULLE frysa i dag:
 *                                    `forhandsprovision` nedan, som foljer
 *                                    `raknaFramProvision` i order/actions.ts
 *                                    steg for steg med samma funktioner.
 *
 * Forhandsberakningen kan falla precis som godkannandet kan (ingen sats, utkop
 * storre an affaren). Da ar provisionen null och skalet star i `provFel` — en
 * nolla hade sett ut som "ingen provision".
 * ===========================================================================
 */

import {
  beraknatOrdervarde,
  gallandeSats,
  harGodkants,
  type Orderstatus,
  type Paket,
  type Sats,
  type Tjanst,
} from "../order.ts";
import {
  affarenFor,
  arEgenForsaljning,
  gallandeChefssats,
  procentProvision,
  type Chefssats,
  type Saljarkalla,
} from "../chefsprovision.ts";
import { gallandeUtkopssats, harUtkop, nettoEfterUtkop, utkopsprovision, type Utkopssats } from "../utkop.ts";
import { finansavgift, gallandeFinanssats, nettoEfterFinans, type Finanssats } from "../finans.ts";
import { bedomSaljsamtal } from "../samtal-order.ts";

/** Raden som `order-server.ts` lamnar ut (FALT), plus det 0080 lade till. */
export type RaOrder = {
  id: string;
  order_number: number | null;
  company_name: string;
  org_number: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  customer_street: string | null;
  customer_postal_code: string | null;
  customer_city: string | null;
  package_id: number;
  term_months: number;
  salesperson_id: string;
  signed_on: string;
  starts_on: string | null;
  ends_on: string | null;
  period_month: string;
  cancel_period_month: string | null;
  status: Orderstatus;
  is_addon: boolean;
  monthly_amount: number | null;
  commission_amount: number | null;
  commission_source: string | null;
  order_value: number | null;
  order_value_source: string | null;
  buyout_amount?: number | null;
  financed?: boolean;
  finance_amount?: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by?: string | null;
  cancelled_on: string | null;
  cancel_reason: string | null;
  cancelled_by?: string | null;
  renewal_outcome: "forlangd" | "avslutad" | null;
  renewal_at?: string | null;
  renewal_reason?: string | null;
  proposed_commission_amount: number | null;
  proposed_commission_percent: number | null;
  /** 0085: skälet till en fri order. */
  free_order_reason?: string | null;
};

export type RaSamtal = {
  id: string;
  direction: "in" | "ut" | "okand";
  startedAt: string | null;
  talkSeconds: number | null;
  recordingState: string;
  orderLinkedBy: string | null;
  employeeId: string | null;
  /** Inspelningen i `file_object`; spelas med `/filer/<id>`, som på /order. */
  recordingFileId?: string | null;
};

export type RaBilaga = { id: string; filename: string | null; uploaded_at: string; size_bytes?: number | null; uploaded_by?: string | null };

export type RaCrm = {
  state: string;
  error: string | null;
  kundnummer: string | null;
  ordernummer: string | null;
  kundLank: string | null;
  orderLank: string | null;
  synkad: string;
};

export type Satserna = {
  paket: Paket[];
  satser: Sats[];
  chefssatser: Chefssats[];
  utkopssatser: Utkopssats[];
  finanssatser: Finanssats[];
};

/** Ett samtal i kundkortet. `nar` ar svensk tid, "YYYY-MM-DD HH:MM". */
export type NdSamtal = {
  id: string;
  nar: string;
  dir: "in" | "ut" | "okand";
  sek: number;
  vem: string;
  /** Inspelningens lage, som i `phone_call.recording_state`. */
  ins: string;
  /** Ordernumret om samtalet ar orderns saljsamtal enligt `bedomSaljsamtal`. */
  order: number | null;
  /** Kopplat for hand (`order_linked_by`). */
  hand: boolean;
  orderId: string;
  /** Inspelningens fil-id, eller null. Spelaren hämtar `/filer/<id>` (behörighet och logg som på /order). */
  fil: string | null;
  /** 0083: utskriften, eller null när samtalet inte transkriberats. */
  utskrift: NdUtskrift | null;
};

/** 0083 `call_transcript`: segment i millisekunder, och vem som talar. */
export type NdUtskrift = {
  status: "ko" | "klar" | "fel";
  segment: { s: number; e: number; vem: "saljare" | "kund" | null; text: string }[];
  fel: string | null;
};

export function formaUtskrift(r: { status: string; segments: unknown; error: string | null }): NdUtskrift {
  const seg = Array.isArray(r.segments) ? (r.segments as Record<string, unknown>[]) : [];
  const status = r.status;
  return {
    status: status === "klar" || status === "fel" ? status : "ko",
    segment: seg
      .map((x): NdUtskrift["segment"][number] => {
        const vem = x.vem;
        return {
          s: Number(x.s) || 0,
          e: Number(x.e) || 0,
          vem: vem === "saljare" || vem === "kund" ? vem : null,
          text: String(x.text ?? "").trim(),
        };
      })
      .filter((x) => x.text)
      .sort((a, b) => a.s - b.s),
    fel: r.error ?? null,
  };
}

/** 0084 `kampanjsidor_lage()`: kampanjsidans läge för kundkortet. */
export type NdSida = {
  url: string | null;
  ok: boolean | null;
  ms: number | null;
  kollad: string | null;
  nereSedan: string | null;
  fel: string | null;
  /** De sju senaste dagarna, äldst först: true = uppe hela dagen, false = nere i perioder, null = inte kollad. */
  vecka: { dag: string; v: boolean | null }[];
};

export function formaSida(
  r: { url: string | null; checked_at: string | null; ok: boolean | null; ms: number | null; status_code: number | null; error: string | null; nere_sedan: string | null; dagar: unknown },
  idag: string,
): NdSida {
  const dagar = (r.dagar && typeof r.dagar === "object" ? r.dagar : {}) as Record<string, boolean>;
  const d0 = new Date(`${idag}T12:00:00Z`);
  const vecka = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(d0);
    d.setUTCDate(d0.getUTCDate() - (6 - i));
    const dag = d.toISOString().slice(0, 10);
    return { dag, v: dag in dagar ? Boolean(dagar[dag]) : null };
  });
  return {
    url: r.url,
    ok: r.checked_at ? Boolean(r.ok) : null,
    ms: r.ms ?? null,
    kollad: r.checked_at ?? null,
    nereSedan: r.nere_sedan ?? null,
    fel: r.error ?? (r.status_code && r.status_code >= 400 ? `Svarade ${r.status_code}` : null),
    vecka,
  };
}

export type NdOrder = {
  id: string;
  nr: number;
  bolag: string;
  org: string;
  kontakt: string;
  tel: string;
  mejl: string;
  adress: string;
  postnr: string;
  ort: string;
  vemId: string;
  vem: string;
  /** Paketet, eller 0 for en fri order. */
  p: number;
  lop: number;
  /** Vad kunden betalar i manaden: fryst, angivet, eller paketets pris. */
  man: number | null;
  tj: [string, "engang" | "manad", number, boolean, number | null][];
  sign: string;
  start: string;
  slut: string | null;
  period: string;
  makPeriod: string | null;
  st: Orderstatus;
  addon: boolean;
  varde: number | null;
  vardeFryst: boolean;
  utkop: number | null;
  finans: boolean;
  finansBelopp: number | null;
  prov: number | null;
  provKalla: string | null;
  provProcent: number | null;
  provFryst: boolean;
  provFel: string | null;
  fri: { varde: number | null; prov: number | null; typ: "kr" | "%"; skal: string } | null;
  samtal: { id: string; t: string; dag: string; min: number; sek: number; ljud: boolean } | null;
  samtalSkal: string | null;
  avtal: boolean;
  bilagor: { id: string; namn: string; kb: number | null; av: string; nar: string }[];
  inkio: RaCrm | null;
  note: string;
  skapad: string;
  /** Klockslaget ordern lades upp, bara nar det var samma dag som signeringen. */
  tid: string | null;
  skapadAv: string | null;
  godkand: string | null;
  godkandAv: string | null;
  mak: { dag: string; skal: string; av: string | null } | null;
  fornyelse: { utfall: "forlangd" | "avslutad"; nar: string | null; skal: string | null } | null;
};

// -----------------------------------------------------------------------------
// Tiden
// -----------------------------------------------------------------------------

const STHLM = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "YYYY-MM-DD HH:MM" i svensk tid. */
export function svenskTid(iso: string): string {
  const p = Object.fromEntries(STHLM.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// -----------------------------------------------------------------------------
// Forhandsberakningen — raknaFramProvision utan databas
// -----------------------------------------------------------------------------

export type Forhand = {
  /** Null nar godkannandet hade fallit. */
  provision: number | null;
  kalla: "matrix" | "manual" | "manager" | "buyout" | null;
  procent: number | null;
  fel: string | null;
  varde: number | null;
  finans: number | null;
};

/**
 * Det godkannandet skulle frysa om det skedde i dag, med orderns egna uppgifter.
 *
 * Foljer `raknaFramProvision` (order/actions.ts) i samma ordning och med samma
 * felbesked. Det enda som skiljer ar att satserna kommer in som argument i
 * stallet for att lasas, och att `form` ar orderns `proposed_commission_*` —
 * precis vad `medAngivenProvision` lagger i formularet nar knappen Godkann
 * trycks utan egen provision.
 */
export function forhandsprovision(
  o: Pick<
    RaOrder,
    | "package_id"
    | "term_months"
    | "signed_on"
    | "salesperson_id"
    | "monthly_amount"
    | "buyout_amount"
    | "financed"
    | "proposed_commission_amount"
    | "proposed_commission_percent"
  >,
  tjanster: Tjanst[],
  s: Satserna,
): Forhand {
  const fall = (fel: string, varde: number | null = null, finans: number | null = null): Forhand => ({
    provision: null,
    kalla: null,
    procent: null,
    fel,
    varde,
    finans,
  });

  const chefssats = gallandeChefssats(s.chefssatser, o.signed_on);
  const chefenSaljer = arEgenForsaljning(chefssats, o.salesperson_id);
  const utkopssats = gallandeUtkopssats(s.utkopssatser, o.signed_on);
  const utkopBelopp: number | null = harUtkop(o.buyout_amount ?? null) ? (o.buyout_amount as number) : null;

  // Den angivna provisionen, som `medAngivenProvision` lagger den.
  const procentText = o.proposed_commission_percent != null ? Number(o.proposed_commission_percent) : null;
  const manuell = procentText === null && o.proposed_commission_amount != null ? Number(o.proposed_commission_amount) : null;
  const handsatt = procentText !== null || manuell !== null;

  // 1. Ordervardet
  const friOrder = o.monthly_amount !== null;
  if (friOrder && !(Number(o.monthly_amount) > 0)) return fall("Månadsbeloppet måste vara större än noll.");
  if (!friOrder && !s.paket.some((p) => p.id === o.package_id)) {
    return fall("Paketet finns inte. Välj ett paket eller kryssa i att ordern inte följer paketreglerna.");
  }
  const varde = beraknatOrdervarde(o, s.paket, tjanster);
  if (varde === null) return fall("Ordervärdet går inte att räkna.");

  // 1c. Finansen
  let finans: number | null = null;
  if (o.financed) {
    const fs = gallandeFinanssats(s.finanssatser, o.signed_on);
    if (!fs) {
      return fall(
        "Ingen finanssats gällde på signeringsdagen. Ordern kan inte räknas som finans förrän en sats är satt.",
        varde,
      );
    }
    finans = finansavgift(varde, o.term_months, fs.percent_per_year);
  }
  const netto = nettoEfterFinans(nettoEfterUtkop(varde, utkopBelopp), finans);

  if (finans !== null && finans + (utkopBelopp ?? 0) > varde) {
    return fall("Utköpet och finansavgiften är tillsammans större än ordervärdet. Kontrollera talen.", varde, finans);
  }
  if (utkopBelopp !== null) {
    if (utkopBelopp > varde) return fall("Utköpet är större än ordervärdet. Kontrollera talen.", varde, finans);
    if (!utkopssats && !chefenSaljer && !handsatt) {
      return fall(
        "Ingen utköpssats gällde på signeringsdagen. Lägg en sats under Provision → Regler, eller sätt beloppet för hand.",
        varde,
        finans,
      );
    }
  }

  // 2. Saljarens provision
  let saljarprovision: number;
  let saljarkalla: Saljarkalla;
  let procent: number | null = null;

  if (procentText !== null) {
    if (procentText < 0 || procentText > 100) return fall("Procentsatsen ska vara mellan 0 och 100.", varde, finans);
    saljarprovision = procentProvision(netto, procentText);
    saljarkalla = "manual";
    procent = procentText;
  } else if (manuell !== null) {
    if (manuell < 0) return fall("Provisionen kan inte vara negativ. En makulering är vägen ut.", varde, finans);
    saljarprovision = manuell;
    saljarkalla = "manual";
  } else if (utkopBelopp !== null && !chefenSaljer) {
    saljarprovision = utkopsprovision(utkopssats!, netto);
    saljarkalla = "buyout";
    procent = utkopssats!.percent;
  } else if (friOrder && !chefenSaljer) {
    return fall("En order utanför paketreglerna behöver både ett ordervärde och en provision.", varde, finans);
  } else {
    const rad = gallandeSats(s.satser, o.package_id, o.term_months, o.signed_on);
    if (!rad && !chefenSaljer) {
      return fall(
        "Ingen provisionssats gällde för den kombinationen på signeringsdagen. Sätt beloppet för hand med en anteckning.",
        varde,
        finans,
      );
    }
    saljarprovision = rad?.amount ?? 0;
    saljarkalla = "matrix";
  }

  // 3. Affaren
  const affar = affarenFor({
    sats: chefssats,
    saljareId: o.salesperson_id,
    ordervarde: netto,
    saljarprovision,
    saljarkalla,
    handsatt,
  });
  if (affar.kalla === "manager") procent = chefssats?.own_sale_percent ?? null;

  return { provision: affar.provision, kalla: affar.kalla, procent, fel: null, varde, finans };
}

/** Procentsatsen bakom en fryst provision, for texten "40 % av nettot". */
function frystProcent(o: RaOrder, s: Satserna): number | null {
  if (o.commission_source === "manager") return gallandeChefssats(s.chefssatser, o.signed_on)?.own_sale_percent ?? null;
  if (o.commission_source === "buyout") return gallandeUtkopssats(s.utkopssatser, o.signed_on)?.percent ?? null;
  if (o.commission_source === "manual") return o.proposed_commission_percent != null ? Number(o.proposed_commission_percent) : null;
  return null;
}

// -----------------------------------------------------------------------------
// En order i utkastets form
// -----------------------------------------------------------------------------

export function formaOrder(
  o: RaOrder,
  ctx: {
    satser: Satserna;
    tjanster: (Tjanst & { id?: string })[];
    samtal: RaSamtal[];
    bilagor: RaBilaga[];
    crm: RaCrm | null;
    namn: (id: string | null | undefined) => string | null;
    /** 0083: utskrifterna per samtal. */
    utskrifter?: Map<string, NdUtskrift>;
  },
): { order: NdOrder; samtal: NdSamtal[] } {
  const s = ctx.satser;
  const nr = Number(o.order_number ?? 0);
  const fryst = harGodkants(o.status);
  const fh = fryst ? null : forhandsprovision(o, ctx.tjanster, s);

  // Fri order: utanfor paketen. Godkand: vardet sattes for hand. Annars: ett angivet manadsbelopp.
  const fri = fryst ? o.order_value_source === "manual" : o.monthly_amount !== null;
  const listpris = s.paket.find((p) => p.id === o.package_id)?.list_price ?? null;
  const man = o.monthly_amount ?? (fri ? null : listpris);

  const varde = fryst ? o.order_value : fh!.varde;
  const prov = fryst ? o.commission_amount : fh!.provision;

  // Saljsamtalet: samma bedomning som sparren, pa de samtal som redan ar kopplade.
  const bedomning = bedomSaljsamtal({
    samtal: ctx.samtal.map((c) => ({
      id: c.id,
      employeeId: c.employeeId,
      talkSeconds: c.talkSeconds,
      startedAt: c.startedAt,
      recordingState: c.recordingState,
    })),
    saljareId: o.salesperson_id,
    orderSkapad: o.created_at,
    signerad: o.signed_on,
  });
  const saljId = bedomning.ok ? bedomning.samtalId : null;
  const saljsamtal = saljId ? ctx.samtal.find((c) => c.id === saljId) ?? null : null;
  const saljTid = saljsamtal?.startedAt ? svenskTid(saljsamtal.startedAt) : null;

  const skapadTid = svenskTid(o.created_at);
  const order: NdOrder = {
    id: o.id,
    nr,
    bolag: o.company_name,
    org: o.org_number ?? "",
    kontakt: o.contact_name ?? "",
    tel: o.contact_phone ?? "",
    mejl: o.contact_email ?? "",
    adress: o.customer_street ?? "",
    postnr: o.customer_postal_code ?? "",
    ort: o.customer_city ?? "",
    vemId: o.salesperson_id,
    vem: ctx.namn(o.salesperson_id) ?? "Okänd säljare",
    p: fri ? 0 : o.package_id,
    lop: o.term_months,
    man,
    tj: ctx.tjanster.map((t): NdOrder["tj"][number] => [t.name, t.billing, t.amount, t.follows_order, t.term_months]),
    sign: o.signed_on,
    start: o.starts_on ?? o.signed_on,
    slut: o.ends_on,
    period: o.period_month.slice(0, 7),
    makPeriod: o.cancel_period_month ? o.cancel_period_month.slice(0, 7) : null,
    st: o.status,
    addon: o.is_addon,
    varde,
    vardeFryst: fryst && o.order_value !== null,
    utkop: o.buyout_amount ?? null,
    finans: o.financed === true,
    finansBelopp: fryst ? (o.finance_amount ?? null) : fh!.finans,
    prov,
    provKalla: fryst ? o.commission_source : fh!.kalla,
    provProcent: fryst ? frystProcent(o, s) : fh!.procent,
    provFryst: fryst,
    provFel: fh?.fel ?? null,
    fri: fri
      ? {
          varde,
          prov: o.proposed_commission_percent != null ? Number(o.proposed_commission_percent) : (prov ?? null),
          typ: o.proposed_commission_percent != null ? "%" : "kr",
          skal: o.free_order_reason ?? "",
        }
      : null,
    samtal:
      saljsamtal && saljTid && bedomning.ok
        ? {
            id: saljsamtal.id,
            dag: saljTid.slice(0, 10),
            t: saljTid.slice(11),
            sek: bedomning.sekunder,
            min: Math.round(bedomning.sekunder / 60),
            ljud: bedomning.harLjud,
          }
        : null,
    samtalSkal: bedomning.ok ? null : bedomning.skal,
    avtal: ctx.bilagor.length > 0,
    bilagor: ctx.bilagor.map((b) => ({
      id: b.id,
      namn: b.filename ?? "Namnlös fil",
      kb: b.size_bytes ? Math.max(1, Math.round(Number(b.size_bytes) / 1024)) : null,
      av: ctx.namn(b.uploaded_by) ?? "",
      nar: b.uploaded_at,
    })),
    inkio: ctx.crm,
    note: o.note ?? "",
    skapad: o.created_at,
    tid: skapadTid.slice(0, 10) === o.signed_on ? skapadTid.slice(11) : null,
    skapadAv: ctx.namn(o.created_by),
    godkand: o.approved_at,
    godkandAv: ctx.namn(o.approved_by),
    mak:
      o.status === "makulerad"
        ? { dag: o.cancelled_on ?? o.signed_on, skal: o.cancel_reason ?? "", av: ctx.namn(o.cancelled_by) }
        : null,
    fornyelse: o.renewal_outcome ? { utfall: o.renewal_outcome, nar: o.renewal_at ?? null, skal: o.renewal_reason ?? null } : null,
  };

  const samtal: NdSamtal[] = ctx.samtal
    .filter((c) => c.startedAt)
    .map((c) => ({
      id: c.id,
      nar: svenskTid(c.startedAt!),
      dir: c.direction,
      sek: c.talkSeconds ?? 0,
      vem: ctx.namn(c.employeeId) ?? "",
      ins: c.recordingState,
      order: saljsamtal && c.id === saljsamtal.id ? nr : null,
      hand: c.orderLinkedBy !== null,
      orderId: o.id,
      fil: c.recordingFileId ?? null,
      utskrift: ctx.utskrifter?.get(c.id) ?? null,
    }));

  return { order, samtal };
}
