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
    slug: "provisionsvyn-som-resultattavla",
    rubrik: "Provisionen visar nu dagen, takten och vägen till nästa bonus",
    ingress:
      "Månadens siffra står överst i stor stil med bonustrappan under. Nya kort för dagen, takten och målet — och en väljare för period och person.",
    text: `**/provision** var en huvudbok — historik, perioder och ett
bokföringsformulär. Den är nu en resultattavla, och svarar i den ordning man
faktiskt frågar.

**Överst i panelen: vilken månad, och vems siffror**

Alla kan byta **period** — tolv månader bakåt. Perioden är en hel månad och
inget fritt datumspann, för volymbonusen är en egenskap hos hela månaden: ett
spann som "1–15 september" har ingen bonusnivå att visa.

Är du **säljchef, VD eller ekonomi** finns en väljare till: **Min provision**,
**Företaget totalt**, eller en enskild säljare. Hela tavlan följer med — talet,
banan, korten, staplarna och orderlägena. Säljare ser bara sin egen och byter
bara period.

I företagsvyn byts bonustrappan mot företagets fyra tal: hur många säljare som
har order, hur många som nått en nivå, order netto och snitt per order. Ett
lag har ingen gemensam bonusnivå — femtio order på tio personer ger ingen bonus
alls, femtio på en ger nivå 20.

Väljer du en månad som varit byts *I dag* och *Takt* mot **månadens facit**:
bästa dagen, dagar med order och snitt per arbetsdag. "I dag: 0" för augusti är
en nolla som ljuger.

**Vad du tjänat den valda månaden**

Ett tal, i stor stil, på mörk platta. Bredvid står vad det består av:
grundprovision, volymbonus, K&V-bonus och det som bokförts för hand.

**K&V-bonusen räknas nu in i totalen.** Den låg förut bara på /kv, och totalen
på provisionssidan var därför lägre än det som faktiskt betalades ut. Raden
visas bara när det finns bedömda veckor.

**Under talet: bonustrappan som en bana**

Prickarna är nivåerna med sina belopp. Den fyllda delen är var du står, och
nästa prick är nästa bonus. Nivån gäller **samtliga** order i månaden, inte
bara de över tröskeln — når du nivå 10 får alla tio orderna nivå 10:s belopp.

**Tre kort: I dag, Takt och Mål**

*I dag* räknar allt du tecknat i dag, på signeringsdatum. Kronorna står i två
delar: det chefen godkänt, och det som ligger i kön. Det väntande beloppet är
slaget ur paketmatrisen och bokförs först vid godkännandet.

*Takt* säger vad månaden landar på om det fortsätter så här — räknat på
**arbetsdagar**, så helger och röda dagar drar inte ned den. K&V-bonusen skrivs
inte fram; den beror på veckor ingen bedömt än.

*Mål* jämför mot var du **borde** stå i dag, inte mot hela månadsmålet. "12 av
20" den åttonde är inte ett underbetyg — det är före takten. I företagsvyn
summeras målen, och både målet och utfallet räknas på de säljare som HAR ett
mål — annars hade siffran stigit av att någon glömde sätta ett.

**Sedan: dagarna, orderlägena och raderna**

En stapel per arbetsdag i månaden. Dina order fördelade på Godkänd, Betald och
Makulerad. Och hela underlaget rad för rad — varje order, varje bonus, varje
avdrag.

**Om du är chef**

*Laget i laget* visar varje säljare med dagens order, månadens volym, nivån,
takten och måluppfyllelsen — räknat live med samma motor som säljarens egen vy.

*Månadsmål* under **Provision → Månadsmål** är nytt. Säljchef och VD sätter mål
i antal order, kronor eller båda, för innevarande månad eller framåt. En passerad
månad går inte att sätta mål för. Säljaren får en notis när målet sätts eller
ändras, och ser bara sitt eget.`,
    datum: "2026-09-08",
    roller: [],
    href: "/provision",
  },
  {
    slug: "flikar-pa-korten",
    rubrik: "Korten har fått flikar, filter och siffror",
    ingress: "Dagens läge visar nu också 7 och 14 dagar framåt. Din kö visar vad som brådskar, inte bara hur mycket.",
    text: `Startsidan och frånvarosidorna har fått samma tre saker överst i korten:
**siffror** som går att läsa på avstånd, **flikar** som byter vy, och **chips**
som filtrerar.

**Dagens läge**

Flikarna är tidsfönster: **I dag**, **7 dagar** och **14 dagar**. Framåtblicken
låg förut som en rad småtext längst ner och gick att missa.

Chipsen under filtrerar på sorts frånvaro. De är färre i framtidsflikarna, och
det är med flit: ingen är sen på tisdag ännu, så *Sena* och *Inte instämplad*
finns bara under *I dag*.

En pågående sjukperiod utan slutdag står som **"Sjuk nu"** framåt — navet
påstår inte när någon är tillbaka.

**Din kö**

Flikarna är områden: Frånvaro, Tid, Ärenden, Utbildning. Överst ligger nu
**det som brådskar** med namn och frist, i stället för bara ett antal.

Bara det som HAR en frist rangordnas — ett ärende har sin svarstid, en ansökan
har sin första ledighetsdag. En rättelse och ett rollspel har ingen, och står
därför kvar som antal längre ner i stället för att sorteras på en påhittad
brådska.

**Frånvaro i teamet** och **Min frånvaro**

Korten som låg staplade under varandra är nu flikar. Det som låg längst ner
lästes minst, oavsett hur viktigt det var.`,
    datum: "2026-09-07",
    roller: [],
    href: "/",
  },
  {
    slug: "franvaro-skal-och-lage",
    rubrik: "Frånvaron säger nu varför, hur länge och vem som är borta",
    ingress:
      "Ledighet söks med ett skäl och en uttrycklig slutdag. Chefen beslutar i listan. Sjukperioden visar sjukdag och frister.",
    text: `Frånvaron svarade förut på **när** men sällan på **vad** och nästan aldrig
på **varför**. Det är ändrat på fyra ställen.

**När du söker ledigt**

Du väljer nu *Bara en dag* eller *Flera dagar* innan du väljer datum. Väljer du
flera anger du antingen sista dagen eller hur många dagar det gäller — de två
räknar fram varandra. Förut kunde slutdagen lämnas tom och blev då tyst en enda
dag, vilket ingen såg förrän beslutet var fattat.

Du skriver också **varför du söker ledigt**. Chefen behöver det för att kunna
säga ja eller nej, och det är obligatoriskt.

*Skriv inget om hälsa, vård eller behandling* — varken din egen eller någon
annans. Texten läses av dig, av den som beslutar och av ledningen. Ingen annan,
och den står aldrig i klockan.

**Om du är chef: en sida i stället för fyra**

**Frånvaro i teamet** ersätter *Att besluta*. Där ligger tre saker under
varandra:

- **Att besluta** — varje ansökan med skälet, perioden, hur många andra som är
  borta samma dagar och vilka regler den bryter mot i klartext. Du godkänner
  eller avslår direkt i listan.
- **Sjukfrånvaro** — vem som är sjuk, vilken sjukdag det är, och när
  läkarintyget och FK-anmälan förfaller med nedräkning i dagar.
- **Godkänd ledighet** — vem som är borta i dag och vem som är borta inom två
  veckor.

Du kan också **anteckna** på en sjukperiod: *"pratat med honom i dag, räknar med
måndag"*. Det är för läget och för arbetet — aldrig för diagnos eller symtom.
Anteckningen går inte att ändra efteråt, och den ingår i personens
registerutdrag.

**På startsidan**

Är du chef har *Dagens läge* fått rubriker per sorts frånvaro och en rad om vad
som börjar de närmaste två veckorna.

Alla får ett eget kort — **Din frånvaro** — med det du väntar svar på, det som är
inbokat framåt och ditt saldo. Kortet syns bara när du har något där.

**I klockan**

Raden om en ledighetsansökan bar bara ett datum och sa varken till när eller hur
länge. Den skriver nu ut hela perioden. Sjukanmälan skriver ut vilken sjukdag
det är.`,
    datum: "2026-09-07",
    roller: [],
    href: "/franvaro",
  },
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
