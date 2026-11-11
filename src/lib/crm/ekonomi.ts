/**
 * Orderns ekonomi, som Inkio visar den (2026-11-02).
 *
 * Beställaren: "Fixa så att alla dem finns med, gör det exakt på samma backend
 * som inkio, läs backend. Sen gör det som inkio med gränssnittet men med navs
 * utseende." Och om betald: "Gör det som inkio."
 *
 * =============================================================================
 * INKIO ÄR KÄLLAN, NAV SPARAR INGENTING
 *
 * Allt här läses ur Inkio när ordern fälls ut på kundkortet
 * (`/nav2/inkio?vad=ekonomi`), med samma anrop som Inkios egna sidor gör:
 * ordern (`/api/records/sales-order/<id>`, med `invoicing` och `handling`),
 * orderhanteringen (`/api/order-handling/get-item`), avtalen
 * (`/api/contracts/get-contracts?source_sales_order=`), utbetalningen
 * (`/api/financing-payouts/get-payout`), produktionskortet
 * (`/api/projects/get-task`), fakturorna (`/api/invoices/get-invoices`), filerna
 * (`/api/filehandler/get-files`) och samtalen (`/api/calls/get-calls`).
 * Ingen kopia i Nav som kan glida isär, och ingen migration.
 * =============================================================================
 *
 * =============================================================================
 * BETALD BETYDER SLUTBETALD, SOM I INKIO
 *
 * Inkio har ingen status "betald" på en order. Varje planerad faktura har ett
 * läge (planerad, väntar på faktura, saknas i Fortnox, fakturerad, förfallen,
 * betald, krediterad), och orderhanteringens sista steg, "Slutbetald", är klart
 * först när ALLA fakturor i planen är betalda (`paid >= total`). Det gäller bara
 * en internt fakturerad order: en finansierad order betalas av finansbolaget, och
 * kunden betalar dem. Nav gör likadant (`slutbetald`): en betald faktura av tolv
 * gör inte ordern betald.
 * =============================================================================
 *
 * Orden är Inkios egna, ur Inkios svenska översättning (`/api/translations/sv`),
 * och stegen följer Inkios `handlingTypes` rad för rad.
 */

// -----------------------------------------------------------------------------
// Inkios svar, så långt Nav läser dem
// -----------------------------------------------------------------------------

export type InkioPlanrad = {
  idx?: number | null;
  invoice_date: string;
  due_date?: string | null;
  amount: number;
  state?: string | null;
  fortnox?: { id?: string | null; invoice_number?: string | null; paid_date?: string | null } | null;
};

export type InkioLopet = {
  total?: number | null;
  invoiced?: number | null;
  paid?: number | null;
  overdue?: number | null;
  missing?: number | null;
  credited?: number | null;
  next?: { invoice_date: string; amount: number } | null;
};

export type InkioFakturering = {
  type?: "Financed" | "Internal" | string | null;
  order_value?: number | null;
  currency?: string | null;
  term_months?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  financing_company?: string | null;
  schedule?: string | null;
  interval_months?: number | null;
  payment_terms_days?: number | null;
  invoices?: InkioPlanrad[] | null;
  matching?: boolean | null;
  outside_plan?: { id: string; invoice_number?: string | null; invoice_date?: string | null; net_amount?: number | null; status?: string | null }[] | null;
  progress?: InkioLopet | null;
};

export type InkioOrderhuvud = {
  id: string;
  number?: string | null;
  state?: string | null;
  status?: string | null;
  customer?: string | null;
  order_date?: string | null;
  delivery_date?: string | null;
  currency?: string | null;
  total_contract_value?: number | null;
  invoice_email?: string | null;
  billing_contact_name?: string | null;
  production_task_id?: string | null;
  production_task_company_name?: string | null;
  contract_created?: boolean | null;
  sales_person_name?: string | null;
  invoicing?: InkioFakturering | null;
  handling?: { id: string; number?: string | null; status?: string | null; method?: string | null; financing_company?: string | null; handled_at?: string | null } | null;
};

export type InkioHantering = {
  id: string;
  number?: string | null;
  status?: string | null;
  method?: string | null;
  invoicing?: string | null;
  financing_company?: string | null;
  order_financier?: string | null;
  fortnox_reference?: string | null;
  note?: string | null;
  handled_at?: string | null;
  handled_by_name?: string | null;
  sent_to_financier_at?: string | null;
  sent_to_financier_by_name?: string | null;
  order_cancelled_at?: string | null;
  financing_payout?: string | { id?: string | null } | null;
  order_date?: string | null;
  sales_person_name?: string | null;
  facts?: { order?: { order_date?: string | null } | null; invoicing?: InkioFakturering | null } | null;
};

