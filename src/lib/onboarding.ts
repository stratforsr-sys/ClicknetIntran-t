/**
 * E10.9 / AC-7.9: checklistan som faller ut nar nagon anstalls. Ren logik.
 *
 * ===========================================================================
 * VARFOR NAGRA PUNKTER FODS AVBOCKADE
 *
 * Floden som skapar listan har redan gjort en del av den: kontot finns,
 * rutinerna och kurserna ar tilldelade av malgruppen, och avtalsutkastet kan
 * vara skapat. De punkterna star kvar i listan anda — de ar bevis pa vad som
 * gjordes, och en checklista som tiger om det som gick automatiskt later som om
 * det aldrig skedde.
 *
 * Men de star som KLARA. En lista som oppnar med tio oppna punkter dar tre
 * redan ar utforda lar anvandaren att bocka av utan att lasa, och da ar de sju
 * som verkligen kraver nagot inte langre skyddade av listan.
 * ===========================================================================
 *
 * Punkterna speglar offboardingens i 0001 med flit: samma saker at andra hallet.
 * Det som ska aterlamnas nar nagon slutar ar det som ska delas ut nu.
 */

export type Punkt = {
  label: string;
  /** Sant nar floden redan utfort punkten och den bara bokfors. */
  automatisk?: boolean;
};

/**
 * @param harAvtal  Ett avtalsutkast skapades i floden.
 * @param antalKurser Hur manga kurser malgruppen gav.
 */
export function checklista(harAvtal: boolean, antalKurser: number): Punkt[] {
  return [
    { label: "Konto i navet skapat med tillfälligt lösenord", automatisk: true },
    { label: "Rutiner tilldelade enligt målgrupp", automatisk: true },
    {
      label:
        antalKurser > 0
          ? `Kurser tilldelade enligt målgrupp (${antalKurser} st)`
          : "Kurser tilldelade enligt målgrupp",
      automatisk: true,
    },
    harAvtal
      ? { label: "Anställningsavtal skapat som utkast — granska, fyll i lönen och utfärda" }
      : { label: "Anställningsavtal upprättat, undertecknat och arkiverat" },
    { label: "Inkio-behörighet upplagd" },
    { label: "Dialer-kö och kösegment tilldelat" },
    { label: "E-postkonto upplagt" },
    { label: "Dator och kringutrustning utlämnad" },
    { label: "Telefon och SIM utlämnat" },
    { label: "Passerkort och nycklar utlämnade" },
    { label: "Introduktion bokad med närmaste chef" },
    { label: "Lön och anställningsuppgifter lämnade till lönehanteringen" },
  ];
}

/** Hur langt listan kommit. Noll punkter ar inte noll procent utan ingen lista. */
export function klart(punkter: { state: string }[]): { avklarade: number; av: number } {
  return {
    avklarade: punkter.filter((p) => p.state !== "open").length,
    av: punkter.length,
  };
}
