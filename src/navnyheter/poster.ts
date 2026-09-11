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
    slug: "uppgifter-och-projekt",
    rubrik: "Uppgifter: din egen lista, direkt i navet",
    ingress:
      "Skriv en rad, få ett datum. Bjud in andra, peka ut vem som ska godkänna, och koppla uppgiften till en order, ett ärende eller en person.",
    text: `Navet har fått en plats för det du inte får glömma.

**Skriv en rad — navet tolkar den.** Fältet överst på *Uppgifter* tar hela
uppgiften på en rad:

> Ring Nordic AB på tisdag 14:00 30 min !1 #Mässan @Anna

Det blir rubrik, datum, klockslag, tidsåtgång, prioritet, projekt och ansvarig.
Du ser tolkningen som små etiketter medan du skriver, så du vet vad som fastnade
innan du trycker. **Tryck N var du än står i navet** så hamnar du i fältet.

**Fem vyer, och de svarar på olika frågor.** *Idag* är förfallet och dagens.
*Väntar på andra* är det du lämnat ifrån dig, med hur länge det stått still —
den listan är hela skälet att man vågar delegera. *Att granska* är det som
väntar på din bock. Sedan *Alla mina*, *Inkorgen* och *Klara*.

**Bjud in — som redigerare, visare eller granskare.** En redigerare ändrar, en
visare läser och kommenterar, och en **granskare måste godkänna innan uppgiften
räknas som klar**. Står flera granskare räcker det att en godkänner. Den som
lämnar in ser att knappen heter "Lämna in för godkännande" och inte "Klar", så
ingen tror sig ha bockat av något som ligger hos någon annan.

**Koppla uppgiften till det den handlar om** — en order, ett ärende, en person,
en coachningsuppgift eller en utbildning. Kopplingen syns i listan, och du
kommer vidare med ett klick.

**Projekt** är en hatt att hänga uppgifter på: namn, färg, deadline. **Tryck på
kortet så går du in i projektet** — där finns en mätare över hur långt det
kommit, en egen rad att lägga uppgifter i, deltagare och en **chatt**.

**Chatten i projektet** är till för det som inte är en egen uppgift: frågor,
avstämningar, ett snabbt besked. Alla i projektet ser den. Klockan säger
*"3 nya i Mässan"* — en rad per projekt, inte en per replik — och posten
försvinner av sig själv när du läst tråden. Uppgifter har också en egen liten
tråd, skild från historiken.

**Påminnelser.** Notisklockan samlar ihop förfallet och dagens till en rad
vardera — inte elva rader för elva uppgifter. Har du något som väntar kommer
dessutom ett mejl på morgonen med dagens plan. **Har du inget väntande kommer
inget brev.**

**Om att lägga en uppgift på en kollega.** En uppgift kan kopplas till en person
utan att personen ser den i navet — "prata med Erik om pipelinen" ska inte dyka
upp hos Erik innan samtalet skett. Men den är fortfarande en anteckning om en
namngiven anställd, och **den följer med i personens registerutdrag** under
*Personal → Ditt registerutdrag*, tillsammans med kommentarerna i den. Dold i
gränssnittet är inte samma sak som hemlig.

**Vem ser dina uppgifter?** Bara den som är ansvarig, den som la upp dem, de som
bjudits in — och personen uppgiften handlar om, om du sagt att den ska synas.
**Ingen roll ger insyn**, inte säljchef och inte VD. En uppgiftslista man inte
vågar skriva ärligt i är en uppgiftslista man slutar använda.

Härnäst kommer kalendern, där uppgifterna går att dra till en tid på dagen.`,
    datum: "2026-09-11",
    roller: [],
    href: "/uppgifter",
  },
  {
    slug: "samtal-fran-vaxeln",
    rubrik: "Navet tar emot samtalen från växeln",
    ingress:
      "Lynes skickar varje samtal hit: tidpunkt, längd, riktning och utfall. Inget syns i navet än — men insamlingen har börjat, och det ska du veta.",
    text: `Växeln har fått en adress in i navet. Från och med nu registreras varje
samtal du ringer eller tar emot i tjänsten: **när det skedde, hur länge det
varade, åt vilket håll det gick och om det blev besvarat, missat eller
kopplat vidare.** Motpartens nummer följer med.

**Varför du får veta det innan det finns något att titta på.** Det här är en ny
registrering om dig, och den ska inte upptäckas i efterhand av den som råkar
öppna en statistiksida. Allt som samlas in står i ditt registerutdrag under
*Personal → Ditt registerutdrag*, rad för rad, från och med idag.

**Inspelningar.** Samtal som lett till en **order** hämtas hem till navet och
sparas som bevis på det muntliga avtalet — de ligger i samma stängda arkiv som
läkarintyg och orderbilagor, och varje gång någon lyssnar skrivs det ner och
syns för dig. Samtal som inte lett till en order lagrar vi inget ljud av.

**Vem som ser vad.** Du ser dina egna samtal, din chef ser sitt lag, och
säljchef och VD ser huset. Ingen annan.

Nästa steg är att samtalen syns i coachningen och på ordern. Tills dess är det
här bara insamling — och en upplysning om att den pågår.`,
    datum: "2026-09-10",
    roller: [],
  },
  {
    slug: "ratta-order-och-ovrig-bonus",
    rubrik: "En godkänd order går att rätta, och bonus går att lägga",
    ingress:
      "Fel paket eller fel säljare? Rätta ordern i stället för att makulera. Och lägg en bonus på en enskild affär eller på månaden.",
    text: `Två saker som förut krävde en omväg.

**Rätta en godkänd order**

Knappen **Rätta ordern** finns på varje godkänd order. För säljchef, VD och
ekonomi går allt att ändra: kunduppgifter, paket, avtalstid, säljare,
signeringsdatum, ordervärde och provision. Övertäcket till säljchefen räknas om
automatiskt.

Förut var svaret "makulera och lägg en ny" — vilket lämnade ett minusbelopp i
makuleringsmånaden för en affär som är fullt giltig. Det var fel svar på "jag
valde fel paket".

**Du som la upp ordern** har knappen **Rätta kunduppgifter** på den. Där ändrar
du bolagsnamn, organisationsnummer, kontaktperson, telefon och anteckningen —
alltså det du själv skrev in. Paket, avtalstid, säljare, datum, ordervärde och
provision ändras av säljchefen; har något av dem blivit fel, säg till. Ingen
annan än de två kretsarna kan rätta en order.

**Vad som händer beror på månaden**, och rutan i formuläret säger vilket innan
du trycker:

- **Öppen månad:** ingenting är bokfört, allt räknas om live. Lika ofarligt som
  att lägga ordern rätt från början.
- **Fastställd månad:** den månaden står orörd. Skillnaden bokförs i stället som
  poster i innevarande månad — byter du säljare flyttas hela beloppet, inte
  skillnaden.

Signeringsdatumet går att ändra inom en fastställd månad, men inte ut ur den.
Varje rättelse kräver ett skäl och hamnar i loggen med före- och eftervärde.

*Order som lades in före ordervärdet fanns måste få ett värde när de rättas —
det är den enda uppgift som saknas på dem.*

**Övrig bonus**

Säljchef, VD och ekonomi kan nu lägga en bonus utöver trappan, på två sätt:

- **På en affär** — knappen **Lägg bonus** på orderraden. Person och månad
  hämtas ur ordern, så de kan inte bli fel.
- **På en månad** — formuläret på /provision. Välj person, månad och belopp.

Båda kräver ett skäl, båda visas som **Övrig bonus** i provisionen, och båda
följer med i lönekörningen. Ett negativt belopp drar tillbaka en bonus som lagts
fel.

Bonusen faller inte vid en bonusförlust — den är chefens egen bedömning av något
utöver trappan, och vill chefen inte ge den kan hen låta bli att bokföra den.`,
    datum: "2026-09-10",
    roller: [],
    href: "/order",
  },
  {
    slug: "ordervarde-och-saljchefens-ersattning",
    rubrik: "Order har ett ordervärde, och säljchefen får sin del automatiskt",
    ingress:
      "Välj paketet så räknas både ordervärde och provision fram. Säljchefen får sin procent på det som blir över — och en egen sats när hen säljer själv.",
    text: `Fram till nu visste navet vad en order **gav i provision**, men inte
vad den var **värd**. Nu vet det båda, och två nya tal följer med.

**Ordervärdet räknas fram ur paketet**

Välj Paket 1 och 12 månader, så står det **11 940 kr** i formuläret innan du
sparar — månadspriset gånger avtalstiden. Du behöver inte skriva något: siffran
kommer ur paketpriset, och den fryses på ordern när den godkänns precis som
provisionen gör.

Faller affären utanför paketreglerna kryssar du i rutan och skriver in **både
ordervärdet och provisionen**. Rutan finns nu också på **Godkänn**-knappen i
kön, inte bara när du lägger in en färdig order själv — en order säljaren
skickat in gick tidigare bara att godkänna med matrisens belopp.

**Säljchefen får sin del av det som blir över**

På en order som någon annan tecknat räknas säljchefens ersättning på **det som
återstår när säljarens provision dragits av**:

> Paket 1, 12 månader. Ordervärde 11 940 kr, säljaren får 1 500 kr.
> Kvar: 10 440 kr. Tio procent av det = **1 044 kr** till säljchefen.

Beloppet syns i formuläret innan du sparar, och säljchefen får en notis när det
bokförs. Det dyker upp som en egen rad, **Övertäck**, i provisionsvyn — och
följer med i lönekörningen när månaden fastställs.

Är provisionen större än ordervärdet blir övertäcket **noll**, aldrig ett
avdrag. Det kan bara hända på en handsatt order, och rutan säger till när det
sker.

**När säljchefen säljer själv gäller en egen sats**

Då används varken paketmatrisen eller övertäcket, utan en procent på **hela
ordervärdet**. Samma order som ovan ger 40 % av 11 940 kr = **4 776 kr**. Inget
övertäck läggs till: satsen ersätter matrisen, den kommer inte utöver den.

**Båda satserna sätts på /provision/regler**

Säljchef och VD väljer mottagare, övertäcksprocent och sats för egen
försäljning — med ett räkneexempel som uppdateras medan du skriver. Satserna är
versionerade som allt annat: en ändring gäller order som godkänns därefter, och
rör aldrig en order som redan är godkänd eller en månad som är stängd.

**Ordervärde per säljare och för hela bolaget**

/provision har ett nytt kort: **Ordervärde**, netto efter makuleringar, med
snittet per order. Det följer periodväljaren och personväljaren som resten av
tavlan. I chefens lagtavla står det som egen kolumn bredvid intjäningen.

De två talen ligger avsiktligt isär och summeras aldrig: ordervärdet är vad
affärerna är värda för bolaget, intjäningen är pengar till personal.

**Order som lades in före det här saknar ordervärde.** De visas som "—" i
stället för 0 kr, och vyerna skriver ut hur många de är så att en summa aldrig
ser mer fullständig ut än den är. En godkänd order skrivs aldrig om i
efterhand.`,
    datum: "2026-09-09",
    // TOM LISTA = ALLA. Ordervardet syns i saljarens eget orderformular och pa
    // hens egen orderrad, sa posten galler bredare an de tva satserna gor.
    roller: [],
    href: "/order",
  },
  {
    slug: "menyn-i-tva-led",
    rubrik: "Menyn följer avdelningarna, och panelen kan fällas ut när du hovrar",
    ingress:
      "Bara det du gör varje dag står framme. Resten ligger under Försäljning, Ekonomi, Personal och System — och panelen har fått ett tredje läge som fäller ut sig när musen är över den.",
    text: `Sidopanelen hade vuxit till arton poster. Alla hörde hemma där, men
arton likadana rader i en spalt är inte en meny — det är en lista man läser
varje gång i stället för att sikta.

**Framme står det du gör varje dag**

Hem, Nyheter, Rutiner, Utbildning och Tid. Ingenting annat.

**Resten ligger i avdelningarnas menyer**

Under snabbposterna står menyerna. **För musen över en** så fälls en spalt ut
bredvid panelen med sidorna som hör dit — du behöver inte klicka. Klicket
fungerar förstås också, och är vägen in på telefon och med tangentbord.

- **Försäljning** — Order, K&V och Provision.
- **Ekonomi** — Lönerapport och Lönekostnad.
- **Personal** — Anställda, Coachning, Rekrytering och Avtal.
- **System** — händelseloggen, adoptionen och designsystemet.
- **Min vy** — det som bara handlar om dig och därför inte hör till någon
  avdelning: dina ärenden, din frånvaro och felrapporteringen.

**Din egen avdelning ligger överst**, närmast snabbposterna. Du ser bara de
menyer du har sidor i, och en meny du inte har någon sida i finns inte alls.

Spalten stänger sig när du valt en sida, när du för musen till en snabbpost i
stället, när du lämnar panelen, med Escape eller genom att klicka utanför.

Tillsammans med **Hovra**-läget nedan blir hela navet ett enda drag: för musen
mot vänsterkanten, panelen fälls ut, och menyn du siktar på öppnar sig.

**Menyerna följer avdelningen, inte din roll.** Order ligger under Försäljning
oavsett om du är säljare eller säljchef — sidan visar olika saker beroende på
vem som öppnar den, precis som förut, men den ligger på samma ställe för alla.
Det betyder också att en kollega kan säga "det ligger under Personal" och ha
rätt.

**Du har inte fått eller förlorat någon behörighet.** Exakt samma sidor som
igår, på nya platser.

**Personalregistret heter nu Anställda.** Samma sida, samma adress — men menyn
det ligger i heter Personal, och "Personal → Personal" läser som ett fel även
när det inte är det.

**Panelen har tre lägen**

Längst ner i panelen, och under Inställningar → Utseende:

- **Utfälld** — som förut, panelen står kvar med ikoner och text.
- **Hopfälld** — bara ikoner, mest plats åt innehållet.
- **Hovra** — *ny.* Panelen ligger smal, men fäller ut sig så fort du för musen
  över den och åker in igen när du lämnar den. Du får hopfällt lägets yta utan
  att behöva gissa vad ikonerna betyder.

I hovra-läget svävar panelen över sidan i stället för att knuffa den åt sidan.
Texten du läser ligger alltså still även när menyn rör sig.

Läget sparas i den här webbläsaren. På telefonen är panelen som förut en låda du
drar in, och där fäller menyerna ut sig på plats i listan i stället för bredvid.`,
    datum: "2026-09-09",
    roller: [],
    href: "/",
  },
  {
    slug: "order-i-faststalld-manad",
    rubrik: "En order som godkänns för sent tappar inte längre sin provision",
    ingress:
      "Godkänner du en order vars månad redan är fastställd bokförs provisionen på den öppna månaden i stället — förut försvann den tyst.",
    text: `En order hör till den månad den **signerades** i, och en månad som är
fastställd räknas aldrig om. Godkändes ordern efter att månaden stängts fanns
det alltså ingenstans för pengarna att ta vägen — och ingenting sa ifrån.

Det hände på riktigt den 8 september: en order signerad 25 augusti godkändes två
timmar efter att augusti fastställts. 6 500 kr intjänade, godkända, och osynliga
för lönekörningen.

**Nu bokförs provisionen på den öppna månaden i stället**, med en anteckning om
vilken månad ordern hör till. Ordern behåller sitt signeringsdatum — det är bara
pengarna som flyttar.

**Om du godkänner order:** står ordern i en fastställd månad ser du det i kön
*innan* du trycker, med besked om vad som kommer att hända.

**Om du säljer:** notisen i klockan säger vilken månad beloppet hamnar på, så
siffran inte dyker upp i fel månad utan förklaring.

Att neka godkännandet vore fel svar — ordern är en riktig affär, och en affär
som inte går att registrera försvinner inte, den blir ett mejl till någon.

Ingen volymbonus räknas på posten: bonusen hör till den månad ordern tecknades,
inte till den den bokförs i.`,
    datum: "2026-09-08",
    roller: [],
    href: "/order",
  },
  {
    slug: "provisionsvyn-som-resultattavla",
    rubrik: "Provisionen visar nu dagen, takten och vägen till nästa bonus",
    ingress:
      "Månadens siffra står överst i stor stil med bonustrappan under. Nya kort för dagen, takten och målet — och en väljare för period och person.",
    text: `**/provision** var en huvudbok — historik, perioder och ett
bokföringsformulär. Den är nu en resultattavla, och svarar i den ordning man
faktiskt frågar.

**Överst i panelen: vilken månad, och vems siffror**

Alla kan byta **period** — tolv månader bakåt, plus **Hela 2026** och
**Hela 2025**.

Perioden är alltid hela månader och aldrig ett fritt datumspann. Volymbonusen är
en egenskap hos hela månaden: ett spann som "1–15 september" har ingen bonusnivå
att visa, för de pengarna finns inte förrän månaden är slut.

I en **årsvy** räknas varje månad för sig, med sin egen trappa och sin egen
sanning — en fastställd månad är bokförd, en öppen räknas live — och summan
bildas av de tolv. Staplarna blir en per månad, och panelens fyra tal blir
årets: månader med order, bästa månaden, månader med bonus och snitt per månad.
Ett år har ingen egen bonusnivå: tolv månader med fyra order ger noll bonus
tolv gånger, medan samma fyrtioåtta order i EN månad ger nivå 20.

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
