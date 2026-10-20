import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SKRIVLAGE } from "@/lib/nav2/skrivlage";

/**
 * Nav 2.0 (0130): schemalagda inlägg i Nyheter ("I morgon 07:30", "måndag 07:30").
 *
 * Körs av dagtidsjobbet var kvart (pg_cron, vardagar 05–19 UTC), och bara när
 * `SKRIVLAGE.nyheter` är på. Ett schemalagt inlägg står som utkast med
 * `scheduled_at`. När tiden passerat blir det publicerat, med tiden då jobbet
 * körde: klockan räknar ett inlägg som nytt om det är nyare än när personen
 * senast tittade, och den planerade tiden hade gjort det läst för den som
 * tittade under kvarten emellan. Notisen till mottagarna är klockans härledda
 * (`news_post` i notiser-server.ts), som när ett inlägg publiceras direkt.
 *
 * pg_cron ringer bara produktionen (minnet nav-push-och-pgcron-produktion), så
 * i previewen går inget schemalagt ut av sig självt.
 */
export async function publiceraSchemalagda(db: SupabaseClient, nu: Date = new Date()): Promise<{ publicerade: string[]; fel?: string } | null> {
  if (!SKRIVLAGE.nyheter) return null;
  const { data, error } = await db
    .from("news_post")
    .select("id, slug, author_id, published_at")
    .eq("status", "draft")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", nu.toISOString());
  if (error) return { publicerade: [], fel: error.message };
  const publicerade: string[] = [];
  for (const p of (data ?? []) as { id: string; slug: string; author_id: string; published_at: string | null }[]) {
    const { error: e } = await db
      .from("news_post")
      .update({ status: "published", published_at: p.published_at ?? nu.toISOString(), updated_at: nu.toISOString() })
      .eq("id", p.id)
      .eq("status", "draft");
    if (e) return { publicerade, fel: e.message };
    await db.from("audit_log").insert({ actor_id: p.author_id, action: "news.published", object_type: "news_post", object_id: p.slug, meta: { schemalagt: true } });
    publicerade.push(p.slug);
  }
  return { publicerade };
}
