import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { STAMPELFRIA_ROLLER, stampelfri } from "./stampelfri.ts";

/**
 * Vilka ANSTÄLLDA som är stämpelfria — regeln i `stampelfri.ts`, men uppslagen
 * mot databasen i stället för mot den inloggades roller.
 *
 * Nattjobben går igenom hela personalen med service role och har ingen
 * `CurrentUser` att fråga. En egen fråga per person hade blivit en fråga per
 * anställd och natt; det här är EN fråga för hela bolaget.
 *
 * FRÅGAN FILTRERAS PÅ ROLLERNA OCH INTE PÅ PERSONERNA. `employee_role` har en
 * rad per roll, så listan blir kort och svaret innehåller bara det som
 * behövs — inga roller för någon som ändå ska stämpla.
 *
 * VID FEL BLIR MÄNGDEN TOM, alltså "alla stämplar". Det är åt rätt håll: ett
 * uteblivet svar får inte tyst göra hela personalen stämpelfri och därmed
 * släcka påminnelserna för dem som faktiskt ska stämpla. En stämpelfri person
 * som får ett förslag om ogiltig frånvaro syns och kan avvisas av en chef; en
 * säljare som slutar bevakas syns inte alls.
 */
export async function stampelfriaAnstallda(db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db
    .from("employee_role")
    .select("employee_id, role")
    .in("role", STAMPELFRIA_ROLLER);

  if (error) return new Set();

  const ut = new Set<string>();
  for (const rad of data ?? []) {
    // Regeln ställs ändå genom `stampelfri()`. Filtret ovan är en optimering,
    // och en optimering får inte vara det som avgör vem som slipper stämpla.
    if (stampelfri([String(rad.role)])) ut.add(String(rad.employee_id));
  }
  return ut;
}
