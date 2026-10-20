/**
 * Overgangen: Nav 2.0 ar navet (bestallaren 2026-10-19: "ta over alla fran
 * gamla nav till 2.0", ingen vag tillbaka).
 *
 * ===========================================================================
 * EN GAMMAL ADRESS SOM NAV 2.0 KAN VISA OPPNAS I NAV 2.0. Ett bokmarke, en
 * lank i ett mejl eller en notis till /franvaro/attest blir
 * /nav2?till=/franvaro/attest, och Nav 2.0 oppnar ratt vy och flik (`ndGa` i
 * utkastets moduler/ndskal.js). Det som bara finns i nuvarande Nav (Nyheter,
 * K&V, Handelselogg, scheman, sparrar, projekt, mallar …)
 * star inte har och oppnas som forut.
 *
 * NAV 2.0 SKICKAR ANDA HIT MED FLIT. Finns en post inte i Nav 2.0 gar vagen
 * vidare till sidan har, och da ar Referer /nav2: mellanvaran slapper igenom
 * den (`franNav2`). Annars hade det blivit en loop.
 * ===========================================================================
 *
 * Bara hela sidladdningar (Sec-Fetch-Dest: document) skickas om. Navets egna
 * klientnavigeringar och prefetch ar inte dokument och rors inte.
 */
const SJALV: RegExp[] = [
  /^\/uppgifter(\/(?!projekt$|mallar$|genomgang$)[^/]+)?$/,
  /^\/rutiner(\/(?!ny$)[^/]+)?$/,
  /^\/utbildning(\/(?!ny$|prov$|rollspel$|systemguider$|oversikt$)[^/]+)?$/,
  /^\/tid(\/(lonerapport|avvikelser|ogiltig-franvaro))?$/,
  /^\/kalender$/,
  /^\/arenden(\/(?!statistik$)[^/]+)?$/,
  /^\/franvaro(\/(attest|sjuk|planering|ny))?$/,
  /^\/fel(\/nytt)?$/,
  /^\/order$/,
  /^\/provision$/,
  /^\/coachning(\/(?!mallar$)[^/]+)?$/,
  /^\/coachning\/uppgift\/[^/]+$/,
  /^\/personal(\/(?!ny$|team$)[^/]+)?$/,
  /^\/rekrytering(\/(?!ny$)[^/]+)?$/,
  /^\/avtal$/,
  /^\/leads(\/[^/]+)?$/,
  /^\/logg$/,
  /^\/adoption$/,
  /^\/nyheter(\/[^/]+)?$/,
  /^\/nyheter\/nav\/[^/]+$/,
  /^\/profil(\/[^/]+)?$/,
  /^\/sok$/,
];

/** Adressen i Nav 2.0 for en gammal sida, eller null om sidan stannar i nuvarande Nav. */
export function nav2Adress(path: string, search: string): string | null {
  // Startsidan gar hit direkt. Annars strommar (app)-layouten forst och
  // page.tsx skickar vidare med en meta refresh: fyra sekunder i previewen.
  if (path === "/") return "/nav2";
  if (!SJALV.some((r) => r.test(path))) return null;
  return "/nav2?till=" + encodeURIComponent(path + search);
}

/** Om en begaran kommer fran Nav 2.0 (samma ursprung, sidan /nav2). */
export function franNav2(referer: string | null, origin: string): boolean {
  if (!referer) return false;
  try {
    const u = new URL(referer);
    return u.origin === origin && (u.pathname === "/nav2" || u.pathname.startsWith("/nav2/"));
  } catch {
    return false;
  }
}
