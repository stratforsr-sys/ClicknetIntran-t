import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sammaUrsprung } from "@/lib/nav2/skrivlage";
import { MAX_RENSA, arKlockId, notisId, type Notiskalla } from "@/lib/notiser";
import { angraRensning, avfardaNotis, rensaKlockan } from "@/lib/notiser-server";

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
 *   POST /nav2/notis  { id?, notis? }
 *        Klockan i Nav 2.0, när en notis trycks. Svarar 204.
 *
 *   POST /nav2/notis  { rensa: { ids, till } }
 *        "Rensa alla". Svarar { forra, satt }, gränsen före och efter.
 *   POST /nav2/notis  { angra: { ids, forra, satt } }
 *        Ångra en rensning eller en rad. Svarar 204.
 *
 * KLOCKAN VISAR BARA DET DU INTE SETT (beställaren 2026-11-13). Den som öppnar
 * en notis, från klockan, pushen eller mejlet, har sett den, och då försvinner
 * den ur klockan på alla enheter (`notification_dismissed`, 0038). Det är
 * personens egen klocka, inte navets data, och därför står inte heller detta
 * bakom SKRIVLAGE.
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
    .select("id, href, opened_at, kalla")
    .eq("id", id)
    .eq("employee_id", mig)
    .maybeSingle();
  if (!data) return null;
  // Öppnad är sedd: ur klockan, var den än öppnades.
  await avfardaNotis(mig, notisId(data.kalla as Notiskalla, String(data.id))).catch(() => {});
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

/** Klockans id ur kroppen: bara välformade, inga dubbletter, högst MAX_RENSA. */
const klockIds = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter(arKlockId))].slice(0, MAX_RENSA) : [];
const tidEllerNull = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return new NextResponse(null, { status: 401 });
  if (!sammaUrsprung(request)) return new NextResponse(null, { status: 403 });
  const mig = user.employee.id;
  const b = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    notis?: unknown;
    rensa?: { ids?: unknown; till?: unknown };
    angra?: { ids?: unknown; forra?: unknown; satt?: unknown };
  };

  if (b.rensa && typeof b.rensa === "object") {
    const svar = await rensaKlockan(mig, klockIds(b.rensa.ids), b.rensa.till).catch(() => null);
    if (!svar) return NextResponse.json({ fel: "Klockan gick inte att rensa just nu." }, { status: 500 });
    return NextResponse.json(svar, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
  if (b.angra && typeof b.angra === "object") {
    const ok = await angraRensning(mig, klockIds(b.angra.ids), tidEllerNull(b.angra.forra), tidEllerNull(b.angra.satt))
      .then(() => true)
      .catch(() => false);
    return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ fel: "Det gick inte att ångra." }, { status: 500 });
  }

  const id = tal(b.id);
  await Promise.all([
    id ? bokfor(mig, id, "klocka").catch(() => null) : null,
    arKlockId(b.notis) ? avfardaNotis(mig, b.notis).catch(() => null) : null,
  ]);
  return new NextResponse(null, { status: 204 });
}
