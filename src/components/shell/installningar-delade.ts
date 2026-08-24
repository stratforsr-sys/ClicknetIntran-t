/**
 * Det av installningarnas lista som bada sidor av server/klient-gransen
 * behover.
 *
 * EGEN FIL MED FLIT. `installningar-poster.ts` bygger listan utifran
 * anvandaren och importerar darfor `@/lib/auth` och `@/lib/lonekostnad-server`
 * — serverkod som inte far folja med till webblasaren. Sidopanelen och rutan
 * ar klientkomponenter och importerar VARDEN harifran; typen tas med
 * `import type` och ar erased.
 */
export type InstallningsPost = {
  href: string;
  label: string;
  ikon: string;
};

/** Adressen rutan oppnas pa, och den forsta panelen i listan. */
export const INSTALLNINGAR_START = "/profil";

/**
 * Posterna som INTE ar de tre egna — allt under rubriken Administration.
 *
 * Skillnaden gar pa adressen och inte pa en flagga i listan: de egna
 * panelerna ar de enda som bor under /profil, och en flagga hade varit ett
 * andra stalle att halla i synk med adressen.
 */
export function arAdministration(post: InstallningsPost): boolean {
  return !post.href.startsWith(INSTALLNINGAR_START);
}