export type InkioUtbetalning = {
  id: string;
  number?: string | null;
  financing_company?: string | null;
  payout_date?: string | null;
  amount?: number | null;
  currency?: string | null;
  reference?: string | null;
  payout_reference?: string | null;
  note?: string | null;
};

export type InkioAvtal = {
  id: string;
  number?: string | null;
  status?: string | null;
  currency?: string | null;
  term_length?: number | null;
  term_unit?: string | null;
  billing_interval?: number | null;
  billed_periods?: number | null;
  billing_end_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  next_billing_date?: string | null;
  total_contract_value?: number | null;
  external_billing_mode?: string | null;
  invoices_financed?: boolean | null;
  financing_company?: string | null;
  notice_given_on?: string | null;
  terminated_at?: string | null;
  services?: string[] | null;
};

export type InkioKort = {
  id: string;
  number?: string | null;
  title?: string | null;
  column_title?: string | null;
  board_title?: string | null;
  project_title?: string | null;
  due_date?: string | null;
  due_complete?: boolean | null;
  completed_at?: string | null;
  is_archived?: boolean | null;
  checklist_total?: number | null;
  checklist_done?: number | null;
  assignees?: { full_name?: string | null }[] | null;
};

export type InkioFaktura = {
  id: string;
  invoice_number?: string | null;
  sales_order?: string | null;
  contract?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  total_amount?: number | null;
  net_amount?: number | null;
  amount_paid?: number | null;
  paid_date?: string | null;
  status?: string | null;
  source?: string | null;
  booked?: boolean | null;
  sent?: boolean | null;
  stand?: string | null;
  stand_label?: string | null;
  last_reminder_on?: string | null;
  reminders_total?: number | null;
  is_final_invoice?: boolean | null;
  is_credit_note?: boolean | null;
  currency?: string | null;
};

export type InkioFil = {
  id: string;
  number?: string | null;
  title?: string | null;
  file_name?: string | null;
  file_url?: string | null;
  file_size?: number | null;
  created_at?: string | null;
  category_name?: string | null;
};

export type InkioSamtal = {
  id: string;
  status?: string | null;
  direction?: string | null;
  started_at?: string | null;
  duration_seconds?: number | null;
  our_user?: string | { full_name?: string | null } | null;
  their_number?: string | null;
  headline?: string | null;
};

// -----------------------------------------------------------------------------
// Inkios ord (Inkios svenska översättning)
// -----------------------------------------------------------------------------

/** Fakturaplanens lägen, med Navs toner (Inkio: grå, bärnsten, röd, blå, röd, grön, grå). */
export const PLANLAGE: Record<string, { text: string; ton: Ton }> = {
  planned: { text: "Planerad", ton: "neutral" },
  expected: { text: "Väntar på faktura", ton: "warn" },
  missing: { text: "Saknas i Fortnox", ton: "danger" },
  invoiced: { text: "Fakturerad", ton: "info" },
  overdue: { text: "Förfallen", ton: "danger" },
  paid: { text: "Betald", ton: "ok" },
  credited: { text: "Krediterad", ton: "neutral" },
};

export type Ton = "ok" | "warn" | "danger" | "info" | "signal" | "neutral" | "brand";

