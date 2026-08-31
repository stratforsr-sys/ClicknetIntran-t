"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { bokforKlar, bokforSteg, aterstallGuide, kandGuide } from "@/lib/guider-server";

/**
 * Slutpunkterna som en pågående tur skriver mot.
 *
 * ===========================================================================
 * TRE REGLER SOM GÄLLER VARJE FUNKTION HÄR, OCH SOM INTE FÅR LUCKRAS UPP
 *
 * 1. `employee_id` KOMMER UR SESSIONEN. Aldrig ur ett argument. Allt som
 *    exporteras ur den här filen är en publik slutpunkt som vem som helst med
 *    ett konto kan anropa med vilka värden som helst — ett id i argumentlistan
 *    hade varit en knapp för att bokföra andras onboarding.
 *
 * 2. SLUGEN SLÅS UPP I REGISTRET. `kandGuide()` är enda vägen. Utan det kan man
 *    fylla tabellen med rader för guider som inte finns, och chefsöversikten
 *    får senare räkna på skräp.
 *
 * 3. STEGET KLÄMS MOT GUIDENS LÄNGD. Talet kommer från webbläsaren och är
 *    därför inte att lita på. Det värsta ett påhittat tal kan göra är att
 *    flytta personens egen bokmärkning, men en tur som "återupptas" på steg
 *    tvåtusen är en trasig skärm, och det ska inte gå att beställa.
 * ===========================================================================
 *
 * INGEN `revalidatePath` I DE TVÅ FÖRSTA. Overlayen håller sitt eget läge och
 * navigerar inte; en revalidering hade slagit ut cachen för varenda sida för
 * att någon klickade sig vidare i en ruta. Samma resonemang som står över
 * `markeraNotiserLasta()` i shell/notiser-actions.ts.
 */

export async function bokforGuidesteg(slug: string, steg: number): Promise<void> {
  const guide = kandGuide(slug);
  if (!guide) return;

  const user = await getCurrentUser();
  if (!user?.employee) return;

  const tryggt = Math.min(Math.max(0, Math.trunc(Number(steg) || 0)), guide.steg.length);
  await bokforSteg(user.employee.id, guide.slug, guide.version, tryggt);
}

export async function bokforGuideKlar(slug: string): Promise<void> {
  const guide = kandGuide(slug);
  if (!guide) return;

  const user = await getCurrentUser();
  if (!user?.employee) return;

  await bokforKlar(user.employee.id, guide.slug, guide.version, guide.steg.length);

  // Här revaliderar vi. Listan över systemguider visar "Klar" i stället för
  // "Pågår", och den som just avslutat turen och går dit ska inte mötas av en
  // cachad sida som påstår att hon står kvar på steg tio.
  revalidatePath("/utbildning/systemguider");
}

/** Gör om en guide frivilligt. Anropas från listan, inte från overlayen. */
export async function borjaOmGuide(slug: string): Promise<void> {
  const guide = kandGuide(slug);
  if (!guide) return;

  const user = await getCurrentUser();
  if (!user?.employee) return;

  await aterstallGuide(user.employee.id, guide.slug);
  revalidatePath("/utbildning/systemguider");
}
