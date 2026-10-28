import { NextResponse } from "next/server";
import { tavlansAtkomst } from "@/lib/salesboard/atkomst";
import { bildnyckel } from "@/lib/salesboard/handlingar";
import { BILD_ID } from "@/lib/salesboard/installningar";
import { svar } from "@/lib/salesboard/svar";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Säljtavlan: månadens prisbild, `?id=<24 hex>`.
 *
 * Samma åtkomst som tavlans data (`/salesboard/data`): en parad skärm eller en
 * inloggad anställd, ingen annan. Bilden ligger som en rad i `nav_setting`
 * (`handlingar.ts`, handlingen `bild`), läst med service role efter kontrollen.
 *
 * Id:t byts när bilden byts, så samma adress ger alltid samma bild och cachas
 * i ett år i webbläsaren. `private`: en delad cache på vägen ska inte ha den.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!BILD_ID.test(id)) return svar({ fel: "Ingen bild." }, 404);

  try {
    const atkomst = await tavlansAtkomst(request);
    if (!atkomst) return svar({ fel: "Skärmen är inte parad." }, 401);

    const { data, error } = await supabaseAdmin().from("nav_setting").select("value").eq("key", bildnyckel(id)).maybeSingle();
    if (error) throw new Error(error.message);
    const value = (data as { value?: { mime?: unknown; data?: unknown } } | null)?.value;
    if (value?.mime !== "image/jpeg" || typeof value.data !== "string") return svar({ fel: "Ingen bild." }, 404);

    return new NextResponse(new Uint8Array(Buffer.from(value.data, "base64")), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    console.error("salesboard/bild:", e instanceof Error ? e.message : e);
    return svar({ fel: "Bilden kunde inte läsas just nu." }, 503);
  }
}
