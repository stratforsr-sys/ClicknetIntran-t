import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { las } from "@/lib/lagring-server";
import { tolkaLager } from "@/lib/lagring";
import { siteUrl } from "@/lib/env";
import { adapter, type Crmorder, type Crmstatus } from "./adapter";
import { kr, leveransrad, orderadress, type Leveranshandelse } from "./inkio-mappning";
import { andraAnteckning, inkioFarSkriva, inkioKund, inkioOrder, rattaIInkio, skrivAnteckning, skrivPaOrder, taBortAnteckning } from "./inkio";
import { kaAnteckning } from "./inflode-server";

/**
 * Nav-sidan av CRM-synken: läser ordern, anropar adaptern och skriver vad den
 * blev. Anropas bara från utkorgen (`crm()` i utkorg-server.ts) — aldrig
 * direkt från en action, så att ett godkännande aldrig väntar på Inkio.
 *
 * Varje funktion KASTAR vid fel. Utkorgen försöker då igen, och efter tre
 * försök får admin en notis. Felet står också på kopplingen (`crm_order`), så
 * att det syns på ordern i Nav och inte bara i en notis.
 */

type Orderrad = {
  id: string;
  company_name: string;
  org_number: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_phone_e164: string | null;
  contact_email: string | null;
  package_id: number;
  term_months: number;
  signed_on: string;
  starts_on: string | null;
  monthly_amount: number | string | null;
  buyout_amount: number | string | null;
  finance_amount: number | string | null;
  financed: boolean | null;
  note: string | null;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  salesperson_id: string;
  cancel_reason: string | null;
  customer_street: string | null;
  customer_postal_code: string | null;
  customer_city: string | null;
};

const FALT =
  "id, company_name, org_number, contact_name, contact_phone, contact_phone_e164, contact_email, package_id, " +
  "term_months, signed_on, starts_on, monthly_amount, buyout_amount, finance_amount, financed, note, status, approved_at, approved_by, " +
  "salesperson_id, cancel_reason, customer_street, customer_postal_code, customer_city";

