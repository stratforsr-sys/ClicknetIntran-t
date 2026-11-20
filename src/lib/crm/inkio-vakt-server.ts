import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { medRoll, notifieraFlera } from "@/lib/notishandelse-server";
import { inkioKonfigurerad, inkioSaljarEpost } from "./inkio";
import { attLarma, orderlarm, saknasIInkio, saljarlarm, saljarnyckel, type Fastnad, type Saljare } from "./inkio-vakt";

/**
 * Inkio-vakten (2026-11-20). Logiken och skälet står i `inkio-vakt.ts`.
 *
 * Körs av utkorgens minutjobb, bara i produktionen: previewen delar databas
 * och hade larmat om samma order en gång till. Kastar aldrig — svaret är en
 * rad i jobbets kvitto.
 *
 * MOTTAGARE: BARA ROLLEN ADMIN (beställaren 2026-11-20: "Säljarna ska inte få
 * någon varning eller mejl"). Säljare, chefer och den som godkände får inget;
 * det är admin som rättar i Inkio. Vem som är admin är data, inte kod.
 *
 * VILKET LARM SOM REDAN GÅTT läses ur `notification_event` (sorten och
 * `object_id`), så vakten behöver ingen egen tabell och kan inte glömma: ett
 * larm som inte skrevs räknas inte som skickat.
 */

const ORDERSORT = "inkio-order-fel";
const SALJARSORT = "inkio-saljare-saknas";

/** Säljarkollen läser Inkio en gång i kvarten, inte varje minut. */
const SALJARKOLL_MINUT = 15;

/** Säljare = aktiv anställd med en order (inte utkast) det senaste kvartalet. */
const SALJARE_DAGAR = 90;

export type Vaktsvar = { order: number; saljare: number | string } | "inte här" | `fel: ${string}`;

export async function inkioVakt(nu = new Date()): Promise<Vaktsvar> {
  try {
    if (process.env.VERCEL_ENV !== "production" || !inkioKonfigurerad()) return "inte här";
    const order = await vaktaOrder(nu);
    const saljare = nu.getUTCMinutes() % SALJARKOLL_MINUT === 0 ? await vaktaSaljare(nu) : 0;
    return { order, saljare };
  } catch (e) {
    const fel = e instanceof Error ? e.message : String(e);
    await larmaOmVakten(fel, nu);
    return `fel: ${fel}`;
  }
}

/** Vakten själv kunde inte köra. Tystnad bevisar inte att allt kom in, så det larmas, högst en gång per dygn. */
async function larmaOmVakten(fel: string, nu: Date): Promise<void> {
  try {
    const senast = await senasteLarm(ORDERSORT, ["vakten"]);
    if (!attLarma(senast.get("vakten") ?? null, nu)) return;
    const till = await medRoll("admin");
    await notifieraFlera(till, {
      av: null,
      kalla: "inkio-order-fel",
      typ: "fel",
      rubrik: "Nav kan inte kontrollera att order kommer in i Inkio",
      detalj: `Inkio-vakten stannade: ${fel}`.slice(0, 300),
      href: "/fel",
      objekt: { typ: "vakt", id: "vakten" },
    });
  } catch {
    // Larmet om larmet får inte fälla minutjobbet.
  }
}

/** Senaste larmet per objekt för en sort. */
async function senasteLarm(sort: string, idn: readonly string[]): Promise<Map<string, Date>> {
  const ut = new Map<string, Date>();
  if (idn.length === 0) return ut;
  const { data, error } = await supabaseAdmin()
    .from("notification_event")
    .select("object_id, created_at")
    .eq("kalla", sort)
    .in("object_id", idn as string[])
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`notification_event: ${error.message}`);
  for (const r of (data ?? []) as { object_id: string; created_at: string }[]) {
    if (!ut.has(r.object_id)) ut.set(r.object_id, new Date(r.created_at));
  }
  return ut;
}

