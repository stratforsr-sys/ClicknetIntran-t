import { visasINav2 } from "./skrivlage.ts";

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
 * BRON (K6): varje monster bar sin vy. I produktionen skickas en adress om
 * forst nar vyn far spara (`visasINav2`, skrivlage.ts). Tills dess stannar den
 * pa sidan har, dar personalen kan stampla, lagga order och soka ledighet.
 * Previewen skickar om allt, som forut.
 *
 * Bara hela sidladdningar (Sec-Fetch-Dest: document) skickas om. Navets egna
 * klientnavigeringar och prefetch ar inte dokument och rors inte.
 */
export const SJALV: ReadonlyArray<readonly [vy: string, monster: RegExp]> = [
  ["uppgifter", /^\/uppgifter(\/[^/]+)?$/],
  ["uppgifter", /^\/uppgifter\/projekt\/[0-9a-f-]{36}$/],
  ["rutiner", /^\/rutiner(\/[^/]+)?$/],
  ["rutiner", /^\/rutiner\/[^/]+\/(redigera|kvittenser)$/],
  ["utbildning", /^\/utbildning(\/[^/]+)?$/],
  ["utbildning", /^\/utbildning\/prov\/[^/]+$/],
  ["utbildning", /^\/utbildning\/oversikt\/systemguider$/],
  ["tid", /^\/tid(\/(lonerapport|avvikelser|ogiltig-franvaro|schema))?$/],
  ["tid", /^\/tid\/lonerapport\/[0-9a-f-]{36}$/],
  ["kalender", /^\/kalender$/],
  ["arenden", /^\/arenden(\/(?!statistik$)[^/]+)?$/],
  ["franvaro", /^\/franvaro(\/(attest|sjuk|planering|ny))?$/],
  ["franvaro", /^\/franvaro\/[0-9a-f-]{36}$/],
  ["fel", /^\/fel(\/nytt)?$/],
  ["order", /^\/order$/],
  ["provision", /^\/provision$/],
  ["provision", /^\/provision\/(regler|mal)$/],
  ["provision", /^\/provision\/underlag\/\d{4}-\d{2}$/],
  ["satser", /^\/lonekostnad(\/satser)?$/],
  ["coachning", /^\/coachning(\/[^/]+)?$/],
  ["coachning", /^\/coachning\/uppgift\/[^/]+$/],
  ["anstallda", /^\/personal(\/[^/]+)?$/],
  ["rekrytering", /^\/rekrytering(\/(?!ny$)[^/]+)?$/],
  ["avtal", /^\/avtal$/],
  ["leads", /^\/leads(\/[^/]+)?$/],
  ["moten", /^\/moten$/],
  ["logg", /^\/logg$/],
  ["adoption", /^\/adoption$/],
  ["nyheter", /^\/nyheter(\/[^/]+)?$/],
  ["nyheter", /^\/nyheter\/nav\/[^/]+$/],
  ["profil", /^\/profil(\/[^/]+)?$/],
  ["sok", /^\/sok$/],
];

/** Adressen i Nav 2.0 for en gammal sida, eller null om sidan stannar i nuvarande Nav. */
export function nav2Adress(path: string, search: string): string | null {
  // Startsidan gar hit direkt. Annars strommar (app)-layouten forst och
  // page.tsx skickar vidare med en meta refresh: fyra sekunder i previewen.
  if (path === "/") return "/nav2";
  if (!SJALV.some(([vy, r]) => r.test(path) && visasINav2(vy))) return null;
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
