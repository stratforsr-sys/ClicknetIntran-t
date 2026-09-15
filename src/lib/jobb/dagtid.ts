import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { gallandeSchema } from "@/lib/raster";
import { stampelfriaAnstallda } from "@/lib/stampelfri-server";
import { notifiera } from "@/lib/notishandelse-server";
import {
  svensktDatum,
  svenskaMinuter,
  svenskVeckodag,
  svenskDygnsstart,
  svenskDygnsslut,
} from "@/lib/klocka";

/**
 * DAGTIDSJOBBET: det som måste hända MITT PÅ DAGEN.
 *
 * ===========================================================================
 * VARFÖR DET INTE ÄR EN CRON-POST I `vercel.json`
 *
 * Hobby-planen tar TVÅ cron-poster per projekt och kör var och en EN gång per
 * dygn. Båda är upptagna: nattjobbet 02:30 och morgonbrevet 05:30 UTC. Det
 * finns alltså ingen tredje post att ta, och en post som kör en gång per dygn
 * hade inte hjälpt ändå — det här jobbet ska köra var kvart.
 *
 * Deklareras en tredje post händer dessutom något värre än ett felmeddelande:
 * INGEN AV DE TRE KÖRS, och det syns inte. Det inträffade 2026-09-08, en
 * instämpling stod öppen i två dygn, och rubriken i `natt/route.ts` finns kvar
 * som varning.
 *
 * DÄRFÖR RINGER DATABASEN I STÄLLET. `pg_cron` och `pg_net` i Supabase (se
 * migration 0059) kallar på `/api/jobb/dagtid` var femtonde minut. Det ligger
 * utanför Vercels kvot, kostar ingenting, och schemat står i samma databas som
 * datan det bevakar.
 *
 * ===========================================================================
 * VAD DET GÖR, OCH VAD NATTJOBBET GÖR I STÄLLET
 *
 * De två är lätta att blanda ihop och gör olika saker:
 *
 *   DET HÄR JOBBET säger till DIG, samma dag, en kvart efter att ditt skift
 *   börjat: du har inte stämplat in. Det går att rätta direkt, och det är hela
 *   poängen — en påminnelse man kan agera på.
 *
 *   NATTJOBBET (`jobb/franvaro.ts`) bokför i efterhand att en schemalagd dag
 *   varken fick en stämpling eller en registrerad frånvaro, och lyfter den till
 *   chefen efter `unregistered_reminder_hours`. Det är en avvikelse, inte en
 *   påminnelse.
 *
 * Det här jobbet skriver DÄRFÖR INGA `absence_reminder`-rader. Den tabellen är
 * nattjobbets huvudbok, och två skribenter i den hade gjort det omöjligt att
 * säga vad en rad betyder.
 * ===========================================================================
 */

/**
 * Hur länge efter skiftets start påminnelsen går ut.
 *
 * Femton minuter, inte noll: den som stämplar in 08:02 ska inte mötas av ett
 * mejl om att hon inte stämplat in 08:00. Marginalen måste vara större än den
 * tid det tar att hänga av sig jackan.
 */
const TOLERANS_MINUTER = 15;

/**
 * Och hur länge efteråt den SLUTAR gå ut.
 *
 * Utan en bortre gräns hade den som är sjuk utan att ha hunnit registrera det
 * fått en påminnelse var femtonde minut hela dagen. Efter tre timmar är saken
 * inte längre "du glömde stämpla in" — då är det en frånvaro, och den är
 * nattjobbets att bokföra.
 */
const BORTRE_MINUTER = 180;

export type Dagtidutfall = {
  /** Sant när dagen inte är en arbetsdag och jobbet därför inte gjorde något. */
  helg: boolean;
  /** Hur många som var schemalagda och inne i fönstret. */
  provade: number;
  /** Hur många som fick påminnelsen. */
  paminda: number;
  fel: string[];
};

