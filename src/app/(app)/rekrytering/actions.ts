"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { BEDOMDA_STEG, nastaSteg, type Steg } from "@/lib/rekrytering";
import { laggUppAnstalld } from "@/lib/anstallning-server";
import { skapaAvtalsutkast } from "@/lib/avtal-server";
import { VARIABELNYCKLAR } from "@/lib/avtal";
import { checklista } from "@/lib/onboarding";
import { type Role } from "@/lib/roles";

export type RekryteringState = { fel?: string };

/**
 * E10. Samma krets som `far_rekrytera()` i 0030.
 *
 * Villkoret star pa tva stallen: har, sa att sidan kan neka innan den skriver,
 * och i RLS, som ar det som faktiskt avgor vad som gar att lasa. Skulle de
 * glida isar ar det databasen som vinner.
 */
function farRekrytera(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return (
    hasRole(user, "sales_manager", "ceo", "admin") ||
    Boolean(user?.permissions.includes("recruiter"))
  );
}

async function kravRekryterare() {
  const user = await getCurrentUser();
  if (!user?.employee || !farRekrytera(user)) throw new Error("Du saknar behörighet.");
  return user;
}

/**
 * AC-7.2: en ny kandidat.
 *
 * Kallan ar obligatorisk. Den gar inte att rekonstruera i efterhand, och utan
 * den ar E10.10 trattrapporten en tabell med en enda rad som heter "okant".
 */
export async function nyKandidat(_prev: RekryteringState, form: FormData): Promise<RekryteringState> {
  const user = await kravRekryterare();

  const fornamn = String(form.get("fornamn") ?? "").trim();
  const efternamn = String(form.get("efternamn") ?? "").trim();
  const epost = String(form.get("epost") ?? "").trim().toLowerCase();
  const kalla = String(form.get("kalla") ?? "").trim();

  if (!fornamn || !efternamn) return { fel: "Fyll i namnet." };
  if (!epost.includes("@")) return { fel: "Fyll i en e-postadress." };
  if (!kalla) return { fel: "Välj varifrån ansökan kom." };

  const { data, error } = await supabaseAdmin()
    .from("candidate")
    .insert({
      first_name: fornamn,
      last_name: efternamn,
      email: epost,
      phone: String(form.get("telefon") ?? "").trim() || null,
      source_slug: kalla,
      role_title: String(form.get("roll") ?? "").trim() || "Säljare",
      notes: String(form.get("anteckning") ?? "").trim() || null,
      created_by: user.employee!.id,
    })
    .select("id")
    .single();

  // K27-villkoret i 0030 slar till pa en anteckning som bar ett personnummer.
  // Meddelandet ska saga VAD som ar fel, inte "det gick inte".
  if (error) {
    return {
      fel: error.message.includes("personnummer")
        ? "Anteckningen ser ut att innehålla ett personnummer. Navet lagrar inga (K27)."
        : "Kandidaten kunde inte sparas. Försök igen.",
    };
  }

  revalidatePath("/rekrytering");
  redirect(`/rekrytering/${data.id}`);
}

/**
 * AC-7.3: flyttar kandidaten ett steg.
 *
 * Kontrollen av vilket steg som ar tillatet ligger i triggern
 * `candidate_stegbyte` — den har bara ritar ratt knappar. Ett fel darifran
 * skickas vidare i klartext, eftersom det sager exakt vad som var fel
 * ("Steget offer gar inte att na fran screening").
 */
export async function flyttaSteg(form: FormData): Promise<void> {
  await kravRekryterare();

  const id = String(form.get("id") ?? "");
  const till = String(form.get("till") ?? "") as Steg;
  const fran = String(form.get("fran") ?? "") as Steg;

  if (!nastaSteg(fran).includes(till)) throw new Error("Det steget går inte härifrån.");

  const rad: Record<string, unknown> = { stage: till };
  if (till === "rejected") {
    rad.rejected_reason = String(form.get("skal") ?? "").trim() || null;
  }

  const { error } = await supabaseAdmin().from("candidate").update(rad).eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/rekrytering");
  revalidatePath(`/rekrytering/${id}`);
}

/**
 * AC-7.6: en scorecard per intervju och intervjuare.
 *
 * `upsert` och inte `insert`: en intervjuare som fyller i samma steg igen
 * rattar sitt omdome. Tva rader fran samma person om samma intervju ar inte
 * tva omdomen, det ar ett omdome och en angerknapp.
 */
