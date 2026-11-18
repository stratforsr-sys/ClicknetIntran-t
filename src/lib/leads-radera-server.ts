import { supabaseAdmin } from "@/lib/supabase/server";
import { skrivHandelse } from "@/lib/handelselogg-server";
import { raderingsHinder } from "@/lib/leads";
import { tilldelningsprefix } from "@/lib/nav2/leadsforma";

/**
 * Raderar ett lead för alltid. Används av båda vyerna: `/leads/[id]`
 * (`raderaLead` i leads/actions.ts) och Nav 2.0 (`radera` i /nav2/leads).
 * Behörigheten prövas av den som anropar, före anropet: bara den som fördelar
 * leads får radera.
 *
 * ===========================================================================
 * RADERA, INTE GÖMMA. Ett lead är en främlings namn, telefon och mejl. Den som
 * raderar vill att de ska vara borta, och "Spam" finns redan för att bara ta
 * bort ett lead ur listorna. Därför finns ingen Ångra-knapp: det finns ingen
 * äkta invers (src/lib/toast.ts), och att spara en kopia för att kunna lägga
 * tillbaka den hade varit att inte radera.
 *
 * Med leadet går:
 *   - samtalen och stegen (`lead_event`, on delete cascade),
 *   - gångerna samma kund skrev igen (`duplicate_of`). Utan det blev de egna
 *     leads när originalet försvann (on delete set null),
 *   - notiser om leadet, och tilldelningsmejl som ännu väntar i utkorgen.
 *
 * Loggen får en rad, `lead.deleted`, utan kunddata: vem, när, vilket id,
 * statusen och hur många dubbletter som gick med.
 * ===========================================================================
 */
export async function raderaLeadet(
  actorId: string,
  id: string,
): Promise<{ ok: string } | { fel: string; status: number }> {
  const db = supabaseAdmin();
  const { data: rad, error: lasfel } = await db
    .from("lead")
    .select("id, status, order_id, meeting_event_id")
    .eq("id", id)
    .maybeSingle();
  if (lasfel) throw new Error(`Leadet kunde inte läsas: ${lasfel.message}`);
  const l = rad as { id: string; status: string; order_id: string | null; meeting_event_id: string | null } | null;
  if (!l) return { fel: "Leadet finns inte.", status: 404 };

  const hinder = raderingsHinder(l);
  if (hinder) return { fel: hinder, status: 409 };

  const { data: dr, error: dfel } = await db.from("lead").select("id").eq("duplicate_of", id);
  if (dfel) throw new Error(`Leadet kunde inte läsas: ${dfel.message}`);
  const dubbletter = ((dr ?? []) as { id: string }[]).map((d) => d.id);
  const alla = [id, ...dubbletter];

  // Det som väntar på att gå ut först, så att ingen får ett mejl om ett lead som inte finns.
  for (const x of alla) {
    await db.from("outbox").delete().like("idempotency_key", `${tilldelningsprefix(x)}%`).is("claimed_at", null).is("sent_at", null);
  }
  await db.from("notification_event").delete().eq("object_type", "lead").in("object_id", alla);

  // Dubbletterna före originalet: de pekar på det.
  if (dubbletter.length) {
    const { error } = await db.from("lead").delete().in("id", dubbletter);
    if (error) throw new Error(`Leadet kunde inte raderas: ${error.message}`);
  }
  const { error } = await db.from("lead").delete().eq("id", id);
  if (error) throw new Error(`Leadet kunde inte raderas: ${error.message}`);

  await skrivHandelse({
    actorId,
    action: "lead.deleted",
    objectType: "lead",
    objectId: id,
    meta: { status: l.status, dubbletter: dubbletter.length },
  });

  return {
    ok: dubbletter.length
      ? `Leadet är raderat, med ${dubbletter.length === 1 ? "gången" : `de ${dubbletter.length} gångerna`} kunden skrev igen.`
      : "Leadet är raderat.",
  };
}
