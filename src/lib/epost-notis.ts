import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { epostArKonfigurerad, skickaKo, type Brev } from "@/lib/epost";
import type { Handelsekalla } from "@/lib/notiser";

/**
 * BRYGGAN MELLAN KLOCKAN OCH INKORGEN.
 *
 * ===========================================================================
 * KLOCKAN ÄR ETT TILLSTÅND, MEJLET ÄR EN HÄNDELSE
 *
 * Det är hela skillnaden, och den förklarar varför listan nedan är så kort.
 *
 * Klockan svarar på "vad ligger på mig just nu". Den får vara lång, för man
 * öppnar den när man vill veta. Ett mejl svarar på "det här hände, och du
 * hinner inte vänta till nästa gång du loggar in" — och varje brev som inte
 * håller det löftet gör de andra breven mindre värda. Beställarens besked
 * 2026-09-14 var exakt det: bara det som är viktigt för chefen och säljaren,
 * inget mer.
 *
 * Sjutton källor mejlas alltså inte, trots att de står i klockan. En godkänd
 * order, ett bokfört övertäck, en ny kollega i teamet, ett satt månadsmål —
 * allt sådant är sant och värt att veta, och ingenting av det är värt att
 * avbryta någon för.
 *
 * ===========================================================================
 * VARFÖR HÄR OCH INTE I VARJE SERVER ACTION
 *
 * `notifiera()` är den enda skrivvägen in i `notification_event`. Läggs mejlet
 * där ärver det tre regler som redan är provade i stället för att skrivas om
 * elva gånger:
 *
 *   1. EN HÄNDELSE GÅR ALDRIG TILL DEN SOM UTLÖSTE DEN. Säljchefen som
 *      makulerar en order ska inte få ett mejl om att hon makulerat en order.
 *   2. Källan måste finnas i `HANDELSEKALLOR`.
 *   3. `href` måste vara en intern sökväg.
 *
 * Alternativet — ett `skickaEpost()` i varje action — hade betytt elva ställen
 * att glömma regel 1 på, och elva rubriker som kan glida ifrån dem i klockan.
 * Nu är rubriken i brevet SAMMA sträng som rubriken i klockan, för den skrivs
 * en gång.
 *
 * ===========================================================================
 * MODULEN KASTAR ALDRIG, OCH BLOCKERAR ALDRIG
 *
 * Samma regel som `notifiera()` själv: anroparen är en server action mitt i
 * någons riktiga arbete. Ett mejl som inte går fram får aldrig bli felet som
 * gör att ordern inte makuleras.
 *
 * Utskicket ligger dessutom i `after()` hos anroparen, så att användaren inte
 * står och väntar på Resend. Se `notishandelse-server.ts`.
 * ===========================================================================
 */

/**
 * Källorna som förtjänar ett brev. En ÄKTA DELMÄNGD av `HANDELSEKALLOR`, och
 * `satisfies` gör att en felstavning faller i typkontrollen i stället för att
 * bli ett brev som aldrig skickas.
 *
 * VARJE RAD HAR ETT SKÄL, och skälet är alltid detsamma: mottagaren kan behöva
 * agera, eller har förlorat något, innan hen nästa gång öppnar navet.
 */
export const MEJLKALLOR = [
  /**
   * Ärendet. Tilldelningen når den som ska hantera det, beslutet når den som
   * öppnade det. Båda är personer som annars kan vänta i dagar på att av en
   * slump logga in.
   */
  "arende-tilldelad",
  "arende-status",

  /**
   * Ordern, och bara de två som KOSTAR något.
   *
   * `order-makulerad` river säljarens provision i makuleringsmånaden — det är
   * det dyraste som kan hända någon i navet utan att de får veta.
   * `order-returnerad` betyder att pengarna står stilla tills säljaren gör om
   * något, och varje dygn den ligger orörd är ett dygn för sent.
   *
   * Godkänd, betald, inskickad, övertäck och rättad står kvar i klockan. De är
   * besked om att något gick BRA, och ett sådant kan vänta till nästa gång man
   * är inne.
   */
  "order-returnerad",
  "order-makulerad",

  /**
   * Frånvaron: de tre besked som RIVER UPP något den anställda redan planerat
   * efter. En godkänd ledighet som ställs in är det tydligaste fallet i hela
   * navet — personen har bokat resa på ett besked som inte längre gäller.
   *
   * Att ansökan VÄNTAR på chefens beslut mejlas inte härifrån, och det är med
   * flit: det är ett tillstånd, inte en händelse. Den ligger i morgonbrevet och
   * upprepas varje morgon tills den är avgjord — vilket är starkare än ett
   * engångsbrev som hinner scrollas förbi. Se `jobb/morgon.ts`.
   */
  "franvaro-tillbakadragen",
  "franvaro-installd",
  "sjuk-installd",

  /**
   * Tiden. Beslutet om en rättelse, och ett nytt schema.
   *
   * Schemat är det minst uppenbara på listan och hör ändå tydligast hemma här:
   * det ändrar vilken tid man ska infinna sig. Den som får veta det först när
   * hon loggar in har redan kommit fel.
   */
  "tid-rattelse-beslut",
  "tid-schema",

  /**
   * Du har inte stämplat in och ditt skift har börjat.
   *
   * Den enda källan på listan som skrivs av ett JOBB och inte av en människas
   * handling — och den som starkast motiverar ett brev: den som glömt stämpla
   * in har per definition inte navet öppet. En notis i klockan når exakt den
   * krets som inte behöver den.
   */
  "tid-ostamplad",

  /**
   * Lönen. BARA justeringen, inte attesten.
   *
   * Attesten låser perioden och är chefens arbete. Justeringen ändrar minuter
   * EFTER att perioden låsts (AC-2.16) — alltså efter att den anställda slutat
   * titta — och det är den enda av de två som någon behöver få veta om.
   */
  "lon-justering",

  /**
   * Uppgiften. Bara tilldelningen.
   *
   * `uppgift-godkand` står MED FLIT INTE HÄR. Beställarens besked 2026-09-14
   * var uttryckligt, och det håller: ett godkännande är ett kvitto på något man
   * själv redan lämnat ifrån sig. Man vet att man gjorde det.
   *
   * Dagens och de försenade uppgifterna mejlas inte heller härifrån — de är
   * tillstånd och ligger i morgonbrevet, som byggdes för just det.
   */
  "uppgift-tilldelad",
] as const satisfies readonly Handelsekalla[];