const TYP: Record<string, string> = { Financed: "Finansierad", Internal: "Intern" };
const SCHEMA: Record<string, string> = {
  Monthly: "Månadsvis",
  Quarterly: "Kvartalsvis",
  "Half-yearly": "Halvårsvis",
  Yearly: "Årsvis",
  Custom: "Anpassad",
};
const METOD: Record<string, string> = {
  "Fortnox Automatic": "Automatiskt i Fortnox",
  "Fortnox Manual": "Manuellt i Fortnox",
};
const HANTERING: Record<string, { text: string; ton: Ton }> = {
  Pending: { text: "Att hantera", ton: "signal" },
  "Awaiting Financier": { text: "Hos finansbolag", ton: "signal" },
  Done: { text: "Hanterad", ton: "ok" },
  "Needs Undo": { text: "Stoppa faktureringen", ton: "danger" },
  Cancelled: { text: "Avbruten", ton: "neutral" },
};
export const ORDERSTATUS: Record<string, { text: string; ton: Ton }> = {
  Draft: { text: "Utkast", ton: "neutral" },
  Confirmed: { text: "Bekräftad", ton: "info" },
  "To Deliver": { text: "Att leverera", ton: "signal" },
  Delivered: { text: "Levererad", ton: "ok" },
  Cancelled: { text: "Avbruten", ton: "danger" },
};
export const AVTALSTATUS: Record<string, { text: string; ton: Ton }> = {
  Draft: { text: "Utkast", ton: "neutral" },
  Scheduled: { text: "Schemalagd", ton: "info" },
  Active: { text: "Aktiv", ton: "ok" },
  Expired: { text: "Utgången", ton: "neutral" },
  Renewed: { text: "Förnyad", ton: "brand" },
  Superseded: { text: "Ersatt", ton: "neutral" },
  Terminated: { text: "Uppsagd", ton: "danger" },
};
export const FAKTURASTATUS: Record<string, { text: string; ton: Ton }> = {
  Draft: { text: "Utkast", ton: "neutral" },
  Sent: { text: "Skickad", ton: "info" },
  Paid: { text: "Betald", ton: "ok" },
  Overdue: { text: "Förfallen", ton: "danger" },
  Credited: { text: "Krediterad", ton: "neutral" },
  Cancelled: { text: "Avbruten", ton: "neutral" },
};
/** Indrivningens ställning på en faktura (Inkios `stand`), när Inkio inte skickar `stand_label`. */
const STAND: Record<string, { text: string; ton: Ton }> = {
  paid: { text: "Betald", ton: "ok" },
  normal: { text: "Normal", ton: "neutral" },
  forfallen: { text: "Förfallen", ton: "danger" },
  paminnelse_1: { text: "Påminnelse 1", ton: "warn" },
  redo_for_inkasso: { text: "Redo för inkasso", ton: "signal" },
  inkasso: { text: "Inkasso", ton: "danger" },
  kfm: { text: "Kronofogden", ton: "danger" },
  avslutad: { text: "Avslutad", ton: "neutral" },
};

/** "Manuellt i Fortnox", "Finansierad av Novo" — Inkios `_()` i handlingTypes. */
export function metodText(metod: string | null | undefined, finansbolag?: string | null): string {
  if (!metod) return "–";
  if (metod === "Financed") return finansbolag ? `Finansierad av ${finansbolag}` : "Finansierad";
  return METOD[metod] ?? metod;
}

