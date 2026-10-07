import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { las } from "@/lib/lagring-server";
import { tolkaLager } from "@/lib/lagring";
import { siteUrl } from "@/lib/env";
import { adapter, type Crmorder, type Crmstatus } from "./adapter";

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
  note: string | null;
  status: string;
  approved_at: string | null;
  approved_by: string | null;
  salesperson_id: string;
  cancel_reason: string | null;
};

const FALT =
  "id, company_name, org_number, contact_name, contact_phone, contact_phone_e164, contact_email, package_id, " +
  "term_months, signed_on, starts_on, monthly_amount, buyout_amount, note, status, approved_at, approved_by, " +
  "salesperson_id, cancel_reason";

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

async function underlag(o: Orderrad): Promise<Crmorder> {
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
    underlag: {
      navId: o.id,
      signerad: o.signed_on,
      startar: o.starts_on,
      manadsbelopp: tal(o.monthly_amount),
      bindningManader: o.term_months,
      paketnamn: (paket?.label as string | undefined) ?? `Paket ${o.package_id}`,
      utkop: tal(o.buyout_amount),
      anteckning: o.note,
      navlank: `${siteUrl().replace(/\/+$/, "")}/order?kund=${o.id}`,
      tjanster: ((tjanster ?? []) as { name: string; billing: "manad" | "engang"; amount: number | string; term_months: number | null }[]).map(
        (t) => ({ namn: t.name, fakturering: t.billing, belopp: tal(t.amount) ?? 0, manader: t.term_months }),
      ),
    },
    bevis: await bevis(o.id),
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

/** Leveransens kund-ID: den manuella kopplingen, annars den Inkio-synken skrev. */
export async function crmKundId(orderId: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data: d } = await db.from("delivery").select("crm_external_id").eq("order_id", orderId).maybeSingle();
  if (d?.crm_external_id) return d.crm_external_id as string;
  const { data: k } = await db.from("crm_order").select("customer_id").eq("order_id", orderId).maybeSingle();
  return (k?.customer_id as string | null) ?? null;
}

export type { Crmstatus };
