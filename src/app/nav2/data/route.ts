import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { arNav2Del, byggNav2Delar } from "@/lib/nav2/data";
import { lasIdentitet } from "@/lib/identitet";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: delar av datan, efter en sparning.
 *
 * Förut laddades hela sidan om efter varje sparning, och då byggdes all data
 * på nytt (418 frågor, 5–9 s när databasen var seg), skriptet tolkades om och
 * vyns tur startade igen (beställaren 2026-11-02). Nu frågar sidan här efter
 * just de delar sparningen kan ha ändrat, `?delar=uppgifter,kalender`, och
 * ritar om där man står (ndOmlas i utkastet).
 *
 * Samma inloggning, samma RLS och samma pg-väg som /nav2 (route.ts): det som
 * kommer härifrån är aldrig mer än sidan redan fick.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ fel: "Du är utloggad." }, { status: 401 });
  if (!user.employee) return NextResponse.json({ fel: "Kontot saknar en anställd i Nav." }, { status: 403 });

  const begarda = (new URL(request.url).searchParams.get("delar") ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  const delar = [...new Set(begarda)].filter(arNav2Del);
  if (!delar.length || delar.length !== new Set(begarda).size) return NextResponse.json({ fel: "Okänd del." }, { status: 400 });

  const h = await headers();
  const id = lasIdentitet(h);
  const pg = id && !id.kraverLosenordsbyte && id.authUserId === user.authUserId ? { authUserId: id.authUserId, email: id.email } : null;
  try {
    const data = await byggNav2Delar(user, delar, pg);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (fel) {
    console.error("nav2/data: delarna gick inte att bygga", delar, fel);
    return NextResponse.json({ fel: "Nav kunde inte läsa datan just nu." }, { status: 500 });
  }
}
