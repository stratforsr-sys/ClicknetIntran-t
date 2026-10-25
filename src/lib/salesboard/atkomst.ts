import "server-only";

import { cookies, headers } from "next/headers";
import type { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { nivaFor } from "@/lib/nav2/forma";
import { hasha } from "@/lib/salesboard/parning";
import { lasningen } from "@/lib/salesboard/saknas";
import { farAndraTavlan } from "@/lib/salesboard/skrivning";
import {
  PARKAKA,
  SKARMKAKA,
  SKARMKAKA_TID,
  arToken,
  klientIp,
  parkaka,
  parkakanBort,
  personbeslut,
  skarmbeslut,
  skarmkakanBehoverFornyas,
  skarmkakor,
  webblasare,
  type Kaka,
} from "@/lib/salesboard/atkomstregler";

export { PARKAKA, SKARMKAKA, SKARMKAKA_TID };

/**
 * Säljtavlan: vem som får se den, och kakorna som bär det.
 *
 * ===========================================================================
 * MELLANVARAN SLÄPPER IN ALLA PÅ /salesboard, OCH DET ÄR HÄR DET AVGÖRS.
 *
 * `/salesboard` står i `PUBLIC` i `supabase/middleware.ts`, eftersom en TV på
 * väggen inte har någon session. Varje rutt och sida under `/salesboard` frågar
 * därför `tavlansAtkomst()` (eller `tavlansAdmin()` för det som ändrar något)
 * innan den svarar, och den som inte får något svar får ingenting.
 * ===========================================================================
 *
 * Två sorters besökare släpps in (spec §9):
 *
 *   skärm   en parad TV med kakan `nav_tavla`: en token på 32 slumpbyte. Den
 *           räknas till sin hash och slås upp på en skärm som inte kopplats
 *           bort. Databasen har aldrig tokenen, bara hashen (`parning.ts`).
 *   person  en inloggad anställd som är aktiv eller håller på att börja. Alla
 *           roller, "alla ser alla".
 *
 * Besluten (vad ett svar betyder, kakornas flaggor, förnyelsen) står som rena
 * funktioner i `atkomstregler.ts` och är provade. Här görs anropen.
 *
 * NULL BETYDER ATT DET ÄR SÄKERT ATT INGEN ÅTKOMST FINNS. Ett databasfel kastar
 * i stället, och rutten svarar 503: en TV som får 401 visar parningen, och en
 * dålig minut i databasen ska inte koppla bort en TV som ingen rör.
 */

export type Atkomst =
  | { typ: "skarm"; skarm: { id: string; namn: string; ljud: boolean } }
  | { typ: "person"; user: CurrentUser };

/** `last_seen_at` skrivs högst så här ofta per skärm. */
const SEDD_MS = 60_000;

/**
 * Skärmen bakom kakan, eller null när kakan saknas, inte är en token eller inte
 * hör till någon skärm som är kvar. `last_seen_at`, adressen och webbläsaren
 * skrivs om den senast sågs för mer än en minut sedan.
 *
 * Kastar när uppslaget går fel, och när tabellen saknas: en välformad token
 * finns bara efter 0250 (`skarmbeslut`).
 */
async function skarmen(request?: Request): Promise<{ id: string; namn: string; ljud: boolean } | null> {
  const token = (await cookies()).get(SKARMKAKA)?.value;
  if (!arToken(token)) return null;

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("salesboard_screen")
    .select("id, name, sound, last_seen_at")
    .eq("token_hash", hasha(token))
    .is("revoked_at", null)
    .maybeSingle();

  const beslut = skarmbeslut(lasningen(error), Boolean(data));
  if (beslut === "fel") {
    throw new Error(`Säljtavlan: skärmen gick inte att slå upp: ${error?.code ?? ""} ${error?.message ?? ""}`.trim());
  }
  if (beslut === "ingen") return null;
  const rad = data as { id: string; name: string; sound: boolean; last_seen_at: string | null };

  const nu = Date.now();
  const sedd = rad.last_seen_at ? Date.parse(rad.last_seen_at) : NaN;
  if (!(nu - sedd < SEDD_MS)) {
    const h = request?.headers ?? (await headers());
    const { error: skrivfel } = await db
      .from("salesboard_screen")
      .update({ last_seen_at: new Date(nu).toISOString(), last_ip: klientIp(h), user_agent: webblasare(h) })
      .eq("id", rad.id);
    // En upplysning i inställningarna, inget mer. Den får inte stänga ute skärmen.
    if (skrivfel) console.error("Säljtavlan: senast sedd gick inte att skriva:", skrivfel.message);
  }

  return { id: rad.id, namn: rad.name, ljud: rad.sound };
}

/**
 * Den inloggade, om hen är en aktiv anställd, annars null. Kastar när det inte
 * går att veta.
 *
 * `getCurrentUser()` ger `employee: null` både för ett konto utan anställning och
 * när läsningen av raden föll, och den skillnaden ska den inte behöva bära. Här
 * läses raden därför en gång till med service role när employee saknas, och
 * `personbeslut` avgör: ingen rad eller en som slutat är null, ett fel eller en
 * aktiv rad som `getCurrentUser()` inte fick är ett fel.
 */
async function aktivPerson(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  let beslut = personbeslut(user);

  if (beslut === "las" && user) {
    const { data, error } = await supabaseAdmin()
      .from("employee")
      .select("status")
      .eq("auth_user_id", user.authUserId)
      .maybeSingle();
    const status = (data as { status?: unknown } | null)?.status;
    beslut = personbeslut(user, { fel: Boolean(error), status: typeof status === "string" ? status : null });
  }

  if (beslut === "fel" || beslut === "las") {
    throw new Error("Säljtavlan: den inloggades anställning gick inte att läsa.");
  }
  return beslut === "in" ? user : null;
}

/**
 * Får den som frågar se tavlan? En parad skärm går före en inloggad, så att en
 * TV som också råkar vara inloggad visar skärmens namn och ljudval.
 *
 * `request` ger adressen och webbläsaren i en rutt. En sida skickar ingen, och
 * då läses rubrikerna ur `headers()`.
 *
 * Null betyder ingen åtkomst (401). Kastar vid ett databasfel (503).
 */
export async function tavlansAtkomst(request?: Request): Promise<Atkomst | null> {
  const skarm = await skarmen(request);
  if (skarm) return { typ: "skarm", skarm };

  const user = await aktivPerson();
  return user ? { typ: "person", user } : null;
}

/**
 * Den inloggade, om hen får ändra tavlan: bara superadmin (`farAndraTavlan`).
 * Kastar, som `tavlansAtkomst`, när det inte går att veta.
 */
export async function tavlansAdmin(): Promise<CurrentUser | null> {
  const user = await aktivPerson();
  if (!user) return null;
  return farAndraTavlan(nivaFor(user.roles)) ? user : null;
}

// -----------------------------------------------------------------------------
// Kakorna. Namnen, flaggorna och förnyelsen står i `atkomstregler.ts`.
// -----------------------------------------------------------------------------

const satt = (res: NextResponse, kaka: Kaka): void => {
  res.cookies.set(kaka.namn, kaka.varde, kaka.val);
};

/** Sätter skärmkakan och tiden den sattes. */
export function sattSkarmkakan(res: NextResponse, token: string, nu: number = Date.now()): void {
  for (const kaka of skarmkakor(token, nu)) satt(res, kaka);
}

/**
 * Förnyar skärmkakan när den sattes för mer än ett dygn sedan, eller när tiden
 * saknas eller inte går att lita på. Samma token, nya 400 dagar.
 */
export async function fornyaSkarmkakan(res: NextResponse, nu: number = Date.now()): Promise<void> {
  const kakor = await cookies();
  const token = kakor.get(SKARMKAKA)?.value;
  if (!arToken(token)) return;
  if (skarmkakanBehoverFornyas(kakor.get(SKARMKAKA_TID)?.value, nu)) sattSkarmkakan(res, token, nu);
}

/** TV:ns nonce under parningen, eller null. */
export async function lasParkakan(): Promise<string | null> {
  const nonce = (await cookies()).get(PARKAKA)?.value;
  return arToken(nonce) ? nonce : null;
}

export function sattParkakan(res: NextResponse, nonce: string): void {
  satt(res, parkaka(nonce));
}

/** Tar bort parningskakan, på samma sökväg som den sattes med. */
export function taBortParkakan(res: NextResponse): void {
  satt(res, parkakanBort());
}
