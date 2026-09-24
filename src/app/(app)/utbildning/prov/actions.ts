"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, type CurrentUser } from "@/lib/auth";
import { certifieraPerson, farTaModul, loggaKurs } from "@/lib/utbildning-server";
import { notifiera } from "@/lib/notishandelse-server";
import { provprocent, saknadeSvar, MINSTA_SVAR } from "@/lib/prov";
import type { KursState } from "../actions";

/**
 * Det skriftliga provet (0067): skriva, lamna in, ratta, skicka tillbaka.
 *
 * ===========================================================================
 * FYRA HANDLINGAR, TVA PERSONER, EN RAD
 *
 * `essay_submission` ar ETT FORSOK och inte ett formular. Saljaren skriver i
 * den (`sparaUtkast`), lamnar in den (`lamnaProv`), och sedan ar det chefens
 * rad: hon rattar den (`rattaProv`) eller skickar tillbaka den (`returneraProv`).
 *
 * Statusen ar det enda som avgor vem som far gora vad, och den kontrolleras i
 * VARJE handling. Ett prov som ligger hos chefen far inte skrivas om av den som
 * lamnade in det, och ett prov som ar rattat far inte rattas en gang till —
 * betyget ar bokfort i `course_attempt` och det gar inte att ta tillbaka.
 * ===========================================================================
 */

/**
 * Far ratta andras prov.
 *
 * ALLA CHEFER, INTE BARA DEN SOM LEDER PERSONEN. Det skiljer sig fran
 * rollspelets `farBedoma()` och ar beställarens uttryckliga val — se rubriken i
 * 0067. Kretsen star pa TVA stallen, har och i policyn `essay_submission_read`,
 * och de maste vara samma: vyn visar det policyn slapper fram, och en handling
 * som racker langre an lasningen hade gett ett knappfel i stallet for ett nej.
 */
function farRatta(user: CurrentUser | null): boolean {
  return hasRole(user, "sales_manager", "team_lead", "admin", "ceo");
}