function tal(v: number | string | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function logga(body: Record<string, unknown>) {
  await supabaseAdmin().from("integration_log").insert({ system: "crm", direction: "ut", body });
}

async function sparaFel(orderId: string, fel: string) {
  // Kopplingens id:n lämnas orörda om de redan finns — ett misslyckat försök
  // att makulera gör inte ordern okopplad.
  const db = supabaseAdmin();
  const { data: finns } = await db.from("crm_order").select("order_id").eq("order_id", orderId).maybeSingle();
  if (finns) {
    await db.from("crm_order").update({ state: "fel", error: fel.slice(0, 500), synced_at: new Date().toISOString() }).eq("order_id", orderId);
  } else {
    await db.from("crm_order").insert({ order_id: orderId, state: "fel", error: fel.slice(0, 500) });
  }
}

/** Det kunden sa ja i: en uppladdad avtalsbilaga i första hand, annars samtalet. */
async function bevis(orderId: string): Promise<Crmorder["bevis"]> {
  const { data } = await supabaseAdmin()
    .from("file_object")
    .select("store, bucket, path, purpose, filename, mime_type, uploaded_at")
    .eq("sales_order_id", orderId)
    .in("purpose", ["sales_order", "call_recording"])
    .is("removed_at", null)
    .order("uploaded_at", { ascending: false });

  const filer = (data ?? []) as { store: string; bucket: string; path: string; purpose: string; filename: string | null; mime_type: string | null }[];
  const fil = filer.find((f) => f.purpose === "sales_order") ?? filer.find((f) => f.purpose === "call_recording");
  if (!fil) return null;

  const innehall = await las({ lager: tolkaLager(fil.store), bucket: fil.bucket, path: fil.path });
  if (!innehall) return null;

  const typ = fil.mime_type || "application/octet-stream";
  const filnamn = fil.filename || (fil.purpose === "call_recording" ? "samtal.mp3" : "avtal.pdf");
  return { filnamn, typ, data: innehall };
}

async function underlag(o: Orderrad, medBevis = true): Promise<Crmorder> {
  const db = supabaseAdmin();
  const [{ data: saljare }, { data: godkannare }, { data: paket }, { data: tjanster }] = await Promise.all([
    db.from("employee").select("email").eq("id", o.salesperson_id).maybeSingle(),
    o.approved_by
      ? db.from("employee").select("first_name, last_name").eq("id", o.approved_by).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("sales_package").select("label").eq("id", o.package_id).maybeSingle(),
    db.from("sales_order_service").select("name, billing, amount, term_months, sort").eq("order_id", o.id).order("sort"),
  ]);

  return {
    bolag: o.company_name,
    orgnr: o.org_number ?? "",
    kontakt: o.contact_name,
    telefon: o.contact_phone_e164 || o.contact_phone,
    epost: o.contact_email,
    saljarEpost: (saljare?.email as string | undefined) ?? null,
    godkandAv: godkannare ? `${godkannare.first_name} ${godkannare.last_name}`.trim() : null,
    godkandDag: o.approved_at ? o.approved_at.slice(0, 10) : null,
    adress: orderadress(o.customer_street, o.customer_postal_code, o.customer_city),
    underlag: {
      navId: o.id,
      signerad: o.signed_on,
      startar: o.starts_on,
      manadsbelopp: tal(o.monthly_amount),
      bindningManader: o.term_months,
      paketnamn: (paket?.label as string | undefined) ?? `Paket ${o.package_id}`,
      utkop: tal(o.buyout_amount),
      finans: tal(o.finance_amount),
      finansierad: o.financed === true,
      anteckning: o.note,
      navlank: `${siteUrl().replace(/\/+$/, "")}/order?kund=${o.id}`,
      tjanster: ((tjanster ?? []) as { name: string; billing: "manad" | "engang"; amount: number | string; term_months: number | null }[]).map(
        (t) => ({ namn: t.name, fakturering: t.billing, belopp: tal(t.amount) ?? 0, manader: t.term_months }),
      ),
    },
    bevis: medBevis ? await bevis(o.id) : null,
  };
}

/** En godkänd order → Inkio. */
export async function skapaICrm(orderId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data } = await db.from("sales_order").select(FALT).eq("id", orderId).maybeSingle();
  const o = data as unknown as Orderrad | null;
  if (!o) return false;
  // Makulerad innan raden hann skickas: det finns inget att lägga in.
  if (o.status !== "signerad" && o.status !== "betald") return false;

  const { data: koppling } = await db.from("crm_order").select("crm_order_id, state").eq("order_id", orderId).maybeSingle();
  if (koppling?.crm_order_id && koppling.state !== "fel") return false;

  const a = adapter();
  const crmorder = await underlag(o);
  await logga({
    system: a.namn,
    handling: "skapa",
    order_id: orderId,
    orgnr: crmorder.orgnr,
    bevis: crmorder.bevis ? { filnamn: crmorder.bevis.filnamn, byte: crmorder.bevis.data.byteLength } : null,
  });

  try {
    const k = await a.skapa(crmorder);
    if (!k) return false;

    await db.from("crm_order").upsert({
      order_id: orderId,
      system: "inkio",
      customer_id: k.kundId,
      customer_number: k.kundnummer,
      crm_order_id: k.orderId,
      crm_order_number: k.ordernummer,
      state: k.lage,
      error: null,
      synced_at: new Date().toISOString(),
    });

    // Leveranskalenderns CRM-ruta: kunden är kopplad, ingen ska klistra in något.
    await db
      .from("delivery")
      .update({ crm_system: "inkio", crm_external_id: k.kundId, crm_synced_at: new Date().toISOString(), crm_attempts: 0, crm_error: null })
      .eq("order_id", orderId);

    await logga({ system: a.namn, handling: "skapad", order_id: orderId, ...k });
    return true;
  } catch (e) {
    const fel = e instanceof Error ? e.message : String(e);
    await sparaFel(orderId, fel);
    throw new Error(fel);
  }
}

