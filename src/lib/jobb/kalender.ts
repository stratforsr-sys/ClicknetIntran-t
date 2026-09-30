import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { svensktDatum } from "@/lib/klocka";
import { HORISONT_DAGAR, forekomster, type Serieregel } from "@/lib/upprepning";
import { plus } from "@/lib/leveranskalender";
import { tomUtkorgen, type Tomning } from "@/lib/utkorg-server";

/**
 * Leveranskalenderns steg i dagtidsjobbet (0070): var kvart, vardagar.
 *
 * 1. SERIERNAS HORISONT. Varje serie har riktiga förekomster 56 dagar framåt
 *    (`HORISONT_DAGAR`, samma som uppgiftsserierna). Datumen räknas av
 *    `forekomster()` — samma regel som när serien skapades — och databasen
 *    föder bara det som saknas. En förekomst som flyttats för sig rörs inte.
 * 2. FÖRBEREDELSEN vardagen före kl 15 (`lk_forberedelser`). Nyckeln per
 *    förekomst och person gör att steget tål att köras var kvart.
 * 3. UTKORGEN töms, så att förberedelsen når klockan direkt och inte först
 *    när reservjobbet `nav-utkorg` kört.
 */
export type Kalendersteg = {
  serier: number;
  fodda: number;
  forberedelser: number | string;
  utkorg: Tomning;
};

export async function korKalendersteget(db: SupabaseClient, nu = new Date()): Promise<Kalendersteg> {
  const idag = svensktDatum(nu);
  const till = plus(idag, HORISONT_DAGAR);

  const { data: serier } = await db
    .from("calendar_series")
    .select("id, monster, intervall, veckodag, starts_on, ends_on")
    .or(`ends_on.is.null,ends_on.gte.${idag}`);

  let fodda = 0;
  const rader = (serier ?? []) as unknown as {
    id: string;
    monster: "vardagar" | "veckovis";
    intervall: number;
    veckodag: number | null;
    starts_on: string;
    ends_on: string | null;
  }[];
  for (const s of rader) {
    const regel: Serieregel = {
      monster: s.monster,
      veckodagar: s.monster === "veckovis" && s.veckodag ? [s.veckodag] : [],
      starts_on: s.starts_on,
      ends_on: s.ends_on,
      intervall: s.intervall === 2 ? 2 : 1,
    };
    const dagar = forekomster(regel, idag, till);
    if (dagar.length === 0) continue;
    const { data } = await db.rpc("lk_fyll_serie", { p_series: s.id, p_dagar: dagar });
    fodda += Number(data ?? 0);
  }

  const { data: forb, error } = await db.rpc("lk_forberedelser");
  const utkorg = await tomUtkorgen(200);

  return {
    serier: rader.length,
    fodda,
    forberedelser: error ? `fel: ${error.message}` : Number(forb ?? 0),
    utkorg,
  };
}
