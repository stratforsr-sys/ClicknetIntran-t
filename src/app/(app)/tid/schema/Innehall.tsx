import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Notis } from "@/components/ui/Notis";
import { getCurrentUser, canManageEmployees, fullName } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { hamtaLage } from "@/lib/sparrar";
import { svensktDatum } from "@/lib/klocka";
import { schemalage, type Schemalage } from "@/lib/raster";
import { Schemaform } from "./Schemaform";

const DAGNAMN = ["", "mån", "tis", "ons", "tor", "fre", "lör", "sön"];

/**
 * AC-2.35: ett schema ändras aldrig, det ersätts. Listorna nedan bär därför
 * historiken också, och utan den här märkningen ser en ersatt rad exakt ut som
 * den som faktiskt gäller. Den som ska sätta rasterna behöver se skillnaden
 * innan hen lägger till en rad till.
 */
const LAGE: Record<Schemalage, { text: string; ton: "ok" | "neutral" | "info" }> = {
  gäller: { text: "Gäller nu", ton: "ok" },
  kommande: { text: "Träder i kraft", ton: "info" },
  ersatt: { text: "Ersatt", ton: "neutral" },
};

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

  // Svenskt datum, inte serverns. På Vercel är serverns zon UTC, och strax
  // efter svensk midnatt hade ett schema som träder i kraft i dag räknats som
  // kommande — samma fälla som klocka.ts finns till för.
  const idag = svensktDatum(new Date().toISOString());
  const arbetsLage = schemalage(arbete ?? [], idag);
  const rastLage = schemalage(raster ?? [], idag);

  // Gällande först, sedan kommande, sist historiken. Inom varje grupp veckodag
  // och rastnummer — den ordning man läser ett schema i.
  const ORDNING: Record<Schemalage, number> = { gäller: 0, kommande: 1, ersatt: 2 };
  const sorterat = <T extends { weekday: number; sort?: number; valid_from: string }>(
    rader: T[],
    lage: Map<T, Schemalage>,
  ) =>
    [...rader].sort(
      (a, b) =>
        ORDNING[lage.get(a) ?? "ersatt"] - ORDNING[lage.get(b) ?? "ersatt"] ||
        a.weekday - b.weekday ||
        (a.sort ?? 1) - (b.sort ?? 1) ||
        b.valid_from.localeCompare(a.valid_from),
    );

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
              {sorterat(arbete ?? [], arbetsLage).map((r) => {
                const lage = LAGE[arbetsLage.get(r) ?? "ersatt"];
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 text-small last:border-0"
                  >
                    <span className="w-12 text-ink-500">{DAGNAMN[r.weekday]}</span>
                    <span className="tnum text-ink-900">
                      {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
                    </span>
                    <span className="flex-1 text-ink-700">{vem(r)}</span>
                    <span className="tnum text-ink-500">från {r.valid_from}</span>
                    <Badge ton={lage.ton}>{lage.text}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader titel="Rastscheman som lagts in" />
          {(raster ?? []).length === 0 ? (
            <p className="text-small text-ink-500">Inga än.</p>
          ) : (
            <ul className="flex flex-col">
              {sorterat(raster ?? [], rastLage).map((r) => {
                const lage = LAGE[rastLage.get(r) ?? "ersatt"];
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-3 border-b border-canvas py-2 text-small last:border-0"
                  >
                    <span className="w-12 text-ink-500">{DAGNAMN[r.weekday]}</span>
                    {/* Rastnumret saknades helt. Med tre raster om dagen gick de
                        inte att skilja åt annat än på klockslag. */}
                    <span className="w-14 text-ink-500">rast {r.sort}</span>
                    <span className="tnum text-ink-900">
                      {r.window_start.slice(0, 5)}–{r.window_end.slice(0, 5)}
                    </span>
                    <span className="tnum text-ink-500">{r.duration_minutes} min</span>
                    <span className="flex-1 text-ink-700">{vem(r)}</span>
                    <span className="tnum text-ink-500">från {r.valid_from}</span>
                    <Badge ton={lage.ton}>{lage.text}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
