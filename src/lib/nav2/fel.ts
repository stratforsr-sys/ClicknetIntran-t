import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fullName, hasRole, type CurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/server";
import { hamtaDrift, KVITTO_ACTIONS } from "@/lib/jobb/drift-server";
import { svensktDatum } from "@/lib/klocka";
import { SKRIVLAGE } from "./skrivlage";
import { formaFelrad, formaStat, formaSteg, type NdFel, type RaFelExtra, type RaFelrad } from "./felforma";

/**
 * Nav 2.0: Fel, med samma läsningar som /fel och det 0082 lade till.
 *
 * Allt läses med användarens token. RLS (`error_report_read`, 0026) ger
 * sales_manager, ceo och admin hela kön och alla andra sina egna rapporter;
 * sidan har inget eget rollfilter, precis som /fel. Tråden, följarna och
 * förekomsterna följer raden eller kön. Det enda som når fler är det kön
 * själv skrivit för alla (`kanda_fel()`) och antal (`fel_statistik()`).
 *
 * NAMNEN är undantaget, som chefens namn i data.ts: den som svarat i tråden
 * eller tagit felet står på en rad läsaren redan ser, men en säljare får inte
 * läsa den personens rad i `employee`. Bara för- och efternamn hämtas, med
 * service role, och bara för de id:n som står på läsarens egna rader.
 *
 * Driftkortet är repots `hamtaDrift` för samma krets som /fel ritar det åt.
 * Stegen läses ur samma kvitto (`meta.resultat` och `meta.fel`).
 */
export async function byggFel(supabase: SupabaseClient, user: CurrentUser): Promise<NdFel> {
  const hanterar = hasRole(user, "sales_manager", "ceo", "admin");
  const mig = user.employee!.id;

  const [{ data: rader }, { data: kanda }, { data: stat }, drift, { data: kvitto }] = await Promise.all([
    supabase
      .from("error_report")
      .select(
        "id, kind, digest, path, message, stack, body, blocking, occurrences, first_seen_at, last_seen_at, status, reporter_id, handled_by, handled_at, release, resolution, user_agent, pointed_at, assigned_to, confirmed_at, confirmed_ok, public_title, workaround",
      )
      .order("last_seen_at", { ascending: false })
      .limit(200),
    supabase.rpc("kanda_fel"),
    supabase.rpc("fel_statistik"),
    hanterar ? hamtaDrift(supabase) : Promise.resolve(null),
    hanterar
      ? supabase
          .from("audit_log")
          .select("meta")
          .eq("object_type", "job")
          .eq("object_id", "natt")
          .in("action", [...KVITTO_ACTIONS])
          .order("ts", { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
  ]);

  const ra = (rader ?? []) as unknown as RaFelrad[];
  const ids = ra.map((r) => r.id);
  const sexDagarSedan = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: meddelanden }, { data: foljare }, { data: forekomster }] = await Promise.all([
    ids.length
      ? supabase.from("error_report_message").select("error_id, author_id, body, created_at").in("error_id", ids).order("created_at")
      : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("error_report_follower").select("error_id, employee_id").in("error_id", ids) : Promise.resolve({ data: [] }),
    hanterar && ids.length
      ? supabase.from("error_occurrence").select("error_id, employee_id, seen_at").in("error_id", ids).gte("seen_at", sexDagarSedan)
      : Promise.resolve({ data: null }),
  ]);

  const extra: RaFelExtra = {
    meddelanden: (meddelanden ?? []) as RaFelExtra["meddelanden"],
    foljare: (foljare ?? []) as RaFelExtra["foljare"],
    forekomster: forekomster ? (forekomster as NonNullable<RaFelExtra["forekomster"]>) : null,
    mig,
    idag: svensktDatum(),
  };

  // Namnen på de personer som står på raderna (se rubriken).
  const ider = new Set<string>();
  ra.forEach((r) => [r.reporter_id, r.handled_by, r.assigned_to].forEach((x) => x && ider.add(x)));
  extra.meddelanden.forEach((m) => m.author_id && ider.add(m.author_id));
  const { data: namnRader } = ider.size
    ? await supabaseAdmin().from("employee").select("id, first_name, last_name").in("id", [...ider])
    : { data: [] as { id: string; first_name: string; last_name: string }[] };

  return {
    hanterar,
    namn: Object.fromEntries((namnRader ?? []).map((p) => [p.id as string, fullName(p)])),
    release:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    rader: ra.map((r) => formaFelrad(r, hanterar, extra)),
    kanda: ((kanda ?? []) as { id: string; kind: string; status: string; path: string; titel: string; workaround: string; drabbade: number; foljer: boolean }[]).map((k) => ({
      id: k.id,
      kind: k.kind,
      status: k.status,
      path: k.path,
      titel: k.titel,
      kant: k.workaround,
      drabbade: Number(k.drabbade) || 0,
      foljer: Boolean(k.foljer),
    })),
    stat: formaStat(stat),
    drift: drift
      ? {
          lage: drift.besked.lage,
          timmar: drift.besked.timmar,
          ts: drift.kvitto?.ts ?? null,
          helt: drift.kvitto?.helt ?? false,
          sekunder: drift.kvitto?.sekunder ?? null,
          steg: formaSteg((kvitto as { meta: unknown }[] | null)?.[0]?.meta),
        }
      : null,
    skriv: SKRIVLAGE.fel,
  };
}
