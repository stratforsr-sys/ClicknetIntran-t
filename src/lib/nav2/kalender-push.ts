import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pushaTill } from "@/lib/nav2/push";
import { skaPaminna } from "@/lib/nav2/kalender-andring";

export { skaPaminna };

/**
 * Nav 2.0: allt i kalendern som push i telefonen (Kalendern som Outlook, del 10).
 *
 * Beställaren 2026-10-22: "super viktigt, allt i kalendern ska komma som notis i
 * telefonen". Två delar, och ingen av dem kräver en migration:
 *
 *   1. VARJE KALENDERNOTIS PUSHAS. Inbjudan, flytt, ändring, inställt, svar,
 *      förslag och beslut, 1:1-punkter och förberedelse, delningar, leveransens
 *      notiser och uppgiftens påminnelse. Alla skrivs genom
 *      `notishandelse-server.ts`, och där pushar `pushaHandelse` när raden står.
 *   2. MÖTETS PÅMINNELSE på påminnelsetiden (`motespaminnelser`). Den läggs i
 *      utkorgen varje minut (`/api/jobb/utkorg`), som uppgifternas påminnelse
 *      (`lk_uppgiftspaminnelser`), och blir då en vanlig notis med push.
 *
 * Pushen kommer tom (`push.ts`). Enhetens service worker frågar
 * `/nav2/kalender?push=<endpoint>` vad den gällde: `kalPushNasta` svarar med
 * den äldsta kalendernotisen som den enheten inte visat, en per push.
 */

/** Källorna som pushas. Allt i kalendern; `utkorg-fel` är admins och pushas inte. */
export const PUSHKALLOR = new Set<string>([
  "kalender-delad",
  "kalender-aterkallad",
  "kalender-inbjudan",
  "kalender-flyttad",
  "kalender-flyttad-tyst",
  "kalender-installd",
  "kalender-svar",
  "kalender-forslag",
  "kalender-forslag-beslut",
  "kalender-punkt",
  "kalender-forberedelse",
  "kalender-paminnelse",
  "uppgift-paminnelse",
  "leverans-ny",
  "leverans-bokad",
  "leverans-makulerad",
  "leverans-komplettera",
  "leverans-frist",
  "leverans-studs",
]);

/** Pushar till mottagarnas enheter, om källan är kalenderns. Kastar aldrig: notisraden står redan. */
export async function pushaHandelse(mottagare: readonly string[], kalla: string): Promise<void> {
  if (!PUSHKALLOR.has(kalla)) return;
  const db = supabaseAdmin();
  for (const id of new Set(mottagare)) {
    try {
      await pushaTill(db, id);
    } catch {
      // En enhet som inte svarar får inte stoppa nästa.
    }
  }
}

/* ---------- Mötets påminnelse ---------- */

type Mote = {
  id: string;
  organizer_id: string | null;
  series_id: string | null;
  starts_at: string;
  reminder_min: number;
  /** "Ingen påminnelse" för mötet (0212). */
  reminder_off: boolean | null;
  plats: string | null;
  tid: string | null;
};
type Deltagarrad = { event_id: string | null; series_id: string | null; employee_id: string; response: string; reminder_min: number | null; reminder_off: boolean | null };

/**
 * Lägger mötenas påminnelser i utkorgen, en per person och starttid. Arrangören
 * och deltagarna (på mötet eller serien) som inte tackat nej. Den egna
 * påminnelsen (0088) går före mötets. Påminnelsen gäller från påminnelsetiden
 * tills mötet börjar; "vid start" (0 min) i två minuter efter. Nyckeln i
 * utkorgen bär starttiden, så ett flyttat möte påminner igen och samma tid
 * aldrig två gånger.
 */
