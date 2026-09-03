import type { Permission, Role } from "../lib/roles.ts";

/**
 * En sak som byggts i navet, skriven för den som ska använda den.
 *
 * INTE SAMMA SAK SOM ETT NYHETSINLÄGG. `news_post` är ledningens kanal: någon
 * skriver ett besked till en målgrupp, det går att redigera och arkivera, och
 * det står kvar i listan för evigt. Det här är navets egen släpplista — en rad
 * som följer med funktionen in i samma commit, som ingen skriver för hand i
 * gränssnittet, och som försvinner ur vägen så fort mottagaren sagt att hen
 * läst den.
 *
 * Därav också varför den bor i koden och inte i databasen: den som bygger
 * funktionen är den enda som vet vad som ändrades, och en rad i samma commit
 * kan inte glömmas bort på vägen till produktion. En tabell hade krävt att
 * någon loggade in och skrev inlägget efteråt — och det är precis det steget
 * som aldrig blir gjort.
 */
export type Navnyhet = {
  /**
   * Stabil och unik. Den bär både adressen (`/nyheter/nav/<slug>`) och
   * avfärdningen (`navnyhet-<slug>` i `notification_dismissed`), så den får
   * ALDRIG ändras när posten väl är ute: en ändrad slug är en ny nyhet, och då
   * dyker den upp igen för alla som redan läst den.
   *
   * Bara a–z, 0–9 och bindestreck. `arNotisId()` släpper inte igenom något
   * annat, och en slug med å, ä eller ö hade därför gett en "Jag har läst"-knapp
   * som tyst inte gör någonting. Provet i tests/navnyheter.mjs fångar det.
   */
  slug: string;

  /** Vad som finns nu. Står i klockan och som rubrik på sidan. */
  rubrik: string;

  /** En mening under rubriken i klockan och i listan. Ingen markdown. */
  ingress: string;

  /**
   * Hela beskedet, markdown. Skriv det för den som ska använda saken — vad man
   * kan göra nu som man inte kunde igår, och var. Inte vilka tabeller som lades
   * till.
   */
  text: string;

  /** Svenskt kalenderdatum, "2026-09-03". När det blev påslaget i produktion. */
  datum: string;

  /**
   * Vilka det gäller. TOM LISTA BETYDER ALLA — samma konvention som guiderna
   * och `news_post.audience_roles`, och av samma skäl: det vanliga fallet ska
   * inte kräva att man räknar upp varenda roll och kommer ihåg att uppdatera
   * listan den dag en nionde roll införs.
   */
  roller: Role[];

  /**
   * Krävs en tilldelad behörighet för att alls kunna öppna det som byggts?
   * Lönekostnadsmodulen är exemplet: rollen räcker inte, `payroll_cost_viewer`
   * gör det. Att berätta om en sida man inte kommer in på är sämre än att inte
   * berätta alls.
   */
  behorighet?: Permission;

  /** Dit funktionen sitter, om den har en egen adress. Visas som knapp. */
  href?: string;
};
