/**
 * Namnet pa kakan som bar sidopanelens lage (UI-PRD §5.1).
 *
 * Egen fil for att bade layouten pa servern och skalet i webblasaren ska lasa
 * samma strang. Ett stavfel pa ena stallet hade betytt att laget aldrig
 * sparades — och det ar en sorts fel som ingen anmaler, man bara slutar falla
 * ihop panelen.
 *
 * Kakan foljer webblasaren, inte kontot. Pa en delad kioskdator far alltsa
 * nasta person foregaende persons lage. Det ar en vy-installning utan
 * personuppgifter, sa priset ar en kolumn och en fraga per sidvisning som
 * ingen far tillbaka nagot for.
 */
export const SIDOPANEL_KAKA = "nav_sidopanel";

export function arHopfalld(varde: string | undefined): boolean {
  return varde === "hopfalld";
}
