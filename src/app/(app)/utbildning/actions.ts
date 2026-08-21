"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, type CurrentUser } from "@/lib/auth";
import { ROLES, type Role } from "@/lib/roles";
import { tillSlug } from "@/lib/dokument";
import { tolkaFragor, utgangsdatum, sparrTill } from "@/lib/utbildning";
import { procent, tolkaKriterier } from "@/lib/rollspel";
import { forberedUppladdning, registreraFil } from "@/lib/filer-server";

export type KursState = { fel?: string; ok?: string };

async function logga(
  actorId: string,
  action: string,
  objectId: string,
  meta?: Record<string, unknown>,
) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: "course",
    object_id: objectId,
    meta: meta ?? null,
  });
}

/** Far skriva kurser. Samma krets som far skriva rutiner (PRD §5.2). */
function farRedigera(user: CurrentUser | null): boolean {
  return hasRole(user, "sales_manager", "admin", "ceo", "team_lead");
}

async function kravRedaktor() {
  const user = await getCurrentUser();
  if (!farRedigera(user) || !user?.employee) {
    throw new Error("Du saknar behörighet att redigera kurser.");
  }
  return user;
}

// -----------------------------------------------------------------------------
// Redigering
// -----------------------------------------------------------------------------

export async function skapaKurs(_prev: KursState, form: FormData): Promise<KursState> {
  let slug: string;
  try {
    const user = await kravRedaktor();
    const titel = String(form.get("titel") ?? "").trim();
    if (!titel) return { fel: "Kursen behöver en titel." };

    const db = supabaseAdmin();
    slug = tillSlug(titel);

    const { data: fanns } = await db.from("course").select("id").eq("slug", slug).maybeSingle();
    if (fanns) return { fel: "Det finns redan en kurs med den titeln." };

    const { data: rad, error } = await db
      .from("course")
      .insert({
        slug,
        title: titel,
        owner_id: user.employee!.id,
        created_by: user.employee!.id,
      })
      .select("id")
      .single();

    if (error || !rad) return { fel: "Kursen kunde inte skapas." };
    await logga(user.employee!.id, "course.created", rad.id, { titel });
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/utbildning", "layout");
  redirect(`/utbildning/${slug}/redigera`);
}

export async function sparaKurs(_prev: KursState, form: FormData): Promise<KursState> {
  const user = await kravRedaktor();
  const db = supabaseAdmin();

  const id = String(form.get("kurs_id"));
  const titel = String(form.get("titel") ?? "").trim();
  if (!id || !titel) return { fel: "Kursen behöver en titel." };

  const roller = form.getAll("roller").map(String).filter((r) => ROLES.includes(r as Role));
  const gransen = Number(form.get("pass_threshold") ?? 80);
  const vantetid = Number(form.get("retry_wait_hours") ?? 24);
  const manader = String(form.get("valid_months") ?? "").trim();
  const frist = String(form.get("due_days") ?? "").trim();
  const publicera = String(form.get("publicera") ?? "");

  if (!Number.isFinite(gransen) || gransen < 1 || gransen > 100)
    return { fel: "Godkäntgränsen är en siffra mellan 1 och 100." };
  if (!Number.isFinite(vantetid) || vantetid < 0)
    return { fel: "Spärrtiden kan inte vara negativ." };

  const { data: fore } = await db.from("course").select("status").eq("id", id).maybeSingle();

  const status = publicera === "1" ? "published" : publicera === "0" ? "draft" : fore?.status;

  const { error } = await db
    .from("course")
    .update({
      title: titel,
      description_md: String(form.get("beskrivning") ?? ""),
      audience_roles: roller,
      pass_threshold: Math.round(gransen),
      retry_wait_hours: Math.round(vantetid),
      valid_months: manader ? Math.max(1, Math.round(Number(manader))) : null,
      due_days: frist ? Math.max(1, Math.round(Number(frist))) : null,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { fel: "Kursen kunde inte sparas." };

  await logga(user.employee!.id, fore?.status !== status ? "course.status_changed" : "course.updated", id, {
    status,
  });
  revalidatePath("/utbildning", "layout");
  return { ok: status === "published" ? "Kursen är publicerad." : "Sparat." };
}

/**
 * En modul och dess fragor sparas i samma svep. Fragorna skrivs om fran
 * grunden varje gang — de ar innehall, inte historik, och en delvis uppdaterad
 * fragelista ar varre an en omskriven.
 */
export async function sparaModul(_prev: KursState, form: FormData): Promise<KursState> {
  const user = await kravRedaktor();
  const db = supabaseAdmin();

  const kursId = String(form.get("kurs_id"));
  const modulId = String(form.get("modul_id") ?? "");
  const titel = String(form.get("titel") ?? "").trim();
  const kind = String(form.get("kind") ?? "reading");
  const text = String(form.get("fragor") ?? "");
  const rubriktext = String(form.get("kriterier") ?? "");

  if (!kursId || !titel) return { fel: "Modulen behöver en rubrik." };
  if (!["reading", "quiz", "roleplay"].includes(kind)) return { fel: "Okänd modultyp." };

  const { fragor, fel } = kind === "quiz" ? tolkaFragor(text) : { fragor: [], fel: null };
  if (fel) return { fel };
  if (kind === "quiz" && fragor.length === 0) return { fel: "Ett quiz behöver minst en fråga." };

  // E8.7: en rollspelsmodul utan rubrik gar inte att bedoma, sa den far inte
  // sparas heller. `procent()` ger noll poang for en tom rubrik — ratt hall
  // att fela at, men ett fel som upptacks forst vid bedomningen ar ett fel som
  // upptacks av fel person.
  const { kriterier, fel: rubrikfel } =
    kind === "roleplay" ? tolkaKriterier(rubriktext) : { kriterier: [], fel: null };
  if (rubrikfel) return { fel: rubrikfel };
  if (kind === "roleplay" && kriterier.length === 0)
    return { fel: "Ett rollspel behöver minst ett kriterium att bedömas mot." };

  let id = modulId;
  if (id) {
    await db
      .from("course_module")
      .update({ title: titel, body_md: String(form.get("innehall") ?? ""), kind })
      .eq("id", id);
  } else {
    const { data: sista } = await db
      .from("course_module")
      .select("sort")
      .eq("course_id", kursId)
      .order("sort", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: rad, error } = await db
      .from("course_module")
      .insert({
        course_id: kursId,
        sort: (sista?.sort ?? 0) + 1,
        title: titel,
        body_md: String(form.get("innehall") ?? ""),
        kind,
      })
      .select("id")
      .single();

    if (error || !rad) return { fel: "Modulen kunde inte sparas." };
    id = rad.id;
  }

  if (kind === "quiz") {
    await db.from("quiz_question").delete().eq("module_id", id);
    for (const [i, f] of fragor.entries()) {
      const { data: fraga } = await db
        .from("quiz_question")
        .insert({ module_id: id, sort: i + 1, prompt: f.prompt })
        .select("id")
        .single();
      if (!fraga) continue;
      await db.from("quiz_option").insert(
        f.alternativ.map((a, j) => ({
          question_id: fraga.id,
          sort: j + 1,
          label: a.label,
          is_correct: a.ratt,
        })),
      );
    }
  }

  if (kind === "roleplay") {
    // Kriterierna skrivs om i sin helhet. Poang som redan satts pekar pa den
    // GAMLA raden, och `roleplay_score` kaskaderar — en bedomning som redan ar
    // gjord tappar alltsa sina delpoang om rubriken skrivs om. Sjalva betyget
    // star kvar i `course_attempt`, som ar historiken, och det ar den som
    // raknas.
    await db.from("roleplay_criterion").delete().eq("module_id", id);
    await db.from("roleplay_criterion").insert(
      kriterier.map((k, i) => ({
        module_id: id,
        sort: i + 1,
        label: k.label,
        guidance: k.guidance,
        max_points: k.max_points,
      })),
    );
  }

  await logga(user.employee!.id, modulId ? "course.module_updated" : "course.module_added", kursId, {
    modul: titel,
    kind,
  });
  revalidatePath("/utbildning", "layout");
  return { ok: "Modulen är sparad." };
}

export async function taBortModul(form: FormData): Promise<void> {
  const user = await kravRedaktor();
  const db = supabaseAdmin();
  const modulId = String(form.get("modul_id"));
  const kursId = String(form.get("kurs_id"));
  if (!modulId) return;

  await db.from("course_module").delete().eq("id", modulId);
  await logga(user.employee!.id, "course.module_removed", kursId, { modul: modulId });
  revalidatePath("/utbildning", "layout");
}

/** Flyttar en modul ett steg. Ordningen ar hela poangen med AC-6.1. */
export async function flyttaModul(form: FormData): Promise<void> {
  const user = await kravRedaktor();
  const db = supabaseAdmin();

  const kursId = String(form.get("kurs_id"));
  const modulId = String(form.get("modul_id"));
  const upp = String(form.get("riktning")) === "upp";

  const { data: moduler } = await db
    .from("course_module")
    .select("id, sort")
    .eq("course_id", kursId)
    .order("sort");

  const lista = moduler ?? [];
  const i = lista.findIndex((m) => m.id === modulId);
  const j = upp ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= lista.length) return;

  // Unikt index pa (course_id, sort) gor att de tva inte kan byta plats rakt
  // av. Den ena parkeras pa ett negativt varde under bytet.
  await db.from("course_module").update({ sort: -1 }).eq("id", lista[i].id);
  await db.from("course_module").update({ sort: lista[i].sort }).eq("id", lista[j].id);
  await db.from("course_module").update({ sort: lista[j].sort }).eq("id", lista[i].id);

  await logga(user.employee!.id, "course.modules_reordered", kursId);
  revalidatePath("/utbildning", "layout");
}

// -----------------------------------------------------------------------------
// Genomforande
// -----------------------------------------------------------------------------

/**
 * Kursen ar klar nar varje modul ar det. Certifikatet skrivs har och ingen
 * annanstans, sa att det bara kan uppsta som foljd av faktiskt genomford kurs.
 */
async function certifieraOmKlar(user: CurrentUser, kursId: string): Promise<boolean> {
  return certifieraPerson(user.employee!.id, kursId);
}

/**
 * Samma sak, men for en utpekad person.
 *
 * Behovs sedan E8.7: ett rollspel bedoms av CHEFEN, och det ar saljaren som
 * ska certifieras nar bedomningen gor kursen klar. Att lata certifieringen
 * utga fran den inloggade hade gett chefen ett certifikat pa en kurs hon inte
 * gatt.
 */
async function certifieraPerson(employeeId: string, kursId: string): Promise<boolean> {
  const db = supabaseAdmin();

  const [{ data: moduler }, { data: klara }, { data: kurs }] = await Promise.all([
    db.from("course_module").select("id").eq("course_id", kursId),
    db.from("module_progress").select("module_id").eq("employee_id", employeeId),
    db.from("course").select("valid_months").eq("id", kursId).maybeSingle(),
  ]);

  const alla = (moduler ?? []).map((m) => m.id);
  if (alla.length === 0) return false;

  const klaraSet = new Set((klara ?? []).map((k) => k.module_id));
  if (!alla.every((id) => klaraSet.has(id))) return false;

  const { data: redan } = await db
    .from("certification")
    .select("id, expires_at")
    .eq("employee_id", employeeId)
    .eq("course_id", kursId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Ett giltigt certifikat racker. Ett utganget ersatts av ett nytt.
  if (redan && (!redan.expires_at || new Date(redan.expires_at) > new Date())) return false;

  await db.from("certification").insert({
    employee_id: employeeId,
    course_id: kursId,
    expires_at: utgangsdatum(kurs?.valid_months ?? null),
  });

  await logga(employeeId, "course.certified", kursId, {
    giltig_manader: kurs?.valid_months ?? null,
  });
  return true;
}

/** AC-6.1: modulerna tas i ordning. Att hoppa over ar inte ett alternativ. */
async function farTaModul(user: CurrentUser, modulId: string): Promise<boolean> {
  const rls = await supabaseServer();
  const { data: modul } = await rls
    .from("course_module")
    .select("id, course_id, sort")
    .eq("id", modulId)
    .maybeSingle();
  if (!modul) return false;

  const { data: tidigare } = await rls
    .from("course_module")
    .select("id")
    .eq("course_id", modul.course_id)
    .lt("sort", modul.sort);

  if ((tidigare ?? []).length === 0) return true;

  const { data: klara } = await rls
    .from("module_progress")
    .select("module_id")
    .eq("employee_id", user.employee!.id)
    .in(
      "module_id",
      (tidigare ?? []).map((t) => t.id),
    );

  return (klara ?? []).length === (tidigare ?? []).length;
}

export async function klarModul(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee) return;

  const modulId = String(form.get("modul_id"));
  const kursId = String(form.get("kurs_id"));
  if (!modulId || !(await farTaModul(user, modulId))) return;

  // Lasningen gick via RLS: syns inte modulen for den inloggade finns den
  // heller inte att bocka av.
  const rls = await supabaseServer();
  const { data: modul } = await rls
    .from("course_module")
    .select("id, kind")
    .eq("id", modulId)
    .maybeSingle();
  if (!modul || modul.kind !== "reading") return;

  await supabaseAdmin()
    .from("module_progress")
    .upsert(
      { employee_id: user.employee.id, module_id: modulId },
      { onConflict: "employee_id,module_id" },
    );

  await certifieraOmKlar(user, kursId);
  revalidatePath("/utbildning", "layout");
}

/**
 * AC-6.2. Rattningen sker har och bara har. Ratt svar lamnar aldrig servern —
 * `quiz_option` ar stangd for varje inloggad roll, sa facit gar inte att lasa
 * ur webblasaren ens av den som letar.
 */
export async function lamnaQuiz(_prev: KursState, form: FormData): Promise<KursState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const modulId = String(form.get("modul_id"));
  const kursId = String(form.get("kurs_id"));
  if (!modulId || !kursId) return { fel: "Något saknas i formuläret." };
  if (!(await farTaModul(user, modulId)))
    return { fel: "Ta modulerna i ordning — den här är inte öppen än." };

  const rls = await supabaseServer();
  const { data: kurs } = await rls
    .from("course")
    .select("id, pass_threshold, retry_wait_hours, status")
    .eq("id", kursId)
    .maybeSingle();
  if (!kurs || kurs.status !== "published") return { fel: "Kursen är inte öppen." };

  const { data: senaste } = await rls
    .from("course_attempt")
    .select("created_at, passed")
    .eq("employee_id", user.employee.id)
    .eq("module_id", modulId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (senaste && !senaste.passed) {
    const oppnar = sparrTill(senaste.created_at, kurs.retry_wait_hours);
    if (oppnar) return { fel: `Nästa försök går att göra ${oppnar.toLocaleString("sv-SE")}.` };
  }

  const db = supabaseAdmin();
  const { data: fragor } = await db
    .from("quiz_question")
    .select("id, sort, quiz_option(id, is_correct)")
    .eq("module_id", modulId)
    .order("sort");

  const lista = fragor ?? [];
  if (lista.length === 0) return { fel: "Modulen har inga frågor." };

  const svar: Record<string, string> = {};
  let ratt = 0;
  for (const f of lista) {
    const valt = String(form.get(`fraga_${f.id}`) ?? "");
    svar[f.id] = valt;
    if (f.quiz_option.some((o) => o.id === valt && o.is_correct)) ratt++;
  }

  const poang = Math.round((ratt / lista.length) * 100);
  const godkant = poang >= kurs.pass_threshold;

  const { data: forsok } = await db
    .from("course_attempt")
    .insert({
      course_id: kursId,
      module_id: modulId,
      employee_id: user.employee.id,
      score: poang,
      passed: godkant,
      answers: svar,
    })
    .select("id")
    .single();

  await logga(user.employee.id, godkant ? "course.quiz_passed" : "course.quiz_failed", kursId, {
    modul: modulId,
    poang,
    grans: kurs.pass_threshold,
  });

  if (!godkant) {
    return {
      fel: `${poang} % rätt. Gränsen är ${kurs.pass_threshold} %. Läs igenom modulen igen och gör ett nytt försök.`,
    };
  }

  await db
    .from("module_progress")
    .upsert(
      { employee_id: user.employee.id, module_id: modulId },
      { onConflict: "employee_id,module_id" },
    );

  if (forsok) {
    const klar = await certifieraOmKlar(user, kursId);
    if (klar) {
      await db
        .from("certification")
        .update({ attempt_id: forsok.id })
        .eq("employee_id", user.employee.id)
        .eq("course_id", kursId)
        .is("attempt_id", null);
    }
  }

  revalidatePath("/utbildning", "layout");
  return { ok: `${poang} % rätt. Godkänt.` };
}

// =============================================================================
// Rollspel (E8.7, AC-6.7)
//
// Saljaren spelar in ett testsamtal, laddar upp det, och bedoms mot rubriken.
// Filen gar direkt till bucketen — se src/components/Filuppladdning.tsx — och
// varje oppning av den loggas, precis som for ett lakarintyg (K36).
//
// TRE SAKER SOM INTE AR SJALVKLARA:
//
//   Rubriken syns FORE inspelningen. `roleplay_criterion` arver modulens
//   lasbehorighet (0024), sa den som ska gora rollspelet ser exakt vad hon
//   bedoms pa. Samma linje som AC-3.13 drog for franvaroreglerna.
//
//   Den som inte oppnat inspelningen far inte bedoma den. Sparren ar en
//   trigger i databasen som fragar `file_access_log`.
//
//   En ny inlamning skriver aldrig over en gammal. Underkant ar lika mycket
//   bevis som godkant (0007).
// =============================================================================

/** Far bedoma nagon annans rollspel. Samma krets som ser inlamningen (0024). */
async function farBedoma(user: CurrentUser, employeeId: string): Promise<boolean> {
  if (hasRole(user, "sales_manager", "ceo")) return true;
  if (!user.employee || user.employee.id === employeeId) return false;

  const db = supabaseAdmin();
  const [{ data: person }, { data: team }] = await Promise.all([
    db.from("employee").select("manager_id, team_id").eq("id", employeeId).maybeSingle(),
    db.from("team").select("id").eq("lead_id", user.employee.id),
  ]);

  if (!person) return false;
  if (person.manager_id === user.employee.id) return true;
  return Boolean(person.team_id && (team ?? []).some((t) => t.id === person.team_id));
}

export async function forberedRollspel(
  modulId: string,
  filnamn: string,
  mimetyp: string,
  storlek: number,
) {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };
  if (!(await farTaModul(user, modulId)))
    return { fel: "Ta modulerna i ordning — den här är inte öppen än." };

  return forberedUppladdning({ andamal: "roleplay", filnamn, mimetyp, storlek });
}

export async function registreraRollspel(
  modulId: string,
  fileId: string,
  filnamn: string,
): Promise<KursState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };
  if (!(await farTaModul(user, modulId)))
    return { fel: "Ta modulerna i ordning — den här är inte öppen än." };

  const rls = await supabaseServer();
  const { data: modul } = await rls
    .from("course_module")
    .select("id, course_id, kind")
    .eq("id", modulId)
    .maybeSingle();
  if (!modul || modul.kind !== "roleplay") return { fel: "Modulen är inte ett rollspel." };

  const resultat = await registreraFil({
    fileId,
    andamal: "roleplay",
    filnamn,
    uploadedBy: user.employee.id,
    subjectEmployeeId: user.employee.id,
  });
  if ("fel" in resultat) return { fel: resultat.fel };

  const { error } = await supabaseAdmin().from("roleplay_submission").insert({
    module_id: modulId,
    course_id: modul.course_id,
    employee_id: user.employee.id,
    file_id: fileId,
  });
  if (error) return { fel: error.message };

  await logga(user.employee.id, "roleplay.submitted", modul.course_id, { modul: modulId });
  revalidatePath("/utbildning", "layout");
  revalidatePath("/");
  return { ok: "Inspelningen är inlämnad. Din chef bedömer den mot rubriken." };
}

