/**
 * Finans pa affaren (0079).
 *
 * Ren logik — inga anrop, inga hemligheter, ingen import av Supabase. Samma
 * linje som `utkop.ts` och `order.ts`: filen ska ga att prova utan att starta
 * Next. Se `tests/finans.mjs`.
 *
 * ===========================================================================
 * VAD FINANS AR, PA BESTALLARENS SPRAK (2026-10-09):
 *
 *   *"Finans betyder att var finanspartner tar 11% av ordervardet per ar,
 *   alltsa om det ar 12 manader sa tar dem 11%, om det ar 24, 22% osv."*
 *
 * Och pa foljdfragorna samma dag: basen ar HELA ordervardet (tjansterna
 * inraknade, fore ett utkop), och avgiften DRAS FRAN NETTOT precis som
 * utkopet — men paketmatrisens fasta belopp andras inte.
 * ===========================================================================
 *
 * PROCENTEN AR PER AR, OCH LOPTIDEN AR I MANADER. Ett avtal pa 18 manader
 * kostar darfor 16,5 % — proportionellt, inte avrundat till hela ar. Ingen
 * annan lasning av "per ar" ger ett svar for de fria orderna, som far ha vilken
 * bindningstid som helst mellan 1 och 60 manader.
 *
 * INGEN PROCENTSATS STAR I DEN HAR FILEN. Talet 11 ar en rad i `finance_rate`
 * (0079) och kommer hit som argument. Talen 12 och 100 nedan ar manader per ar
 * och hundradelar — samma resonemang som overst i `utkop.ts`.
 */

import { avrunda } from "./provision-motor.ts";

// -----------------------------------------------------------------------------
// Formen pa det databasen bar. Speglar 0079 utan att veta om databasen.
// -----------------------------------------------------------------------------

export type Finanssats = {
  id: string;
  /** Procent av ordervardet PER AR av avtalstiden. Exakt en oppen rad finns. */
  percent_per_year: number;
  valid_from: string;
  valid_to: string | null;
};

// -----------------------------------------------------------------------------
// Satsuppslaget
// -----------------------------------------------------------------------------

/**
 * Satsen som gallde vid ett visst datum — orderns SIGNERINGSDATUM.
 *
 * Samma val som `gallandeUtkopssats` gor, och av samma skal: avgiften ar en
 * egenskap hos EN order och fryses nar just den godkanns.
 *
 * `valid_to` ar exklusivt. Saknas satsen returneras null, aldrig noll procent —
 * en nolla hade sett ut som "finanspartnern tar ingenting", och anroparen ska
 * saga ifran i stallet for att tyst rakna en finansaffar som gratis.
 */
export function gallandeFinanssats(satser: Finanssats[], datum: string): Finanssats | null {
  const traffar = satser.filter(
    (s) => s.valid_from <= datum && (s.valid_to === null || s.valid_to > datum),
  );

  if (traffar.length === 0) return null;

  // Nyast valid_from vinner nar tva stangda rader overlappar — se
  // `gallandeUtkopssats` for resonemanget.
  return traffar.sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))[0];
}

// -----------------------------------------------------------------------------
// Rakningen
// -----------------------------------------------------------------------------

/** Hela avtalets procent: satsen per ar gange antalet ar. 11 % i 24 man = 22 %. */
export function finansprocent(procentPerAr: number, loptid: number): number {
  return (procentPerAr * loptid) / 12;
}

/**
 * Finanspartnerns avgift i kronor.
 *
 * BASEN AR BRUTTOT — hela ordervardet, fore utkopet. Det ar bestallarens svar
 * 2026-10-09, och det ar ocksa det tal finanspartnern ser: avtalet sager
 * bruttot.
 *
 * Avrundas till hela kronor har, och bara har. Beloppet fryses pa ordern och
 * gar aldrig genom nagon andra avrundning — samma regel som `utkopsprovision`.
 */
export function finansavgift(ordervarde: number, loptid: number, procentPerAr: number): number {
  return avrunda((ordervarde * finansprocent(procentPerAr, loptid)) / 100);
}

/**
 * Det som ar kvar nar finanspartnern fatt sitt.
 *
 * Tar NETTOT EFTER UTKOPET som forsta argument, inte bruttot: de tva avdragen
 * ar oberoende och dras bada. TALET GAR ALDRIG UNDER NOLL, av samma skal som
 * `nettoEfterUtkop` — ett negativt netto hade gett en negativ provision.
 *
 * `null` eller noll lamnar nettot orort, sa en affar utan finans raknas exakt
 * som fore 0079.
 */
export function nettoEfterFinans(netto: number, avgift: number | null): number {
  if (avgift === null || !(avgift > 0)) return netto;
  const kvar = netto - avgift;
  return kvar > 0 ? kvar : 0;
}

/** "22 %" — hela avtalets procent, utan onodiga decimaler. */
export function procenttext(procent: number): string {
  const avrundat = Math.round(procent * 100) / 100;
  return `${avrundat.toLocaleString("sv-SE")} %`;
}