async function vaktaOrder(nu: Date): Promise<number> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("crm_order")
    .select("order_id, error, sales_order!inner(order_number, company_name, approved_at, status)")
    .eq("state", "fel");
  if (error) throw new Error(`crm_order: ${error.message}`);

  type Rad = {
    order_id: string;
    error: string | null;
    sales_order: {
      order_number: number | null;
      company_name: string;
      approved_at: string | null;
      status: string;
    };
  };
  // En order som makulerats i Nav efter felet har inget kvar att lägga in.
  const allaFel = ((data ?? []) as unknown as Rad[]).filter((r) => r.sales_order.status === "signerad" || r.sales_order.status === "betald");
  if (allaFel.length === 0) return 0;

  // Utkorgen försöker tre gånger. Så länge en rad för ordern väntar är felet
  // inte slutgiltigt — ett hack hos Inkio som går vid andra försöket larmar inte.
  const { data: vantar, error: vantarFel } = await db
    .from("outbox")
    .select("payload")
    .eq("kind", "crm")
    .is("sent_at", null)
    .is("error", null)
    .in("payload->>order_id", allaFel.map((r) => r.order_id));
  if (vantarFel) throw new Error(`outbox: ${vantarFel.message}`);
  const iKo = new Set(((vantar ?? []) as { payload: { order_id?: string } }[]).map((v) => String(v.payload?.order_id ?? "")));
  const rader = allaFel.filter((r) => !iKo.has(r.order_id));
  if (rader.length === 0) return 0;

  const senast = await senasteLarm(ORDERSORT, rader.map((r) => r.order_id));
  const admins = await medRoll("admin");
  let antal = 0;

  for (const r of rader) {
    if (!attLarma(senast.get(r.order_id) ?? null, nu)) continue;
    const f: Fastnad = {
      orderId: r.order_id,
      ordernummer: r.sales_order.order_number,
      bolag: r.sales_order.company_name,
      fel: r.error,
      sedan: r.sales_order.approved_at,
    };
    const larm = orderlarm(f, nu);
    await notifieraFlera(admins, {
      av: null,
      kalla: ORDERSORT,
      typ: "fel",
      ...larm,
      objekt: { typ: "sales_order", id: r.order_id },
    });
    antal++;
  }
  return antal;
}

async function vaktaSaljare(nu: Date): Promise<number> {
  const db = supabaseAdmin();
  const sedan = new Date(nu.getTime() - SALJARE_DAGAR * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("sales_order")
    .select("salesperson_id, employee!sales_order_salesperson_id_fkey(id, first_name, last_name, email, status)")
    .neq("status", "utkast")
    .gte("created_at", sedan);
  if (error) throw new Error(`sales_order: ${error.message}`);

  type Rad = { salesperson_id: string; employee: { id: string; first_name: string; last_name: string; email: string | null; status: string } | null };
  const navSaljare = new Map<string, Saljare>();
  for (const r of (data ?? []) as unknown as Rad[]) {
    const e = r.employee;
    if (!e || !e.email || (e.status !== "active" && e.status !== "onboarding")) continue;
    navSaljare.set(e.id, { id: e.id, namn: `${e.first_name} ${e.last_name}`.trim(), epost: e.email });
  }
  if (navSaljare.size === 0) return 0;

  const saknas = saknasIInkio([...navSaljare.values()], await inkioSaljarEpost());
  if (saknas.length === 0) return 0;

  // En notis för hela uppsättningen. Samma uppsättning en gång per dygn; saknas någon ny larmas det direkt.
  const nyckel = saljarnyckel(saknas);
  const senast = await senasteLarm(SALJARSORT, [nyckel]);
  if (!attLarma(senast.get(nyckel) ?? null, nu)) return 0;
  const till = await medRoll("admin");
  await notifieraFlera(till, { av: null, kalla: SALJARSORT, typ: "fel", ...saljarlarm(saknas), objekt: { typ: "saljare", id: nyckel } });
  return saknas.length;
}
