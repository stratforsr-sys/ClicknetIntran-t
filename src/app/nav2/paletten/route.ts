import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { PAL_VYER, palettKalender, palettObesvarade, sokPaletten, type PalVy } from "@/lib/nav2/paletten";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: paletten ("Sök, gör eller fråga Nav").
 *
 *   GET ?q=<text>&vyer=uppgifter,rutiner,…   innehållssökningen, med RLS
 *   GET ?vad=kalender                        kommande egna kalenderposter, en gång per öppning
 *   GET ?vad=obesvarade                      veckans frågor utan svar (chefen, 0125)
 *   POST {handling: "fraga", text}           bokför en fritt skriven fråga, utan namn
 *
 * Läsningarna går med användarens token (se `src/lib/nav2/paletten.ts`).
 * "Gör" har ingen egen rutt: palettens handlingar är de kopplade vyernas egna
 * (/nav2/uppgifter, /nav2/rutiner, /nav2/franvaro …).
 *
 * LÄSLÄGE: står `SKRIVLAGE.paletten` på false svarar POST 423 innan något
 * skrivs. Frågan bokförs med service role, eftersom `registrera_fragemiss` är
 * stängd för inloggade (0125): bara den här rutten skriver, och bara på ja.
 */

const svar = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Inte inloggad." }, 401);
  const url = new URL(request.url);

  try {
    const vad = url.searchParams.get("vad");
    if (vad === "obesvarade") return svar(await palettObesvarade(await supabaseServer(), user));
    if (vad === "kalender") return svar(await palettKalender(user));

    const q = url.searchParams.get("q") ?? "";
    const vyer = (url.searchParams.get("vyer") ?? "").split(",").filter((v): v is PalVy => (PAL_VYER as readonly string[]).includes(v));
    return svar(await sokPaletten(await supabaseServer(), user, q, vyer));
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }

  if (!SKRIVLAGE.paletten) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);

  try {
    switch (String(b.handling ?? "")) {
      case "fraga": {
        // Bara texten. Ingen person följer med, och tabellen har ingen kolumn för den (0125).
        const text = String(b.text ?? "").trim().slice(0, 200);
        if (text.length < 3) return svar({ fel: "Frågan är för kort." }, 400);
        const { error } = await supabaseAdmin().rpc("registrera_fragemiss", { p_q: text });
        if (error) return svar({ fel: `Frågan sparades inte: ${error.message}` }, 500);
        return svar({ ok: "Frågan är sparad utan ditt namn." });
      }
      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch (e) {
    return svar({ fel: e instanceof Error ? e.message : "Något gick fel." }, 500);
  }
}
