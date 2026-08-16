import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { MFA_REQUIRED_ROLES } from "@/lib/roles";
import type { CurrentUser } from "@/lib/auth";

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

/** Har anvandaren en fardigt inskriven faktor? */
export function harVerifieradFaktor(user: CurrentUser | null): boolean {
  return (user?.factors ?? []).some((f) => f.status === "verified");
}

export const ANTAL_KODER = 10;

/**
 * Utan I, O, 0 och 1 — koden skrivs av for hand fran ett papper, och da ar
 * en tvetydig bokstav samma sak som en trasig kod. 32 tecken delar 256 jamnt,
 * sa modulo ger ingen snedfordelning.
 */
const ALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TECKEN_PER_KOD = 10; // 10 x 5 bitar = 50 bitars entropi

export function genereraKoder(antal: number = ANTAL_KODER): string[] {
  return Array.from({ length: antal }, () => {
    const bytes = randomBytes(TECKEN_PER_KOD);
    const tecken = Array.from(bytes, (b) => ALFABET[b % ALFABET.length]).join("");
    return `${tecken.slice(0, 5)}-${tecken.slice(5)}`;
  });
}

/**
 * Bindestreck, mellanslag och gemener ar hur en manniska skriver av en kod.
 * Normaliseringen sker pa bada sidor sa att alla dessa former traffar.
 */
export function normaliseraKod(kod: string): string {
  return kod.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashaKod(kod: string): string {
  return createHash("sha256").update(normaliseraKod(kod)).digest("hex");
}
