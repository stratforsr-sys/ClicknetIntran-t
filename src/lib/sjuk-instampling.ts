import { dagarBakat, svensktDatum } from "./klocka.ts";

/**
 * Instämplingen avslutar sjukanmälan (beställaren 2026-11-12: "den måste
 * försvinna när han stämplar in, för det är ingen som tar bort den").
 *
 * ===========================================================================
 * EN DAG KAN INTE VARA BÅDE SJUKDAG OCH ARBETAD DAG (FEAT 353 i utkastet).
 *
 * Den som är sjukanmäld på heltid och stämplar in är tillbaka. Knappen på
 * startsidan har alltid hetat "Jag är frisk, stämpla in", men fram till nu
 * gjorde den bara en instämpling: anmälan låg kvar i chefens sjuklista i
 * veckor, och chefen ställde in den för att bli av med den. En inställd
 * anmälan räknas inte som frånvaro, så sjukdagarna blev förslag på ogiltig
 * frånvaro natten efter.
 * ===========================================================================
 *
 * Regeln, samma som utkastets val vid instämplingen:
 *
 *   - Instämpling en LATER dag än första sjukdagen: sista sjukdagen blir dagen
 *     före. Det gäller också en anmälan som lagts i efterhand, efter att
 *     personen redan var tillbaka.
 *   - Instämpling SAMMA dag som första sjukdagen, efter att anmälan gjordes:
 *     anmälan ställs in. Personen kom till jobbet, och dagen har en stämpling,
 *     så ingenting blir ogiltig frånvaro.
 *   - Instämpling samma dag men FÖRE anmälan: den som gick hem sjuk. Rörs inte.
 *   - Deltidssjukskrivning: rörs inte. Den som är sjuk på halvtid stämplar för
 *     den halva hen arbetar.
 */
export type Sjukrad = {
  first_sick_day: string;
  last_sick_day: string | null;
  cancelled_at: string | null;
  extent_percent: number | null;
  registered_at: string;
};

export type Sjukatgard = { typ: "avsluta"; sista: string } | { typ: "stall_in" } | null;

export function sjukVidInstampling(r: Sjukrad, instampladIso: string): Sjukatgard {
  if (r.cancelled_at) return null;
  if ((r.extent_percent ?? 100) < 100) return null;
  const dag = svensktDatum(instampladIso);
  const forsta = String(r.first_sick_day).slice(0, 10);
  if (dag < forsta) return null;
  const sista = r.last_sick_day ? String(r.last_sick_day).slice(0, 10) : null;
  if (sista && sista < dag) return null;
  if (dag === forsta) {
    return Date.parse(instampladIso) > Date.parse(r.registered_at) ? { typ: "stall_in" } : null;
  }
  return { typ: "avsluta", sista: dagarBakat(dag, 1) };
}