export type Mejlkalla = (typeof MEJLKALLOR)[number];

const MEJLAS = new Set<string>(MEJLKALLOR);

/** Sant för de källor som ska mejlas. Anropas av `notifiera()` före allt annat
 *  arbete, så att de sjutton andra källorna inte kostar en uppslagning. */
export function kallanMejlas(kalla: string): boolean {
  return MEJLAS.has(kalla);
}

/**
 * Navets adress i ett brev.
 *
 * `NEXT_PUBLIC_SITE_URL` är satt lokalt men INTE i Vercel, så reservvärdet är
 * det som faktiskt gäller i produktion. Det är avsiktligt hårdkodat och inte
 * hämtat ur `VERCEL_URL`: den senare pekar på den enskilda deployen, och en
 * länk i ett brev ska peka på navet även sedan tio deployer passerat.
 */
function navadress(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://clicknet-nav.vercel.app").replace(
    /\/+$/,
    "",
  );
}

/** Aktiva anställda. Samma spärr som morgonbrevet och iCal-flödet drar: en
 *  offboardad person får inga brev, och den regeln ska inte kräva att
 *  offboardingkoden kommer ihåg den här filen. */
const AKTIV = ["active", "onboarding"];

type Utskick = {
  kalla: string;
  rubrik: string;
  detalj?: string;
  href: string;
};

/**
 * Skickar brevet till dem som redan fått notisen.
 *
 * `mottagare` är de id:n `notifiera()` FAKTISKT skrev en rad för — inte de som
 * skickades in. Skillnaden är regel 1: aktören är redan bortsållad när listan
 * kommer hit, så filen behöver inte kunna regeln för att lyda den.
 *
 * Returnerar antalet brev som gick fram. Kastar aldrig.
 */
export async function mejlaHandelse(
  mottagare: readonly string[],
  utskick: Utskick,
): Promise<number> {
  try {
    if (!kallanMejlas(utskick.kalla)) return 0;
    if (mottagare.length === 0) return 0;
    if (!epostArKonfigurerad()) return 0;

    const unika = [...new Set(mottagare)].filter(Boolean);
    if (unika.length === 0) return 0;

    const { data: personer } = await supabaseAdmin()
      .from("employee")
      .select("id, first_name, email, status")
      .in("id", unika)
      .in("status", AKTIV);

    const brevlada: Brev[] = [];

    for (const p of (personer ?? []) as {
      id: string;
      first_name: string | null;
      email: string | null;
      status: string;
    }[]) {
      if (!p.email) continue;
      brevlada.push({
        till: p.email,
        amne: `Clicknet Nav: ${utskick.rubrik}`,
        text: brevtext(p.first_name ?? "", utskick),
      });
    }

    if (brevlada.length === 0) return 0;

    const utfall = await skickaKo(brevlada);
    return utfall.filter((u) => u.utfall.skickat).length;
  } catch {
    return 0;
  }
}

/**
 * Brevets text.
 *
 * RUBRIKEN OCH DETALJEN SKRIVS INTE OM. De kommer från den server action som
 * gjorde saken, är redan formulerade för en människa, och står ordagrant i
 * klockan. En egen formulering här hade betytt två sanningar om samma händelse
 * — och den i brevet hade varit den som åldrades, eftersom ingen ser den när
 * hon ändrar texten i actionen.
 */
function brevtext(fornamn: string, utskick: Utskick): string {
  const rader: string[] = [];

  rader.push(fornamn ? `Hej ${fornamn},` : "Hej,");
  rader.push("");
  rader.push(utskick.rubrik);

  if (utskick.detalj?.trim()) {
    rader.push("");
    rader.push(utskick.detalj.trim());
  }

  rader.push("");
  rader.push(`Öppna i navet: ${navadress()}${utskick.href}`);
  rader.push("");
  rader.push("Det här brevet går bara ut på det som kräver att du gör något.");

  return rader.join("\n");
}
