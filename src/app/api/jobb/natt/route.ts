import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { M2_AKTIV } from "@/lib/tid";
import { korTidjobbet } from "@/lib/jobb/tid";
import { korKontojobbet } from "@/lib/jobb/konton";
import { korArendejobbet } from "@/lib/jobb/arenden";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Ett nattjobb i stället för tre.
 *
 * Bakgrunden är inte estetisk. Tre cron-poster deklarerades i `vercel.json`,
 * och ingen av dem kördes — Hobby-planen tar två per projekt. Följden var tyst:
 * en instämpling stod öppen i två dygn, journalen fick inga rader och ingen sen
 * ankomst upptäcktes. Ett schemalagt jobb som inte kör ser likadant ut som ett
 * som inte hade något att göra.
 *
 * Nu körs allt från en post. Varje steg körs för sig och ett fel i ett steg
 * stoppar inte de andra — men det syns i svaret, och svaret sparas i loggen så
 * att en utebliven körning går att se i efterhand.
 */
export async function GET(request: NextRequest) {
  const hemlighet = process.env.CRON_SECRET;
  if (!hemlighet) return NextResponse.json({ fel: "CRON_SECRET saknas" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${hemlighet}`)
    return NextResponse.json({ fel: "Nekad" }, { status: 401 });

  const db = supabaseAdmin();
  const start = Date.now();
  const resultat: Record<string, unknown> = {};
  const fel: Record<string, string> = {};

  const steg: [string, () => Promise<unknown>][] = [
    ["tid", () => (M2_AKTIV ? korTidjobbet(db) : Promise.resolve({ hoppade_over: "stämplingen är av" }))],
    ["konton", () => korKontojobbet(db)],
    ["arenden", () => korArendejobbet(db)],
  ];

  for (const [namn, kor] of steg) {
    try {
      resultat[namn] = await kor();
    } catch (e) {
      fel[namn] = e instanceof Error ? e.message : String(e);
    }
  }

  const sekunder = Math.round((Date.now() - start) / 100) / 10;

  // Kvittot pa att jobbet kort. Utan det gar det inte att skilja "inget hande"
  // fran "ingenting kordes" — och det var precis den skillnaden som kostade tva
  // dygn av oupptackt oppen stampling.
  await db.from("audit_log").insert({
    actor_id: null,
    action: Object.keys(fel).length > 0 ? "job.night_partial" : "job.night_ok",
    object_type: "job",
    object_id: "natt",
    meta: { sekunder, resultat, fel },
  });

  return NextResponse.json(
    { sekunder, ...resultat, ...(Object.keys(fel).length > 0 ? { fel } : {}) },
    { status: Object.keys(fel).length > 0 ? 500 : 200 },
  );
}
