/**
 * Mejlpåminnelsen i utkorgen: vad ska en `resend_schedule`-rad göra just nu?
 *
 * Ren logik, så att den går att prova utan databas.
 *
 * Förut schemalades påminnelsen hos Resend (`scheduled_at`) och kunde inte
 * avbokas, eftersom nyckeln bara får skicka (401 restricted_api_key). Nu ligger
 * raden kvar i utkorgen med `not_before = send_at` och minutjobbet skickar den
 * när det är dags. Tills dess kan den tas bort: flyttas eller ställs mötet in
 * ändras påminnelsen i databasen, och raden skickar inget som inte längre gäller.
 */

export type Paminnelselage = {
  status: string;
  resend_id: string | null;
  send_at: string;
};

export type Motelage = {
  cancelled_at: string | null;
  outcome: string | null;
  starts_at: string;
};

export type Paminnelsebeslut =
  | { gor: "skicka" }
  /** Inte dags än: lämna raden tillbaka med `not_before = till`. */
  | { gor: "vanta"; till: string }
  /** Raden gäller inte längre (inställt, flyttat, redan skickat): markera den hanterad utan att skicka. */
  | { gor: "hoppa"; skal: string }
  /** Tiden är ute och mötet har börjat: skicka inget, markera påminnelsen `fel`. */
  | { gor: "fel"; skal: string };

/** Inom så här lång tid före `send_at` skickas den direkt (minutjobbet går en gång i minuten). */
export const SKICKA_FRAN_MS = 60_000;

/**
 * `radens_tid` är den `send_at` som raden väntar på (sparas i payload när raden
 * lämnas tillbaka). Skiljer den sig från påminnelsens nuvarande tid har mötet
 * flyttats, och flytten har köat en egen rad: den här är gammal.
 */
export function paminnelsebeslut(p: Paminnelselage | null, e: Motelage | null, radens_tid: string | null, nu: Date): Paminnelsebeslut {
  if (!p) return { gor: "hoppa", skal: "påminnelsen finns inte" };
  if (p.resend_id || p.status !== "vantar") return { gor: "hoppa", skal: `påminnelsen är redan ${p.status}` };
  if (!e || e.cancelled_at || e.outcome) return { gor: "hoppa", skal: "mötet gäller inte längre" };

  const sendAt = Date.parse(p.send_at);
  if (radens_tid && Date.parse(radens_tid) !== sendAt) return { gor: "hoppa", skal: "påminnelsen har flyttats" };

  if (sendAt - nu.getTime() > SKICKA_FRAN_MS) return { gor: "vanta", till: new Date(sendAt).toISOString() };
  if (nu.getTime() >= Date.parse(e.starts_at)) return { gor: "fel", skal: "Tiden hade redan passerat" };
  return { gor: "skicka" };
}