/** En makulerad order → makulerad i Inkio. */
export async function makuleraICrm(orderId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: k } = await db.from("crm_order").select("crm_order_id, state").eq("order_id", orderId).maybeSingle();
  // Aldrig inlagd: inget att makulera.
  if (!k?.crm_order_id || k.state === "makulerad") return false;

  const { data: o } = await db.from("sales_order").select("cancel_reason").eq("id", orderId).maybeSingle();
  const a = adapter();
  await logga({ system: a.namn, handling: "makulera", order_id: orderId, crm_order_id: k.crm_order_id });

  try {
    const utfall = await a.makulera(k.crm_order_id as string, (o?.cancel_reason as string | null) ?? null);
    await db
      .from("crm_order")
      .update({ state: "makulerad", error: null, synced_at: new Date().toISOString(), ...(utfall === "borta" ? { crm_order_id: null } : {}) })
      .eq("order_id", orderId);
    return true;
  } catch (e) {
    const fel = e instanceof Error ? e.message : String(e);
    await sparaFel(orderId, fel);
    throw new Error(fel);
  }
}

/**
 * Ett leveranssteg → en rad på kundens tidslinje (0075).
 *
 * Raden skrevs av triggern `calendar_event_till_crm` 15 sekunder bakåt i tiden.
 * Händelsen läses OM här: ångrades handlingen under tiden stämmer den inte
 * längre med raden, och då går ingenting ut.
 */
export async function leveransICrm(p: Record<string, unknown>): Promise<boolean> {
  const db = supabaseAdmin();
  const orderId = String(p.order_id ?? "");
  const handelse = String(p.handelse ?? "") as Leveranshandelse;

  const { data: e } = await db
    .from("calendar_event")
    .select("id, step, outcome, outcome_by, cancelled_at, starts_at, organizer_id, attempt")
    .eq("id", String(p.event_id ?? ""))
    .maybeSingle();
  if (!e) return false;

  const stammer =
    handelse === "bokad"
      ? !e.cancelled_at
      : handelse === "installd"
        ? !!e.cancelled_at
        : handelse === "flyttad"
          ? !e.cancelled_at && Date.parse(String(e.starts_at)) === Date.parse(String(p.starts_at))
          : e.outcome === handelse;
  if (!stammer) return false;

  const { data: k } = await db.from("crm_order").select("customer_id, state").eq("order_id", orderId).maybeSingle();
  // Ingen koppling: ordern gick aldrig till Inkio (lagd före 0074 eller för
  // en preview). Inget att skriva.
  if (!k) return false;
  if (!k.customer_id) {
    throw new Error("Kunden finns inte i Inkio än — ordern gick inte att lägga in. Se ordern i Nav och tryck Försök igen.");
  }

  const vemId = handelse === "genomford" ? (e.outcome_by as string | null) ?? (e.organizer_id as string) : (e.organizer_id as string);
  const { data: vem } = await db.from("employee").select("first_name, last_name").eq("id", vemId).maybeSingle();
  const text = leveransrad({
    steg: (e.step as string | null) ?? null,
    handelse,
    startar: String(e.starts_at),
    vem: vem ? `${vem.first_name} ${vem.last_name}`.trim() : null,
    forsok: Number(e.attempt ?? 1),
  });

  const a = adapter();
  await logga({ system: a.namn, handling: "leverans", order_id: orderId, event_id: e.id, handelse, text });
  await a.tidslinje(String(k.customer_id), text);
  return true;
}

/** Leveransens kund-ID: den manuella kopplingen, annars den Inkio-synken skrev. */
export async function crmKundId(orderId: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data: d } = await db.from("delivery").select("crm_external_id").eq("order_id", orderId).maybeSingle();
  if (d?.crm_external_id) return d.crm_external_id as string;
  const { data: k } = await db.from("crm_order").select("customer_id").eq("order_id", orderId).maybeSingle();
  return (k?.customer_id as string | null) ?? null;
}

export type { Crmstatus };

// -----------------------------------------------------------------------------
// Allt i Nav ut till Inkio (0277)
// -----------------------------------------------------------------------------

async function vemGjorde(orderId: string, action: string): Promise<{ namn: string | null; meta: Record<string, unknown> }> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("audit_log")
    .select("actor_id, meta")
    .eq("object_type", "sales_order")
    .eq("object_id", orderId)
    .eq("action", action)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { namn: null, meta: {} };
  const { data: e } = data.actor_id
    ? await db.from("employee").select("first_name, last_name").eq("id", data.actor_id).maybeSingle()
    : { data: null };
  return { namn: e ? `${e.first_name} ${e.last_name}`.trim() : null, meta: (data.meta ?? {}) as Record<string, unknown> };
}

