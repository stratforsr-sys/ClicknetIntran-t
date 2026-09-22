"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { svensktDatum } from "@/lib/klocka";
import { veckostart } from "@/lib/kalender";
import { stegantal, totaltAttGaIgenom, type Genomgangsrad } from "@/lib/genomgang";
import { hamtaUppgiftsbild, stilla } from "@/lib/uppgifter-server";

/**
 * Veckogenomgångens enda skrivning.
 *
 * ALLA ANDRA HANDLINGAR I GENOMGÅNGEN ÄR LÅNADE. Steg 1 och 2 flyttar rader med
 * `planera()`, steg 2 tar en rad ur inkorgen med `tilldela()`, och båda stryker
 * med `avbryt()` — alla tre bor i `uppgifter/actions.ts` och har gjort det
 * sedan 0054. Att skriva egna hade betytt en andra behörighetskontroll per
 * handling, och två kontroller på samma fråga glider isär. Det är den sortens
 * glidning som en dag släpper ut någons anteckningar.
 *
 * Kvar blir alltså en enda sak som är genomgångens egen: att den är gjord.
 */

export type GenomgangState = { fel?: string; ok?: string; kvar?: number };

/**
 * Bokför veckan som avbetad.
 *
 * =============================================================================
 * VECKAN OCH ANTALET RÄKNAS PÅ SERVERN, ALDRIG UR FORMULÄRET
 *
 * Samma linje som utköpet på ordern (0060) och serietillhörigheten i 0062 drar:
 * ett `week_start` i ett formulär är en plats att kvittera någon annans vecka
 * ifrån, eller sin egen vecka i oktober i september. Båda värdena kommer
 * därför ur `svensktDatum()` och ur en läsning som RLS redan gjort urvalet i.
 *
 * `remaining` räknas med SAMMA funktion som ritade stegen. Ett andra räknesätt
 * hade gett ett kvitto som motsäger sidan det kvitterar — se rubriken i 0066.
 * =============================================================================
 */
export async function slutforGenomgang(
  _prev: GenomgangState,
  _form: FormData,
): Promise<GenomgangState> {
  try {
    const user = await getCurrentUser();
    if (!user?.employee) return { fel: "Du måste vara inloggad." };

    const mig = user.employee.id;
    const idag = svensktDatum();
    const vecka = veckostart(idag);

    const bild = await hamtaUppgiftsbild(user);
    const rader: Genomgangsrad[] = bild.uppgifter.map((u) => ({ ...u, stilla: stilla(u, bild.idag) }));
    const kvar = totaltAttGaIgenom(stegantal(rader, bild.projekt, mig, bild.idag));

    /**
     * `upsert` OCH INTE `insert`, och konfliktmålet är det unika villkoret i
     * 0066. Den som går igenom veckan två gånger — vilket är fullt rimligt, man
     * kan komma på något efter lunch — ska inte mötas av ett databasfel, och
     * den andra genomgången ska skriva över den förstas tal.
     */
    const { error } = await supabaseAdmin()
      .from("weekly_review")
      .upsert(
        {
          employee_id: mig,
          week_start: vecka,
          completed_at: new Date().toISOString(),
          remaining: kvar,
        },
        { onConflict: "employee_id,week_start" },
      );

    if (error) return { fel: `Genomgången bokfördes inte: ${error.message}` };

    /**
     * Kalendern revalideras INTE här, till skillnad från `uppdatera()` i
     * uppgifter/actions.ts. Genomgången i sig flyttar ingenting — det gjorde
     * `planera()` och `avbryt()` inne i stegen, och de revaliderar redan. Det
     * som ändrats av just den här skrivningen är kortet på uppgiftssidan och
     * posten i klockan.
     */
    revalidatePath("/uppgifter");
    revalidatePath("/uppgifter/genomgang");
    revalidatePath("/");

    return {
      ok:
        kvar === 0
          ? "Veckan är avbetad. Ingenting står kvar."
          : `Genomgången är bokförd. ${kvar} ${kvar === 1 ? "rad" : "rader"} står kvar — det är ett val och inte en glömska.`,
      kvar,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}
