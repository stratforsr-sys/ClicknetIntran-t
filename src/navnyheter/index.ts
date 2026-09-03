import type { Navnyhet } from "./typer.ts";
import type { Permission, Role } from "../lib/roles.ts";
import { svenskTidpunkt } from "../lib/klocka.ts";
import { POSTER } from "./poster.ts";

/**
 * Släpplistan. Allt nytt som byggs i navet står här, och ingenting utanför
 * listan går att visa eller kvittera — `hamtaNavnyhet()` är det enda uppslaget,
 * och server actionen slår upp slugen här innan den skriver något.
 *
 * Registret är avsiktligt byggt som `src/guider/`: en lista i koden, ett
 * uppslag, en filterfunktion och ett prov. Skälet är detsamma på båda ställena
 * — den som bygger funktionen skriver raden i samma commit, så den kan inte bli
 * kvar i någons huvud.
 *
 * DE TVÅ YTORNA FRÅGAR SAMMA FUNKTION. Klockan (`notiser-server.ts`) och listan
 * på `/nyheter` kallar båda `navnyheterFor()`. Ett eget filter på det ena
 * stället hade varit ett andra svar på frågan "gäller det här mig", och två
 * svar glider isär — då hade klockan sagt att det finns något att läsa på en
 * sida där det inte syntes.
 */
export const NAVNYHETER: Navnyhet[] = POSTER;

export function hamtaNavnyhet(slug: string): Navnyhet | null {
  return NAVNYHETER.find((n) => n.slug === slug) ?? null;
}

/**
 * Klockan visar högst så här många släppnyheter samtidigt.
 *
 * Klockan har femton platser totalt, och de delas med ärenden, frånvaro och
 * allt annat som väntar på ett svar. En vecka med sju släpp får inte tränga ut
 * en sjukanmälan som behöver bekräftas. Resten står kvar under Nyheter tills de
 * läses — de försvinner inte, de slutar bara tränga sig fram (0018).
 */
export const MAX_I_KLOCKAN = 5;

export type Mottagare = {
  roller: Role[] | null | undefined;
  behorigheter?: Permission[];
  /**
   * Personens anställningsdatum, `employee.start_date`.
   *
   * Släpp som skedde INNAN personen började visas inte. En nyanställd ska möta
   * navet som det ser ut idag, inte en kö med besked om saker hen aldrig
   * saknade — och "coachning finns nu i navet" är en nyhet bara för den som
   * minns tiden utan den. Det hen behöver i stället är startguiden, som redan
   * startar av sig själv vid första inloggningen.
   */
  anstalldSedan?: string | null;
};

/**
 * Släppnyheterna som gäller den här personen, nyast först.
 *
 * `poster` är till för provet, som ska kunna ställa frågor om målgrupper som
 * inte råkar finnas i registret just nu. Anropare i navet lämnar den.
 */
export function navnyheterFor(mottagare: Mottagare, poster: Navnyhet[] = NAVNYHETER): Navnyhet[] {
  const mina = mottagare.roller ?? [];
  const harBehorighet = mottagare.behorigheter ?? [];
  const start = mottagare.anstalldSedan ?? null;

  return poster.filter((n) => {
    if (n.behorighet && !harBehorighet.includes(n.behorighet)) return false;
    if (start && n.datum < start) return false;
    return n.roller.length === 0 || n.roller.some((r) => mina.includes(r));
  }).sort((a, b) => b.datum.localeCompare(a.datum));
}

/**
 * Tidpunkten posten räknas som utgiven, som ISO.
 *
 * Klockan jämför mot `notification_seen.seen_at`, som är en riktig tidpunkt, så
 * datumet ensamt räcker inte. Att tolka det som svensk förmiddag och inte som
 * midnatt UTC är samma regel som resten av navet följer: ett datum i den här
 * organisationen är svensk väggtid (se src/lib/klocka.ts). Midnatt hade dessutom
 * gett "igår" på en post som släpptes samma morgon.
 */
export function tidpunktFor(nyhet: Navnyhet): string {
  return svenskTidpunkt(nyhet.datum, "09:00").toISOString();
}

export type { Navnyhet } from "./typer.ts";
