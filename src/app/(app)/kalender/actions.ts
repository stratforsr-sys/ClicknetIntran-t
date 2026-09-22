"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import {
  NIVA_ETIKETT,
  POSTTYPER,
  arDelningsniva,
  GRUNDNIVA,
  type Delningsniva,
  type Posttyp,
} from "@/lib/kalender";
import { notifiera } from "@/lib/notishandelse-server";
import { skapaUppgift as skapaVanligUppgift } from "../uppgifter/actions";
import { skapaUppgift as skapaCoachningsuppgift } from "../coachning/actions";

/**
 * Kalenderns skrivningar — och de är TVÅ saker: vem som ser mer än
 * ledig/upptagen, och vägen in till de två moduler kalendern ritar.
 *
 * =============================================================================
 * KALENDERN SKRIVER INGA EGNA POSTER, OCH DET ÄR DÄRFÖR DEN HÄR FILEN ÄR KORT
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
 *
 * `skapaKalenderpost()` nedan följer exakt samma linje: den skriver ingenting
 * själv, den VÄLJER VÄG. Se rubriken där.
 * =============================================================================
 */

export type KalenderState = { fel?: string; ok?: string };

function text(form: FormData, namn: string): string {
  return String(form.get(namn) ?? "").trim();
}

// =============================================================================
// Ny post
// =============================================================================

/**
 * "Ny post" i kalendern — en uppgift eller en coachningsuppgift.
 *
 * =============================================================================
 * EN ACTION SOM VÄLJER VÄG, INTE EN ACTION SOM SKRIVER
 *
 * Beställningen 2026-09-14 var Outlooks grepp: lägg in något i kalendern och
 * välj vad det ska bli. Det som skapas är därför INGEN kalenderhändelse — det
 * är en rad i `task` eller i `coaching_task`, skriven av modulens egen
 * `skapaUppgift()`, med modulens egen behörighetskontroll, historikrad och
 * notis.
 *
 * En `skapaKalenderpost()` som skrev direkt i tabellerna hade varit kortare och
 * fel: den hade blivit ett andra svar på frågan vem som får lägga upp vad. Att
 * bara teamledare, säljchef och VD lägger upp coachningsuppgifter är
 * beställarens beslut från 2026-09-01, och det beslutet bor i `kravCoach()` —
 * inte i två filer som ska hållas lika.
 *
 * EN ACTION OCH INTE TVÅ. Två hade betytt två rader i `TACKNING`, två ställen
 * som kan glömma en revalidering, och ett gränssnitt som måste veta vilken av
 * dem som gäller innan användaren valt något.
 *
 * FORMULÄRET SKICKAS INTE VIDARE SOM DET ÄR. Det hade varit den korta vägen —
 * fälten heter redan samma sak — och det hade också betytt att ett `assignee_id`
 * avsett för coachningsvägen följt med in i uppgiftsvägen och lagt uppgiften på
 * någon annan. Varje väg bygger därför sin egen `FormData` av de fält den
 * faktiskt använder.
 * =============================================================================
 */
export async function skapaKalenderpost(
  _prev: KalenderState,
  form: FormData,
): Promise<KalenderState> {
  try {
    const user = await getCurrentUser();
    if (!user?.employee) return { fel: "Du måste vara inloggad." };

    const typ = text(form, "typ");
    if (!POSTTYPER.includes(typ as Posttyp)) return { fel: "Välj om posten är en uppgift eller coachning." };

    const titel = text(form, "title");
    if (!titel) return { fel: "Skriv vad som ska göras." };

    /**
     * DAGEN KRÄVS, till skillnad från i de två modulernas egna formulär.
     *
     * En uppgift utan datum är fullt giltig — den ligger i inkorgen och väntar
     * på att planeras. Men en post som skapas I KALENDERN och saknar dag skulle
     * försvinna ur den i samma sekund som den sparades, och det finns ingen
     * rimlig läsning där det är vad användaren menade. Rutan hon klickade på
     * fyller dessutom i fältet åt henne.
     */
    const dag = text(form, "due_date");
    const tid = text(form, "due_time");
    if (!dag) return { fel: "Välj vilken dag posten gäller." };

    const vidare = new FormData();
    vidare.set("title", titel);
    vidare.set("description_md", text(form, "description_md"));
    vidare.set("due_date", dag);
    vidare.set("due_time", tid);
    vidare.set("estimate_minutes", text(form, "estimate_minutes"));

    /**
     * 0062: UPPREPNINGSFALTEN FOLJER MED BADA VAGARNA, ORORDA.
     *
     * De tolkas av `regelUrFormular()` i den modul som far beslutet, inte har.
     * Det ar samma val som resten av funktionen gor och av samma skal: den har
     * filen VALJER VAG, den granskar ingenting. En kontroll harinne hade blivit
     * ett andra svar pa fragan vad en giltig regel ar, och det andra svaret ar
     * alltid det som glomms bort.
     *
     * `veckodag` ar FLERA VARDEN — kryssrutorna bar en var — och maste darfor
     * kopieras med `getAll`/`append`. Ett `set` hade tystat alla utom den
     * forsta, och en regel som skulle infalla mandag och torsdag hade blivit en
     * regel om bara mandagar. Samma grepp som `focus_id` nedan, av samma skal.
     */
    for (const namn of ["upprepas", "monster", "serie_starts_on", "serie_ends_on"]) {
      vidare.set(namn, text(form, namn));
    }
    for (const d of form.getAll("veckodag")) vidare.append("veckodag", String(d));

    if (typ === "uppgift") {
      /**
       * INGEN `assignee_id` OCH INGEN `till_inkorgen`. Utan båda lägger
       * `uppgifter::skapaUppgift` uppgiften på den inloggade, och det är vad en
       * post man skriver i sin egen kalender ska bli. Att delegera sker i
       * uppgiften, där kretsen syns.
       */
      vidare.set("priority", text(form, "priority") || "3");

      const svar = await skapaVanligUppgift({}, vidare);
      if (svar.fel) return { fel: svar.fel };

      revalidera();
      /**
       * EN SERIE FAR SITT EGET KVITTO. "Upplagd 2026-09-21." om en rutin som
       * gav atta mandagar sager fel sak om det som hande — och det ar precis den
       * skillnaden anvandaren behover se bekraftad. Uppgiftsmodulen har redan
       * formulerat den (`skapaSerieinternt`), sa den skickas vidare orord.
       */
      if (svar.ok && text(form, "upprepas") === "ja") return { ok: svar.ok };
      return { ok: tid ? `Upplagd ${dag} ${tid}.` : `Upplagd ${dag}.` };
    }

    // --- Coachningsuppgiften -------------------------------------------------
    //
    // Fälten är coachningens egna (0043) och skickas vidare orörda.
    // `coachning::skapaUppgift` avvisar det som inte går ihop — en typ utan sin
    // källa, en motpart som är samma person, en kvitterare som inte finns — och
    // de felmeddelandena är redan skrivna för en människa.
    for (const namn of ["assignee_id", "kind", "partner_id", "verify_by", "evidence", "course_id", "module_id", "document_id"]) {
      vidare.set(namn, text(form, namn));
    }
    for (const f of form.getAll("focus_id")) vidare.append("focus_id", String(f));

    const svar = await skapaCoachningsuppgift({}, vidare);
    if (svar.fel) return { fel: svar.fel };

    revalidera();
    return { ok: svar.ok ?? "Upplagd." };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
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