/** Hamtar (eller oppnar) det oppna forsoket for den inloggade. */
async function oppetForsok(user: CurrentUser, modulId: string, skapa: boolean) {
  const db = supabaseAdmin();

  const { data: modul } = await db
    .from("course_module")
    .select("id, course_id, kind")
    .eq("id", modulId)
    .maybeSingle();

  if (!modul || modul.kind !== "fritext") return { fel: "Modulen är inte ett skriftligt prov." };

  const { data: fanns } = await db
    .from("essay_submission")
    .select("id, status, course_id")
    .eq("module_id", modulId)
    .eq("employee_id", user.employee!.id)
    .neq("status", "rattad")
    .maybeSingle();

  if (fanns) return { forsok: fanns, kursId: modul.course_id };
  if (!skapa) return { fel: "Provet är inte påbörjat." };

  // Sparrtiden galler ett UNDERKANT forsok, precis som for quizet (AC-6.2).
  // Kursen "Saljstruktur" har noll timmar, men regeln bor i koden och inte i
  // raden — nasta kurs kan valja annat.
  const [{ data: kurs }, { data: senaste }] = await Promise.all([
    db.from("course").select("retry_wait_hours").eq("id", modul.course_id).maybeSingle(),
    db
      .from("essay_submission")
      .select("graded_at, attempt_id")
      .eq("module_id", modulId)
      .eq("employee_id", user.employee!.id)
      .eq("status", "rattad")
      .order("graded_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (senaste?.attempt_id && (kurs?.retry_wait_hours ?? 0) > 0) {
    const { data: forsok } = await db
      .from("course_attempt")
      .select("passed, created_at")
      .eq("id", senaste.attempt_id)
      .maybeSingle();

    if (forsok && !forsok.passed) {
      const oppnar = new Date(forsok.created_at);
      oppnar.setHours(oppnar.getHours() + (kurs?.retry_wait_hours ?? 0));
      if (oppnar > new Date()) {
        return { fel: `Nästa försök går att börja ${oppnar.toLocaleString("sv-SE")}.` };
      }
    }
  }

  const { data: ny, error } = await db
    .from("essay_submission")
    .insert({
      module_id: modulId,
      course_id: modul.course_id,
      employee_id: user.employee!.id,
      status: "utkast",
    })
    .select("id, status, course_id")
    .single();

  if (error || !ny) return { fel: "Provet kunde inte öppnas." };
  return { forsok: ny, kursId: modul.course_id };
}

/**
 * Skriver ner svaren utan att lamna in. Anropas bade av knappen och av
 * spartimern.
 *
 * FRAGORNA HAMTAS UR MODULEN och inte ur formularet, trots att formularet redan
 * bar dem. Faltnamnen kommer fran webblasaren, och den som byter ut ett id i
 * dem hade annars fatt ett svar pa en annan kurs fraga inskrivet under sitt
 * eget forsok. Det skadar ingen, men det gor `essay_answer` till en tabell dar
 * raderna inte langre hanger ihop med sin modul.
 */
async function skrivSvar(submissionId: string, modulId: string, form: FormData): Promise<number> {
  const db = supabaseAdmin();

  const { data: fragor } = await db
    .from("essay_question")
    .select("id")
    .eq("module_id", modulId);

  let skrivna = 0;
  for (const f of fragor ?? []) {
    if (!form.has(`svar_${f.id}`)) continue;
    const text = String(form.get(`svar_${f.id}`) ?? "");
    // Texten sparas som den skrevs, utom for blanksteg i kanterna. Ett prov ar
    // inte kod och far innehalla vad som helst — det ar en textkolumn och den
    // renderas som text, aldrig som markdown.
    const { error } = await db.from("essay_answer").upsert(
      {
        submission_id: submissionId,
        question_id: f.id,
        body: text.slice(0, 8000).trimEnd(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "submission_id,question_id" },
    );
    if (!error) skrivna++;
  }

  await db
    .from("essay_submission")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", submissionId);

  return skrivna;
}

/**
 * AUTOSPAR OCH SPARAKNAPP AR SAMMA HANDLING.
 *
 * Tjugo fritextsvar ar fyrtio minuters arbete, och ett formular som bara finns
 * i webblasaren tills man trycker pa ratt knapp ar fyrtio minuter som kan
 * forsvinna i en stangd flik. Utkastet skrivs darfor ner medan hon skriver.
 *
 * Handlingen ar INTE idempotent-kanslig: den skriver over svaret pa varje fraga
 * som star i formularet, och ingenting annat. Kommer tva sparningar i fel
 * ordning vinner den sista, vilket ar samma regel som varje textfalt i navet.
 */
export async function sparaUtkast(_prev: KursState, form: FormData): Promise<KursState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const modulId = String(form.get("modul_id") ?? "");
  if (!modulId) return { fel: "Något saknas i formuläret." };
  if (!(await farTaModul(user, modulId)))
    return { fel: "Ta modulerna i ordning — den här är inte öppen än." };

  const svar = await oppetForsok(user, modulId, true);
  if ("fel" in svar) return { fel: svar.fel };

  if (svar.forsok.status !== "utkast" && svar.forsok.status !== "retur") {
    return { fel: "Provet är inlämnat och går inte att ändra." };
  }

  await skrivSvar(svar.forsok.id, modulId, form);
  revalidatePath("/utbildning", "layout");
  return { ok: `Sparat ${new Date().toLocaleTimeString("sv-SE", { timeStyle: "short" })}.` };
}

/**
 * Inlamningen.
 *
 * SPARRAS AV TOMMA SVAR, och det ar inte ett kvalitetskrav. Rattningen ar en
 * manniskas fyrtio minuter, och ett prov med sex tomma rutor kostar en hel
 * rattningsrunda att upptacka. Gransen ar `MINSTA_SVAR` tecken — den skiljer ett
 * svar fran ett streck, ingenting annat. Vad svaret ar VART ar chefens sak.
 */
export async function lamnaProv(_prev: KursState, form: FormData): Promise<KursState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const modulId = String(form.get("modul_id") ?? "");
  if (!modulId) return { fel: "Något saknas i formuläret." };
  if (!(await farTaModul(user, modulId)))
    return { fel: "Ta modulerna i ordning — den här är inte öppen än." };

  const svar = await oppetForsok(user, modulId, true);
  if ("fel" in svar) return { fel: svar.fel };
  if (svar.forsok.status !== "utkast" && svar.forsok.status !== "retur") {
    return { fel: "Provet är redan inlämnat." };
  }

  const db = supabaseAdmin();
  await skrivSvar(svar.forsok.id, modulId, form);

  const [{ data: fragor }, { data: svaren }] = await Promise.all([
    db.from("essay_question").select("id, sort").eq("module_id", modulId).order("sort"),
    db.from("essay_answer").select("question_id, body").eq("submission_id", svar.forsok.id),
  ]);

  const lista = fragor ?? [];
  if (lista.length === 0) return { fel: "Provet har inga frågor än." };

  const text: Record<string, string> = {};
  for (const s of svaren ?? []) text[s.question_id] = s.body;

  const saknas = saknadeSvar(lista, text);
  if (saknas.length > 0) {
    return {
      fel:
        saknas.length === 1
          ? `Fråga ${saknas[0]} saknar svar. Alla tjugo behöver minst ${MINSTA_SVAR} tecken.`
          : `${saknas.length} frågor saknar svar: ${saknas.join(", ")}.`,
    };
  }

  const { error } = await db
    .from("essay_submission")
    .update({
      status: "inlamnad",
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", svar.forsok.id);

  if (error) return { fel: "Provet kunde inte lämnas in." };

  await loggaKurs(user.employee.id, "prov.inlamnat", svar.kursId, {
    modul: modulId,
    fragor: lista.length,
  });

  // Ingen notisrad skrivs har. Chefens post ar HARLEDD ur statusen
  // (`notiser-server.ts`) och faller darmed bort av sig sjalv i samma sekund
  // provet ar rattat — en skriven rad hade legat kvar efterat.
  revalidatePath("/utbildning", "layout");
  revalidatePath("/");
  return { ok: "Inlämnat. Din chef rättar provet och du får svar i navet." };
}

/**
 * Rattningen.
 *
 * Skriver ett `course_attempt` — samma tabell som quizet och rollspelet,
 * eftersom alla tre ar "nagon provades och fick ett resultat" (0007).
 */
export async function rattaProv(_prev: KursState, form: FormData): Promise<KursState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };
  if (!farRatta(user)) return { fel: "Du saknar behörighet att rätta prov." };

  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim();

  const db = supabaseAdmin();
  const { data: inlamning } = await db
    .from("essay_submission")
    .select("id, module_id, course_id, employee_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!inlamning) return { fel: "Inlämningen finns inte." };
  if (inlamning.status === "rattad") return { fel: "Provet är redan rättat." };
  if (inlamning.status === "utkast") return { fel: "Provet är inte inlämnat än." };

  /**
   * DET EGNA PROVET GAR ATT RATTA, och det ar ett andrat beslut.
   *
   * Forst stod har samma sparr som rollspelet har: "du rattar inte ditt eget".
   * Den var fel av tva skal.
   *
   * DET FORSTA ar att den gjorde modulen omojlig att prova. Den som bygger en
   * kurs skriver provet sjalv for att se hur det ar att gora det — och motte da
   * en rattningsvy dar varenda knapp och varje kommentarfalt var utgraat, utan
   * annan vag framat an att be en kollega skriva tjugo svar.
   *
   * DET ANDRA ar att sparren skyddade mot nagot som inte finns. Bara en
   * chefsroll kan alls ratta (se `farRatta`), och certifikatet oppnar ingenting
   * — `course.blocks_capability` star oanvand sedan 0007. En saljare kan alltsa
   * aldrig ratta sig sjalv, och det en chef kan ge sig sjalv ar ett papper utan
   * lås bakom.
   *
   * Det som star kvar ar SPARET: `graded_by` bar vem som satte betyget, och
   * `audit_log` far `eget: true` nar det ar samma person. En sjalvrattning gar
   * att se, och det ar vad den behover.
   */
  const eget = inlamning.employee_id === user.employee.id;

  // AC-6.7:s regel, ordagrant lanad fran rollspelet: ett betyg utan ord larde
  // ingen sig nagot av, och det ar hela skalet att provet skrivs med egna ord.
  if (note.length < 10)
    return { fel: "Skriv en återkoppling. Ett betyg utan ord lär ingen sig något av." };

  const [{ data: fragor }, { data: kurs }] = await Promise.all([
    db.from("essay_question").select("id, sort, max_points").eq("module_id", inlamning.module_id).order("sort"),
    db.from("course").select("pass_threshold, valid_months").eq("id", inlamning.course_id).maybeSingle(),
  ]);

  const lista = fragor ?? [];
  if (lista.length === 0) return { fel: "Provet saknar frågor att sätta poäng på." };

  const poang: Record<string, number> = {};
  for (const f of lista) {
    const varde = Number(form.get(`poang_${f.id}`) ?? NaN);
    if (!Number.isInteger(varde) || varde < 0 || varde > f.max_points)
      return { fel: `Sätt poäng på varje fråga. Fråga ${f.sort} saknar poäng.` };
    poang[f.id] = varde;
  }

  const resultat = provprocent(lista, poang);
  const godkant = resultat >= (kurs?.pass_threshold ?? 80);

  const { data: forsok, error: forsoksfel } = await db
    .from("course_attempt")
    .insert({
      course_id: inlamning.course_id,
      module_id: inlamning.module_id,
      employee_id: inlamning.employee_id,
      score: resultat,
      passed: godkant,
      graded_by: user.employee.id,
      note,
    })
    .select("id")
    .single();

  if (forsoksfel || !forsok) return { fel: "Betyget kunde inte bokföras." };

  /**
   * UPSERT och inte update. En `update` traffar noll rader om svaret saknas —
   * och det gor det for en fraga som LAGTS TILL i modulen efter inlamningen.
   * Poangen fanns da i summan men inte i historiken, alltsa ett betyg som inte
   * gick att harleda ur sina delar.
   */
  for (const f of lista) {
    await db.from("essay_answer").upsert(
      {
        submission_id: inlamning.id,
        question_id: f.id,
        points: poang[f.id],
        comment: String(form.get(`kommentar_${f.id}`) ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "submission_id,question_id" },
    );
  }

  const { error: statusfel } = await db
    .from("essay_submission")
    .update({
      status: "rattad",
      graded_at: new Date().toISOString(),
      graded_by: user.employee.id,
      attempt_id: forsok.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inlamning.id);

  if (statusfel) {
    // Forsoket rullas tillbaka for hand — annars star ett betyg i historiken pa
    // en inlamning som fortfarande ligger i kon, och de tva sager olika saker.
    await db.from("course_attempt").delete().eq("id", forsok.id);
    return { fel: "Betyget kunde inte sparas. Ingenting bokfördes." };
  }

  if (godkant) {
    await db
      .from("module_progress")
      .upsert(
        { employee_id: inlamning.employee_id, module_id: inlamning.module_id },
        { onConflict: "employee_id,module_id" },
      );

    const klar = await certifieraPerson(inlamning.employee_id, inlamning.course_id);
    if (klar) {
      await db
        .from("certification")
        .update({ attempt_id: forsok.id })
        .eq("employee_id", inlamning.employee_id)
        .eq("course_id", inlamning.course_id)
        .is("attempt_id", null);
    }
  }

  await loggaKurs(user.employee.id, godkant ? "prov.godkant" : "prov.underkant", inlamning.course_id, {
    modul: inlamning.module_id,
    poang: resultat,
    godkant,
    eget,
  });

  // HANDELSE OCH INTE HARLEDNING: rattningen SKRIVER OVER det tillstand den kom
  // ur. Ett rattat prov ar bara "rattad", omojligt att skilja fran ett som
  // rattades i varas — och den som fick sitt resultat skulle da vara den enda
  // som inte fick veta.
  await notifiera({
    till: inlamning.employee_id,
    av: user.employee.id,
    kalla: "prov-rattat",
    typ: "kurs",
    rubrik: godkant ? "Ditt skriftliga prov är godkänt" : "Ditt skriftliga prov är rättat",
    detalj: `${resultat} % · ${godkant ? "godkänt" : `gränsen är ${kurs?.pass_threshold ?? 80} %`} · återkopplingen finns i modulen`,
    href: "/utbildning",
    objekt: { typ: "essay_submission", id: inlamning.id },
  });

  revalidatePath("/utbildning", "layout");
  revalidatePath("/");
  if (eget) {
    return {
      ok: `${resultat} % — ${godkant ? "godkänt" : `under gränsen på ${kurs?.pass_threshold ?? 80} %`}. Du rättade ditt eget prov, och det står i loggen.`,
    };
  }

  return {
    ok: godkant
      ? `Godkänt med ${resultat} %. Återkopplingen syns för säljaren.`
      : `${resultat} % — under gränsen. Säljaren ser din återkoppling och kan göra om provet.`,
  };
}

/**
 * Returen: chefen ber om komplettering i stallet for att satta betyg.
 *
 * VAD SOM SKILJER DEN FRAN ETT UNDERKANT. Ett underkant prov ar ett BEDOMT
 * prov — forsoket ar slut, betyget star i historiken, och ett omtag ar ett nytt
 * forsok med tomma rutor. En retur ar tvartom ett prov som INTE gick att bedoma:
 * tre svar sager for lite for att avgora om hon forstatt. Da far hon fylla pa
 * dar det behovs i stallet for att skriva om alltihop.
 *
 * OGONBLICKSBILDEN AR INTE VALFRI. `essay_return.answers` bar vad som stod i
 * svaren nar returen gjordes. Utan den vore returen det enda stallet i modulen
 * dar ett inlamnat svar skrivs over utan spar.
 */
export async function returneraProv(_prev: KursState, form: FormData): Promise<KursState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };
  if (!farRatta(user)) return { fel: "Du saknar behörighet att rätta prov." };

  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim();

  if (note.length < 10)
    return { fel: "Skriv vad som behöver kompletteras. Ett returnerat prov utan besked är en gåta." };

  const db = supabaseAdmin();
  const { data: inlamning } = await db
    .from("essay_submission")
    .select("id, module_id, course_id, employee_id, status")
    .eq("id", id)
    .maybeSingle();

  if (!inlamning) return { fel: "Inlämningen finns inte." };
  if (inlamning.status !== "inlamnad") return { fel: "Bara ett inlämnat prov går att skicka tillbaka." };

  const { data: fragor } = await db
    .from("essay_question")
    .select("id, sort")
    .eq("module_id", inlamning.module_id)
    .order("sort");

  // Kommentarerna skrivs ner FORE ogonblicksbilden — det ar de som talar om var
  // hon ska fylla pa, och de ska folja med bade till henne och till kopian.
  for (const f of fragor ?? []) {
    const kommentar = String(form.get(`kommentar_${f.id}`) ?? "").trim();
    if (!kommentar) continue;
    await db
      .from("essay_answer")
      .update({ comment: kommentar, updated_at: new Date().toISOString() })
      .eq("submission_id", inlamning.id)
      .eq("question_id", f.id);
  }

  const { data: svaren } = await db
    .from("essay_answer")
    .select("question_id, body, points, comment")
    .eq("submission_id", inlamning.id);

  const { data: retur, error } = await db
    .from("essay_return")
    .insert({
      submission_id: inlamning.id,
      returned_by: user.employee.id,
      note,
      answers: svaren ?? [],
    })
    .select("id")
    .single();

  if (error || !retur) return { fel: "Returen kunde inte sparas." };

  const { error: statusfel } = await db
    .from("essay_submission")
    .update({ status: "retur", updated_at: new Date().toISOString() })
    .eq("id", inlamning.id);

  if (statusfel) {
    // Ogonblicksbilden tas bort igen. En retur som star kvar utan att provet
    // faktiskt gick tillbaka ar en rad som sager att nagot hant som inte hande.
    await db.from("essay_return").delete().eq("id", retur.id);
    return { fel: "Returen kunde inte skickas." };
  }

  await loggaKurs(user.employee.id, "prov.returnerat", inlamning.course_id, {
    modul: inlamning.module_id,
  });

  // Ingen notisrad. Returen ar ett TILLSTAND — provet ligger och vantar pa
  // henne tills hon kompletterat det — och harleds darfor ur statusen, som
  // faller bort av sig sjalv nar hon lamnat in igen.
  revalidatePath("/utbildning", "layout");
  revalidatePath("/");
  return { ok: "Provet är tillbaka hos säljaren med dina kommentarer." };
}
