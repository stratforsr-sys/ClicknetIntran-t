import type { Navnyhet } from "./typer.ts";

/**
 * Posterna. Nyast först — listan läses uppifrån av den som ska lägga till en.
 *
 * SÅ HÄR LÄGGER DU TILL EN: skriv den överst, i samma commit som funktionen den
 * handlar om, och kör `npm run test:navnyheter`. Datumet är dagen den blir
 * påslagen i produktion, inte dagen du skrev raden.
 *
 * SKRIV DEN FÖR MOTTAGAREN. Rubriken säger vad som finns, ingressen vad man kan
 * göra med det, och texten var man hittar det. "Migration 0046 och en ny
 * server action" är sant men hjälper ingen — och en släpplista ingen förstår
 * blir en släpplista alla klickar bort oläst.
 */
export const POSTER: Navnyhet[] = [
  {
    slug: "klockan-sager-allt",
    rubrik: "Klockan säger till om allt som händer",
    ingress: "Godkänd uppgift, makulerad order, ändrat schema, hävd varning — och två nya knappar.",
    text: `Klockan sa förut till om ungefär hälften av det som hände i navet. Nu säger
den till om resten också.

**Det du får veta som du inte fick förut:**

- **Coachning** — när din uppgift blir *godkänd*, inte bara underkänd. Och när
  en uppgift avbryts eller ett samtal bokförs på dig.
- **Order** — inskickad, godkänd, returnerad, **makulerad** och betald. En
  makulering drar tillbaka provisionen i makuleringsmånaden, och det står i
  notisen med belopp och skäl.
- **Tid** — när din rättelse avgörs, när ditt schema ändras och när din
  rastavvikelse avslutas.
- **Lön** — när perioden attesteras och när någon lägger en justering på dina
  minuter efteråt.
- **Frånvaro** — när en godkänd ledighet ställs in, när din sjukanmälan
  bekräftas eller avslutas, när ditt saldo matas in och när en ogiltig frånvaro
  hävs. Läkarintygsfrister säger till en vecka i förväg.
- **Ditt konto** — roll, behörighet, återställt lösenord och ny chef.
- **Ärenden** — när ett ärende tilldelas dig och när ditt eget avslutas.
- **Avtal, certifieringar och rutiner** — utfärdat avtal, certifiering som går
  ut inom en månad, granskningsdatum som passerat på en rutin du äger.

**Två nya knappar i klockan:**

**Markera alla som lästa** släcker prickarna utan att ta bort något. Det som
väntar på dig ligger kvar — du har bara sett att det finns.

**Krysset** till höger om varje rad tar bort just den posten. Panelen stannar
öppen så att du kan rensa flera i följd. Ingenting annat påverkas: den
okvitterade rutinen står kvar på Rutiner, den obeslutade ansökan på Frånvaro.

Klockan rymmer 25 poster i stället för 15.`,
    datum: "2026-09-04",
    roller: [],
  },
  {
    slug: "nytt-i-navet",
    rubrik: "Nytt i navet syns nu i klockan",
    ingress: "Det som byggs berättas här — och försvinner när du läst det.",
    text: `När något nytt byggs i navet får du det i klockan och under **Nyheter**,
med en mening om vad du kan göra som du inte kunde innan.

Du ser bara det som gäller din roll. En ny sida för ekonomi hamnar hos ekonomi,
inte hos alla.

Nere i inlägget finns knappen **Jag har läst det här**. Den tar bort posten från
både klockan och listan, för dig — ingen annan påverkas, och ingenting annat
försvinner. Låter du den ligga kvar står den kvar tills du tar den.`,
    datum: "2026-09-03",
    roller: [],
    href: "/nyheter",
  },
  {
    slug: "personal-ta-bort",
    rubrik: "Personal går att ta bort ur navet",
    ingress: "För den som aldrig skulle ha lagts upp. Offboarding är fortfarande det normala valet.",
    text: `På personkortet finns ett nytt kort längst ned: **Ta bort ur navet**.

Det är inte samma sak som att avsluta en anställning. Offboardingen går att
ångra och lämnar historiken intakt — raderingen gör varken det ena eller det
andra. Använd den för den som lagts upp av misstag eller aldrig började.

Pekar ingenting i navet på personen försvinner raden helt. Har hen godkänt en
kundorder eller attesterat en löneperiod behålls raden men töms på allt utom
namnet, som får tillägget *(borttagen anställd)*. Alternativet hade varit att
radera hela månadens lönekörning för alla andra.

Kortet är i tre steg och sista steget är att skriva personens namn för hand.`,
    datum: "2026-09-03",
    roller: ["sales_manager", "ceo", "admin"],
    href: "/personal",
  },
  {
    slug: "coachning-lagvy-personkort",
    rubrik: "Coachningens lagvy är personkort",
    ingress: "Hela laget som kort, med varje persons öppna uppgifter direkt på kortet.",
    text: `Lagvyn på **Coachning** är inte längre en tabell med en siffra per person.
Varje person är ett kort som bär sina öppna uppgifter med läge och förfallodag,
plus knapparna *Ny uppgift* och *Använd mall*.

Överst finns sökfält och tre filter: **Alla**, **Behöver något** och **Väntar på
din bock**. Hela laget ritas — ingen sidindelning att bläddra i.

Personkortet har öppna uppgifter, historik med sökfält och utfall, och en
tidslinje över allt som hänt personen.

Du får också en notis i klockan när någon lägger upp en uppgift åt dig. En
omgång på tolv moment är ett besked, inte tolv.`,
    datum: "2026-09-03",
    roller: ["team_lead", "sales_manager", "ceo"],
    href: "/coachning",
  },
  {
    slug: "coachning",
    rubrik: "Coachning finns i navet",
    ingress: "Uppgifter, mallar och GROW-protokoll — och en påminnelse när något står still.",
    text: `**Coachning** i menyn. Chefer ser sitt lag, alla andra sitt eget kort.

Du får dina uppgifter med läge och förfallodag, och kvitterar när de är gjorda.
Chefen lägger upp dem en och en eller med en mall, och ett GROW-protokoll blir
riktiga uppgifter av det som bestämdes i samtalet.

Tre sorters uppgift går inte att bocka för hand: kurs, inspelat rollspel och
läsning. De hämtar sitt läge ur certifikatet, kursförsöket och kvittensen — det
är gjort när det faktiskt är gjort.

Står något still hör klockan av sig.`,
    datum: "2026-09-02",
    roller: [],
    href: "/coachning",
  },
  {
    slug: "systemguider",
    rubrik: "Guidade turer i navet",
    ingress: "Startguiden går igenom navet på fyra minuter, och varje modul visar sig själv första gången.",
    text: `Första gången du loggar in startar **Kom igång i navet** — tio steg, ungefär
fyra minuter. Den går att pausa och kommer tillbaka tills du gått igenom den.

Varje modul har dessutom en egen kort guide som startar första gången du öppnar
den: rutiner, nyheter, ärenden, frånvaro, stämpling, avtal, order och resten.

Vill du se en igen finns alla under **Utbildning → Systemguider**, med *Gör om*.

När rollens alla guider är genomgångna byter du själv status från onboarding
till aktiv. Ingen behöver kvittera det åt dig.`,
    datum: "2026-08-31",
    roller: [],
    href: "/utbildning/systemguider",
  },
];
