"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { DOC_TYPES, tillSlug, type DocType } from "@/lib/dokument";

export type DokumentState = { fel?: string };

/**
 * PRD §5.2: sales_manager och admin har RW pa rutiner. Agaren far redigera
 * sitt eget aven utan de rollerna — annars gar det granskningsansvar AC-5.1
 * lagger pa agaren inte att utova.
 */
async function kravRedaktor(dokumentId?: string) {
  const user = await getCurrentUser();
  if (!user?.employee) throw new Error("Du måste vara inloggad.");
  if (hasRole(user, "sales_manager", "admin")) return user;

  if (dokumentId) {
    const { data } = await supabaseAdmin()
      .from("document")
      .select("owner_id")
      .eq("id", dokumentId)
      .maybeSingle();
    if (data?.owner_id === user.employee.id) return user;
  }
  throw new Error("Du saknar behörighet att redigera dokument.");
}

async function logga(
  actorId: string,
  action: string,
  objectId: string,
  meta?: Record<string, unknown>,
) {
  await supabaseAdmin().from("audit_log").insert({
    actor_id: actorId,
    action,
    object_type: "document",
    object_id: objectId,
    meta: meta ?? null,
  });
}

function lasFormular(form: FormData) {
  const titel = String(form.get("titel") ?? "").trim();
  const kategori = String(form.get("kategori") ?? "").trim().replace(/^\/+|\/+$/g, "");
  const brodtext = String(form.get("brodtext") ?? "");
  const docType = String(form.get("doc_type") ?? "routine") as DocType;
  const reviewDue = String(form.get("review_due") ?? "");
  const kraverKvittens = form.get("kraver_kvittens") === "on";
  const malgrupp = form.getAll("malgrupp").map(String).filter(Boolean);
  return { titel, kategori, brodtext, docType, reviewDue, kraverKvittens, malgrupp };
}