/**
 * En anteckning från kundkortet → kunden i Inkio. Den står redan i Nav
 * (`kundanteckning`); här skrivs den dit och får Inkios id, så att ekot som
 * bevakningen läser tillbaka inte visas två gånger.
 *
 * Ett andra försök får inte skriva den två gånger: har bevakningen redan sett
 * texten från tjänstekontot (svaret kom aldrig fram, men anteckningen gjorde
 * det) tas den raden i stället.
 *
 * En borttagen anteckning skrivs aldrig dit (0283). Ändras eller tas den bort
 * medan den är på väg köas ändringen efteråt, så att Inkio inte står kvar med
 * den gamla texten.
 */
export async function anteckningICrm(id: string): Promise<boolean> {
  const db = supabaseAdmin();
  // `*`: `om_order` (0278) och `raderad_at` (0283) finns först när migrationerna körts.
  const { data: a } = await db.from("kundanteckning").select("*").eq("id", id).maybeSingle();
  if (!a || a.crm_id || a.raderad_at) return false;
  const { data: inst } = await db.from("crm_installning").select("aktiv, utflode").eq("id", true).maybeSingle();
  if (!inst?.aktiv || !inst.utflode || !inkioFarSkriva()) return false;

  const innehall = `**${a.skriven_namn}** (via Nav): ${a.text}`;
  const { data: redan } = await db
    .from("crm_handelse")
    .select("extern_id")
    .eq("org_number", a.org_number)
    .eq("fran_nav", true)
    .eq("text", innehall)
    .gte("skapad", a.skriven_at)
    .limit(1)
    .maybeSingle();
  if (redan) {
    await db.from("kundanteckning").update({ crm_id: redan.extern_id, crm_state: "skickad", crm_fel: null }).eq("id", id);
    return false;
  }

  const { data: k } = await db.from("crm_kund").select("customer_id").eq("org_number", a.org_number).maybeSingle();
  const kundId = (k?.customer_id as string | null) ?? (await inkioKund(a.org_number))?.id ?? null;
  if (!kundId) {
    // Bevakningen köar den igen den dag kunden finns i Inkio.
    await db.from("kundanteckning").update({ crm_state: "ingen-kund" }).eq("id", id);
    return false;
  }

  // Gäller den en order som finns i Inkio skrivs den där, annars på kunden.
  const omOrder = (a as { om_order?: string | null }).om_order ?? null;
  const { data: o } = omOrder ? await db.from("crm_order").select("crm_order_id, state").eq("order_id", omOrder).maybeSingle() : { data: null };
  const paOrder = o?.crm_order_id && o.state !== "makulerad" ? (o.crm_order_id as string) : null;

  await logga({ system: "inkio", handling: "anteckning", anteckning: id, org: a.org_number, ...(paOrder ? { crm_order_id: paOrder } : {}) });
  try {
    const crmId = await skrivAnteckning(paOrder ? "Sales Order" : "Customer", paOrder ?? kundId, a.text, a.skriven_namn);
    await db.from("kundanteckning").update({ crm_id: crmId, crm_state: "skickad", crm_fel: null }).eq("id", id);
    const { data: nu } = await db.from("kundanteckning").select("*").eq("id", id).maybeSingle();
    if (crmId && nu?.raderad_at) await kaAnteckning(id, 0, "anteckning-borttagen");
    else if (crmId && nu && nu.text !== a.text) await kaAnteckning(id, 0, "anteckning-andrad");
    return true;
  } catch (e) {
    const fel = e instanceof Error ? e.message : String(e);
    await db.from("kundanteckning").update({ crm_state: "fel", crm_fel: fel.slice(0, 500) }).eq("id", id);
    throw new Error(fel);
  }
}

/**
 * En ändrad anteckning → samma anteckning i Inkio (0283), med den text som
 * gäller nu. Står den inte i Inkio än gör den inget: `anteckningICrm` skriver
 * den nya texten när den skrivs dit.
 */