/** Faktureringens märke: "Intern · Månadsvis · 15 dagar", "Finansierad · Novo" (Inkios InvoicingBadge). */
export function faktureringsText(f: { type?: string | null; financing_company?: string | null; schedule?: string | null; payment_terms_days?: number | null } | null | undefined): string {
  if (!f || !f.type) return "Inte angivet";
  return [
    TYP[f.type] ?? f.type,
    f.type === "Financed" ? f.financing_company : f.schedule ? (SCHEMA[f.schedule] ?? f.schedule) : null,
    f.type === "Internal" && f.payment_terms_days ? `${f.payment_terms_days} dagar` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// -----------------------------------------------------------------------------
// Slutbetald, och stegen
// -----------------------------------------------------------------------------

/**
 * SLUTBETALD — Inkios sista steg: en internt fakturerad order där varje faktura
 * i planen är betald. Det enda som gör en order "betald" i Nav när det kommer
 * från Inkio.
 */
export function slutbetald(f: InkioFakturering | null | undefined): boolean {
  if (!f || f.type !== "Internal") return false;
  const p = f.progress;
  const total = p?.total ?? f.invoices?.length ?? 0;
  const betalda = p?.paid ?? (f.invoices ?? []).filter((r) => r.state === "paid").length;
  return total > 0 && betalda >= total;
}

export type Steglage = "klar" | "nu" | "kvar" | "stopp";
export type Steg = { nyckel: string; text: string; lage: Steglage; detalj: string | null; ton: "vanta" | "fel" | null };

const dag = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null);
/** Inkios namn som de står, utan det lösa "." Inkio sätter efter ett namn utan efternamn ("Zen ."). */
const namn = (n: string | null | undefined) => (n ? n.replace(/\s+\.$/, "").trim() || null : null);
const sammanfoga = (...d: (string | null | undefined)[]) => d.filter(Boolean).join(" · ") || null;

/** Hela dagar sedan `iso`, räknat i UTC-dagar som Inkios `b()`. */
export function dagarSedan(iso: string | null | undefined, nu: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  const d = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.max(Math.round((d(nu) - d(t)) / 864e5), 0);
}
const dagarText = (n: number | null) => (!n ? "i dag" : n === 1 ? "1 dag" : `${n} dagar`);

/**
 * Orderhanteringens steg, som Inkios `h()` i handlingTypes:
 *   finansierad   Ordern är skickad → Skickade till Novo → Godkänd
 *   intern        Ordern är skickad → Upplagd i Fortnox → Fakturerade a/b → Slutbetald
 *   annars        Ordern är skickad → Faktureringen upplagd
 * En makulerad order (Avbruten, Stoppa faktureringen) stannar på steget den var på.
 * Datumen är ISO-dagar (YYYY-MM-DD); kortet skriver dem på svenska.
 */
export function hanteringsSteg(e: InkioHantering, nu: Date = new Date()): Steg[] {
  const fakt = e.facts?.invoicing ?? null;
  const typAvMetod = e.invoicing ? e.invoicing : e.method === "Financed" ? "Financed" : e.method ? "Internal" : null;
  const typ = fakt?.type ?? typAvMetod ?? (e.status === "Awaiting Financier" ? "Financed" : null);
  const skickad: Steg = {
    nyckel: "skickad",
    text: "Ordern är skickad",
    lage: "klar",
    detalj: sammanfoga(dag(e.facts?.order?.order_date ?? e.order_date), namn(e.sales_person_name)),
    ton: null,
  };
  const hanterad = e.handled_at ? sammanfoga(namn(e.handled_by_name), dag(e.handled_at)) : null;
  let steg: Steg[];

  if (typ === "Financed") {
    const bolag = e.financing_company || e.order_financier || null;
    const hos = e.status === "Awaiting Financier";
    const klar = e.status === "Done";
    steg = [
      skickad,
      {
        nyckel: "finansbolag",
        text: bolag ? `Skickade till ${bolag}` : "Skickad till finansbolaget",
        lage: hos || klar ? "klar" : "nu",
        detalj: e.sent_to_financier_at ? sammanfoga(namn(e.sent_to_financier_by_name), dag(e.sent_to_financier_at)) : e.status === "Pending" ? "Ekonomi skickar den" : null,
        ton: null,
      },
      {
        nyckel: "godkand",
        text: "Godkänd",
        lage: klar ? "klar" : hos ? "nu" : "kvar",
        detalj: klar ? hanterad : hos ? `Väntar på deras svar · ${dagarText(dagarSedan(e.sent_to_financier_at, nu))}` : null,
        ton: hos ? "vanta" : null,
      },
    ];
  } else if (typ === "Internal" && fakt) {
    const p = fakt.progress;
    const total = p?.total ?? fakt.invoices?.length ?? 0;
    const fakturerade = p?.invoiced ?? 0;
    const betalda = p?.paid ?? 0;
    const klar = e.status === "Done";
    const alla = total > 0 && fakturerade >= total;
    const fel = (p?.overdue ?? 0) > 0 || (p?.missing ?? 0) > 0;
    steg = [
      skickad,
      { nyckel: "fortnox", text: "Upplagd i Fortnox", lage: klar ? "klar" : "nu", detalj: klar ? sammanfoga(metodText(e.method), hanterad) : "Ekonomi lägger upp den", ton: null },
      {
        nyckel: "fakturerad",
        text: total ? `Fakturerade ${fakturerade}/${total}` : "Fakturerad",
        lage: alla ? "klar" : klar || fakturerade > 0 ? "nu" : "kvar",
        detalj: p?.next ? `Nästa ${p.next.invoice_date}` : null,
        ton: fel ? "fel" : null,
      },
      {
        nyckel: "betald",
        text: "Slutbetald",
        lage: total > 0 && betalda >= total ? "klar" : alla ? "nu" : "kvar",
        detalj: total ? `${betalda} av ${total} betalda` : null,
        ton: alla && (p?.overdue ?? 0) > 0 ? "fel" : null,
      },
    ];
  } else {
    steg = [
      skickad,
      { nyckel: "hanterad", text: "Faktureringen upplagd", lage: e.status === "Done" ? "klar" : "nu", detalj: e.status === "Done" ? sammanfoga(metodText(e.method, e.financing_company), hanterad) : null, ton: null },
    ];
  }

  if (e.status === "Cancelled" || e.status === "Needs Undo") {
    const i = steg.findIndex((s) => s.lage === "nu");
    const vid = i === -1 ? steg.length - 1 : i;
    const skal = e.order_cancelled_at ? `Ordern makulerades ${dag(e.order_cancelled_at)}` : "Ordern har makulerats";
    steg = steg.map((s, n): Steg => (n < vid ? s : n === vid ? { ...s, lage: "stopp", detalj: skal, ton: "fel" } : { ...s, lage: "kvar", detalj: null, ton: null }));
  }
  return steg;
}

/** Löpraden under märket: "0 av 4 fakturerade · 0 betalda · 1 hittades inte i Fortnox" (Inkios `ut`). */
export function lopText(f: InkioFakturering | null | undefined): string | null {
  const p = f?.progress;
  if (!p || !p.total) return null;
  const delar = [f!.matching ? `${p.invoiced ?? 0} av ${p.total} fakturerade` : p.total === 1 ? "1 faktura" : `${p.total} fakturor`];
  if (f!.matching) delar.push(`${p.paid ?? 0} betalda`);
  if (f!.matching && p.overdue) delar.push(`${p.overdue} försenad`);
  if (f!.matching && p.missing) delar.push(`${p.missing} hittades inte i Fortnox`);
  return delar.join(" · ");
}

// -----------------------------------------------------------------------------
// Det kortet får
// -----------------------------------------------------------------------------

export type Orderekonomi = {
  order: {
    nummer: string | null;
    lank: string | null;
    status: { kod: string | null; text: string; ton: Ton };
    leveransdag: string | null;
    orderdag: string | null;
    fakturamejl: string | null;
    fakturakontakt: string | null;
  };
  /** Faktureringen på ordern. `typ` null = inte vald än i Inkio. */
  fakturering: {
    typ: string | null;
    text: string;
    ton: Ton;
    finansbolag: string | null;
    schema: string | null;
    betalningsvillkor: number | null;
    varde: number | null;
    manader: number | null;
    start: string | null;
    slut: string | null;
    valuta: string;
    plan: { nr: number; datum: string; forfaller: string | null; belopp: number; lage: string | null; text: string; ton: Ton; faktura: string | null; betaldDen: string | null }[];
    utanforPlan: { id: string; nummer: string | null; datum: string | null; belopp: number | null; status: { text: string; ton: Ton } }[];
    stammer: boolean;
    lop: { totalt: number; fakturerade: number; betalda: number; forfallna: number; saknas: number; krediterade: number; nasta: { datum: string; belopp: number } | null } | null;
    lopText: string | null;
    slutbetald: boolean;
  } | null;
  /** Orderhanteringen (ekonomins kö). null = ordern har inte nått ekonomi. */
  hantering: {
    nummer: string | null;
    lank: string | null;
    status: { kod: string | null; text: string; ton: Ton };
    /** Märket som på Inkios order: "Väntar på ekonomi", eller metoden när den är klar. */
    marke: string;
    metod: string | null;
    finansbolag: string | null;
    fortnoxReferens: string | null;
    notering: string | null;
    steg: Steg[];
  } | null;
  /** Finansbolagets utbetalning — bara för en finansierad order som ekonomi hanterat. */
  utbetalning: { lage: "registrerad" | "vantar"; finansbolag: string | null; datum: string | null; belopp: number | null; referens: string | null; sedan: string | null; dagar: number | null } | null;
  avtal: {
    id: string;
    nummer: string | null;
    lank: string | null;
    status: { kod: string | null; text: string; ton: Ton };
    tjanster: string[];
    start: string | null;
    slut: string | null;
    nastaFaktura: string | null;
    faktureradePerioder: number | null;
    intervall: number | null;
    faktureringSlutar: string | null;
    finansierat: boolean;
    finansbolag: string | null;
    externFakturering: string | null;
    uppsagtDen: string | null;
    avslutatDen: string | null;
    varde: number | null;
    valuta: string;
  }[];
  leverans: {
    nummer: string | null;
    lank: string | null;
    titel: string | null;
    kolumn: string | null;
    tavla: string | null;
    projekt: string | null;
    forfaller: string | null;
    klar: boolean;
    arkiverad: boolean;
    checklista: { klara: number; totalt: number } | null;
    ansvariga: string[];
    /** Kortet ligger på en tavla tjänstekontot inte når. */
    stangt: boolean;
  } | null;
  fakturor: {
    id: string;
    lank: string | null;
    nummer: string | null;
    datum: string | null;
    forfaller: string | null;
    belopp: number | null;
    betalt: number | null;
    betaldDen: string | null;
    status: { text: string; ton: Ton };
    stand: { kod: string; text: string; ton: Ton } | null;
    paminnelser: number;
    senastPaminnelse: string | null;
    slutfaktura: boolean;
    kredit: boolean;
  }[];
  filer: { id: string; titel: string; filnamn: string | null; storlek: number | null; nar: string | null; kategori: string | null; lank: string | null }[];
  samtal: { id: string; nar: string | null; sek: number | null; riktning: string | null; vem: string | null; nummer: string | null; rubrik: string | null }[];
  /** Inkios fakturor speglar Fortnox. Inte kopplat = inga fakturor och inga betalningar att visa. */
  fortnox: { kopplat: boolean; synkad: string | null } | null;
};

export type Ravara = {
  order: InkioOrderhuvud;
  hantering: InkioHantering | null;
  utbetalning: InkioUtbetalning | null;
  avtal: InkioAvtal[];
  kort: InkioKort | null;
  /** Kortet fanns men gick inte att läsa (en tavla tjänstekontot inte är med på). */
  kortStangt: boolean;
  fakturor: InkioFaktura[];
  filer: InkioFil[];
  samtal: InkioSamtal[];
  fortnox?: { connected?: boolean | null; last_successful_sync_at?: string | null } | null;
  /** Inkios adress, för länkarna. */
  bas: string;
  nu?: Date;
};

const tal = (v: unknown): number | null => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
const kod = <T,>(karta: Record<string, T>, k: string | null | undefined, annars: T): T => (k && karta[k]) || annars;

/** Utbetalningens id, vare sig Inkio ger id:t eller hela raden. */
export function utbetalningsId(h: InkioHantering | null | undefined): string | null {
  const p = h?.financing_payout;
  if (!p) return null;
  return typeof p === "string" ? p : (p.id ?? null);
}

export function orderekonomi(r: Ravara): Orderekonomi {
  const o = r.order;
  const nu = r.nu ?? new Date();
  const lank = (vag: string, id: string | null | undefined) => (id ? `${r.bas}/${vag}/${encodeURIComponent(id)}` : null);
  // En äldre order har ingen fakturering på sig, bara orderhanteringens metod. Typen tas då ur
  // metoden, som Inkios `l()` i handlingTypes: Financed = finansierad, en annan metod = intern.
  const metodTyp = (m: string | null | undefined) => (m === "Financed" ? "Financed" : m ? "Internal" : null);
  const hm = r.hantering?.method ?? o.handling?.method ?? null;
  const f: InkioFakturering | null =
    o.invoicing ??
    r.hantering?.facts?.invoicing ??
    (metodTyp(r.hantering?.invoicing ?? hm)
      ? { type: metodTyp(r.hantering?.invoicing ?? hm), financing_company: r.hantering?.financing_company ?? o.handling?.financing_company ?? null, currency: o.currency, invoices: [] }
      : null);
  const valuta = f?.currency || o.currency || "SEK";

  const fakturering: Orderekonomi["fakturering"] = f
    ? {
        typ: f.type ?? null,
        text: faktureringsText(f),
        ton: f.type === "Financed" ? "info" : f.type === "Internal" ? "ok" : "neutral",
        finansbolag: f.financing_company ?? null,
        schema: f.schedule ? (SCHEMA[f.schedule] ?? f.schedule) : null,
        betalningsvillkor: f.payment_terms_days ?? null,
        varde: tal(f.order_value),
        manader: tal(f.term_months),
        start: f.start_date ?? null,
        slut: f.end_date ?? null,
        valuta,
        plan: (f.invoices ?? []).map((p, i) => {
          const l = p.state ? PLANLAGE[p.state] : null;
          return {
            nr: p.idx ?? i + 1,
            datum: p.invoice_date,
            forfaller: p.due_date ?? null,
            belopp: Number(p.amount) || 0,
            lage: p.state ?? null,
            text: l?.text ?? "–",
            ton: l?.ton ?? "neutral",
            faktura: p.fortnox?.invoice_number ?? null,
            betaldDen: p.state === "paid" ? (p.fortnox?.paid_date ?? null) : null,
          };
        }),
        utanforPlan: (f.outside_plan ?? []).map((u) => ({
          id: u.id,
          nummer: u.invoice_number ?? null,
          datum: u.invoice_date ?? null,
          belopp: tal(u.net_amount),
          status: kod(FAKTURASTATUS, u.status, { text: u.status ?? "–", ton: "neutral" as Ton }),
        })),
        stammer: !!f.matching,
        lop: f.progress
          ? {
              totalt: f.progress.total ?? 0,
              fakturerade: f.progress.invoiced ?? 0,
              betalda: f.progress.paid ?? 0,
              forfallna: f.progress.overdue ?? 0,
              saknas: f.progress.missing ?? 0,
              krediterade: f.progress.credited ?? 0,
              nasta: f.progress.next ? { datum: f.progress.next.invoice_date, belopp: f.progress.next.amount } : null,
            }
          : null,
        lopText: lopText(f),
        slutbetald: slutbetald(f),
      }
    : null;

  const h = r.hantering;
  const hk = h?.status ?? o.handling?.status ?? null;
  const hstatus = kod(HANTERING, hk, { text: hk ?? "–", ton: "neutral" as Ton });
  const hantering: Orderekonomi["hantering"] =
    h || o.handling
      ? {
          nummer: h?.number ?? o.handling?.number ?? null,
          lank: lank("invoices/handling", h?.id ?? o.handling?.id),
          status: { kod: hk, ...hstatus },
          marke:
            hk === "Pending"
              ? "Väntar på ekonomi"
              : hk === "Done"
                ? metodText(h?.method ?? o.handling?.method, h?.financing_company ?? o.handling?.financing_company)
                : hstatus.text,
          metod: h?.method ?? o.handling?.method ?? null,
          finansbolag: h?.financing_company || h?.order_financier || o.handling?.financing_company || null,
          fortnoxReferens: h?.fortnox_reference ?? null,
          notering: h?.note?.trim() || null,
          steg: h ? hanteringsSteg(h, nu) : [],
        }
      : null;

  // Utbetalningen: registrerad, eller väntar — en finansierad order som ekonomi är klar med (Inkios get-awaiting).
  const metod = h?.method ?? o.handling?.method ?? null;
  const finansierad = metod === "Financed" || f?.type === "Financed";
  const utbetalning: Orderekonomi["utbetalning"] = r.utbetalning
    ? {
        lage: "registrerad",
        finansbolag: r.utbetalning.financing_company ?? h?.financing_company ?? null,
        datum: r.utbetalning.payout_date ?? null,
        belopp: tal(r.utbetalning.amount),
        referens: r.utbetalning.reference ?? r.utbetalning.payout_reference ?? null,
        sedan: null,
        dagar: null,
      }
    : finansierad && hk === "Done"
      ? {
          lage: "vantar",
          finansbolag: h?.financing_company ?? o.handling?.financing_company ?? f?.financing_company ?? null,
          datum: null,
          belopp: tal(o.total_contract_value),
          referens: null,
          sedan: dag(h?.handled_at ?? o.handling?.handled_at),
          dagar: dagarSedan(h?.handled_at ?? o.handling?.handled_at, nu),
        }
      : null;

  const avtal = r.avtal.map((a) => ({
    id: a.id,
    nummer: a.number ?? null,
    lank: lank("contracts", a.id),
    status: { kod: a.status ?? null, ...kod(AVTALSTATUS, a.status, { text: a.status ?? "–", ton: "neutral" as Ton }) },
    tjanster: a.services ?? [],
    start: a.start_date ?? null,
    slut: a.end_date ?? null,
    nastaFaktura: a.next_billing_date ?? null,
    faktureradePerioder: tal(a.billed_periods),
    intervall: tal(a.billing_interval),
    faktureringSlutar: a.billing_end_date ?? null,
    finansierat: !!a.invoices_financed,
    finansbolag: a.financing_company ?? null,
    externFakturering: a.external_billing_mode ?? null,
    uppsagtDen: a.notice_given_on ?? null,
    avslutatDen: dag(a.terminated_at),
    varde: tal(a.total_contract_value),
    valuta: a.currency || valuta,
  }));

  const k = r.kort;
  const leverans: Orderekonomi["leverans"] =
    k || r.kortStangt || o.production_task_id
      ? {
          nummer: k?.number ?? null,
          lank: lank("tasks", k?.id ?? o.production_task_id),
          titel: k?.title ?? null,
          kolumn: k?.column_title ?? null,
          tavla: k?.board_title ?? null,
          projekt: k?.project_title ?? null,
          forfaller: k?.due_date ?? null,
          klar: !!(k?.completed_at || k?.due_complete),
          arkiverad: !!k?.is_archived,
          checklista: k && k.checklist_total ? { klara: k.checklist_done ?? 0, totalt: k.checklist_total } : null,
          ansvariga: (k?.assignees ?? []).map((a) => namn(a.full_name) ?? "").filter(Boolean),
          stangt: r.kortStangt || (!k && !!o.production_task_id),
        }
      : null;

  const fakturor = r.fakturor.map((x) => {
    const ejSkickad = x.source === "Fortnox" && x.status === "Sent" && x.booked && !x.sent;
    const st = x.stand ? (STAND[x.stand] ?? { text: x.stand, ton: "neutral" as Ton }) : null;
    return {
      id: x.id,
      lank: lank("invoices", x.id),
      nummer: x.invoice_number ?? null,
      datum: x.invoice_date ?? null,
      forfaller: x.due_date ?? null,
      belopp: tal(x.total_amount ?? x.net_amount),
      betalt: tal(x.amount_paid),
      betaldDen: x.paid_date ?? null,
      status: ejSkickad ? { text: "Inte skickat", ton: "warn" as Ton } : kod(FAKTURASTATUS, x.status, { text: x.status ?? "–", ton: "neutral" as Ton }),
      stand: x.stand && st ? { kod: x.stand, text: x.stand_label || st.text, ton: st.ton } : null,
      paminnelser: x.reminders_total ?? 0,
      senastPaminnelse: x.last_reminder_on ?? null,
      slutfaktura: !!x.is_final_invoice,
      kredit: !!x.is_credit_note,
    };
  });

  return {
    order: {
      nummer: o.number ?? null,
      lank: lank("sales-orders", o.id),
      status: { kod: o.status ?? null, ...kod(ORDERSTATUS, o.status, { text: o.status ?? "–", ton: "neutral" as Ton }) },
      leveransdag: o.delivery_date ?? null,
      orderdag: o.order_date ?? null,
      fakturamejl: o.invoice_email ?? null,
      fakturakontakt: o.billing_contact_name ?? null,
    },
    fakturering,
    hantering,
    utbetalning,
    avtal,
    leverans,
    fakturor,
    filer: r.filer.map((x) => ({
      id: x.id,
      titel: x.title || x.file_name || x.number || "Fil",
      filnamn: x.file_name ?? null,
      storlek: tal(x.file_size),
      nar: x.created_at ?? null,
      kategori: x.category_name ?? null,
      lank: x.file_url ? (/^https?:\/\//.test(x.file_url) ? x.file_url : `${r.bas}${x.file_url.startsWith("/") ? "" : "/"}${x.file_url}`) : null,
    })),
    samtal: r.samtal.map((c) => ({
      id: c.id,
      nar: c.started_at ?? null,
      sek: tal(c.duration_seconds),
      riktning: c.direction ?? null,
      vem: namn(typeof c.our_user === "string" ? c.our_user : c.our_user?.full_name),
      nummer: c.their_number ?? null,
      rubrik: c.headline ?? null,
    })),
    fortnox: r.fortnox ? { kopplat: !!r.fortnox.connected, synkad: r.fortnox.last_successful_sync_at ?? null } : null,
  };
}

/** "Novos", "Kronans": ett namn på s, x eller z får inget s till. */
export const genitiv = (namn: string) => (/[sxz]$/i.test(namn) ? namn : `${namn}s`);

/**
 * Kortets märke i huvudet (rutan "Ekonomi" bredvid Inkio och Säljsamtal), i
 * den ordning Inkio själv lyfter det: något förfallet först, sedan var ordern
 * står i ekonomins kö, sedan betalningarna.
 */
export function ekonomiMarke(e: Orderekonomi): { text: string; ton: Ton } {
  const f = e.fakturering;
  const lop = f?.lop;
  const indriven = e.fakturor.find((x) => x.stand?.kod === "kfm") ?? e.fakturor.find((x) => x.stand?.kod === "inkasso");
  if (indriven?.stand) return { text: indriven.stand.text.toLowerCase(), ton: "danger" };
  if (lop && lop.forfallna) return { text: `${lop.forfallna} försenad`, ton: "danger" };
  if (e.order.status.kod === "Cancelled" || e.hantering?.status.kod === "Cancelled") return { text: "avbruten i Inkio", ton: "neutral" };
  if (e.hantering?.status.kod === "Needs Undo") return { text: "stoppa faktureringen", ton: "danger" };
  if (f?.slutbetald) return { text: "slutbetald", ton: "ok" };
  if (e.hantering?.status.kod === "Pending") return { text: "väntar på ekonomi", ton: "warn" };
  if (e.hantering?.status.kod === "Awaiting Financier") return { text: `hos ${e.hantering.finansbolag || "finansbolaget"}`, ton: "signal" };
  if (e.utbetalning?.lage === "vantar") return { text: e.utbetalning.finansbolag ? `väntar på ${genitiv(e.utbetalning.finansbolag)} utbetalning` : "väntar på utbetalningen", ton: "signal" };
  if (e.utbetalning?.lage === "registrerad") return { text: `utbetald${e.utbetalning.finansbolag ? ` av ${e.utbetalning.finansbolag}` : ""}`, ton: "ok" };
  if (lop && lop.totalt && f?.stammer) return { text: `${lop.betalda} av ${lop.totalt} betalda`, ton: lop.saknas ? "warn" : lop.betalda ? "ok" : "neutral" };
  if (f && !f.typ) return { text: "fakturering inte vald", ton: "warn" };
  if (!e.hantering) return { text: "inte hos ekonomi", ton: "neutral" };
  return { text: e.hantering.marke.toLowerCase(), ton: "ok" };
}
