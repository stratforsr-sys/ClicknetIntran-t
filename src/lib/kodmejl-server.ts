import "server-only";

import { headers } from "next/headers";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { epostArKonfigurerad, skickaEpost } from "@/lib/epost";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { KOD_GILTIG_MIN, KOD_PAUS_S, klockslag, tolkaAuthFel } from "@/lib/inloggning";
import { kodbrev, type Kodsyfte } from "@/lib/kodbrev";

/**
 * Engångskoden till mejlen: inloggningen, "Glömt lösenordet?", lösenordsbytet
 * och steg två skickar den härifrån.
 *
 * ===========================================================================
 * NAVET SKICKAR KODEN SJÄLVT. Supabase skickar sin kod med mallen för magisk
 * länk, och den mallen bar 2026-08-16 bara en länk (DRIFTSATTNING punkt 0):
 * utan `{{ .Token }}` får mottagaren inget att skriva in. Supabases inbyggda
 * utskick tar dessutom bara ett par mejl i timmen. Navet har redan en avsändare
 * som går i drift (Resend, src/lib/epost.ts). Koden tas fram med
 * `admin.generateLink`, som ger samma engångskod som Supabases mejl hade burit
 * (tests/rls.mjs provar att `verifyOtp` godtar den), och mejlet är navets eget.
 * Saknas Resend (EMAIL_FROM eller RESEND_API_KEY) skickar Supabase som förut.
 * ===========================================================================
 *
 * BARA KÄNDA KONTON. Adressen ska höra till någon i personalregistret som inte
 * slutat och som har ett konto. generateLink går med service role och kan
 * annars göra en magisk länk till en registrering, förbi projektets spärr.
 *
 * SPÄRRARNA är navets egna, eftersom generateLink inte har Supabases: en kod
 * per person och KOD_PAUS_S (som Supabase), och högst TAK koder i hela navet
 * per tio minuter. Båda läses ur audit_log, där varje skickad kod står
 * (`auth.code_sent`). Kan loggen inte läsas skickas koden ändå: en spärr som
 * låser ute alla när databasen har en dålig minut är värre än ett mejl för
 * mycket.
 *
 * Utfallet "okand" och "sparr" ska ge samma svar utåt som "skickad", så att
 * formuläret inte röjer vilka adresser som har konto.
 */
export type Kodutfall = "skickad" | "okand" | "sparr" | "mejlgrans" | "fel";

/** Koder i hela navet per tio minuter. Ett normalt morgonpass är en handfull. */
const TAK = 100;

async function klientIp(): Promise<string | null> {
  try {
    const v = (await headers()).get("x-forwarded-for");
    return v ? v.split(",")[0].trim() : null;
  } catch {
    return null;
  }
}

/** Utan Resend: Supabases eget utskick, med dess spärrar och dess mall. */
async function viaSupabase(epost: string): Promise<Kodutfall> {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({ email: epost, options: { shouldCreateUser: false } });
  if (!error) return "skickad";
  const orsak = tolkaAuthFel(error);
  if (orsak.typ === "okant" || orsak.typ === "adress") return "okand";
  if (orsak.typ === "sparr") return "sparr";
  return orsak.typ === "mejlgrans" ? "mejlgrans" : "fel";
}

/**
 * Adressen som ett ILIKE-mönster utan jokertecken: registret kan ha en rad
 * med versaler från förr, och inloggningen bryr sig inte om dem. `*` är
 * PostgREST:s eget jokertecken och går inte att skydda; en sådan adress
 * finns inte i ett bolag och får inget mejl.
 */
function somMonster(epost: string): string | null {
  return epost.includes("*") ? null : epost.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function skickaKodmejl(epost: string, syfte: Kodsyfte): Promise<Kodutfall> {
  if (!epostArKonfigurerad()) return viaSupabase(epost);
  const monster = somMonster(epost);
  if (!monster) return "okand";

  const db = supabaseAdmin();
  const { data: person } = await db
    .from("employee")
    .select("id, first_name, auth_user_id, status")
    .ilike("email", monster)
    .maybeSingle();
  if (!person?.auth_user_id || person.status === "offboarded") return "okand";

  const nu = Date.now();
  const [nyss, idag] = await Promise.all([
    db
      .from("audit_log")
      .select("id")
      .eq("object_type", "auth")
      .eq("object_id", person.id)
      .eq("action", "auth.code_sent")
      .gte("ts", new Date(nu - KOD_PAUS_S * 1000).toISOString())
      .limit(1),
    db
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth.code_sent")
      .gte("ts", new Date(nu - 10 * 60 * 1000).toISOString()),
  ]);
  if (nyss.data?.length) return "sparr";
  if ((idag.count ?? 0) >= TAK) return "mejlgrans";

  const { data: lank, error } = await db.auth.admin.generateLink({ type: "magiclink", email: epost });
  const kod = lank?.properties?.email_otp;
  if (error || !kod) return "fel";

  const brev = kodbrev(kod, person.first_name ?? null, syfte, klockslag(new Date(nu + KOD_GILTIG_MIN * 60 * 1000)));
  const utfall = await skickaEpost({ till: epost, amne: brev.amne, text: brev.text, html: brev.html });
  if (!utfall.skickat) return "fel";

  // Koden står aldrig i loggen. Bara att den skickades, till vem och varför.
  await skrivHandelse({
    actorId: person.id,
    action: "auth.code_sent",
    objectType: "auth",
    objectId: person.id,
    meta: { syfte, ip: await klientIp() },
  });
  return "skickad";
}
