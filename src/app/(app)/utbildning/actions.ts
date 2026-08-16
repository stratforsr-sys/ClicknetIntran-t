"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, hasRole, type CurrentUser } from "@/lib/auth";
import { ROLES, type Role } from "@/lib/roles";
import { tillSlug } from "@/lib/dokument";
import { tolkaFragor, utgangsdatum, sparrTill } from "@/lib/utbildning";

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

  revalidatePath("/utbildning");
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
  revalidatePath("/utbildning");
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

  if (!kursId || !titel) return { fel: "Modulen behöver en rubrik." };
  if (!["reading", "quiz"].includes(kind)) return { fel: "Okänd modultyp." };

  const { fragor, fel } = kind === "quiz" ? tolkaFragor(text) : { fragor: [], fel: null };
  if (fel) return { fel };
  if (kind === "quiz" && fragor.length === 0) return { fel: "Ett quiz behöver minst en fråga." };

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

  await logga(user.employee!.id, modulId ? "course.module_updated" : "course.module_added", kursId, {
    modul: titel,
    kind,
  });
  revalidatePath("/utbildning");
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
  revalidatePath("/utbildning");
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
  revalidatePath("/utbildning");
}

// -----------------------------------------------------------------------------
// Genomforande
// -----------------------------------------------------------------------------

/**
 * Kursen ar klar nar varje modul ar det. Certifikatet skrivs har och ingen
 * annanstans, sa att det bara kan uppsta som foljd av faktiskt genomford kurs.
 */
async function certifieraOmKlar(user: CurrentUser, kursId: string): Promise<boolean> {
  const db = supabaseAdmin();

  const [{ data: moduler }, { data: klara }, { data: kurs }] = await Promise.all([
    db.from("course_module").select("id").eq("course_id", kursId),
    db.from("module_progress").select("module_id").eq("employee_id", user.employee!.id),
    db.from("course").select("valid_months").eq("id", kursId).maybeSingle(),
  ]);

  const alla = (moduler ?? []).map((m) => m.id);
  if (alla.length === 0) return false;

  const klaraSet = new Set((klara ?? []).map((k) => k.module_id));
  if (!alla.every((id) => klaraSet.has(id))) return false;

  const { data: redan } = await db
    .from("certification")
    .select("id, expires_at")
    .eq("employee_id", user.employee!.id)
    .eq("course_id", kursId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Ett giltigt certifikat racker. Ett utganget ersatts av ett nytt.
  if (redan && (!redan.expires_at || new Date(redan.expires_at) > new Date())) return false;

  await db.from("certification").insert({
    employee_id: user.employee!.id,
    course_id: kursId,
    expires_at: utgangsdatum(kurs?.valid_months ?? null),
  });

  await logga(user.employee!.id, "course.certified", kursId, {
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
  revalidatePath("/utbildning");
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

  revalidatePath("/utbildning");
  return { ok: `${poang} % rätt. Godkänt.` };
}
