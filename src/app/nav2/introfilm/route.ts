import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { bucketen, lagerForNyaFiler, signeraLank } from "@/lib/lagring-server";
import { ADRESS_SEKUNDER, FILM, arSedd, filmstorlek, seddRad } from "@/lib/nav2/introfilmforma";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: introfilmen (beställaren 2026-10-31, 0270).
 *
 * GET ?k=stor|liten  En signerad adress till filmen i R2, som lever i tre
 *                    timmar. Datorn får 1080p60 (originalet), telefonen 720p60.
 * POST sedd          Filmen är sedd (minst 95 % uppspelad): `sedd_at` sätts
 *                    första gången, `senast_sedd_at` och `ganger` varje gång.
 *
 * ===========================================================================
 * FILMEN LIGGER ALDRIG PÅ EN ÖPPEN ADRESS. Musiken är en kommersiell låt vars
 * licens inte är utredd. Filen ligger i navets privata bucket, och adressen
 * signeras bara åt den som är inloggad. Den går inte genom Vercel (en
 * funktion svarar med högst 4,5 MB), och den ligger inte i /public.
 *
 * Adressen kommer som JSON, inte som en omdirigering: spelaren vet då direkt om
 * filmen finns och kan erbjuda "Fortsätt utan film", och webbläsarens Range-
 * hämtningar går rakt mot R2. CSP:ns media-src släpper redan in R2 (csp.ts).
 * ===========================================================================
 *
 * LÄSLÄGE: står `SKRIVLAGE.introfilm` på false svarar POST 423, och då ser alla
 * filmen varje gång. Den ska vara påslagen när introfilmen går ut.
 */

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  const k = filmstorlek(new URL(request.url).searchParams.get("k"));
  if (!k) return svar({ fel: "Okänd storlek." }, 400);
  if (lagerForNyaFiler() !== "r2") return svar({ fel: "Filmen finns inte här." }, 503);

  const s = await signeraLank({ lager: "r2", bucket: bucketen("r2"), path: FILM.nycklar[k], sekunder: ADRESS_SEKUNDER });
  if ("fel" in s) {
    console.error("introfilm: adressen gick inte att signera", s.fel);
    return svar({ fel: "Filmen gick inte att hämta just nu." }, 502);
  }
  return svar({ url: s.url, sekunder: ADRESS_SEKUNDER, film: FILM.namn });
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
  if (String(b.handling ?? "") !== "sedd") return svar({ fel: "Okänd handling." }, 400);
  if (!SKRIVLAGE.introfilm) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);
  if (!arSedd(b.spelat)) return svar({ fel: "Filmen är inte sedd än." }, 400);

  const db = supabaseAdmin();
  const mig = user.employee.id;
  const { data: forra, error: lasfel } = await db
    .from("introfilm")
    .select("sedd_at, ganger")
    .eq("employee_id", mig)
    .maybeSingle();
  if (lasfel) {
    console.error("introfilm: raden gick inte att läsa", lasfel.message);
    return svar({ fel: "Det gick inte att spara att filmen är sedd." }, 500);
  }
  // Två flikar som blir klara samtidigt skriver samma sak; sedd_at står kvar från den första.
  const { error } = await db
    .from("introfilm")
    .upsert({ employee_id: mig, ...seddRad(forra, new Date().toISOString()) }, { onConflict: "employee_id" });
  if (error) {
    console.error("introfilm: sedd gick inte att spara", error.message);
    return svar({ fel: "Det gick inte att spara att filmen är sedd." }, 500);
  }
  return svar({ ok: "sedd" });
}
