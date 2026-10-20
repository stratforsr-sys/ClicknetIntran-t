import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { heltNamn } from "./forma";
import { SKRIVLAGE } from "./skrivlage";

/**
 * Nav 2.0, profilen i Inställningar: tilltalsnamnet, telefonen, det privata
 * mejlet och profilbilden.
 *
 * Telefonen och det privata mejlet är samma fält som Anställda visar och
 * välkomstbrevet går till (0105 `employee_onboarding`), och tilltalsnamnet
 * ligger bredvid dem (0107). Den egna raden läses med service role, bara de tre
 * fälten: tabellen läser annars bara den som läser hela personalen.
 *
 * Profilbilderna (0107 `employee_photo`) syns för alla inloggade, på alla
 * enheter (beställaren 2026-10-20). Vilka som har en bild läses med den
 * inloggades token; namnen till dem med service role, bara namnen, för att
 * säljaren inte ser kollegornas rader i personalen men ser dem på Golvet och i
 * kalendern. Utkastet slår upp bilden på namnet. Adressen bär tidpunkten, så
 * att en ny bild får en ny adress och den gamla kan cachas länge.
 *
 * Utan 0107 (migrationerna körs när hela Nav 2.0 är klart) blir det inga
 * bilder och inget tilltalsnamn; `utan0107` säger varför.
 */
export type NdProfil = {
  tilltal: string | null;
  tel: string | null;
  privat: string | null;
  /** Fullständigt namn → bildens adress. Bara de som har en bild. */
  bilder: Record<string, string>;
  far: boolean;
  utan0107: boolean;
};

const saknas = (e: { message?: string } | null | undefined) => !!e && /does not exist|schema cache|could not find/i.test(e.message ?? "");

export const bildAdress = (id: string, nar: string) => `/nav2/profil?bild=${id}&v=${Date.parse(nar) || 0}`;

export async function byggProfil(supabase: SupabaseClient, user: CurrentUser): Promise<NdProfil> {
  const mig = user.employee?.id ?? null;
  const tom: NdProfil = { tilltal: null, tel: null, privat: null, bilder: {}, far: SKRIVLAGE.profil, utan0107: false };
  if (!mig) return tom;
  const db = supabaseAdmin();

  const [egen, bilder] = await Promise.all([
    db.from("employee_onboarding").select("preferred_name, phone, private_email").eq("employee_id", mig).maybeSingle(),
    supabase.from("employee_photo").select("employee_id, updated_at").not("image", "is", null).limit(500),
  ]);
  let rad = egen.data as { preferred_name?: string | null; phone: string | null; private_email: string | null } | null;
  const utan0107 = saknas(egen.error) || saknas(bilder.error);
  if (saknas(egen.error)) {
    const { data } = await db.from("employee_onboarding").select("phone, private_email").eq("employee_id", mig).maybeSingle();
    rad = (data as { phone: string | null; private_email: string | null } | null) ?? null;
  }

  const foton = ((bilder.error ? [] : bilder.data) ?? []) as { employee_id: string; updated_at: string }[];
  const ut: NdProfil = {
    ...tom,
    tilltal: rad?.preferred_name?.trim() || null,
    tel: rad?.phone?.trim() || null,
    privat: rad?.private_email?.trim() || null,
    utan0107,
  };
  if (!foton.length) return ut;

  const { data: personer } = await db
    .from("employee")
    .select("id, first_name, last_name")
    .in("id", foton.map((f) => f.employee_id))
    .neq("status", "offboarded");
  const namn = new Map(((personer ?? []) as { id: string; first_name: string; last_name: string }[]).map((p) => [p.id, heltNamn(p.first_name, p.last_name)]));
  for (const f of foton) {
    const n = namn.get(f.employee_id);
    if (n) ut.bilder[n] = bildAdress(f.employee_id, f.updated_at);
  }
  return ut;
}