export async function korDagtidsjobbet(
  db: SupabaseClient,
  nu = new Date(),
): Promise<Dagtidutfall> {
  const utfall: Dagtidutfall = { helg: false, provade: 0, paminda: 0, fel: [] };

  const idag = svensktDatum(nu);
  const veckodag = svenskVeckodag(nu);
  if (veckodag >= 6) {
    utfall.helg = true;
    return utfall;
  }

  const nuMinuter = svenskaMinuter(nu);
  const dygnsstart = svenskDygnsstart(nu);
  const dygnsslut = svenskDygnsslut(idag);

  const [
    { data: personal },
    { data: scheman },
    { data: stamplingar },
    { data: ledighet },
    { data: sjuk },
    { data: redanSagt },
    stampelfria,
  ] = await Promise.all([
    db.from("employee").select("id, team_id, start_date, status").neq("status", "offboarded"),
    db
      .from("work_schedule")
      .select("id, scope, employee_id, team_id, weekday, start_time, valid_from")
      .eq("weekday", veckodag),
    // Bara instämplingar, och bara dagens. Den som stämplat in och ut igen har
    // ändå stämplat in — frågan är om raden finns, inte vad läget är nu.
    db
      .from("time_event")
      .select("employee_id")
      .eq("kind", "in")
      .gte("occurred_at", dygnsstart)
      .lte("occurred_at", dygnsslut),
    // Beviljad ledighet som täcker idag. En ansökan som bara är inskickad
    // räknas INTE — den är inte beslutad, och personen förväntas på jobbet.
    db
      .from("absence_request")
      .select("employee_id, starts_on, ends_on")
      .eq("status", "approved")
      .lte("starts_on", idag)
      .gte("ends_on", idag),
    db
      .from("sick_report")
      .select("employee_id, first_sick_day, last_sick_day, cancelled_at")
      .is("cancelled_at", null)
      .lte("first_sick_day", idag),
    /**
     * Vem som redan fått påminnelsen idag.
     *
     * JOBBET KÖR VAR KVART, och utan den här frågan hade den som glömt stämpla
     * in fått tolv identiska mejl före lunch. Spärren ligger i
     * `notification_event` och inte i en egen tabell, av två skäl: raden måste
     * skrivas ändå för att påminnelsen ska synas i klockan, och en andra
     * bokföring av samma sak är en andra sak som kan glida isär.
     */
    db
      .from("notification_event")
      .select("employee_id")
      .eq("kalla", "tid-ostamplad")
      .gte("created_at", dygnsstart),
    stampelfriaAnstallda(db),
  ]);

  const harStamplat = new Set(
    ((stamplingar ?? []) as { employee_id: string }[]).map((r) => r.employee_id),
  );

  const arLedig = new Set(
    ((ledighet ?? []) as { employee_id: string }[]).map((r) => r.employee_id),
  );

  for (const s of (sjuk ?? []) as {
    employee_id: string;
    last_sick_day: string | null;
  }[]) {
    // `last_sick_day` null betyder en pågående sjukperiod utan slutdatum.
    if (!s.last_sick_day || s.last_sick_day >= idag) arLedig.add(s.employee_id);
  }

  const redan = new Set(
    ((redanSagt ?? []) as { employee_id: string }[]).map((r) => r.employee_id),
  );

  for (const p of (personal ?? []) as {
    id: string;
    team_id: string | null;
    start_date: string | null;
  }[]) {
    // Den stämpelfria rollen påminns aldrig. Samma spärr och samma skäl som i
    // nattjobbets frånvarosteg: bolagsschemat gäller dem också, men det är
    // rollen och inte schemat som avgör vem som ska stämpla.
    if (stampelfria.has(p.id)) continue;

    // Ingen påminnelse före anställningens första dag.
    if (p.start_date && idag < String(p.start_date).slice(0, 10)) continue;

    if (harStamplat.has(p.id)) continue;
    if (arLedig.has(p.id)) continue;
    if (redan.has(p.id)) continue;

    /**
     * Samma uppslagning som nattjobbet och rastschemat gör: person före team
     * före bolag, och senaste `valid_from` inom nivån. Den ligger i `raster.ts`
     * och återanvänds med flit — en egen kopia här hade kunnat ge en annan
     * starttid än den navet visar, och då påminner brevet om fel klockslag.
     */
    const dagens = gallandeSchema(scheman ?? [], p.id, p.team_id, idag);
    if (dagens.length === 0) continue;

    const start = minuterUrTid(String(dagens[0].start_time));
    if (start === null) continue;

    const gatt = nuMinuter - start;
    if (gatt < TOLERANS_MINUTER || gatt > BORTRE_MINUTER) continue;

    utfall.provade++;

    const klockslag = String(dagens[0].start_time).slice(0, 5);
    const skrevs = await notifiera({
      till: p.id,
      // Jobbet har ingen aktör. `notifiera()` skickar aldrig till den som
      // utlöste händelsen, och med `null` finns ingen att sålla bort.
      av: null,
      kalla: "tid-ostamplad",
      typ: "tid",
      rubrik: "Du har inte stämplat in",
      detalj: `Ditt skift började ${klockslag}. Stämpla in, eller registrera frånvaro om du inte är på plats.`,
      href: "/tid",
    });

    if (skrevs) utfall.paminda++;
    else utfall.fel.push(`${p.id}: notisen kunde inte skrivas`);
  }

  return utfall;
}

/** "08:00:00" → 480. Null när tiden inte går att tolka. */
function minuterUrTid(tid: string): number | null {
  const traff = /^(\d{1,2}):(\d{2})/.exec(tid);
  if (!traff) return null;
  const timmar = Number(traff[1]);
  const minuter = Number(traff[2]);
  if (!Number.isFinite(timmar) || !Number.isFinite(minuter)) return null;
  return timmar * 60 + minuter;
}
