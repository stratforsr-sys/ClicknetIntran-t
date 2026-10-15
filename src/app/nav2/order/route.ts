import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser, hasRole, fullName } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { kopplaForHand } from "@/lib/samtal-order-server";
import { notifieraFlera } from "@/lib/notishandelse-server";
import { skrivKundanteckning } from "@/lib/crm/inkio";
import { giltigBindningstid, giltigTelefon, normaliseraOrgnr } from "@/lib/order";
import { tolkaBelopp } from "@/lib/provision";
import {
  aterupptaBevakning,
  avslutaAvtal,
  forberedNyttAvtal,
  forberedOrderbilaga,
  godkannOrder,
  hamtaSamtalskandidater,
  kopplaSaljsamtal,
  lasAvtalsforslag,
  makuleraOrder,
  markeraBetald,
  raderaOrder,
  raderaUtkast,
  rattaFranAvtal,
  redigeraOgodkand,
  redigeraOrder,
  registreraOrderbilaga,
  returneraOrder,
  skapaOrder,
  skickaInOrder,
  synkaTillInkio,
  taBortOrderbilaga,
  type Orderstate,
} from "@/app/(app)/order/actions";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: allt som ändrar en order, i en rutt.
 *
 * ===========================================================================
 * REPOTS ACTIONS, MED SAMMA FÄLT. Varje handling som /order har går genom sin
 * egen action i app/(app)/order/actions.ts — samma behörighet, samma regler
 * för provisionen, samma logg och samma notiser. Rutten bygger bara det
 * formulär actionen väntar sig, och släpper bara igenom de fält den läser.
 *
 * Det nya (0083) skrivs här: anteckningen till Inkio från kundkortet, den
 * fästa anteckningen, "sett senast" och att lossa ett säljsamtal (repots
 * `kopplaForHand` med ingen order, som släpper samtalet till svepningen).
 *
 * "Spara som utkast" lägger en order med status utkast, som repot redan har
 * (en tillbakaskickad order blir ett utkast). Den kräver bara det databasen
 * kräver; avtal och säljsamtal kommer när den skickas in med `skickaInOrder`.
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.order` på false svarar rutten 423 innan något
 * skrivs. Att läsa avtalets förslag och samtalskandidaterna är läsningar och
 * fungerar alltid.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ORGNR = /^\d{6}-\d{4}$/;

/** Fälten varje action läser ur formuläret, och inga andra. */
const FALT = {
  skapa: ["salesperson_id", "company_name", "org_number", "contact_name", "contact_phone", "contact_email", "customer_street", "customer_postal_code", "customer_city", "avtal_fil_id", "avtal_store", "avtal_filnamn", "package_id", "term_months", "fri_order", "monthly_amount", "signed_on", "starts_on", "note", "is_addon", "godkann", "forlanger_id", "provision_form", "commission_percent", "commission_amount", "tjanster", "finans", "har_utkop", "buyout_amount"],
  rattaOgodkand: ["company_name", "org_number", "contact_name", "contact_phone", "contact_email", "customer_street", "customer_postal_code", "customer_city", "package_id", "term_months", "fri_order", "monthly_amount", "signed_on", "starts_on", "salesperson_id", "is_addon", "note", "tjanster", "finans", "har_utkop", "buyout_amount", "provision_form", "commission_percent", "commission_amount"],
  rattaGodkand: ["org_number", "contact_email", "reason", "note", "package_id", "term_months", "monthly_amount", "is_addon", "tjanster", "finans", "har_utkop", "buyout_amount"],
  rattaFranAvtal: ["company_name", "org_number", "contact_name", "contact_phone", "package_id", "term_months", "signed_on"],
} as const;

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
const fran = (s: Orderstate, okText?: string) => (s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? okText ?? "Klart.", id: s.orderId ?? null }));

function form(falt: Record<string, unknown>, tillatna?: readonly string[]): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) {
    if (tillatna && !tillatna.includes(k)) continue;
    if (v === undefined || v === null) continue;
    f.set(k, typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return f;
}

/** Ordern som den inloggade ser den (RLS), eller null. */
async function ordern(id: string) {
  if (!UUID.test(id)) return null;
  const rls = await supabaseServer();
  const { data } = await rls.from("sales_order").select("id, status, salesperson_id, org_number").eq("id", id).maybeSingle();
  return data;
}

/** Ser den inloggade en order på kunden? Samma krets som kundkortet. */
async function serKunden(org: string): Promise<boolean> {
  if (!ORGNR.test(org)) return false;
  const rls = await supabaseServer();
  const { data } = await rls.from("sales_order").select("id").eq("org_number", org).limit(1);
  return Boolean(data && data.length);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const mig = user.employee.id;
  const hanterare = hasRole(user, "sales_manager", "ceo", "finance");

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");
  const id = String(b.id ?? "");
  const falt = (b.falt && typeof b.falt === "object" ? b.falt : {}) as Record<string, unknown>;

  try {
    // Läsningar: fungerar i läsläge.
    if (handling === "kandidater") {
      const s = await hamtaSamtalskandidater(id);
      return "fel" in s ? svar({ fel: s.fel }, 400) : svar({ kandidater: s.kandidater });
    }
    if (handling === "las-avtal") {
      const s = await lasAvtalsforslag(id, String(b.fil ?? ""));
      return "fel" in s ? svar({ fel: s.fel }, 400) : svar({ forslag: s.forslag });
    }

    if (!SKRIVLAGE.order) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
    const db = supabaseAdmin();

    switch (handling) {
      case "skapa":
        return fran(await skapaOrder({}, form(falt, FALT.skapa)), "Ordern är sparad.");
      case "utkast": {
        // Bara det databasen kräver. Resten fylls i innan den skickas in.
        const saljare = hanterare && String(falt.salesperson_id ?? "") ? String(falt.salesperson_id) : mig;
        const bolag = String(falt.company_name ?? "").trim();
        const orgnr = normaliseraOrgnr(String(falt.org_number ?? ""));
        const kontakt = String(falt.contact_name ?? "").trim();
        const telefon = String(falt.contact_phone ?? "").trim();
        const paket = Number(falt.package_id);
        const loptid = Number(falt.term_months);
        const signerad = String(falt.signed_on ?? "");
        const start = String(falt.starts_on ?? "") || signerad;
        if (!bolag || !orgnr || !kontakt || !giltigTelefon(telefon) || ![1, 2, 3].includes(paket) || !giltigBindningstid(loptid) || !/^\d{4}-\d{2}-\d{2}$/.test(signerad)) {
          return svar({ fel: "Ett utkast behöver bolag, organisationsnummer, kontaktperson, telefon, paket och bindningstid." }, 400);
        }
        const fri = falt.fri_order === "on";
        const { data: rad, error } = await db
          .from("sales_order")
          .insert({
            company_name: bolag,
            org_number: orgnr,
            contact_name: kontakt,
            contact_phone: telefon,
            contact_email: String(falt.contact_email ?? "").trim() || null,
            customer_street: String(falt.customer_street ?? "").trim() || null,
            customer_postal_code: String(falt.customer_postal_code ?? "").trim() || null,
            customer_city: String(falt.customer_city ?? "").trim() || null,
            package_id: paket,
            term_months: loptid,
            salesperson_id: saljare,
            signed_on: signerad,
            starts_on: start,
            is_addon: falt.is_addon === "on",
            monthly_amount: fri ? tolkaBelopp(String(falt.monthly_amount ?? "")) : null,
            buyout_amount: falt.har_utkop === "on" ? tolkaBelopp(String(falt.buyout_amount ?? "")) : null,
            financed: falt.finans === "on",
            free_order_reason: fri ? String(falt.fri_skal ?? "").trim().slice(0, 500) || null : null,
            note: String(falt.note ?? "").trim() || null,
            status: "utkast",
            created_by: mig,
          })
          .select("id, order_number")
          .single();
        if (error || !rad) return svar({ fel: `Utkastet sparades inte: ${error?.message ?? "okänt fel"}` }, 500);
        let tjanster: { name?: unknown; billing?: unknown; amount?: unknown; follows_order?: unknown; term_months?: unknown; starts_on?: unknown }[] = [];
        try {
          tjanster = JSON.parse(String(falt.tjanster ?? "[]"));
        } catch {
          tjanster = [];
        }
        const rader = (Array.isArray(tjanster) ? tjanster : []).slice(0, 20).filter((t) => String(t.name ?? "").trim() && Number(t.amount) > 0 && (t.billing === "engang" || t.billing === "manad"));
        if (rader.length) {
          await db.from("sales_order_service").insert(
            rader.map((t, i) => ({ order_id: rad.id, name: String(t.name).trim(), billing: t.billing, amount: Number(t.amount), follows_order: t.billing === "manad", term_months: null, starts_on: null, sort: i })),
          );
        }
        await db.from("audit_log").insert({ actor_id: mig, action: "sales_order.draft_created", object_type: "sales_order", object_id: rad.id, meta: { via: "nav2" } });
        revalidatePath("/order");
        return svar({ ok: `Utkast sparat som #${rad.order_number}. Det syns bara för dig och dem som hanterar order.`, id: rad.id, nr: rad.order_number });
      }
      case "skicka-in":
        return fran(await skickaInOrder({}, form({ id })), "Ordern är inskickad.");
      case "godkann":
        return fran(await godkannOrder({}, form({ id, note: b.note ?? "" })), "Godkänd.");
      case "tillbaka":
        return fran(await returneraOrder({}, form({ id, reason: b.reason ?? "" })), "Skickad tillbaka.");
      case "makulera":
        return fran(await makuleraOrder({}, form({ id, reason: b.reason ?? "", makulera_i_inkio: b.inkio === false ? "" : "1" })), "Makulerad.");
      case "betald":
        return fran(await markeraBetald({}, form({ id })), "Markerad betald.");
      case "radera": {
        const o = await ordern(id);
        if (!o) return svar({ fel: "Ordern finns inte." }, 404);
        return o.status === "utkast"
          ? fran(await raderaUtkast({}, form({ id })), "Utkastet är raderat.")
          : fran(await raderaOrder({}, form({ id, reason: b.reason ?? "" })), "Ordern är raderad.");
      }
      case "ratta": {
        const o = await ordern(id);
        if (!o) return svar({ fel: "Ordern finns inte." }, 404);
        const godkand = o.status === "signerad" || o.status === "betald";
        return godkand
          ? fran(await redigeraOrder({}, form({ ...falt, id }, ["id", ...FALT.rattaGodkand])), "Ordern är rättad.")
          : fran(await redigeraOgodkand({}, form({ ...falt, id }, ["id", ...FALT.rattaOgodkand])), "Ordern är rättad.");
      }
      case "ratta-fran-avtal":
        return fran(await rattaFranAvtal({}, form({ ...falt, id }, ["id", ...FALT.rattaFranAvtal])), "Ordern är rättad efter avtalet.");
      case "koppla":
        return fran(await kopplaSaljsamtal({}, form({ id, samtal_id: b.samtal ?? "" })), "Säljsamtalet är kopplat.");
      case "lossa": {
        // Repots kopplaForHand med ingen order: samtalet släpps till svepningen.
        const samtalId = String(b.samtal ?? "");
        if (!UUID.test(samtalId)) return svar({ fel: "Okänt samtal." }, 400);
        const { data: c } = await (await supabaseServer()).from("phone_call").select("id, sales_order_id").eq("id", samtalId).maybeSingle();
        if (!c?.sales_order_id) return svar({ fel: "Samtalet är inte kopplat." }, 400);
        const o = await ordern(c.sales_order_id as string);
        if (!o) return svar({ fel: "Ordern finns inte." }, 404);
        if (!hanterare && o.salesperson_id !== mig) return svar({ fel: "Du saknar behörighet." }, 403);
        if (o.status !== "utkast" && o.status !== "inskickad") return svar({ fel: "Säljsamtalet går bara att byta innan ordern godkänns." }, 400);
        const r = await kopplaForHand({ samtalId, orderId: null, beslutadAv: mig });
        if (r.fel) return svar({ fel: r.fel }, 500);
        await db.from("audit_log").insert({ actor_id: mig, action: "sales_order.call_unlinked", object_type: "sales_order", object_id: o.id, meta: { samtal: samtalId } });
        revalidatePath("/order");
        return svar({ ok: "Samtalet är loss. Ordern är stoppad tills rätt samtal är kopplat." });
      }
      case "avsluta-avtal":
        return fran(await avslutaAvtal({}, form({ id, renewal_reason: b.reason ?? "" })), "Bevakningen av avtalet är avslutad.");
      case "ateruppta":
        return fran(await aterupptaBevakning({}, form({ id })), "Bevakningen är tillbaka.");
      case "inkio-igen":
        return fran(await synkaTillInkio({}, form({ id })), "Ordern skickas till Inkio igen.");
      case "bilaga-forbered": {
        const s = await forberedOrderbilaga(id, String(b.filnamn ?? "bilaga"), String(b.mime ?? ""), Number(b.storlek ?? 0));
        return "fel" in s && s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Klar att ladda upp.", ...s, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null });
      }
      case "bilaga-registrera":
        return fran(await registreraOrderbilaga(id, String(b.fil ?? ""), String(b.filnamn ?? "bilaga"), String(b.store ?? "")), "Bilagan är sparad.");
      case "bilaga-bort":
        return fran(await taBortOrderbilaga({}, form({ id, fil_id: b.fil ?? "" })), "Bilagan är borttagen.");
      case "avtal-forbered": {
        const s = await forberedNyttAvtal(String(b.filnamn ?? "avtal"), String(b.mime ?? ""), Number(b.storlek ?? 0));
        return "fel" in s && s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: "Klar att ladda upp.", ...s, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null });
      }

      case "anteckning": {
        const org = String(b.org ?? "");
        const text = String(b.text ?? "").trim();
        if (!text) return svar({ fel: "Skriv något först." }, 400);
        if (text.length > 2000) return svar({ fel: "Anteckningen är för lång." }, 400);
        if (!(await serKunden(org))) return svar({ fel: "Kunden finns inte, eller så är den inte din." }, 404);
        const r = await skrivKundanteckning(org, text, fullName(user.employee));
        if ("fel" in r) return svar({ fel: r.fel }, 400);
        await db.from("audit_log").insert({ actor_id: mig, action: "customer.note_added", object_type: "customer", object_id: org, meta: { inkio: r.id } });
        return svar({ ok: "Anteckningen är sparad i Inkio.", kommentar: r.id });
      }
      case "fast": {
        const org = String(b.org ?? "");
        const text = String(b.text ?? "").trim();
        const kommentar = String(b.kommentar ?? "").trim();
        if (!kommentar || !text) return svar({ fel: "Välj en anteckning att fästa." }, 400);
        if (!(await serKunden(org))) return svar({ fel: "Kunden finns inte, eller så är den inte din." }, 404);
        await db.from("customer_note_pin").upsert(
          { org_number: org, inkio_comment_id: kommentar.slice(0, 100), body: text.slice(0, 2000), author_name: String(b.vem ?? "").slice(0, 200) || null, pinned_by: mig, pinned_at: new Date().toISOString() },
          { onConflict: "org_number" },
        );
        await db.from("audit_log").insert({ actor_id: mig, action: "customer.note_pinned", object_type: "customer", object_id: org, meta: { inkio: kommentar } });
        return svar({ ok: "Anteckningen står nu överst i Översikt." });
      }
      case "lossa-fast": {
        const org = String(b.org ?? "");
        if (!(await serKunden(org))) return svar({ fel: "Kunden finns inte, eller så är den inte din." }, 404);
        await db.from("customer_note_pin").delete().eq("org_number", org);
        await db.from("audit_log").insert({ actor_id: mig, action: "customer.note_unpinned", object_type: "customer", object_id: org, meta: {} });
        return svar({ ok: "Anteckningen är inte fäst längre." });
      }
      case "sett":
        await db.from("order_list_seen").upsert({ employee_id: mig, seen_at: new Date().toISOString() }, { onConflict: "employee_id" });
        return svar({ ok: "Sett." });
      case "meddela-leveransen": {
        // 0086: en öppen anmälan per kund. Leveransens krets är den från 0071.
        const org = String(b.org ?? "");
        if (!(await serKunden(org))) return svar({ fel: "Kunden finns inte, eller så är den inte din." }, 404);
        const { data: oppen } = await db.from("landing_page_report").select("id").eq("org_number", org).is("resolved_at", null).maybeSingle();
        if (oppen) return svar({ ok: "Leveransen vet redan. Du får besked när sidan är uppe." });
        await db.from("landing_page_report").insert({ org_number: org, reported_by: mig });
        const { data: roller } = await db.from("employee_role").select("employee_id").in("role", ["delivery", "project_manager"]);
        const bolag = String(b.bolag ?? org).slice(0, 120);
        const sida = String(b.sida ?? "").slice(0, 200);
        await notifieraFlera(
          (roller ?? []).map((r) => r.employee_id as string),
          { av: mig, kalla: "kampanjsida-nere", typ: "order", rubrik: `Kampanjsidan för ${bolag} svarar inte`, detalj: sida || org, href: "/order", objekt: { typ: "customer", id: org } },
        );
        await db.from("audit_log").insert({ actor_id: mig, action: "customer.landing_page_reported", object_type: "customer", object_id: org, meta: {} });
        return svar({ ok: "Leveransen har fått beskedet. Du får besked när sidan är uppe." });
      }
      case "utskrift-last": {
        // Att läsa en utskrift loggas som att lyssna (K36).
        const samtalId = String(b.samtal ?? "");
        if (!UUID.test(samtalId)) return svar({ fel: "Okänt samtal." }, 400);
        const { data: c } = await (await supabaseServer()).from("call_transcript").select("call_id").eq("call_id", samtalId).maybeSingle();
        if (!c) return svar({ fel: "Utskriften finns inte." }, 404);
        await db.from("audit_log").insert({ actor_id: mig, action: "phone_call.transcript_read", object_type: "phone_call", object_id: samtalId, meta: {} });
        return svar({ ok: "Loggat." });
      }
      case "transkribera":
        // Tabellen och kön finns (0083). Taltjänsten väljs av beställaren.
        return svar({ fel: "Utskrifter görs när en taltjänst är vald. Inspelningen går att lyssna på." }, 501);

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
