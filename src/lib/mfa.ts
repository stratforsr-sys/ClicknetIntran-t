import "server-only";
import { SUPABASE_SERVICE_KEY } from "@/lib/env";
import { MFA_REQUIRED_ROLES } from "@/lib/roles";
import type { CurrentUser } from "@/lib/auth";

/**
 * Steg tva vid inloggning: en engangskod till e-posten.
 *
 * Supabase egna MFA-typer ar TOTP, telefon och WebAuthn — e-post finns inte
 * bland dem. Steget ar darfor byggt har: koden skickas med Supabase
 * e-post-OTP, och nar den stammer skrivs ett signerat kvitto i en kaka.
 *
 * Kvittot ar HMAC over anvandarens id och en utgangstid. Det gar inte att
 * skriva utan hemligheten och gar inte att flytta till ett annat konto. Det ar
 * ett kvitto pa ett genomfort steg, inte en inloggning: utan giltig session ar
 * det vardelost.
 */

export const STEG2_KAKA = "nav_steg2";

/** Hur lange en enhet slipper koden. AC-1.1 sager inget om intervall. */
export const STEG2_DYGN = 30;

/**
 * AC-1.1, K33. Kravet foljer inte rollen ensam utan aven rattigheten
 * payroll_cost_viewer: den som ser vad kollegorna kostar ar ett lika
 * intressant mal som den som kan andra loner.
 */
export function kraverMfa(user: CurrentUser | null): boolean {
  if (!user?.employee) return false;
  if (user.roles.some((r) => MFA_REQUIRED_ROLES.includes(r))) return true;
  return user.permissions.includes("payroll_cost_viewer");
}

/**
 * Egen hemlighet om den finns, annars service role-nyckeln. Att falla tillbaka
 * ar med flit: en saknad miljovariabel far inte gora att ingen kan skriva ett
 * kvitto och alla chefer star utanfor. Byts nyckeln maste alla verifiera om,
 * vilket ar ratt beteende.
 */
function hemlighet(): string {
  return process.env.STEG2_SECRET || SUPABASE_SERVICE_KEY;
}

async function nyckel(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(hemlighet()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signera(data: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await nyckel(), new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Konstant tid: en jamforelse som avbryter tidigt lacker signaturen tecken for tecken. */
function likaLangsamt(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let skillnad = 0;
  for (let i = 0; i < a.length; i++) skillnad |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return skillnad === 0;
}

export async function skapaKvitto(authUserId: string): Promise<{ varde: string; utgang: Date }> {
  const utgang = new Date(Date.now() + STEG2_DYGN * 24 * 60 * 60 * 1000);
  const kropp = `${authUserId}.${utgang.getTime()}`;
  return { varde: `${kropp}.${await signera(kropp)}`, utgang };
}

export async function kvittoGiltigt(
  varde: string | undefined,
  authUserId: string,
): Promise<boolean> {
  if (!varde) return false;
  const bitar = varde.split(".");
  if (bitar.length !== 3) return false;

  const [id, utgang, sig] = bitar;
  if (id !== authUserId) return false;

  const tid = Number(utgang);
  if (!Number.isFinite(tid) || tid < Date.now()) return false;

  return likaLangsamt(sig, await signera(`${id}.${utgang}`));
}
