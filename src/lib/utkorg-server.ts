import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { medRoll, notifiera, notifieraFranUtkorgen } from "@/lib/notishandelse-server";
import { HANDELSEKALLOR, type Handelsekalla } from "@/lib/notiser";
import { ANGER_SEKUNDER, notistext, type Notisrad } from "@/lib/leveranskalender";

/**
 * Utkorgen (0069): allt som lämnar en kalenderändring.
 *
 * =============================================================================
 * RADERNA SKRIVS I SAMMA TRANSAKTION SOM ÄNDRINGEN — HÄR TÖMS DE
 *
 * `lk_*`-funktionerna i databasen skriver ändringen och utkorgens rader
 * tillsammans, med `not_before = now() + 10 s`. Här skickas de. Två vägar hit:
 *
 *   1. `after()` i den action som skrev raderna: väntar ut ångerfönstret och
 *      tömmer. Det är den vanliga vägen, och den gör att en inbjudan når
 *      klockan tio sekunder efter att den skickats.
 *   2. `/api/jobb/utkorg`, som `pg_cron` ringer varje minut. Reserven, för när
 *      funktionen dog innan fönstret gått ut.
 *
 * DE KAN INTE TA SAMMA RAD. `lk_utkorg_ta()` tar raderna med
 * `for update skip locked` och stämplar dem, och samma `idempotency_key` kan
 * aldrig skrivas två gånger. En rad som Ångra hunnit ta bort finns inte kvar
 * att ta, och en rad som tagits går inte längre att ångra (`lk_angra` vägrar).
 *
 * TRE MISSLYCKADE FÖRSÖK ger `error`, och admin får en notis. Raden försöks
 * inte igen — ett fel som kvarstår efter tre minuter är ett fel en människa
 * ska titta på.
 * =============================================================================
 */

const KALLOR = new Set<string>(HANDELSEKALLOR);

type Utkorgsrad = {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type Tomning = { skickade: number; hoppade: number; fel: number; igen: number };

/** Töm det som är dags att skicka. Kastar aldrig. */
export async function tomUtkorgen(antal = 50): Promise<Tomning> {
  const utfall: Tomning = { skickade: 0, hoppade: 0, fel: 0, igen: 0 };
  const db = supabaseAdmin();

  const { data, error } = await db.rpc("lk_utkorg_ta", { p_antal: antal });
  if (error || !data) return utfall;

  for (const rad of data as unknown as Utkorgsrad[]) {
    let fel: string | null = null;
    try {
      const gick = await skicka(rad);
      if (gick) utfall.skickade++;
      else utfall.hoppade++;
    } catch (e) {
      fel = e instanceof Error ? e.message : String(e);
    }

    const { data: klar } = await db.rpc("lk_utkorg_klar", { p_id: rad.id, p_fel: fel });
    const svar = klar as unknown as "skickad" | "igen" | "fel" | null;
    if (svar === "fel") {
      utfall.fel++;
      await sagTillAdmin(rad, fel ?? "okänt fel");
    } else if (svar === "igen") {
      utfall.igen++;
    }
  }
  return utfall;
}

/**
 * Vänta ut ångerfönstret och töm. Anropas i `after()` av actionen som skrev
 * raderna, så att den som bjöd in inte står och väntar på Resend.
 */
export async function tomEfterFonstret(): Promise<void> {
  await new Promise((r) => setTimeout(r, (ANGER_SEKUNDER + 1) * 1000));
  await tomUtkorgen();
}

/** En rad. `true` = skickad, `false` = sållad av reglerna (inget att skicka). */
async function skicka(rad: Utkorgsrad): Promise<boolean> {
  if (rad.kind !== "notis") {
    // Resend, .ics och CRM byggs i pass 3 och 4. En sådan rad i pass 1 är ett
    // fel i databasen, inte något att tyst markera som skickat.
    throw new Error(`Okänd sort i utkorgen: ${rad.kind}`);
  }

  const n = rad.payload as unknown as Notisrad;
  if (!KALLOR.has(n.kalla)) throw new Error(`Okänd källa: ${n.kalla}`);

  const underlag = await hamtaUnderlag(n);
  if (!underlag) return false;

  const text = notistext(n, underlag);
  if (!text) throw new Error(`Okänd mall: ${n.mall}`);

  return notifieraFranUtkorgen({
    till: n.till,
    av: n.av,
    kalla: n.kalla as Handelsekalla,
    typ: n.task_id ? "uppgift" : "kalender",
    rubrik: text.rubrik,
    detalj: text.detalj,
    href: text.href,
    objekt: n.event_id
      ? { typ: "calendar_event", id: n.event_id }
      : n.task_id
        ? { typ: "task", id: n.task_id }
        : undefined,
  });
}

/**
 * Det texten behöver: aktörens förnamn, rubriken och tiden. Läses NU, när
 * raden töms — tio sekunder efter handlingen är rubriken densamma.
 *
 * `null` när händelsen eller uppgiften inte längre finns: då finns det inget
 * att berätta, och raden räknas som hanterad.
 */
async function hamtaUnderlag(n: Notisrad) {
  const db = supabaseAdmin();

  const avNamn = n.av
    ? (((await db.from("employee").select("first_name").eq("id", n.av).maybeSingle()).data?.first_name as string | undefined) ?? null)
    : null;

  if (n.event_id) {
    const { data: e } = await db
      .from("calendar_event")
      .select("title, dag, tid")
      .eq("id", n.event_id)
      .maybeSingle();
    if (!e) return null;
    return {
      avNamn,
      rubrik: e.title as string,
      dag: e.dag as string,
      tid: e.tid ? String(e.tid).slice(0, 5) : null,
    };
  }

  if (n.task_id) {
    const { data: t } = await db
      .from("task")
      .select("title, due_date, due_time")
      .eq("id", n.task_id)
      .maybeSingle();
    if (!t || !t.due_date) return null;
    return {
      avNamn,
      rubrik: t.title as string,
      dag: t.due_date as string,
      tid: t.due_time ? String(t.due_time).slice(0, 5) : null,
    };
  }

  return null;
}

/** Tredje misslyckade försöket. En notis per rad, aldrig en per försök. */
async function sagTillAdmin(rad: Utkorgsrad, fel: string): Promise<void> {
  const admins = await medRoll("admin");
  for (const till of admins) {
    await notifiera({
      till,
      av: null,
      kalla: "utkorg-fel",
      typ: "fel",
      rubrik: "Utkorgen kunde inte skicka en rad",
      detalj: `Rad ${rad.id} (${rad.kind}) efter tre försök: ${fel}`.slice(0, 300),
      href: "/fel",
    });
  }
}
