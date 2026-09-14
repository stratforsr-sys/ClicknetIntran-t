"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { NIVA_ETIKETT, arDelningsniva, GRUNDNIVA, type Delningsniva } from "@/lib/kalender";
import { notifiera } from "@/lib/notishandelse-server";

/**
 * Kalenderns skrivningar — och det är EN sak: vem som ser mer än ledig/upptagen.
 *
 * =============================================================================
 * KALENDERN SKRIVER INGA POSTER, OCH DET ÄR DÄRFÖR DEN HÄR FILEN ÄR KORT
 *
 * Att dra en uppgift till ett klockslag går genom `planera()` i
 * uppgifter/actions.ts, inte genom något härinne. Det var ett val: en egen
 * `flyttaPost()` hade varit bekvämare att skriva mot kalenderns egna typer och
 * hade blivit ett ANDRA ställe där en uppgifts datum sätts — med en egen
 * behörighetskontroll som skulle behöva hållas lika med den första.
 *
 * Uppgiftens datum ändras alltså på ett ställe i hela navet, precis som före
 * kalendern. Det som är nytt är att `planera()` numera frågar `farPlanera()`
 * i stället för `farRedigera()`, så att nivå fyra släpps in där och bara där.
 * =============================================================================
 */

export type KalenderState = { fel?: string; ok?: string };

function text(form: FormData, namn: string): string {
  return String(form.get(namn) ?? "").trim();
}

/**
 * Sätt vad en kollega får se av min kalender.
 *
 * EN ACTION FÖR ALLA FEM STEGEN, inklusive vägen tillbaka till grundläget.
 * Alternativet — "dela" och "sluta dela" som två handlingar — hade betytt att
 * gränssnittet måste veta vilken av dem som gäller innan användaren valt, och
 * den som sänker någon från delegat till "kan se rubriker" hade fått gå genom
 * båda. Väljaren i panelen har fem lägen och skickar hit det man valde.
 *
 * `upptagen` ÄR BORTTAGNING, inte en lagrad rad. Grundläget är frånvaron av en
 * rad — se rubriken i 0057 — och villkoret i databasen vägrar nivån, så det här
 * är inte en artighet utan det enda som fungerar.
 *
 * DEN SOM ÄGER RADEN ÄR DEN ENDA SOM KAN SKRIVA DEN. `owner_id` tas ur
 * sessionen och aldrig ur formuläret; annars vore fältet en plats att dela
 * någon annans kalender från.
 */
export async function stallInDelning(_prev: KalenderState, form: FormData): Promise<KalenderState> {
  try {
    const user = await getCurrentUser();
    if (!user?.employee) return { fel: "Du måste vara inloggad." };

    const mig = user.employee.id;
    const viewer = text(form, "employee_id");
    const vald = text(form, "level");

    if (!viewer) return { fel: "Välj vem det gäller." };
    if (viewer === mig) return { fel: "Din egen kalender ser du redan." };
    if (vald !== GRUNDNIVA && !arDelningsniva(vald)) return { fel: "Okänd nivå." };

    const db = supabaseAdmin();

    // Mottagaren måste finnas och vara i tjänst. En delning till en avslutad
    // anställd är en rad som ser ut att ge något och inte gör det —
    // `kalender_niva()` i 0057 svarar ändå null för den.
    const { data: mottagare } = await db
      .from("employee")
      .select("id, status")
      .eq("id", viewer)
      .maybeSingle();

    if (!mottagare || mottagare.status === "offboarded") {
      return { fel: "Personen finns inte i registret." };
    }

    const { data: forra } = await db
      .from("calendar_share")
      .select("level")
      .eq("owner_id", mig)
      .eq("viewer_id", viewer)
      .maybeSingle();

    const foreNiva = arDelningsniva((forra as { level?: string } | null)?.level)
      ? ((forra as { level: string }).level as Delningsniva)
      : GRUNDNIVA;

    if (vald === foreNiva) return { ok: "Oförändrad." };

    if (vald === GRUNDNIVA) {
      const { error } = await db
        .from("calendar_share")
        .delete()
        .eq("owner_id", mig)
        .eq("viewer_id", viewer);

      if (error) return { fel: `Gick inte att ändra: ${error.message}` };

      /**
       * ÅTERKALLANDET ÄR EN EGEN KÄLLA, och det är den av de två som är
       * nödvändig. En delning som tas bort lämnar ingen rad efter sig — det
       * finns ingenting kvar att härleda ur — och den som stått som DELEGAT
       * har handlat i någon annans namn ända fram till den här sekunden. Att
       * hon får veta att hon inte längre kan det är inte en artighet.
       */
      await notifiera({
        till: viewer,
        av: mig,
        kalla: "kalender-aterkallad",
        typ: "kalender",
        rubrik: `${user.employee.first_name} delar inte längre sin kalender`,
        detalj: "Du ser fortfarande när tiden är bokad, men inte vad den gäller.",
        href: "/kalender",
        objekt: { typ: "employee", id: mig },
      });

      revalidera();
      return { ok: "Tillbaka till ledig/upptagen." };
    }

    const niva = vald as Delningsniva;

    const { error } = await db.from("calendar_share").upsert(
      {
        owner_id: mig,
        viewer_id: viewer,
        level: niva,
        created_by: mig,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,viewer_id" },
    );

    if (error) return { fel: `Gick inte att dela: ${error.message}` };

    await notifiera({
      till: viewer,
      av: mig,
      kalla: "kalender-delad",
      typ: "kalender",
      rubrik: `${user.employee.first_name} har delat sin kalender med dig`,
      // Nivåns etikett i klartext. "Nivå 4" säger ingenting till mottagaren, och
      // det är mottagaren som ska kunna avgöra om hon fått något hon inte bett om.
      detalj: NIVA_ETIKETT[niva],
      href: "/kalender",
      objekt: { typ: "employee", id: mig },
    });

    revalidera();
    return { ok: `Delad: ${NIVA_ETIKETT[niva].toLowerCase()}.` };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}

function revalidera() {
  revalidatePath("/kalender");
  revalidatePath("/kalender/delning");
  // Delningen öppnar uppgifter för mottagaren (0057), så hennes lista kan ha
  // fått eller tappat rader.
  revalidatePath("/uppgifter");
}