/**
 * Bedomningen. Skapar ett `course_attempt` — samma tabell som quizet, eftersom
 * bada ar "nagon provades och fick ett resultat" (0007).
 */
export async function bedomRollspel(_prev: KursState, form: FormData): Promise<KursState> {
  const user = await getCurrentUser();
  if (!user?.employee) return { fel: "Du måste vara inloggad." };

  const id = String(form.get("id") ?? "");
  const note = String(form.get("note") ?? "").trim();

  const db = supabaseAdmin();
  const { data: inlamning } = await db
    .from("roleplay_submission")
    .select("id, module_id, course_id, employee_id, file_id, graded_at")
    .eq("id", id)
    .maybeSingle();

  if (!inlamning) return { fel: "Inlämningen finns inte." };
  if (inlamning.graded_at) return { fel: "Rollspelet är redan bedömt." };
  if (!(await farBedoma(user, inlamning.employee_id)))
    return { fel: "Du bedömer bara rollspel från dem du leder." };

  // AC-6.7: aterkopplingen ar obligatorisk. Ett betyg utan ord ar ett tal, och
  // ett tal larde ingen sig nagot av — samma resonemang som AC-9.19 for
  // samtalsgranskningen.
  if (note.length < 10)
    return { fel: "Skriv en återkoppling. Ett betyg utan ord lär ingen sig något av." };

  const [{ data: kriterier }, { data: kurs }] = await Promise.all([
    db.from("roleplay_criterion").select("id, max_points").eq("module_id", inlamning.module_id),
    db.from("course").select("pass_threshold, valid_months").eq("id", inlamning.course_id).maybeSingle(),
  ]);

  const lista = kriterier ?? [];
  if (lista.length === 0) return { fel: "Modulen saknar rubrik att bedöma mot." };

  const poang: Record<string, number> = {};
  for (const k of lista) {
    const varde = Number(form.get(`poang_${k.id}`) ?? NaN);
    if (!Number.isInteger(varde) || varde < 0 || varde > k.max_points)
      return { fel: "Sätt poäng på varje kriterium, inom kriteriets tak." };
    poang[k.id] = varde;
  }

  const resultat = procent(lista, poang);
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

  if (forsoksfel) return { fel: forsoksfel.message };

  for (const k of lista) {
    await db.from("roleplay_score").insert({
      submission_id: inlamning.id,
      criterion_id: k.id,
      points: poang[k.id],
    });
  }

  // Sparren i 0024 slar till har: har bedomaren aldrig oppnat inspelningen
  // vagrar databasen skriva raden.
  const { error: bedomningsfel } = await db
    .from("roleplay_submission")
    .update({
      graded_by: user.employee.id,
      graded_at: new Date().toISOString(),
      attempt_id: forsok.id,
    })
    .eq("id", inlamning.id);

  if (bedomningsfel) {
    // Forsoket rullas tillbaka for hand — annars star ett betyg kvar pa en
    // inlamning som inte ar bedomd, och progressvyn visar tva sanningar.
    await db.from("roleplay_score").delete().eq("submission_id", inlamning.id);
    await db.from("course_attempt").delete().eq("id", forsok.id);
    return {
      fel: bedomningsfel.message.includes("oppnas")
        ? "Öppna inspelningen innan du bedömer den. Varje öppning loggas."
        : bedomningsfel.message,
    };
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

  await logga(user.employee.id, "roleplay.graded", inlamning.course_id, {
    modul: inlamning.module_id,
    poang: resultat,
    godkant,
  });

  revalidatePath("/utbildning", "layout");
  revalidatePath("/");
  return {
    ok: godkant
      ? `Godkänt med ${resultat} %. Återkopplingen syns för säljaren.`
      : `${resultat} % — under gränsen. Säljaren ser din återkoppling och kan lämna in igen.`,
  };
}
