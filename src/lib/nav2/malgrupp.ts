/**
 * Nav 2.0: får en viss person läsa ett dokument? (granskningen F2-18)
 *
 * Databasens regel är `matches_audience(audience_roles, audience_teams,
 * audience_employees)` i policyn `document_read`, och den frågar efter den
 * INLOGGADE (auth.uid()). Rutten som skickar en rutin till en kollega kör med
 * service role och vet därför inte vad kollegan får läsa. Den här funktionen
 * är samma regel för en annan person än den inloggade:
 *
 *   - bara ett publicerat dokument (utkast och arkiverade läser bara redaktörerna),
 *   - inte någon som slutat,
 *   - `audience_employees` satt: bara de personerna,
 *   - annars: rollerna (om några) OCH lagen (om några), tomma listor = alla.
 *
 * Ren fil, provad i `tests/nav2-missbruk.mjs`.
 */

export type Malgrupp = {
  status: string;
  audience_roles?: string[] | null;
  audience_teams?: string[] | null;
  audience_employees?: string[] | null;
};

export type Mottagare = { id: string; status: string; team_id: string | null; roller: string[] };

export function mottagarenFarLasa(d: Malgrupp, m: Mottagare): boolean {
  if (d.status !== "published") return false;
  if (m.status === "offboarded") return false;
  const personer = d.audience_employees ?? [];
  if (personer.length) return personer.includes(m.id);
  const roller = d.audience_roles ?? [];
  const lag = d.audience_teams ?? [];
  if (roller.length && !roller.some((r) => m.roller.includes(r))) return false;
  if (lag.length && !(m.team_id && lag.includes(m.team_id))) return false;
  return true;
}
