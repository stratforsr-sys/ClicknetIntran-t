import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { getCurrentUser, canManageEmployees, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { hamtaLage } from "@/lib/sparrar";
import { Schemaform } from "./Schemaform";

const DAGNAMN = ["", "mån", "tis", "ons", "tor", "fre", "lör", "sön"];

/**
 * Innehallet, utan sidhuvud.
 *
 * Ligger for sig eftersom det ritas pa TVA stallen: som helsida pa
 * /tid/schema och som panel i installningsrutan. Rubriken och tillbakalanken
 * hor bara till sidan — i rutan star namnet redan i rutans topprad, och en
 * tillbakalank inne i en modal pekar at ett hall som inte finns.
 *
 * BEHORIGHETEN KONTROLLERAS HAR och inte hos anroparen. Bada vagarna in ar
 * publika adresser, och en kontroll som ligger i sidan ovanfor ar en
 * kontroll som nasta vag in glommer.
 */
export async function SchemaInnehall() {
  const user = await getCurrentUser();
  if (!canManageEmployees(user)) redirect("/tid");

  const supabase = await supabaseServer();
  const sparr = await hamtaLage();
  const [{ data: personal }, { data: team }, { data: arbete }, { data: raster }] = await Promise.all([
    supabase
      .from("employee")
      .select("id, first_name, last_name")
      .neq("status", "offboarded")
      .order("first_name"),
    supabase.from("team").select("id, name").order("name"),
    supabase
      .from("work_schedule")
      .select("id, scope, employee_id, team_id, weekday, start_time, end_time, valid_from")
      .order("valid_from", { ascending: false }),
    supabase
      .from("scheduled_break")
      .select("id, scope, employee_id, team_id, weekday, sort, window_start, window_end, duration_minutes, valid_from")
      .order("valid_from", { ascending: false }),
  ]);

  const personer = (personal ?? []).map((p) => ({ id: p.id, namn: fullName(p) }));
  const teamval = (team ?? []).map((t) => ({ id: t.id, namn: t.name }));
  const namnPer = new Map(personer.map((p) => [p.id, p.namn]));
  const teamPer = new Map(teamval.map((t) => [t.id, t.namn]));

  const vem = (r: { scope: string; employee_id: string | null; team_id: string | null }) =>
    r.scope === "company"
      ? "Hela bolaget"
      : r.scope === "team"
        ? (teamPer.get(r.team_id ?? "") ?? "Okänt team")
        : (namnPer.get(r.employee_id ?? "") ?? "Okänd person");

  return (
    <div className="flex flex-col gap-4">
      {!sparr.rast && (
        <Notis ton="warn">
          Rastschemat går att lägga in nu, men avvikelser genereras inte förrän K29 är uppfylld:
          schemat ska vara dokumenterat i förväg enligt ATL 15 §, och de berörda ska ha kvitterat
          det.
        </Notis>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader titel="Arbetsschema" beskrivning="När arbetsdagen börjar och slutar." />
          <Schemaform sort="arbete" personer={personer} team={teamval} />
        </Card>

        <Card>
          <CardHeader titel="Rastschema" beskrivning="Tidsfönster och längd per rast." />
          <Schemaform sort="rast" personer={personer} team={teamval} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader titel="Arbetsscheman som lagts in" />
          {(arbete ?? []).length === 0 ? (
            <p className="text-small text-ink-500">Inga än.</p>
          ) : (
            <ul className="flex flex-col">
              {(arbete ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 text-small last:border-0"
                >
                  <span className="w-12 text-ink-500">{DAGNAMN[r.weekday]}</span>
                  <span className="tnum text-ink-900">
                    {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
                  </span>
                  <span className="flex-1 text-ink-700">{vem(r)}</span>
                  <Badge ton="neutral">från {r.valid_from}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader titel="Rastscheman som lagts in" />
          {(raster ?? []).length === 0 ? (
            <p className="text-small text-ink-500">Inga än.</p>
          ) : (
            <ul className="flex flex-col">
              {(raster ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 text-small last:border-0"
                >
                  <span className="w-12 text-ink-500">{DAGNAMN[r.weekday]}</span>
                  <span className="tnum text-ink-900">
                    {r.window_start.slice(0, 5)}–{r.window_end.slice(0, 5)}
                  </span>
                  <span className="text-ink-500">{r.duration_minutes} min</span>
                  <span className="flex-1 text-ink-700">{vem(r)}</span>
                  <Badge ton="neutral">från {r.valid_from}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
