import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { svensktDatum, svenskVeckodag } from "./klocka.ts";
import { dygnetsStart } from "./tid.ts";
import { stampelfriaAnstallda } from "./stampelfri-server.ts";
import {
  dagensLage,
  type Dagsbild,
  type Ledighet,
  type Person,
  type Schemarad,
  type Sjukrad,
  type Stampel,
} from "./dagslage.ts";

/**
 * Fragorna bakom chefens dagsbild.
 *
 * ===========================================================================
 * ANVANDARENS EGEN TOKEN, ALDRIG SERVICE ROLE.
 *
 * Kretsen ar redan dragen i RLS och ser likadan ut i alla fyra tabellerna:
 * egen rad, den man leder, och ledningen. Teamledaren far darfor sitt team och
 * ingenting mer utan att den har filen behover upprepa granen — och kan inte
 * heller rakna ut nagot om nagon hen inte far se, for raderna kommer aldrig
 * fram. `absence_request` och `sick_report` slapper dessutom INTE in `admin`
 * (0019, 0020), och det ar med flit: rollen ar teknisk.
 *
 * Anroparen maste anda villkora sitt anrop pa rollen. Utan det hade saljaren
 * fatt sju fragor per sidvisning som alla svarar med noll rader.
 * ===========================================================================
 *
 * SJU FRAGOR I EN VAG. Ingen av dem behover svaret fran nagon annan, sa de
 * loper parallellt och kostar en tur — samma monster som `uppgifterFor()`, och
 * skalet till att hela hamtningen ligger som EN post i startsidans egen
 * `Promise.all`.
 */
export async function hamtaDagsbild(
  supabase: SupabaseClient,
  nu: Date,
  stamplingPa: boolean,
): Promise<Dagsbild> {
  const datum = svensktDatum(nu);
  const veckodag = svenskVeckodag(nu);

  const [
    { data: personer },
    { data: scheman },
    { data: stamplingar },
    { data: ledigheter },
    { data: typer },
    { data: sjuka },
    stampelfria,
  ] = await Promise.all([
    supabase
      .from("employee")
      .select("id, first_name, last_name, team_id, start_date")
      .neq("status", "offboarded")
      .order("first_name"),

    // Bara dagens veckodag, och bara scheman som hunnit trada i kraft.
    // `gallandeSchema()` valjer sedan den mest specifika nivan per person.
    stamplingPa
      ? supabase
          .from("work_schedule")
          .select("id, scope, employee_id, team_id, start_time, tol_late, valid_from")
          .eq("weekday", veckodag)
          .lte("valid_from", datum)
      : Promise.resolve({ data: null }),

    // Dagens stamplingar, hela kretsen pa en gang. Rattelser och ersatta rader
    // spelar ingen roll for FORSTA instamplingen — den star kvar aven nar en
    // senare rad ersatts, och `senAnkomst()` letar upp den aldsta sjalv.
    stamplingPa
      ? supabase
          .from("time_event")
          .select("employee_id, kind, occurred_at")
          .gte("occurred_at", dygnetsStart(nu))
      : Promise.resolve({ data: null }),

    supabase
      .from("absence_request")
      .select("employee_id, type_id, starts_on, ends_on, part_day_minutes")
      .eq("status", "approved")
      .lte("starts_on", datum)
      .gte("ends_on", datum),

    supabase.from("absence_type").select("id, label"),

    // En pagaende sjukperiod har `last_sick_day = null`. Bada fallen behovs,
    // och filtret star i fragan sa att gamla avslutade perioder aldrig hamtas.
    supabase
      .from("sick_report")
      .select("employee_id, first_sick_day, last_sick_day, extent_percent, confirmed_at")
      .is("cancelled_at", null)
      .lte("first_sick_day", datum)
      .or(`last_sick_day.is.null,last_sick_day.gte.${datum}`),

    // Rollerna lases live, precis som overallt annars. En som blev befordrad
    // till saljchef i dag slutar bedomas i dag.
    stamplingPa ? stampelfriaAnstallda(supabase) : Promise.resolve(new Set<string>()),
  ]);

  return dagensLage({
    personer: (personer ?? []) as Person[],
    scheman: (scheman ?? []) as Schemarad[],
    stamplingar: (stamplingar ?? []) as Stampel[],
    ledigheter: (ledigheter ?? []) as Ledighet[],
    sjuka: (sjuka ?? []) as Sjukrad[],
    typnamn: new Map((typer ?? []).map((t) => [String(t.id), String(t.label)])),
    stampelfria,
    datum,
    nu,
    stamplingPa,
  });
}
