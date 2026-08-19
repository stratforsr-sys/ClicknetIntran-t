/**
 * Svensk vägg-klocka, oberoende av var koden råkar köra.
 *
 * ===========================================================================
 * BAKGRUND — läs den här innan du "förenklar" något nedan.
 *
 * Navet körde `new Date(iso).getHours()` och `new Date("2026-08-17T17:00:00")`
 * för att jämföra stämplingar mot schematider. Båda använder serverns lokala
 * tidszon. På min dator är den Europe/Stockholm och allt såg rätt ut. På Vercel
 * är den UTC, och då hände två saker samtidigt:
 *
 *   - En instämpling 09:05 svensk tid lästes som 07:05, alltså två timmar FÖRE
 *     arbetsdagens start. Ingen kunde bli sen. Larmet var dött från början.
 *   - Ett schema som slutar 17:00 blev 17:00 UTC, alltså 19:00 svensk tid.
 *     Automatstängningen la utstämplingen två timmar för sent.
 *
 * Ett schema är en överenskommelse om svensk väggtid. "Arbetsdagen slutar
 * 17:00" betyder 17:00 i Sverige, både i januari och i juli. Därför räknas
 * tiden här ut mot `Europe/Stockholm` uttryckligen — inte mot serverns idé om
 * var den står.
 *
 * Modulen har noll importer och går att prova med TZ satt till vad som helst.
 * Testet kör den med TZ=UTC just för att bevisa att svaren inte ändras.
 * ===========================================================================
 */

const ZON = "Europe/Stockholm";

const FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: ZON,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

type Delar = { ar: number; manad: number; dag: number; timme: number; minut: number; sekund: number };

function delar(instant: Date): Delar {
  const p = Object.fromEntries(FORMAT.formatToParts(instant).map((d) => [d.type, d.value]));
  return {
    ar: Number(p.year),
    manad: Number(p.month),
    dag: Number(p.day),
    // Intl skriver midnatt som "24" i vissa körtider. 24:00 är 00:00 dagen efter,
    // och dagen är redan rätt i `p.day` — så bara timmen behöver rättas.
    timme: Number(p.hour) % 24,
    minut: Number(p.minute),
    sekund: Number(p.second),
  };
}

/** Hur många minuter Sverige ligger före UTC vid den här tidpunkten. */
function offsetMinuter(instant: Date): number {
  const d = delar(instant);
  const somOmDetVoreUtc = Date.UTC(d.ar, d.manad - 1, d.dag, d.timme, d.minut, d.sekund);
  return Math.round((somOmDetVoreUtc - instant.getTime()) / 60000);
}

/** Svenskt kalenderdatum för en tidpunkt: "2026-08-17". */
export function svensktDatum(instant: Date | string = new Date()): string {
  const d = delar(typeof instant === "string" ? new Date(instant) : instant);
  return `${d.ar}-${String(d.manad).padStart(2, "0")}-${String(d.dag).padStart(2, "0")}`;
}

/** Minuter sedan svensk midnatt. 18:08 ger 1088 oavsett var servern står. */
export function svenskaMinuter(instant: Date | string): number {
  const d = delar(typeof instant === "string" ? new Date(instant) : instant);
  return d.timme * 60 + d.minut;
}

/** Veckodag 1–7 med måndag först, räknat i svensk tid. */
export function svenskVeckodag(instant: Date | string = new Date()): number {
  const d = delar(typeof instant === "string" ? new Date(instant) : instant);
  // Date.UTC med de svenska delarna ger rätt veckodag utan att zonen stör.
  const dag = new Date(Date.UTC(d.ar, d.manad - 1, d.dag)).getUTCDay();
  return ((dag + 6) % 7) + 1;
}

/**
 * Tidpunkten då klockan visar `tid` i Sverige på datumet `datum`.
 *
 * Två varv: första gissningen tolkar tiden som UTC och drar bort offseten,
 * andra varvet rättar de två gånger om året då offseten ändras mellan gissning
 * och svar. Utan det landar sista söndagen i mars och oktober fel.
 */
export function svenskTidpunkt(datum: string, tid: string): Date {
  const [t, m = "0", s = "0"] = tid.split(":");
  const gissning = new Date(
    `${datum}T${String(t).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`,
  );

  const forsta = new Date(gissning.getTime() - offsetMinuter(gissning) * 60000);
  const andra = new Date(gissning.getTime() - offsetMinuter(forsta) * 60000);
  return andra;
}

/** Midnatt svensk tid, som ISO. Gränsen för "idag" i stämplingsvyn. */
export function svenskDygnsstart(nu: Date = new Date()): string {
  return svenskTidpunkt(svensktDatum(nu), "00:00").toISOString();
}

/** Dygnets sista millisekund, svensk tid. */
export function svenskDygnsslut(datum: string): string {
  return new Date(svenskTidpunkt(datum, "00:00").getTime() + 24 * 3600_000 - 1).toISOString();
}

/** Datumet `n` dygn före `datum`, räknat i svenska kalenderdygn. */
export function dagarBakat(datum: string, n: number): string {
  const mitt = svenskTidpunkt(datum, "12:00");
  return svensktDatum(new Date(mitt.getTime() - n * 24 * 3600_000));
}

/** Klockslag i svensk tid: "18:08". */
export function svenskKlocka(instant: Date | string): string {
  const d = delar(typeof instant === "string" ? new Date(instant) : instant);
  return `${String(d.timme).padStart(2, "0")}:${String(d.minut).padStart(2, "0")}`;
}