export async function motespaminnelser(db: SupabaseClient, nu = new Date()): Promise<number> {
  const fran = new Date(nu.getTime() - 2 * 60_000).toISOString();
  const till = new Date(nu.getTime() + (1440 + 1) * 60_000).toISOString();
  const { data: moten } = await db
    .from("calendar_event")
    .select("id, organizer_id, series_id, starts_at, reminder_min, reminder_off, plats, tid")
    .is("cancelled_at", null)
    .gte("starts_at", fran)
    .lte("starts_at", till);
  const lista = (moten ?? []) as Mote[];
  if (!lista.length) return 0;

  const ids = lista.map((m) => m.id);
  const serier = [...new Set(lista.map((m) => m.series_id).filter((s): s is string => Boolean(s)))];
  const [{ data: pa }, { data: ps }] = await Promise.all([
    db.from("calendar_attendee").select("event_id, series_id, employee_id, response, reminder_min, reminder_off").in("event_id", ids).not("employee_id", "is", null),
    serier.length
      ? db.from("calendar_attendee").select("event_id, series_id, employee_id, response, reminder_min, reminder_off").in("series_id", serier).not("employee_id", "is", null)
      : Promise.resolve({ data: [] as Deltagarrad[] }),
  ]);
  const perMote = new Map<string, Deltagarrad[]>(), perSerie = new Map<string, Deltagarrad[]>();
  for (const r of (pa ?? []) as Deltagarrad[]) if (r.event_id) perMote.set(r.event_id, [...(perMote.get(r.event_id) ?? []), r]);
  for (const r of (ps ?? []) as Deltagarrad[]) if (r.series_id) perSerie.set(r.series_id, [...(perSerie.get(r.series_id) ?? []), r]);

  const rader: { kind: string; payload: Record<string, unknown>; idempotency_key: string; event_id: string; not_before: string }[] = [];
  for (const m of lista) {
    // Heldag (0204) har inget klockslag att påminna inför.
    if (!m.tid) continue;
    const start = new Date(m.starts_at).getTime();
    // Mötets rad går före seriens för samma person.
    const vem = new Map<string, { svar: string; min: number | null; av: boolean | null }>();
    for (const r of perSerie.get(m.series_id ?? "") ?? []) vem.set(r.employee_id, { svar: r.response, min: r.reminder_min, av: r.reminder_off ?? null });
    for (const r of perMote.get(m.id) ?? []) {
      const s = vem.get(r.employee_id);
      vem.set(r.employee_id, { svar: r.response, min: r.reminder_min ?? s?.min ?? null, av: r.reminder_off ?? s?.av ?? null });
    }
    if (m.organizer_id && !vem.has(m.organizer_id)) vem.set(m.organizer_id, { svar: "ja", min: null, av: null });
    for (const [person, { svar, min, av }] of vem) {
      if (svar === "nej") continue;
      // "Ingen påminnelse" (granskningen E4): mötets eller deltagarens, null = ingen push.
      const fore = skaPaminna({ reminder_min: m.reminder_min, reminder_off: Boolean(m.reminder_off) }, { reminder_min: min, reminder_off: av });
      if (fore === null) continue;
      const nar = start - fore * 60_000;
      if (nu.getTime() < nar || nu.getTime() >= start + (fore === 0 ? 2 * 60_000 : 0)) continue;
      rader.push({
        kind: "notis",
        payload: { kalla: "kalender-paminnelse", mall: "paminnelse", till: person, av: null, event_id: m.id, data: { min: fore, plats: m.plats ?? "" } },
        idempotency_key: `motespaminnelse:${m.id}:${person}:${m.starts_at}`,
        event_id: m.id,
        not_before: nu.toISOString(),
      });
    }
  }
  if (!rader.length) return 0;
  const { data, error } = await db.from("outbox").upsert(rader, { onConflict: "idempotency_key", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`motespaminnelser: ${error.message}`);
  return (data ?? []).length;
}

/* ---------- Vad pushen gällde ---------- */

export type Pushnotis = { id: number; titel: string; text: string; url: string };

/**
 * Den äldsta kalendernotisen som den här enheten inte visat, eller null. Varje
 * enhet har sin egen markör (`nav_preference` `push.kal.<enhet>`): personens
 * alla enheter får samma push, och var och en visar samma notis. Utan markör
 * (en ny enhet) räknas bara de senaste femton minuterna, så att en nyss
 * påslagen telefon inte visar gamla notiser. Äldre än tolv timmar visas
 * aldrig: pushen lever inte längre än så (TTL i `push.ts`).
 */
export async function kalPushNasta(mig: string, endpoint: string): Promise<Pushnotis | null> {
  const db = supabaseAdmin();
  const { data: enhet } = await db.from("push_subscription").select("id").eq("employee_id", mig).eq("endpoint", endpoint).maybeSingle();
  if (!enhet) return null;
  const nyckel = `push.kal.${enhet.id as string}`;
  const { data: pref } = await db.from("nav_preference").select("value").eq("employee_id", mig).eq("key", nyckel).maybeSingle();
  const markor = Number((pref?.value as { id?: number } | null)?.id ?? 0);
  const golv = new Date(Date.now() - (markor ? 12 * 60 : 15) * 60_000).toISOString();

  const { data } = await db
    .from("notification_event")
    .select("id, rubrik, detalj, href")
    .eq("employee_id", mig)
    .in("kalla", [...PUSHKALLOR])
    .gt("id", markor)
    .gte("created_at", golv)
    .order("id", { ascending: true })
    .limit(1);
  const n = (data ?? [])[0] as { id: number; rubrik: string; detalj: string | null; href: string } | undefined;
  if (!n) return null;
  await db.from("nav_preference").upsert({ employee_id: mig, key: nyckel, value: { id: n.id }, updated_at: new Date().toISOString() }, { onConflict: "employee_id,key" });
  return { id: n.id, titel: n.rubrik, text: n.detalj ?? "", url: `/nav2?till=${encodeURIComponent(n.href)}` };
}
