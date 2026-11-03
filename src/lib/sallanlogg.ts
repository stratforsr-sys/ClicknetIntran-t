/**
 * Ett fel som består loggas en gång per kvart och nyckel, inte vid varje sidladdning
 * (rättelserna 2026-11-02).
 *
 * Notisernas delfrågor och utskicksreglerna läses vid varje laddning av /nav2. Ett fel som
 * består — en tabell som saknas, en policy som nekar — gav därför en rad i loggen per
 * delfråga och laddning, och det som hände en gång drunknade i det som hände hela tiden.
 * Nu skrivs första förekomsten, och nästa rad efter en kvart säger hur många som tystades
 * emellan. Kartan är per instans: varje kall instans skriver sin första rad.
 */

const KVART = 15 * 60_000;
/** Fler nycklar än så är inte ett fel som består, utan många olika. Då börjar kartan om. */
const MAX_NYCKLAR = 500;

type Spar = { nar: number; tystade: number };
const senast = new Map<string, Spar>();

/** Ska raden skrivas nu? Ren: kartan och klockan kommer utifrån, så att provet kan styra dem. */
export function skaLoggas(
  karta: Map<string, Spar>,
  nyckel: string,
  nu: number,
  intervall: number = KVART,
): { logga: boolean; tystade: number } {
  const s = karta.get(nyckel);
  if (s && nu - s.nar < intervall) {
    s.tystade++;
    return { logga: false, tystade: 0 };
  }
  if (!s && karta.size >= MAX_NYCKLAR) karta.clear();
  karta.set(nyckel, { nar: nu, tystade: 0 });
  return { logga: true, tystade: s?.tystade ?? 0 };
}

/** `console.error`, men högst en gång per kvart för samma nyckel. */
export function loggaSallan(nyckel: string, ...delar: unknown[]): void {
  const b = skaLoggas(senast, nyckel, Date.now());
  if (!b.logga) return;
  if (b.tystade > 0) console.error(...delar, `(+${b.tystade} likadana sedan förra raden)`);
  else console.error(...delar);
}
