"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, hasRole } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ANGRABARA, arId, type Angrabar } from "@/lib/toast";
import { sattKvitto } from "@/lib/toast-server";

/**
 * E5.7. Angra-knappen i kvittot.
 *
 * ===========================================================================
 * DISPATCHERN LITAR INTE PA KVITTOT.
 *
 * `handling` och `id` kommer fran ett dolt falt i ett formular, alltsa fran
 * webblasaren, alltsa fran nagot en anvandare kan skriva om. Varje gren nedan
 * gor darfor OM hela behorighetskontrollen — precis som om atgarden anropats
 * fran sin egen sida.
 *
 * Att kvittot bara VISAS for den som nyss gjorde atgarden ar ingen sparr. Det
 * ar en foljd av att kakan sattes i hennes svar, och en foljd ar inte ett
 * skydd.
 *
 * Listan ar stangd (ANGRABARA i src/lib/toast.ts). En handling som inte star
 * dar gor ingenting — inte ens ett felmeddelande som beratter att den fanns.
 * ===========================================================================
 *
 * Varje angring loggas som en EGEN rad i audit_log. Den ursprungliga atgarden
 * star kvar. Att sudda den hade gjort loggen till en berattelse om vad som
 * blev kvar, inte om vad som hande — och det ar det senare AC-12.1 vill ha.
 *
 * `angra` ar det ENDA som exporteras harifran, och det ska den forbli. Allt
 * som exporteras ur en `"use server"`-fil blir en publik andpunkt — darfor
 * ligger `sattKvitto` i src/lib/toast-server.ts.
 */
export async function angra(form: FormData): Promise<void> {
  const handling = String(form.get("handling") ?? "");
  const id = String(form.get("id") ?? "");

  if (!(ANGRABARA as readonly string[]).includes(handling)) return;
  if (!arId(id)) return;

  const user = await getCurrentUser();
  if (!user?.employee) return;

  const db = supabaseAdmin();

  switch (handling as Angrabar) {
    /**
     * Nyheten publiceras igen.
     *
     * `published_at` rors inte — det ar redan satt, och nyheternas actions.ts
     * forklarar varfor: en nyhet som avpubliceras och publiceras igen ska inte
     * dyka upp som ny i allas klockor en andra gang. Just den regeln ar det som
     * gor arkiveringen angrabar utan biverkning.
     */
    case "nyhet.arkiverad": {
      if (!hasRole(user, "sales_manager", "ceo", "admin")) return;

      const { data: nyhet } = await db
        .from("news_post")
        .select("slug, status")
        .eq("id", id)
        .maybeSingle();
      if (!nyhet || nyhet.status !== "archived") return;

      await db
        .from("news_post")
        .update({ status: "published", updated_at: new Date().toISOString() })
        .eq("id", id);

      await db.from("audit_log").insert({
        actor_id: user.employee.id,
        action: "news.unarchived",
        object_type: "news_post",
        object_id: nyhet.slug,
        reason: "Ångrad direkt efter arkivering",
      });

      await sattKvitto({ text: "Inlägget är publicerat igen." });
      revalidatePath("/nyheter");
      revalidatePath(`/nyheter/${nyhet.slug}`);
      return;
    }

    case "fel.avslutad": {
      if (!hasRole(user, "sales_manager", "ceo", "admin")) return;

      const { data: rapport } = await db
        .from("error_report")
        .select("status")
        .eq("id", id)
        .maybeSingle();
      if (!rapport || rapport.status !== "closed") return;

      await db
        .from("error_report")
        .update({ status: "new", handled_by: user.employee.id, handled_at: new Date().toISOString() })
        .eq("id", id);

      await db.from("audit_log").insert({
        actor_id: user.employee.id,
        action: "error.new",
        object_type: "error_report",
        object_id: id,
        reason: "Ångrad direkt efter avslut",
      });

      await sattKvitto({ text: "Felrapporten är öppen igen." });
      revalidatePath("/fel");
      return;
    }

    case "mall.arkiverad": {
      if (!hasRole(user, "sales_manager", "ceo", "admin")) return;

      const { data: mall } = await db
        .from("contract_template")
        .select("slug, status")
        .eq("id", id)
        .maybeSingle();
      if (!mall || mall.status !== "archived") return;

      await db
        .from("contract_template")
        .update({
          status: "published",
          updated_by: user.employee.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      await db.from("audit_log").insert({
        actor_id: user.employee.id,
        action: "contract_template.published",
        object_type: "contract_template",
        object_id: mall.slug,
        reason: "Ångrad direkt efter arkivering",
      });

      await sattKvitto({ text: "Mallen är publicerad igen." });
      revalidatePath("/avtal/mallar");
      revalidatePath(`/avtal/mallar/${mall.slug}`);
      return;
    }
  }
}
