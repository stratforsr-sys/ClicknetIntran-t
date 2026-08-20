"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ROLES, type Role } from "@/lib/roles";

export type NyhetState = { fel?: string };

/**
 * AC-11.2. Nyhetsinlagg med malgruppsstyrning.
 *
 * Vem som far skriva: samma krets som far publicera rutiner, minus
 * teamledaren. Ett nyhetsinlagg gar till hela mottagargruppen samtidigt och
 * kan inte tas tillbaka ur nagons minne — den spaken ska vara kort.
 */
function farSkriva(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return hasRole(user, "sales_manager", "ceo", "admin");
}

/**
 * Slug ur rubriken. Ar den upptagen laggs datumet till, och darefter en siffra.
 *
 * Att lata rubriken bli adressen ar inte kosmetik: en lank till ett inlagg
 * klistras in i ett samtal, och `/nyheter/nya-provisionsregler` sager vad man
 * ar pa vag till pa ett satt som en uuid inte gor.
 */
function tillSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "inlagg";
}

async function ledigSlug(bas: string): Promise<string> {
  const db = supabaseAdmin();
  const kandidater = [bas, `${bas}-${new Date().toISOString().slice(0, 10)}`];
  for (let i = 2; i <= 20; i++) kandidater.push(`${bas}-${i}`);

  for (const slug of kandidater) {
    const { data } = await db.from("news_post").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${bas}-${Date.now()}`;
}

function lasMalgrupp(form: FormData): string[] {
  const valda = form.getAll("roller").map(String).filter((r): r is Role => ROLES.includes(r as Role));
  // Alla roller valda betyder samma sak som ingen vald, och tom lista ar det
  // som `matches_audience` forstar som "alla". Att spara atta rader i stallet
  // hade brutit den dag en nionde roll laggs till.
  return valda.length === ROLES.length ? [] : valda;
}

export async function skapaNyhet(_prev: NyhetState, form: FormData): Promise<NyhetState> {
  let slug: string;

  try {
    const user = await getCurrentUser();
    if (!user?.employee || !farSkriva(user)) return { fel: "Du saknar behörighet." };

    const rubrik = String(form.get("rubrik") ?? "").trim();
    const text = String(form.get("text") ?? "").trim();
    const publicera = form.get("publicera") === "1";
    const pinned = form.get("pinned") === "1";

    if (!rubrik) return { fel: "Skriv en rubrik." };
    if (text.length < 5) return { fel: "Skriv några ord i inlägget." };

    slug = await ledigSlug(tillSlug(rubrik));
    const db = supabaseAdmin();

    const { error } = await db.from("news_post").insert({
      slug,
      title: rubrik,
      body_md: text,
      audience_roles: lasMalgrupp(form),
      audience_teams: form.getAll("team").map(String).filter(Boolean),
      status: publicera ? "published" : "draft",
      pinned,
      author_id: user.employee.id,
      published_at: publicera ? new Date().toISOString() : null,
    });

    if (error) return { fel: `Inlägget kunde inte sparas: ${error.message}` };

    await db.from("audit_log").insert({
      actor_id: user.employee.id,
      action: publicera ? "news.published" : "news.drafted",
      object_type: "news_post",
      object_id: slug,
      meta: { rubrik, pinned },
    });
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/nyheter");
  redirect(`/nyheter/${slug}`);
}

/**
 * Publicerar ett utkast.
 *
 * `published_at` sätts bara forsta gangen. Ett inlagg som avpubliceras och
 * publiceras igen ska inte dyka upp som nytt i allas klockor en andra gang —
 * det ar samma besked, och en klocka som upprepar sig slutar man titta i.
 */
export async function publiceraNyhet(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farSkriva(user)) throw new Error("Du saknar behörighet.");

  const id = String(form.get("nyhet_id") ?? "");
  const db = supabaseAdmin();

  const { data: nu } = await db
    .from("news_post")
    .select("slug, published_at")
    .eq("id", id)
    .maybeSingle();
  if (!nu) throw new Error("Inlägget finns inte.");

  await db
    .from("news_post")
    .update({
      status: "published",
      published_at: nu.published_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "news.published",
    object_type: "news_post",
    object_id: nu.slug,
  });

  revalidatePath("/nyheter");
  revalidatePath(`/nyheter/${nu.slug}`);
}

/** Arkiverar. Inlagget finns kvar och gar att lasa via sin adress för den som
 *  redan har lanken — det ar historik, inte nagot som ska kunna suddas. */
export async function arkiveraNyhet(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farSkriva(user)) throw new Error("Du saknar behörighet.");

  const id = String(form.get("nyhet_id") ?? "");
  const db = supabaseAdmin();

  const { data: nu } = await db.from("news_post").select("slug").eq("id", id).maybeSingle();
  if (!nu) return;

  await db
    .from("news_post")
    .update({ status: "archived", pinned: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "news.archived",
    object_type: "news_post",
    object_id: nu.slug,
  });

  revalidatePath("/nyheter");
  revalidatePath(`/nyheter/${nu.slug}`);
}