export async function anteckningAndradICrm(id: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: a } = await db.from("kundanteckning").select("*").eq("id", id).maybeSingle();
  if (!a || !a.crm_id || a.raderad_at) return false;
  const { data: inst } = await db.from("crm_installning").select("aktiv, utflode").eq("id", true).maybeSingle();
  if (!inst?.aktiv || !inst.utflode || !inkioFarSkriva()) return false;
  await logga({ system: "inkio", handling: "anteckning-andrad", anteckning: id, org: a.org_number, crm_id: a.crm_id });
  await andraAnteckning(String(a.crm_id), String(a.text), String(a.skriven_namn));
  return true;
}

/** En borttagen anteckning → borttagen i Inkio också (0283). Stod den aldrig där finns inget att ta bort. */
export async function anteckningBorttagenICrm(id: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: a } = await db.from("kundanteckning").select("*").eq("id", id).maybeSingle();
  if (!a || !a.crm_id || !a.raderad_at) return false;
  const { data: inst } = await db.from("crm_installning").select("aktiv, utflode").eq("id", true).maybeSingle();
  if (!inst?.aktiv || !inst.utflode || !inkioFarSkriva()) return false;
  await logga({ system: "inkio", handling: "anteckning-borttagen", anteckning: id, org: a.org_number, crm_id: a.crm_id });
  await taBortAnteckning(String(a.crm_id));
  return true;
}

/**
 * Det som hänt med en order i Nav → en rad i Inkio (triggrarna i 0277).
 *
 * Raden skrivs på ORDERN i Inkio när den är kopplad och inte makulerad, annars
 * på kunden. Texten byggs nu, inte när triggern körde, så att den säger det
 * som gäller. Provision står aldrig i Inkio: EffektivMedias personal ser det.
 */
export async function navHandelseICrm(p: Record<string, unknown>): Promise<boolean> {
  const db = supabaseAdmin();
  const typ = String(p.typ ?? "");
  if (!inkioFarSkriva()) return false;
  const a = adapter();

  if (typ === "sida-nere" || typ === "sida-uppe") {
    const org = String(p.org ?? "");
    const { data: k } = await db.from("crm_kund").select("customer_id").eq("org_number", org).maybeSingle();
    if (!k?.customer_id) return false;
    const { data: r } = await db.from("landing_page_report").select("reported_by").eq("id", String(p.id ?? "")).maybeSingle();
    const { data: e } = r?.reported_by ? await db.from("employee").select("first_name, last_name").eq("id", r.reported_by).maybeSingle() : { data: null };
    const vem = e ? `${e.first_name} ${e.last_name}`.trim() : null;
    const text = typ === "sida-nere" ? `Kampanjsidan svarar inte — anmält i Clicknet Nav${vem ? ` av ${vem}` : ""}.` : "Kampanjsidan svarar igen (kontrollerad av Clicknet Nav).";
    await logga({ system: a.namn, handling: "nav-handelse", typ, org, text });
    await a.tidslinje(String(k.customer_id), text);
    return true;
  }

  const orderId = String(p.order_id ?? "");
  const { data: k } = await db.from("crm_order").select("customer_id, crm_order_id, crm_order_number, kopplad, state").eq("order_id", orderId).maybeSingle();
  if (!k?.customer_id) return false;
  const { data } = await db.from("sales_order").select(FALT + ", order_value, renewal_outcome, renewal_reason").eq("id", orderId).maybeSingle();
  const o = data as unknown as (Orderrad & { order_value: number | string | null; renewal_outcome: string | null; renewal_reason: string | null }) | null;
  if (!o) return false;

  let text: string | null = null;
  if (typ === "betald") {
    if (o.status !== "betald") return false;
    const { namn } = await vemGjorde(orderId, "sales_order.paid");
    text = `Markerad betald i Clicknet Nav${namn ? ` av ${namn}` : ""}.`;
  } else if (typ === "rattad") {
    return rattaICrm(orderId, o, k as { customer_id: string; crm_order_id: string | null; kopplad: string; state: string });
  } else if (typ === "forlangning") {
    if (o.renewal_outcome === "avslutad") text = `Förlänger inte (Clicknet Nav)${o.renewal_reason ? `: ${o.renewal_reason}` : "."}`;
    else if (o.renewal_outcome === "forlangd") text = "Avtalet är förlängt med en ny order i Clicknet Nav.";
    else text = "Avtalet bevakas igen i Clicknet Nav (förlängningen är inte avgjord).";
  } else if (typ === "bilaga") {
    const { data: f } = await db.from("file_object").select("filename, uploaded_by, removed_at").eq("id", String(p.id ?? "")).maybeSingle();
    if (!f || f.removed_at) return false;
    const { data: e } = f.uploaded_by ? await db.from("employee").select("first_name, last_name").eq("id", f.uploaded_by).maybeSingle() : { data: null };
    text = `Ny bilaga i Clicknet Nav: ${f.filename ?? "fil"}${e ? ` (${`${e.first_name} ${e.last_name}`.trim()})` : ""}. Den finns på ordern i Nav.`;
  } else if (typ === "samtal") {
    const { data: c } = await db.from("phone_call").select("started_at, duration_seconds").eq("id", String(p.id ?? "")).maybeSingle();
    if (!c) return false;
    const min = c.duration_seconds ? Math.round(Number(c.duration_seconds) / 60) : null;
    text = `Säljsamtalet är kopplat i Clicknet Nav${c.started_at ? ` (${String(c.started_at).slice(0, 10)}${min !== null ? `, ${min} min` : ""})` : ""}.`;
  } else {
    throw new Error(`Okänd händelse till Inkio: ${typ}`);
  }

  await logga({ system: a.namn, handling: "nav-handelse", typ, order_id: orderId, text });
  if (k.crm_order_id && k.state !== "makulerad") await skrivPaOrder(String(k.crm_order_id), text);
  else await a.tidslinje(String(k.customer_id), text);
  return true;
}

