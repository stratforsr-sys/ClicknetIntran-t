/**
 * Nav 2.0, Satser och löner: ren logik som rutten /nav2/satser prövar med.
 *
 * ===========================================================================
 * GRANSKNINGEN S06 (D8): EN BÄRANDE SATS SLUTAR INTE GÄLLA UTAN EFTERFÖLJARE.
 *
 * Nav 2.0 kan sätta "Gäller till" på en sats, både på en ny rad och på en
 * befintlig. Sattes slutdatumet på åldersgränsen för äldre utan att en ny rad
 * lades in, saknades satsen från dagen efter, och lönekostnaden gav alla den
 * nedsatta avgiften (åldersgränsen föll tillbaka på 0). Nu är en saknad sats
 * null och ger ingen nedsättning (lonekostnad.ts), men den ska inte gå att
 * skapa av misstag heller.
 *
 * Bärande är full avgift (utan den räknas ingen lönekostnad alls) och
 * åldersgränsen för äldre (planens fall). Övriga satser får sluta utan
 * efterföljare: Skatteverkets rättelse för unga lägger in `employer_fee_young`,
 * `young_age_min` och `young_age_max` till 2027-09-30 just utan efterföljare,
 * eftersom nedsättningen är tillfällig. Saknas spannet, taket eller den
 * nedsatta avgiften ger null-regeln full avgift, aldrig nedsatt.
 * ===========================================================================
 */

export const BARANDE = new Set(["employer_fee_standard", "senior_age_min"]);

/** Nyckeln en sats gäller per: slaget och (för frånvarofaktorn) typen. */
export const satsNyckel = (kind: string, applies: string | null | undefined): string => `${kind}|${applies ?? ""}`;

/** Dagen efter ett datum (YYYY-MM-DD), i UTC så att sommartiden inte flyttar den. */
export function dagenEfter(datum: string): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Får raden sluta gälla `giltig_till`? Sant utan slutdatum, och annars bara om
 * en annan rad med samma nyckel tar vid: den börjar efter raden och senast
 * dagen efter slutdatumet, och gäller själv den dagen (inget eget slutdatum
 * före den). Efterföljaren får i sin tur bara ha ett slutdatum om den har en
 * egen efterföljare (granskningen S06, M5). Då finns ingen dag utan sats.
 * `giltig_till` på `alla` är valfritt: utan det räknas raden som öppen.
 */
export function kanSluta(
  rad: { nyckel: string; giltig_fran: string; giltig_till: string | null },
  alla: { nyckel: string; giltig_fran: string; giltig_till?: string | null }[],
): boolean {
  if (!rad.giltig_till) return true;
  const senast = dagenEfter(rad.giltig_till);
  return alla.some(
    (r) =>
      r.nyckel === rad.nyckel &&
      r.giltig_fran > rad.giltig_fran &&
      r.giltig_fran <= senast &&
      (!r.giltig_till || r.giltig_till >= senast) &&
      kanSluta({ nyckel: r.nyckel, giltig_fran: r.giltig_fran, giltig_till: r.giltig_till ?? null }, alla),
  );
}

/**
 * Slutdatumen som en ändring bryter: rader med slutdatum som hade en efterföljare
 * i `fore` men inte längre har det i `efter` (granskningen S06, M5: en Skatteverket-rättelse
 * kan ta bort efterföljaren). Ett glapp som redan fanns före ändringen räknas inte.
 */
export function brutnaSlut(
  fore: { nyckel: string; giltig_fran: string; giltig_till: string | null }[],
  efter: { nyckel: string; giltig_fran: string; giltig_till: string | null }[],
): string[] {
  return efter
    .filter((r) => r.giltig_till && !kanSluta(r, efter) && fore.some((f) => f.nyckel === r.nyckel && f.giltig_fran === r.giltig_fran && kanSluta(f, fore)))
    .map((r) => r.giltig_till as string);
}

/** Texten rutten svarar med när ett slutdatum nekas. */
export function slutNekas(till: string): string {
  return `Satsen kan inte sluta gälla ${till} utan en ny rad som tar vid ${dagenEfter(till)}. Lägg in den nya satsen först, annars saknas den från ${dagenEfter(till)}. Ingenting sparades.`;
}
