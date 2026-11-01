import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: notisen öppnades (0271, utskicksloggen).
 *
 *   GET  /nav2/notis?id=<notis>&via=push|mejl
 *        Trycket på en push och länken i ett mejl går hit. Öppningen bokförs
 *        och sidan skickar vidare till /nav2?till=<notisens href>, så att
 *        posten öppnas som från klockan. Är man utloggad skickar mellanvaran
 *        först till inloggningen, med adressen kvar i `nasta`.
 *
 *   POST /nav2/notis  { id }
 *        Klockan i Nav 2.0, när en notis trycks. Svarar 204.
 *
 * Bara den första öppningen räknas (`opened_at` sätts en gång), och bara
 * mottagarens egen: en notis som inte är ens egen ger ingenting, inte heller
 * ett fel som avslöjar att den finns. Det är det som gör att "lästes den?"
 * kan mätas per notis, inte bara när klockan senast öppnades.
 *
 * Ingen bakom SKRIVLAGE: öppningen ändrar inget i navet, den bokför bara att
 * något lästes.
 */

const VIA = new Set(["push", "mejl"]);

async function bokfor(mig: string, id: number, via: "klocka" | "push" | "mejl"): Promise<string | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("notification_event")
    .select("id, href, opened_at")
    .eq("id", id)
    .eq("employee_id", mig)
    .maybeSingle();
  if (!data) return null;
  if (!data.opened_at) {
    await db
      .from("notification_event")
      .update({ opened_at: new Date().toISOString(), opened_via: via })
      .eq("id", id)
      .eq("employee_id", mig)
      .is("opened_at", null);
  }
  return data.href as string;
}

const tal = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const till = (vag: string) =>
    NextResponse.redirect(new URL(vag, url.origin), { status: 303, headers: { "Cache-Control": "private, no-store, max-age=0" } });

  const user = await getCurrentUser();
  const id = tal(url.searchParams.get("id"));
  const via = url.searchParams.get("via") ?? "";
  if (!user?.employee || !id || !VIA.has(via)) return till("/nav2");

  const href = await bokfor(user.employee.id, id, via as "push" | "mejl").catch(() => null);
  // Samma krav som notifiera() ställer på en href: en intern sökväg utan blanktecken.
  if (!href || !href.startsWith("/") || href.startsWith("//") || /\s/.test(href)) return till("/nav2");
  return till(`/nav2?till=${encodeURIComponent(href)}`);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return new NextResponse(null, { status: 401 });
  if (!sammaUrsprung(request)) return new NextResponse(null, { status: 403 });
  const b = (await request.json().catch(() => ({}))) as { id?: unknown };
  const id = tal(b.id);
  if (id) await bokfor(user.employee.id, id, "klocka").catch(() => null);
  return new NextResponse(null, { status: 204 });
}
