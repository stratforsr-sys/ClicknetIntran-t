"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { skapaAvtalsutkast } from "@/lib/avtal-server";
import {
  VARIABELNYCKLAR,
  okandaPlatshallare,
  serUtSomPersonnummer,
  tillSlug,
  trasigaKlamrar,
} from "@/lib/avtal";
import { sattKvitto } from "@/lib/toast-server";

export type AvtalState = { fel?: string };

/** Samma krets som `far_hantera_avtal()` i 0028. */
function farHantera(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return hasRole(user, "sales_manager", "ceo", "admin");
}

async function ledigSlug(bas: string): Promise<string> {
  const db = supabaseAdmin();
  for (const slug of [bas, ...Array.from({ length: 20 }, (_, i) => `${bas}-${i + 2}`)]) {
    const { data } = await db.from("contract_template").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  return `${bas}-${Date.now()}`;
}

/**
 * Sparar en mall.
 *
 * Valideringen sker HAR och inte nar avtalet skapas. Ett stavfel i en nyckel
 * ska stoppa den som skriver mallen — hon har texten framfor sig och vet vad
 * hon menade. Samma fel upptackt tre veckor senare, av nagon som ska anstalla
 * en person i dag, ar bara i vagen.
 */
export async function sparaMall(_prev: AvtalState, form: FormData): Promise<AvtalState> {
  let slug: string;

  try {
    const user = await getCurrentUser();
    if (!user?.employee || !farHantera(user)) return { fel: "Du saknar behörighet." };

    const id = String(form.get("mall_id") ?? "");
    const rubrik = String(form.get("rubrik") ?? "").trim();
    const text = String(form.get("text") ?? "").trim();
    const form_ = String(form.get("anstallningsform") ?? "");

    if (!rubrik) return { fel: "Ge mallen en rubrik." };
    if (text.length < 20) return { fel: "Mallen är för kort för att vara ett avtal." };

    if (trasigaKlamrar(text)) {
      return {
        fel: "Det finns en ofullständig platshållare i texten. Varje fält skrivs som {{fältnamn}}.",
      };
    }

    const okanda = okandaPlatshallare(text);
    if (okanda.length > 0) {
      return {
        fel:
          `Mallen använder fält som inte finns: ${okanda.join(", ")}. ` +
          `Tillgängliga fält: ${VARIABELNYCKLAR.join(", ")}.`,
      };
    }

    // En mall ar bolagets text, inte en persons. Ett personnummer i en MALL ar
    // dessutom nastan sakert nagons riktiga, inkopierat ur ett gammalt avtal.
    if (serUtSomPersonnummer(text)) {
      return {
        fel: "Mallen innehåller något som ser ut som ett personnummer. Navet lagrar inte personnummer — lämna en rad att fylla i för hand.",
      };
    }

    const db = supabaseAdmin();
    const nu = new Date().toISOString();

    if (id) {
      const { data: fanns } = await db
        .from("contract_template")
        .select("slug")
        .eq("id", id)
        .maybeSingle();
      if (!fanns) return { fel: "Mallen finns inte." };
      slug = fanns.slug;

      const { error } = await db
        .from("contract_template")
        .update({
          title: rubrik,
          body_md: text,
          employment_type: form_ || null,
          updated_by: user.employee.id,
          updated_at: nu,
        })
        .eq("id", id);
      if (error) return { fel: `Mallen kunde inte sparas: ${error.message}` };

      await db.from("audit_log").insert({
        actor_id: user.employee.id,
        action: "contract_template.updated",
        object_type: "contract_template",
        object_id: slug,
      });
    } else {
      slug = await ledigSlug(tillSlug(rubrik));
      const { error } = await db.from("contract_template").insert({
        slug,
        title: rubrik,
        body_md: text,
        employment_type: form_ || null,
        status: "draft",
        created_by: user.employee.id,
        updated_by: user.employee.id,
      });
      if (error) return { fel: `Mallen kunde inte sparas: ${error.message}` };

      await db.from("audit_log").insert({
        actor_id: user.employee.id,
        action: "contract_template.created",
        object_type: "contract_template",
        object_id: slug,
      });
    }
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/avtal/mallar");
  redirect(`/avtal/mallar/${slug}`);
}

export async function sattMallstatus(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farHantera(user)) throw new Error("Du saknar behörighet.");

  const id = String(form.get("mall_id") ?? "");
  const status = String(form.get("status") ?? "");
  if (!["draft", "published", "archived"].includes(status)) throw new Error("Okänd status.");

  const db = supabaseAdmin();
  const { data: mall } = await db
    .from("contract_template")
    .select("slug")
    .eq("id", id)
    .maybeSingle();
  if (!mall) throw new Error("Mallen finns inte.");

  await db
    .from("contract_template")
    .update({ status, updated_by: user.employee.id, updated_at: new Date().toISOString() })
    .eq("id", id);

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: `contract_template.${status}`,
    object_type: "contract_template",
    object_id: mall.slug,
  });

  if (status === "archived") {
    await sattKvitto({ text: "Mallen är arkiverad.", angra: { handling: "mall.arkiverad", id } });
  }

  revalidatePath("/avtal/mallar");
  revalidatePath(`/avtal/mallar/${mall.slug}`);
}