export async function sparaScorecard(
  _prev: RekryteringState,
  form: FormData,
): Promise<RekryteringState> {
  const user = await kravRekryterare();

  const id = String(form.get("id") ?? "");
  const steg = String(form.get("steg") ?? "") as Steg;
  const rekommendation = String(form.get("rekommendation") ?? "");

  if (!BEDOMDA_STEG.includes(steg)) return { fel: "Det steget bedöms inte." };
  if (!["yes", "no", "maybe"].includes(rekommendation)) return { fel: "Välj en rekommendation." };

  const { error } = await supabaseAdmin()
    .from("interview_scorecard")
    .upsert(
      {
        candidate_id: id,
        stage: steg,
        interviewer_id: user.employee!.id,
        recommendation: rekommendation,
        strengths: String(form.get("styrkor") ?? "").trim() || null,
        concerns: String(form.get("tveksamheter") ?? "").trim() || null,
      },
      { onConflict: "candidate_id,stage,interviewer_id" },
    );

  if (error) {
    return {
      fel: error.message.includes("personnummer")
        ? "Anteckningen ser ut att innehålla ett personnummer. Navet lagrar inga (K27)."
        : "Scorecarden kunde inte sparas. Försök igen.",
    };
  }

  revalidatePath(`/rekrytering/${id}`);
  return {};
}

/**
 * AC-7.5: kandidaten kom inte till intervjun.
 *
 * En raknare och inte en flagga. Att nagon uteblev en gang och kom nasta gang
 * ar en annan uppgift an att hen uteblev tva ganger, och trattrapporten per
 * kalla behover den skillnaden.
 */
export async function registreraNoShow(form: FormData): Promise<void> {
  await kravRekryterare();
  const id = String(form.get("id") ?? "");

  const db = supabaseAdmin();
  const { data } = await db.from("candidate").select("no_show_count").eq("id", id).single();
  if (!data) throw new Error("Kandidaten finns inte.");

  const { error } = await db
    .from("candidate")
    .update({ no_show_count: (data.no_show_count ?? 0) + 1 })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/rekrytering/${id}`);
}

/**
 * AC-7.8: talangpoolen.
 *
 * Samtycket far ett datum i samma skrivning som flaggan. Villkoret i 0030
 * nekar annars raden — en talangpool utan samtycke ar bara ett register over
 * folk som sokt jobb.
 */
export async function sattTalangpool(form: FormData): Promise<void> {
  await kravRekryterare();

  const id = String(form.get("id") ?? "");
  const pa = form.get("pa") === "1";

  const { error } = await supabaseAdmin()
    .from("candidate")
    .update({
      talent_pool: pa,
      talent_pool_consent: pa ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/rekrytering/${id}`);
}

export type AnstallState = {
  fel?: string;
  /** Visas EN gang och sparas ingenstans. Se laggUppAnstalld i lib. */
  losenord?: string;
  anstalldId?: string;
  namn?: string;
  avtalId?: string;
  /** Sant nar personen ar upplagd men nagot EFTER det gick fel. */
  halvvags?: boolean;
};

/**
 * E10.9 / AC-7.9: kandidaten blir anstalld.
 *
 * ===========================================================================
 * ORDNINGEN, OCH VAD SOM HANDER OM DET BRISTER MITT I
 *
 * Floden spanner over auth och databasen och har darfor ingen gemensam
 * transaktion. Stegen ligger i den ordning dar ett avbrott lamnar nagot
 * halvfardigt men inget motsagelsefullt:
 *
 *   1. konto + employee-rad   -- en anstalld utan kandidatkoppling ar giltig
 *   2. kopplingen OCH steget  -- en enda skrivning, se nedan
 *   3. avtalsutkast, checklista, logg -- bekvamlighet, gar att gora om
 *
 * Steg 2 ar det enda som inte gar att angra, och det ar darfor det ligger fore
 * allt som bara ar bekvamlighet. Brister det star kandidaten kvar pa `offer`
 * med en anstalld som redan finns — ett lage nagon KAN se och rata. Motsatsen,
 * en kandidat markt som anstalld utan att personen finns, hade inte gatt att
 * upptacka utan att leta.
 *
 * `hired_employee_id` och `stage` skrivs i SAMMA update med flit. Triggern
 * `candidate_stegbyte` i 0030 nekar `hired` utan koppling, sa tva skrivningar
 * hade krävt att kopplingen sattes forst — och en kandidat som pekar pa en
 * anstalld utan att sta pa `hired` ar precis det motsagelsefulla lage ordningen
 * ovan finns for att undvika.
 * ===========================================================================
 *
 * INGEN REDIRECT NAR DET GAR VAGEN. Det tillfalliga losenordet visas en gang
 * och gar inte att bara till nasta sida utan att ligga i en URL — dar det
 * hamnar i webbhistoriken, i Vercels loggar och i varje mellanliggande proxy.
 * Samma skal som `laggUppAnstalld` pa /personal/ny.
 */