/**
 * En rättad order. Lade Nav själv ordern i Inkio, och den är inskickad där,
 * rättas den med Inkios egen rättning — rader, värde, längd och fakturering
 * blir det Nav nu säger, och skälet står i Inkios historik. En importerad
 * order (kopplad på organisationsnummer) har rader Nav inte känner: den får en
 * rad om vad som ändrats, och den som sköter Inkio rättar.
 */
async function rattaICrm(
  orderId: string,
  o: Orderrad & { order_value: number | string | null },
  k: { customer_id: string; crm_order_id: string | null; kopplad: string; state: string },
): Promise<boolean> {
  const db = supabaseAdmin();
  if (o.status !== "signerad" && o.status !== "betald") return false;
  const { data: inst } = await db.from("crm_installning").select("ratta_i_inkio").eq("id", true).maybeSingle();
  const { namn, meta } = await vemGjorde(orderId, "sales_order.corrected");
  const skal = typeof meta.skal === "string" && meta.skal.trim() ? meta.skal.trim() : "Rättad i Clicknet Nav.";
  const { data: paket } = await db.from("sales_package").select("label").eq("id", o.package_id).maybeSingle();
  const nu = [
    (paket?.label as string | undefined) ?? `Paket ${o.package_id}`,
    tal(o.monthly_amount) !== null ? `${kr(tal(o.monthly_amount)!)}/mån` : null,
    `${o.term_months} mån`,
    tal(o.order_value) !== null ? `ordervärde ${kr(tal(o.order_value)!)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const a = adapter();

  if (inst?.ratta_i_inkio && k.kopplad === "nav" && k.crm_order_id) {
    const iInkio = await inkioOrder(k.crm_order_id);
    if (iInkio && iInkio.state === "submitted" && iInkio.external_order_id === orderId) {
      await logga({ system: a.namn, handling: "ratta", order_id: orderId, crm_order_id: k.crm_order_id, skal });
      await rattaIInkio(k.crm_order_id, await underlag(o, false), `${skal}${namn ? ` (${namn}, Clicknet Nav)` : " (Clicknet Nav)"}`);
      return true;
    }
  }

  const text = `Rättad i Clicknet Nav${namn ? ` av ${namn}` : ""}: ${skal} Nu: ${nu}.`;
  await logga({ system: a.namn, handling: "nav-handelse", typ: "rattad", order_id: orderId, text });
  if (k.crm_order_id && k.state !== "makulerad") await skrivPaOrder(k.crm_order_id, text);
  else await a.tidslinje(k.customer_id, text);
  return true;
}
