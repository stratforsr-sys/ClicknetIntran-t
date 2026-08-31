import type { Permission, Role } from "../lib/roles.ts";

/**
 * Vad ett steg i en guidad tur är.
 *
 * ===========================================================================
 * ETT STEG PEKAR PÅ ETT ELEMENT, INTE PÅ EN BILD AV ETT ELEMENT.
 *
 * `ankare` är värdet i ett `data-guide`-attribut någonstans i gränssnittet.
 * Overlayen slår upp det i den riktiga sidan och klipper ett hål över det som
 * finns där. Det betyder att en guide aldrig kan visa något annat än vad
 * användaren faktiskt har framför sig — men också att ett omdöpt attribut gör
 * guiden trasig, och att det måste upptäckas av bygget och inte av en ny
 * anställd. Se `npm run test:guider`.
 * ===========================================================================
 */

/**
 * Vad som får turen att gå vidare.
 *
 * `klick` och `fokus` är löftet i beställningen: användaren lär sig genom att
 * göra, och steget står kvar tills hon gjort det. `vidare` är en knapp, och den
 * finns för de steg där det inte FINNS något att göra — en förklaring av vad en
 * yta betyder, eller välkomstrutan. Att sätta `klick` på ett sådant steg vore
 * att uppfinna en handling bara för att slippa knappen.
 *
 * Regeln: bär steget en instruktion i imperativ ("Tryck på …") ska det kräva
 * handlingen. Beskriver det något ("Här ligger …") är det `vidare`.
 */
export type Handling = "klick" | "fokus" | "vidare";

/**
 * Vissa steg finns bara i ett av lägena, och det är inte kosmetika.
 *
 * På telefonen ligger menyn bakom "Mer" i bottenraden och måste öppnas innan
 * något i den går att peka på. På datorn står den framme hela tiden, och ett
 * steg som ber någon öppna den vore obegripligt. Två steg som utesluter
 * varandra är ärligare än ett steg med en text som säger "om du sitter vid en
 * dator, hoppa över det här".
 */
export type Lage = "dator" | "mobil";

export type Steg = {
  /**
   * `data-guide`-värdet steget pekar på. Utelämnat betyder att rutan ritas
   * mitt på skärmen utan hål — välkomst och avslut.
   */
  ankare?: string;

  /**
   * Ankare för samma sak när layouten är en annan under 768 px. Saknas det
   * används `ankare` i båda lägena, vilket är det vanliga: de flesta element
   * ligger på samma ställe i trädet oavsett bredd.
   */
  ankare_mobil?: string;

  rubrik: string;
  text: string;
  handling: Handling;

  /** Steget finns bara i det här läget. Utelämnat = båda. */
  bara?: Lage;

  /**
   * Adressen steget hör hemma på. Står användaren någon annanstans visar
   * overlayen en väg dit i stället för att peka på ingenting.
   */
  vag?: string;
};

export type Guide = {
  slug: string;
  titel: string;

  /** En mening. Står i listan på /utbildning/systemguider. */
  beskrivning: string;

  /**
   * Höjs BARA när själva momentet ändrats, aldrig för en omskriven mening
   * eller ett flyttat ankare. En höjning med `omtag: true` gör alla tidigare
   * genomföranden ogiltiga och ber hela personalen göra om turen — se
   * `arKlar()` i src/lib/guider.ts. Det är ett beslut om andras tid.
   */
  version: number;

  /** Tvingar om alla vid versionshöjningen. Utan den gäller nya versionen bara nya. */
  omtag?: boolean;

  /**
   * Modulen guiden hör till, som adress: `/order`, `/rutiner`.
   *
   * Sidan för den modulen monterar guiden själv, och den startar första gången
   * någon öppnar modulen. Utan `modul` är guiden inte knuten till någon sida —
   * det gäller orienteringen, som handlar om navet i stort.
   */
  modul?: string;

  /**
   * Ett villkor utöver rollen.
   *
   * `stamplar` betyder att guiden bara gäller den som faktiskt stämplar in och
   * ut. Vem det är kan INTE uttryckas som en rollista: svaret är
   * `sparr.stampling && !stampelfri(user.roles)`, och `src/lib/stampelfri.ts`
   * är enda stället där den listan får bo. En kopia här hade glidit isär från
   * originalet första gången en roll flyttades — vilket är precis vad den filen
   * varnar för. Anroparen räknar ut svaret och skickar det vidare.
   */
  krav?: "stamplar";

  /**
   * En tilldelad behörighet, inte en roll.
   *
   * `payroll_cost_viewer` är den skarpa: kretsen som ser vad namngivna personer
   * KOSTAR är mindre än den som sköter löner, och den följer inte av rollen —
   * behörigheten delas ut per person under Personal (K26/E15.1). En guide för
   * den vyn får inte ligga och skylta i listan för en ekonom som inte fått den.
   */
  behorighet?: Permission;

  /** Ungefärlig tid i minuter. Står i erbjudandet, så ingen börjar i blindo. */
  minuter: number;

  /**
   * Vilka rollen gäller. Tom lista = alla, samma konvention som
   * `course.audience_roles` i M6.
   */
  roller: Role[];

  /**
   * Startar av sig själv första gången personen kommer in i navet. Sant för
   * en enda guide — orienteringen. Se `startguiden()`.
   */
  vidForstaInloggningen?: boolean;

  steg: Steg[];
};
