/**
 * Gästens kalenderfil (0072): ska utkorgens `ics`-rad skickas?
 *
 * Ren logik, så att den går att prova utan databas. Raden köas av `lk_ics_ko`
 * med händelsens sekvens just då; när den töms gäller den bara om händelsen
 * fortfarande ser ut så. En senare ändring har köat en egen rad.
 */
export type IcsLage = {
  tid: string | null;
  dag: string | null;
  ics_sequence: number;
  cancelled_at: string | null;
};

export function icsGaller(e: IcsLage | null, epost: string, sekvens: number, metod: "REQUEST" | "CANCEL"): boolean {
  // Ett heldagsmöte (0204) har ingen tid men en dag, och får sin fil som en
  // heldagspost (`somMote` → `heldag`). Förut krävdes `tid`, och gästen till ett
  // heldagsmöte fick ingenting fast kvittot sa att inbjudan gick ut.
  if (!e || !(e.tid || e.dag) || !epost) return false;
  if (e.ics_sequence !== sekvens) return false;
  if ((metod === "CANCEL") !== Boolean(e.cancelled_at)) return false;
  return true;
}
