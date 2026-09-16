/**
 * Plinget i webbläsaren — det som är gemensamt för knappen och lyssnaren.
 *
 * =============================================================================
 * INGEN PUSH, OCH DET ÄR EN PLANGRÄNS OCH INTE ETT VAL
 *
 * Beställaren bad om "pling i webbläsaren när navet är öppet", och den sista
 * halvan av meningen är hela konstruktionen. Ett pling som når en stängd flik
 * kräver en service worker med Web Push, en VAPID-nyckel, en prenumerationstabell
 * — och något som faktiskt skickar vid rätt klockslag. Det sista finns inte:
 * Vercels Hobby-plan tar två cron-poster per projekt och kör var och en EN GÅNG
 * PER DYGN. Båda är tagna sedan 0054 (`/api/jobb/natt` och `/api/jobb/morgon`),
 * och en påminnelse som kan komma en gång om dagen är ett morgonbrev, vilket
 * redan finns.
 *
 * Plinget är därför webbläsarens egen `Notification`, utlöst av en flik som står
 * öppen. Det når den som har navet framme — vilket är precis den krets som har
 * nytta av att bli avbruten tio minuter innan något ska ske.
 *
 * =============================================================================
 * PÅ ELLER AV LIGGER I `localStorage` OCH INTE I DATABASEN
 *
 * Inställningen gäller DEN HÄR webbläsaren, inte personen. Behörigheten att
 * visa notiser är per webbläsare och per enhet — den som sagt ja på kontoret
 * har inte sagt ja på sin telefon — och en inställning i databasen hade påstått
 * att den gällde överallt. Då står det "på" på en enhet där ingenting händer,
 * och det är värre än att stå av.
 * =============================================================================
 */

export const PLING_NYCKEL = "nav-pling";

/** Hur ofta fliken frågar vad som är på väg. */
export const PLING_INTERVALL_MS = 5 * 60 * 1000;

/**
 * Fem minuter mot ett tiominutersfönster, och det är inte slarv.
 *
 * `attPlinga()` i kalender.ts släpper igenom poster som ligger 0–10 minuter
 * fram. Varje femminutersraster träffar ett tiominutersfönster minst en gång,
 * så ingen post kan hoppas över — och varje post som HINNER träffas två gånger
 * stoppas av `tag` på notisen, som byter ut den förra i stället för att lägga
 * en till.
 */

export function plingetPa(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PLING_NYCKEL) === "pa";
  } catch {
    // Privat läge och blockerade kakor kastar. Av är rätt håll att fela åt.
    return false;
  }
}

export function sattPling(pa: boolean): void {
  try {
    window.localStorage.setItem(PLING_NYCKEL, pa ? "pa" : "av");
    // Lyssnaren i skalet ska slå om direkt och inte vid nästa raster.
    window.dispatchEvent(new CustomEvent(PLING_HANDELSE));
  } catch {
    /* tomt med flit — se ovan */
  }
}

/** Skickas när knappen slår om. `storage` fyrar bara i ANDRA flikar. */
export const PLING_HANDELSE = "nav-pling-andrad";

export type Plingpost = {
  id: string;
  rubrik: string | null;
  tid: string | null;
  minuter: number | null;
  href: string | null;
};