/**
 * Skapar ett avtal ur en mall.
 *
 * Renderar direkt och sparar RESULTATET. Faller renderingen skapas inget
 * avtal alls — se rubriken i src/lib/avtal.ts om varfor ett halvfyllt avtal
 * ar farligare an inget avtal.
 */
export async function skapaAvtal(_prev: AvtalState, form: FormData): Promise<AvtalState> {
  let nyttId: string;

  try {
    const user = await getCurrentUser();
    if (!user?.employee || !farHantera(user)) return { fel: "Du saknar behörighet." };

    const employeeId = String(form.get("employee_id") ?? "");
    const mallId = String(form.get("mall_id") ?? "");
    if (!employeeId || !mallId) return { fel: "Välj både person och mall." };

    const handskrivna: Record<string, string> = {};
    for (const nyckel of VARIABELNYCKLAR) {
      handskrivna[nyckel] = String(form.get(`var_${nyckel}`) ?? "");
    }

    const svar = await skapaAvtalsutkast(employeeId, mallId, handskrivna, user.employee.id);
    if ("fel" in svar) return { fel: svar.fel };
    nyttId = svar.avtalId;
  } catch (e) {
    return { fel: e instanceof Error ? e.message : "Något gick fel." };
  }

  revalidatePath("/avtal");
  redirect(`/avtal/${nyttId}`);
}

/**
 * Utfardar avtalet.
 *
 * Det ar HAR den anstallda far se det — RLS i 0028 slapper fram raden forst
 * nar status ar 'issued'. Efter det gar texten inte att andra; triggern i 0028
 * nekar det.
 */
export async function utfardaAvtal(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farHantera(user)) throw new Error("Du saknar behörighet.");

  const id = String(form.get("avtal_id") ?? "");
  const db = supabaseAdmin();

  const { data: avtal } = await db.from("contract").select("status").eq("id", id).maybeSingle();
  if (!avtal) throw new Error("Avtalet finns inte.");
  if (avtal.status !== "draft") throw new Error("Bara ett utkast kan utfärdas.");

  await db
    .from("contract")
    .update({
      status: "issued",
      issued_at: new Date().toISOString(),
      issued_by: user.employee.id,
    })
    .eq("id", id);

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "contract.issued",
    object_type: "contract",
    object_id: id,
  });

  revalidatePath("/avtal");
  revalidatePath(`/avtal/${id}`);
}

/** Drar tillbaka ett utfardat avtal. Texten star kvar — se triggern i 0028. */
export async function draTillbakaAvtal(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farHantera(user)) throw new Error("Du saknar behörighet.");

  const id = String(form.get("avtal_id") ?? "");
  const skal = String(form.get("skal") ?? "").trim();
  if (!skal) throw new Error("Ange varför avtalet dras tillbaka.");

  const db = supabaseAdmin();
  await db
    .from("contract")
    .update({
      status: "withdrawn",
      withdrawn_at: new Date().toISOString(),
      withdrawn_by: user.employee.id,
      withdrawn_reason: skal,
    })
    .eq("id", id);

  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "contract.withdrawn",
    object_type: "contract",
    object_id: id,
    reason: skal,
  });

  revalidatePath("/avtal");
  revalidatePath(`/avtal/${id}`);
}

/** Ett utkast som aldrig utfardades gar att radera. Ett utfardat gor det inte. */
export async function raderaUtkast(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user?.employee || !farHantera(user)) throw new Error("Du saknar behörighet.");

  const id = String(form.get("avtal_id") ?? "");
  const db = supabaseAdmin();

  const { data: avtal } = await db.from("contract").select("status").eq("id", id).maybeSingle();
  if (!avtal) return;
  if (avtal.status !== "draft") throw new Error("Bara ett utkast kan raderas.");

  await db.from("contract").delete().eq("id", id);
  await db.from("audit_log").insert({
    actor_id: user.employee.id,
    action: "contract.draft_deleted",
    object_type: "contract",
    object_id: id,
  });

  revalidatePath("/avtal");
  redirect("/avtal");
}