export async function anstallKandidat(
  _prev: AnstallState,
  form: FormData,
): Promise<AnstallState> {
  try {
    const user = await kravRekryterare();
    const db = supabaseAdmin();

    const kandidatId = String(form.get("kandidat_id") ?? "");
    const { data: kandidat } = await db
      .from("candidate")
      .select("id, first_name, last_name, stage, hired_employee_id, role_title")
      .eq("id", kandidatId)
      .maybeSingle();

    if (!kandidat) return { fel: "Kandidaten finns inte." };
    if (kandidat.hired_employee_id) {
      return { fel: "Kandidaten är redan anställd. Ett dubbelklick skapar ingen andra person." };
    }
    if (kandidat.stage !== "offer") {
      return {
        fel: "Bara en kandidat som fått ett erbjudande kan anställas. Flytta först kandidaten till erbjudande.",
      };
    }

    // Steg 1. E-posten kommer ur formularet och inte fran kandidatraden: den
    // adressen ar en privat ansokningsadress, och det ar arbetsadressen som
    // blir inloggning i navet. Att forifylla den privata hade gjort den till
    // standardvalet.
    const uppgifter = {
      epost: String(form.get("epost") ?? "").trim().toLowerCase(),
      fornamn: kandidat.first_name,
      efternamn: kandidat.last_name,
      roll: String(form.get("roll") ?? "salesperson") as Role,
      anstallningsform: String(form.get("anstallningsform") ?? "permanent"),
      startdatum: String(form.get("startdatum") ?? "") || null,
      anstallningsnummer: String(form.get("anstallningsnummer") ?? "").trim() || null,
      teamId: String(form.get("team_id") ?? "") || null,
    };

    const namn = `${kandidat.first_name} ${kandidat.last_name}`;
    const svar = await laggUppAnstalld(uppgifter, user.employee!.id);
    if ("fel" in svar) return { fel: svar.fel };

    // Steg 2. Den enda skrivningen som inte gar att gora om.
    const { error: stegfel } = await db
      .from("candidate")
      .update({ hired_employee_id: svar.employeeId, stage: "hired" })
      .eq("id", kandidatId);

    if (stegfel) {
      return {
        halvvags: true,
        anstalldId: svar.employeeId,
        losenord: svar.losenord,
        namn,
        fel: `${namn} är upplagd som anställd, men kandidatraden kunde inte uppdateras: ${stegfel.message} Kandidaten står kvar på erbjudande. Lösenordet nedan gäller — skriv ner det nu, det visas inte igen.`,
      };
    }

    // Steg 3. Avtalsutkastet, om en mall valdes.
    //
    // Kretsen som far skapa avtal ar SMALARE an den som far rekrytera — se
    // rubriken i src/lib/avtal-server.ts. En rekryterare utan ledningsroll far
    // ingen mallvaljare, och da faller punkten till checklistan i stallet.
    let avtalId: string | undefined;
    let avtalsfel: string | undefined;
    const mallId = String(form.get("mall_id") ?? "");

    if (mallId && hasRole(user, "sales_manager", "ceo", "admin")) {
      const handskrivna: Record<string, string> = {};
      for (const nyckel of VARIABELNYCKLAR) {
        handskrivna[nyckel] = String(form.get(`var_${nyckel}`) ?? "");
      }
      const utkast = await skapaAvtalsutkast(svar.employeeId, mallId, handskrivna, user.employee!.id);
      if ("fel" in utkast) avtalsfel = utkast.fel;
      else avtalId = utkast.avtalId;
    }

    // Checklistan. Punkterna som floden redan utfort fods avbockade — se
    // rubriken i src/lib/onboarding.ts.
    const nu = new Date().toISOString();
    await db.from("onboarding_task").insert(
      checklista(Boolean(avtalId), svar.kurser.length).map((p, i) => ({
        employee_id: svar.employeeId,
        label: p.label,
        sort: i,
        state: p.automatisk ? "done" : "open",
        handled_by: p.automatisk ? user.employee!.id : null,
        handled_at: p.automatisk ? nu : null,
      })),
    );

    await db.from("audit_log").insert({
      actor_id: user.employee!.id,
      action: "candidate.hired",
      object_type: "candidate",
      object_id: kandidatId,
      meta: {
        employee_id: svar.employeeId,
        roll: uppgifter.roll,
        avtal: avtalId ?? null,
        rutiner: svar.rutiner.length,
        kurser: svar.kurser.length,
      },
    });

    revalidatePath("/rekrytering");
    revalidatePath(`/rekrytering/${kandidatId}`);
    revalidatePath("/personal");

    return {
      anstalldId: svar.employeeId,
      losenord: svar.losenord,
      namn,
      avtalId,
      // Avtalet ar det enda i steg 3 som kan falla for sig, och tystnad om det
      // hade betytt att nagon letar efter ett utkast som aldrig skapades.
      fel: avtalsfel ? `Allt annat gick igenom, men avtalsutkastet skapades inte: ${avtalsfel}` : undefined,
    };
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }
}
