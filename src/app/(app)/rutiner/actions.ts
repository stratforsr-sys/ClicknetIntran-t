"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { DOC_TYPES, tillSlug, type DocType } from "@/lib/dokument";
import { forberedUppladdning, registreraFil, taBortInnehall } from "@/lib/filer-server";
import { pdfText } from "@/lib/pdf";
import { notifiera } from "@/lib/notishandelse-server";

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
  const decidedOn = String(form.get("decided_on") ?? "").trim() || null;
  const kraverKvittens = form.get("kraver_kvittens") === "on";
  const malgrupp = form.getAll("malgrupp").map(String).filter(Boolean);
  return { titel, kategori, brodtext, docType, reviewDue, decidedOn, kraverKvittens, malgrupp };
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
        decided_on: f.decidedOn,
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
        decided_on: f.decidedOn,
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

  // Agaren och titeln lases fore arkiveringen. Efterat gar raden fortfarande
  // att lasa, men da ar det tva fragor i stallet for en.
  const { data: dok } = await supabaseAdmin()
    .from("document")
    .select("owner_id, title")
    .eq("id", id)
    .maybeSingle();

  await supabaseAdmin().from("document").update({ status: "archived" }).eq("id", id);
  await logga(user.employee!.id, "document.archived", id);

  /**
   * AC-5.1 lagger granskningsansvaret pa AGAREN, och en redaktor med
   * `sales_manager` eller `admin` kan arkivera vem som helsts rutin.
   *
   * Agaren star alltsa ansvarig for ett dokument som nagon annan kan ta ur
   * bruk utan att hon far veta det. Notisen ar inte en artighet — det ar den
   * enda vagen fran arkiveringen tillbaka till den som har ansvaret.
   *
   * Arkiverar agaren sin egen rutin skickas ingenting; `notifiera()` haller
   * ute aktoren.
   */
  if (dok?.owner_id) {
    await notifiera({
      till: dok.owner_id,
      av: user.employee!.id,
      kalla: "rutin-arkiverad",
      typ: "rutin",
      rubrik: `Din rutin är arkiverad: ${dok.title}`,
      detalj: "Den visas inte längre för någon. Du står som ägare.",
      href: "/rutiner",
      objekt: { typ: "document", id },
    });
  }

  revalidatePath("/rutiner");
  redirect("/rutiner");
}

// `registreraVisning` lag har och flyttades till src/lib/rutiner-data.ts
// 2026-08-26. Den tog ett `employeeId` som ARGUMENT och skrev med service role
// utan att kontrollera nagot — och allt som exporteras ur den har filen ar en
// publik andpunkt. Se rubriken i rutiner-data.ts.

// =============================================================================
// Bilagor (E2.12)
//
// Filen laggs i `file_object` med `purpose = 'document_attachment'` och arver
// dokumentets egen behorighet (0022). Ar en PDF med ett textlager laggs texten
// i `document.attachment_text` sa att den gar att soka i (0023).
//
// EN BILAGA SKAPAR INGEN NY VERSION. AC-5.4 och AC-5.5 skulle annars ge alla
// som kvitterat dokumentet en ny kvittens att gora varje gang nagon byter ut en
// prislista, och en kvittens som kommer for ofta slutar betyda nagot.
// =============================================================================

/** Raknar om sokbar text ur SAMTLIGA bilagor pa dokumentet. */
async function raknaOmBilagetext(dokumentId: string) {
  const db = supabaseAdmin();
  const { data: filer } = await db
    .from("file_object")
    .select("id, bucket, path, mime_type")
    .eq("purpose", "document_attachment")
    .eq("document_id", dokumentId)
    .is("removed_at", null);

  const delar: string[] = [];
  for (const f of filer ?? []) {
    if (f.mime_type !== "application/pdf") continue;
    const { data } = await db.storage.from(f.bucket).download(f.path);
    if (!data) continue;
    const text = await pdfText(new Uint8Array(await data.arrayBuffer()));
    if (text) delar.push(text);
  }

  await db
    .from("document")
    .update({ attachment_text: delar.length ? delar.join("\n\n") : null })
    .eq("id", dokumentId);
}

export async function forberedBilaga(
  dokumentId: string,
  filnamn: string,
  mimetyp: string,
  storlek: number,
) {
  try {
    await kravRedaktor(dokumentId);
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Du saknar behörighet." };
  }
  return forberedUppladdning({ andamal: "document_attachment", filnamn, mimetyp, storlek });
}

export async function registreraBilaga(
  dokumentId: string,
  fileId: string,
  filnamn: string,
): Promise<DokumentState> {
  try {
    const user = await kravRedaktor(dokumentId);

    const resultat = await registreraFil({
      fileId,
      andamal: "document_attachment",
      filnamn,
      uploadedBy: user.employee!.id,
      documentId: dokumentId,
    });

    if ("fel" in resultat) return { fel: resultat.fel };

    // Textextraktionen sker EFTER att filen ligger uppe. Gar den fel ar
    // bilagan anda inlamnad — en inskannad PDF utan textlager ska ga att
    // bifoga, den blir bara inte sokbar.
    await raknaOmBilagetext(dokumentId);

    await logga(user.employee!.id, "document.attachment_added", dokumentId, { fil: fileId });
    revalidatePath("/rutiner", "layout");
    return {};
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Bilagan kunde inte läggas till." };
  }
}

export async function taBortBilaga(_prev: DokumentState, form: FormData): Promise<DokumentState> {
  const fileId = String(form.get("fil_id") ?? "");
  const dokumentId = String(form.get("id") ?? "");

  try {
    const user = await kravRedaktor(dokumentId);
    await taBortInnehall(fileId, user.employee!.id);

    // Texten raknas om ur de bilagor som ar kvar. Att i stallet dra bort den
    // borttagna filens del hade krävt att texten lagrades per fil — och den
    // kolumnen far inte finnas, se rubriken i 0023.
    await raknaOmBilagetext(dokumentId);

    await logga(user.employee!.id, "document.attachment_removed", dokumentId, { fil: fileId });
    revalidatePath("/rutiner", "layout");
    return {};
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Bilagan kunde inte tas bort." };
  }
}
