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
 *
 * BARA DET SOM PASSERADE DE SENASTE 48 TIMMARNA (granskningen H3). Previewen
 * sparar i produktionens databas, så inlägg som schemalades under provningen
 * står kvar som utkast med en tid i det förflutna. Utan gränsen hade första
 * körningen efter mergen publicerat dem för alla. En schemaläggning är alltid
 * en arbetsdag 07:30 och jobbet går var kvart på vardagar, så ett riktigt
 * inlägg är som mest en kvart gammalt när det tas.
 */
export const SCHEMALAGT_FONSTER_MS = 48 * 3_600_000;

/** Id:n att publicera nu: utkast med en schemalagd tid som passerat, men inom fönstret. */
export function attPublicera(rader: { id: string; status: string; scheduled_at: string | null }[], nu: Date): string[] {
  const t = nu.getTime();
  return rader
    .filter((r) => {
      if (r.status !== "draft" || !r.scheduled_at) return false;
      const s = Date.parse(r.scheduled_at);
      return s <= t && s > t - SCHEMALAGT_FONSTER_MS;
    })
    .map((r) => r.id);
}

export async function publiceraSchemalagda(db: SupabaseClient, nu: Date = new Date()): Promise<{ publicerade: string[]; fel?: string } | null> {
  if (!SKRIVLAGE.nyheter) return null;
  const { data, error } = await db
    .from("news_post")
    .select("id, slug, author_id, published_at, status, scheduled_at")
    .eq("status", "draft")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", nu.toISOString())
    .gt("scheduled_at", new Date(nu.getTime() - SCHEMALAGT_FONSTER_MS).toISOString());
  if (error) return { publicerade: [], fel: error.message };
  const rader = (data ?? []) as { id: string; slug: string; author_id: string; published_at: string | null; status: string; scheduled_at: string | null }[];
  const ta = new Set(attPublicera(rader, nu));
  const publicerade: string[] = [];
  for (const p of rader.filter((r) => ta.has(r.id))) {
    // Samma villkor i uppdateringen (F2-21): den som ångrar schemaläggningen samtidigt nollar scheduled_at, och då träffas ingen rad.
    const { data: tagna, error: e } = await db
      .from("news_post")
      .update({ status: "published", published_at: p.published_at ?? nu.toISOString(), updated_at: nu.toISOString() })
      .eq("id", p.id)
      .eq("status", "draft")
      .not("scheduled_at", "is", null)
      .select("id");
    if (e) return { publicerade, fel: e.message };
    if (!tagna?.length) continue;
    await db.from("audit_log").insert({ actor_id: p.author_id, action: "news.published", object_type: "news_post", object_id: p.slug, meta: { schemalagt: true } });
    publicerade.push(p.slug);
  }
  return { publicerade };
}
