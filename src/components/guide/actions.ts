"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { hamtaLage } from "@/lib/sparrar";
import { stampelfri } from "@/lib/stampelfri";
import {
  bokforKlar,
  bokforSteg,
  aterstallGuide,
  kandGuide,
  provaOnboardad,
} from "@/lib/guider-server";

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

  /**
   * Var det den sista? Då är personen onboardad, och statusen sätts här.
   *
   * `stamplar` räknas ut på samma sätt som överallt annars —
   * `sparr.stampling && !stampelfri(roller)` — så att nämnaren blir densamma
   * som i listan och i chefens vy. Räknade vi den annorlunda här skulle en
   * säljare kunna bli "onboardad" utan att ha gjort stämplingsguiden.
   */
  const lage = await hamtaLage();
  await provaOnboardad(user, lage.stampling && !stampelfri(user.roles));

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

/**
 * Knuffar någon som stannat av i sina systemguider.
 *
 * ===========================================================================
 * DEN HÄR ÄR DEN ENDA I FILEN SOM RÖR NÅGON ANNAN ÄN DEN INLOGGADE, OCH DÄRFÖR
 * DEN ENDA SOM BEHÖVER FRÅGA OM LOV.
 *
 * De andra tar `employee_id` ur sessionen och kan därför inte missbrukas. Den
 * här får ett id utifrån — det är hela poängen med den — och måste alltså
 * kontrollera att avsändaren har med saken att göra. Ledningen får knuffa vem
 * som helst; en teamledare bara sina egna. Ingen annan får knuffa någon.
 *
 * Kontrollen görs HÄR och inte av RLS, eftersom skrivningen går via service
 * role (0042). Det är samma uppdelning som resten av navet: läsningen skyddas
 * av databasen, skrivningen av att det bara finns en väg in.
 * ===========================================================================
 *
 * TYST VID NEJ. Funktionen säger inte om personen finns eller vem som leder
 * henne — ett felmeddelande som skiljer på "får inte" och "finns inte" är en
 * väg att kartlägga personalen för den som provar id:n.
 */
export async function knuffa(employeeId: string): Promise<void> {
  if (typeof employeeId !== "string" || !/^[0-9a-f-]{36}$/i.test(employeeId)) return;

  const user = await getCurrentUser();
  if (!user?.employee) return;
  if (employeeId === user.employee.id) return; // knuffa inte dig själv

  const db = supabaseAdmin();

  const { data: mal } = await db
    .from("employee")
    .select("id, manager_id, status")
    .eq("id", employeeId)
    .maybeSingle();

  if (!mal || mal.status === "offboarded") return;

  const farKnuffa =
    hasRole(user, "sales_manager", "ceo", "admin") || mal.manager_id === user.employee.id;
  if (!farKnuffa) return;

  await db.from("guide_nudge").insert({
    employee_id: mal.id,
    nudged_by: user.employee.id,
  });

  await skrivHandelse({
    actorId: user.employee.id,
    action: "guide.nudged",
    objectType: "employee",
    objectId: mal.id,
    reason: "Knuff om systemguider",
  });

  revalidatePath("/utbildning/oversikt/systemguider");
}