/** AC-5.1: publicering utan agare och granskningsdatum ar omojlig. */
export async function skapaDokument(_prev: DokumentState, form: FormData): Promise<DokumentState> {
  let slug: string;
  try {
    const user = await kravRedaktor();
    const db = supabaseAdmin();
    const f = lasFormular(form);
    const agare = String(form.get("owner_id") ?? "") || user.employee!.id;

    if (!f.titel) return { fel: "Dokumentet behöver en rubrik." };
    if (!f.reviewDue) return { fel: "Ange när dokumentet senast ska granskas." };
    if (!DOC_TYPES.includes(f.docType)) return { fel: "Okänd dokumenttyp." };

    // Unik slug. Kollision loses med suffix i stallet for felmeddelande —
    // "Sjukanmalan" kan rimligen finnas i tva kategorier.
    const bas = tillSlug(f.titel) || "dokument";
    slug = bas;
    for (let i = 2; i < 50; i++) {
      const { data } = await db.from("document").select("id").eq("slug", slug).maybeSingle();
      if (!data) break;
      slug = `${bas}-${i}`;
    }

    const publicera = form.get("publicera") === "1";

    const { data: rad, error } = await db
      .from("document")
      .insert({
        title: f.titel,
        slug,
        category_path: f.kategori,
        body_md: f.brodtext,
        owner_id: agare,
        review_due: f.reviewDue,
        doc_type: f.docType,
        requires_ack: f.kraverKvittens,
        audience_roles: f.malgrupp,
        status: publicera ? "published" : "draft",
        published_at: publicera ? new Date().toISOString() : null,
        created_by: user.employee!.id,
        version: 1,
      })
      .select("id, slug")
      .single();

    if (error || !rad) return { fel: `Kunde inte spara: ${error?.message ?? "okänt fel"}` };

    await db.from("document_version").insert({
      document_id: rad.id,
      version: 1,
      title: f.titel,
      body_md: f.brodtext,
      changed_by: user.employee!.id,
      change_note: "Skapad",
    });

    await logga(user.employee!.id, publicera ? "document.published" : "document.created", rad.id, {
      titel: f.titel,
    });
    slug = rad.slug;
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/rutiner");
  redirect(`/rutiner/${slug}`);
}

/**
 * AC-5.4: varje sparning skapar en ny version.
 *
 * Versionsnumret hojs bara nar innehallet faktiskt andrats. Att rakna upp det
 * for en rattad stavning i kategorifaltet skulle tvinga fram en ny kvittens
 * fran alla — och en kvittens som krävs utan skal ar den snabbaste vagen till
 * att folk klickar utan att lasa.
 */
export async function sparaDokument(_prev: DokumentState, form: FormData): Promise<DokumentState> {
  const id = String(form.get("id") ?? "");
  let slug = String(form.get("slug") ?? "");
  try {
    const user = await kravRedaktor(id);
    const db = supabaseAdmin();
    const f = lasFormular(form);
    const anteckning = String(form.get("andringsnot") ?? "").trim();

    if (!f.titel) return { fel: "Dokumentet behöver en rubrik." };
    if (!f.reviewDue) return { fel: "Ange när dokumentet senast ska granskas." };

    const { data: fore } = await db
      .from("document")
      .select("id, title, body_md, version, status, slug")
      .eq("id", id)
      .single();
    if (!fore) return { fel: "Dokumentet finns inte." };

    const innehallAndrat = fore.body_md !== f.brodtext || fore.title !== f.titel;
    const nyVersion = innehallAndrat ? fore.version + 1 : fore.version;
    const publicera = form.get("publicera") === "1";

    const { error } = await db
      .from("document")
      .update({
        title: f.titel,
        category_path: f.kategori,
        body_md: f.brodtext,
        owner_id: String(form.get("owner_id") ?? "") || undefined,
        review_due: f.reviewDue,
        doc_type: f.docType,
        requires_ack: f.kraverKvittens,
        audience_roles: f.malgrupp,
        version: nyVersion,
        status: publicera ? "published" : fore.status,
        published_at:
          publicera && fore.status !== "published" ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return { fel: `Kunde inte spara: ${error.message}` };

    if (innehallAndrat) {
      await db.from("document_version").insert({
        document_id: id,
        version: nyVersion,
        title: f.titel,
        body_md: f.brodtext,
        changed_by: user.employee!.id,
        change_note: anteckning || null,
      });
    }

    await logga(user.employee!.id, "document.updated", id, {
      version: nyVersion,
      innehall_andrat: innehallAndrat,
    });
    slug = fore.slug;
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/rutiner");
  revalidatePath(`/rutiner/${slug}`);
  redirect(`/rutiner/${slug}`);
}

/** AC-5.5: kvittensen ar kopplad till versionen. */
export async function kvittera(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee) return;

  const id = String(form.get("document_id"));
  const slug = String(form.get("slug"));

  // Dokumentet lases via anvandarens egen klient, sa RLS avgor om hen alls far
  // se det. Utan det steget kan vem som helst posta en kvittens for ett
  // dokument utanfor sin malgrupp, och kvittensrapporten — som ar det som
  // visas upp vid en arbetsmiljoinspektion — blir vardelos.
  const rls = await supabaseServer();
  const { data: dok } = await rls
    .from("document")
    .select("id, version, status, requires_ack")
    .eq("id", id)
    .maybeSingle();

  if (!dok || dok.status !== "published" || !dok.requires_ack) return;

  // Versionen tas ur databasen, inte ur formularet. Annars kvitterar den som
  // hade en gammal flik oppen fel version, och den nya andringen raknas som
  // last av nagon som aldrig sett den.
  const { error } = await supabaseAdmin()
    .from("document_ack")
    .upsert(
      { document_id: id, version: dok.version, employee_id: user.employee.id },
      { onConflict: "document_id,employee_id,version" },
    );
  if (error) return;

  await logga(user.employee.id, "document.acked", id, { version: dok.version });

  revalidatePath(`/rutiner/${slug}`);
  revalidatePath("/");
}

/**
 * AC-5.3: agaren bekraftar att dokumentet ar genomgangt. Det ar den handling
 * som gor granskningsdatumet till nagot annat an en siffra som passeras.
 */
export async function markeraGranskad(form: FormData): Promise<void> {
  const id = String(form.get("document_id"));
  const slug = String(form.get("slug"));
  const manader = Number(form.get("manader") ?? 12);
  const user = await kravRedaktor(id);

  const nytt = new Date();
  nytt.setMonth(nytt.getMonth() + manader);

  await supabaseAdmin()
    .from("document")
    .update({ review_due: nytt.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
    .eq("id", id);

  await logga(user.employee!.id, "document.reviewed", id, { nastaGranskning: nytt.toISOString().slice(0, 10) });
  revalidatePath("/rutiner");
  revalidatePath(`/rutiner/${slug}`);
}

export async function arkivera(form: FormData): Promise<void> {
  const id = String(form.get("document_id"));
  const user = await kravRedaktor(id);
  await supabaseAdmin().from("document").update({ status: "archived" }).eq("id", id);
  await logga(user.employee!.id, "document.archived", id);
  revalidatePath("/rutiner");
  redirect("/rutiner");
}

/** AC-12.5: rakna visningar, inte logga varje oppning. */
export async function registreraVisning(dokumentId: string, employeeId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("document_view")
    .select("views")
    .eq("document_id", dokumentId)
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (data) {
    await db
      .from("document_view")
      .update({ last_seen: new Date().toISOString(), views: data.views + 1 })
      .eq("document_id", dokumentId)
      .eq("employee_id", employeeId);
  } else {
    await db.from("document_view").insert({ document_id: dokumentId, employee_id: employeeId });
  }
}
