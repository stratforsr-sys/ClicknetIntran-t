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
    slug: "avtalsslut-och-tjanster",
    rubrik: "Navet säger till när en kunds avtal löper ut",
    ingress:
      "Nittio dagar innan bindningstiden tar slut hör klockan av sig — så att någon hinner ringa och förlänga innan kunden hinner tänka om.",
    text: `Varje order bär nu ett **slutdatum**. Det räknas ur när avtalet börjar gälla
plus bindningstiden, och det står på orderkortet från den dag ordern läggs.

## Påminnelsen

Nittio dagar innan avtalet tar slut dyker kunden upp i klockan och i
morgonbrevet, med telefonnumret framme. Du ser dina egna kunder; säljledningen
ser allas.

**Posten slocknar inte av att datumet passerar.** Ett avtal som gick ut förra
veckan ligger kvar överst — kunden är fortfarande kund, och det enda som hänt är
att ingen hann ringa. Det som släcker påminnelsen är att du bokför vad som
hände:

**Förläng.** Knappen öppnar orderformuläret med kundens uppgifter ifyllda. Paket,
bindningstid, säljare och datum står tomma — det är en ny förhandling. När den
nya ordern är lagd kopplas den ihop med den gamla, som slutar påminna. Och
eftersom förlängningen är en riktig order ger den provision som vilken affär som
helst.

**Kunden förlänger inte.** Då skriver du varför, med egna ord. Orsaken är
obligatorisk, och skälet till det är att en lista över varför kunder lämnar är
det enda ställe ett mönster kan visa sig.

## Ordern börja gälla-datum

Ett avtal signeras ofta innan det börjar löpa. Därför finns ett eget fält —
**Avtalet börjar gälla** — och det är därifrån slutdatumet räknas. Vill du ha
samma datum som signeringen finns en knapp för det.

## Tjänster på ordern

Du kan lägga till hur många tjänster du vill på en order: namn, om det är en
**engångsavgift eller månadsavgift**, och beloppet. Värdet räknas in i
ordervärdet, alltså också i provisionen.

En tjänst följer normalt huvudavtalets bindningstid. Har den en **egen** — en
växel på 36 månader under ett tvåårsavtal — får den ett eget slutdatum och en
egen påminnelse. Annars hade den löpt ut tyst.

## Order som inte följer paketreglerna

Kryssrutan öppnar nu **månadsbelopp** och **fri bindningstid** i stället för ett
ordervärde du räknar ut själv. Skriv vad kunden betalar i månaden och hur många
månader — resten räknas fram, och avtalet får ett slutdatum som går att bevaka.
Bindningstiden får vara 1–60 månader; en paketorder håller sig till 12, 24
eller 36, eftersom provisionsmatrisen bara känner de tre.

## Inga förvalda fält

Inget i orderformuläret är ifyllt i förväg längre — inte säljaren, inte paketet,
inte datumet, inte "godkänn direkt". Ett förvalt fält ser likadant ut som ett du
fyllt i, och säljaren avgör vems provision affären blir. Det kostar några klick
till per order, och ingen order kan längre bli fel av att du inte gjorde något.

Avtalet går dessutom att ladda upp direkt i formuläret, så fort ordern är
sparad.`,
    datum: "2026-09-24",
    roller: ["salesperson", "sales_manager", "ceo", "finance"],
    href: "/order",
  },
  {
    slug: "skriftligt-prov-saljstruktur",
    rubrik: "Skriftligt prov: Säljstruktur — tjugo frågor du svarar på med egna ord",
    ingress:
      "Ingen kryssruta och ingen maskin som rättar. Du skriver svaren själv, din chef läser varje ett, sätter poäng och skriver tillbaka.",
    text: `Under **Utbildning** ligger en ny kurs: **Säljstruktur**. Den består av ett
enda moment — ett skriftligt prov med tjugo frågor om intro, intresseväckare,
behovsanalys, ROI, presentation och avslut.

## Det som är nytt är formen

Proven i navet har hittills haft svarsalternativ, och servern har rättat dem i
samma sekund du tryckt. **Det här provet har inga alternativ.** Frågorna är
sådana att svaret inte går att känna igen — det går bara att formulera. "Vad
vill du uppnå med intresseväckaren?" har inte fyra svar där ett är rätt.

Därför rättas det av en människa. Varje svar ger **noll, en eller två poäng**:
två för ett svar som håller, en för ett halvt, noll för ett som inte svarar på
frågan. Godkänt är 70 procent, alltså 28 av 40 poäng.

## Du kan gå ifrån provet

Tjugo fritextsvar tar sin tid. **Svaren sparas medan du skriver** — du ser i
överkanten när det senast skedde — och provet lämnas in först när du själv
säger till. Fram till dess går allt att ändra.

Räknaren överst visar hur många frågor som är besvarade. Inlämningsknappen
öppnar sig när alla tjugo har ett svar.

## Efter inlämningen

Provet går till säljledningen. Två saker kan hända:

**Det rättas.** Du får ett besked i navet med poängen, en återkoppling på hela
provet och — där chefen skrivit något — en kommentar vid enskilda svar. Godkänt
ger ett certifikat som gäller i tolv månader.

**Det skickas tillbaka.** Säger ett par svar för lite för att gå att bedöma får
du provet åter med besked om vad som ska fyllas på. **Dina svar ligger kvar** —
du kompletterar där han bett om det, i stället för att skriva om alltihop.

Blir provet underkänt gör du om det. Ett nytt försök börjar med tomma rutor, och
det förra ligger kvar i historiken — underkänt är lika mycket ett resultat som
godkänt.

## För dig som är chef

Knappen **Skriftliga prov** på utbildningssidan öppnar kön. **Alla chefer ser
alla prov**, inte bara sitt eget lag: du sätter poäng fråga för fråga, ser
summan och procenten växa fram medan du rättar, och skriver återkopplingen
längst ned. Den är obligatorisk — ett betyg utan ord lär ingen sig något av.`,
    datum: "2026-09-24",
    roller: [],
    href: "/utbildning",
  },
  {
    slug: "delade-uppgifter-syns-nu",
    rubrik: "Uppgifter du bjudits in i syns nu — förut gjorde de inte det",
    ingress:
      "Är du redigerare hamnar uppgiften bland dina egna, under Idag och Alla mina. Är du visare eller granskare ligger den i den nya fliken Delat med mig.",
    text: `Det här är en rättelse och inte en nyhet, så den börjar med vad som var fel.

## Vad som inte fungerade

När någon bjöd in dig i en uppgift fick du **ingenting**. Ingen rad i någon
lista, ingen post i klockan, inget i morgonbrevet. Uppgiften fanns, du hade
behörighet att öppna den, och om du var redigerare fick du dessutom ändra och
bocka av den — men det fanns ingen väg fram till den i navet. Enda sättet att
komma dit var att någon skickade dig adressen.

Det gällde alla tre rollerna, och det hade gällt sedan uppgiftsmodulen byggdes.
Har du undrat varför en kollega inte hörde av sig om något du delade: det var
därför, och det var inte hen som missade det.

## Vad som gäller nu

**Är du redigerare ligger uppgiften bland dina egna.** Den står under **Idag**
när fristen är inne, i **Alla mina**, på startsidan, i veckogenomgången och i
morgonbrevet — precis som en uppgift du tilldelats. Du får också ett besked i
klockan när den läggs på dig, och det försvinner av sig självt så fort du börjat
arbeta i den.

**Är du visare eller granskare finns en ny flik: Delat med mig.** Där står det
du bjudits in i men inte ansvarar för, med namnet på den som gör jobbet. En
granskare ser uppgiften där fram till att den lämnas in — sedan flyttar den till
**Att granska**, där den hör hemma.

**Ingen rad står på två ställen**, och inget av det här ändrar vem som får se
vad. Behörigheterna är desamma som förut; det är listorna som nu visar det du
alltid haft rätt att se.

## Om du vill att någon ska GÖRA en uppgift

Sätt hen som **ansvarig** — det är fortfarande skillnaden som betyder något. Att
bjuda in ger insyn och, för en redigerare, rätten att arbeta i den; att tilldela
säger vems den är. Bara en person kan vara ansvarig, och det är med flit.`,
    datum: "2026-09-23",
    roller: [],
    href: "/uppgifter",
  },
  {
    slug: "veckogenomgang-och-uppgiftsmallar",
    rubrik: "Veckogenomgång på fredagar — och mallar för det du gör om igen",
    ingress:
      "Två saker i uppgifterna: en genomgång i fem steg som tar en kvart på fredagen, och checklistor som blir riktiga uppgifter med rätt datum.",
    text: `Två saker som hör ihop. Den ena städar veckan som var, den andra gör att
nästa vecka inte behöver byggas från början.

## Veckogenomgång

**På fredagen dyker det upp ett kort på uppgiftssidan** och en rad i klockan.
Den leder till en genomgång i fem steg, och hela poängen är att den tar slut.

1. **Förfallet** — det vars frist gått ut. Flytta till en dag eller stryk, på
   raden.
2. **Inkorgen** — allt du skrivit ner utan att ge det en dag. En uppgift med ett
   utskrivet NÄR blir gjord ungefär dubbelt så ofta som en utan; det här steget
   finns bara för att göra det.
3. **Väntar på andra** — det du lämnat ifrån dig som stått still i tre dygn
   eller mer. Du kan skriva en påminnelse direkt i listan; den hamnar i
   uppgiftens tråd så att både du och mottagaren ser den efteråt.
4. **Projekt som stannat** — projekt utan en enda öppen uppgift. Antingen
   färdiga eller glömda, och båda kräver att någon säger det.
5. **Nästa vecka** — hur många timmar som redan ligger på varje dag. Sex timmar
   är taket; en dag över det ritas i varningsfärg.

**Du kan bokföra genomgången även om något står kvar.** Kvittot säger hur
mycket — "3 kvar" är ett val, och något helt annat än att inte ha gjort den.
Kortet slocknar så fort veckan är bokförd och kommer tillbaka nästa fredag.

**Ingen annan ser din genomgång.** Inte din chef heller. En lista över vilka i
laget som betat av sin vecka hade gjort det här till något man gör för att det
mäts, och då slutar det fungera.

## Mallar

Under **Uppgifter → Mallar** skriver du en checklista en gång och använder den
hur många gånger som helst. En mall är rader med dagar:

    Välkomstsamtal | 0 | 30 | 09:00 | 2
    Skicka avtalet | 1 | 15
    Stäm av att avtalet kom fram | 3
    Uppföljning efter första veckan | 7 | 30

Rubrik, dagar efter start, minuter, klockslag, prioritet. **Bara rubriken
krävs** — "Ring kunden" är en fullt giltig rad.

**Du väljer mall och en startdag, och får riktiga uppgifter** — inte en
påminnelse om att göra dem. Datumen räknas från startdagen, så samma mall
fungerar för kunden som börjar i mars och för den som lades upp i efterhand.
Innan du trycker står varje datum utskrivet, så en rad som råkat hamna på dag
365 syns innan den hamnar i någons lista.

Uppgifterna som skapas är vanliga uppgifter: de går att ändra, flytta, bocka av
och koppla som alla andra. Ändrar du mallen efteråt rör det inte det som redan
skapats.

**Mallar är delade som förval** — kryssrutan står framme när du sparar, och du
kan kryssa ur den om checklistan bara är din.

**Lägger du en mall på en kollega får hen ett besked**, men ett och inte sex.`,
    datum: "2026-09-22",
    roller: [],
    href: "/uppgifter/genomgang",
  },
  {
    slug: "utbildning-slapp-inte-kunden",
    rubrik: "Ny utbildning: släpp inte kunden för tidigt",
    ingress:
      'Tre dagars drill mot reflexen att lägga på när kunden säger "vi kör redan Bokadirekt" — fem övningar du gör på plats, fyra prov och ett inspelat testsamtal.',
    text: `Kunden säger "vi kör Bokadirekt", och samtalet tar slut. Inte för att kunden
sa nej — utan för att du hörde ett nej som inte fanns där.

Under **Utbildning** ligger nu en kurs som tränar bort en enda reflex och lär in
en enda i stället: **motstånd betyder en fråga till.**

**Kursen går inte att läsa igenom.** Efter varje läsmodul ligger en övning du
gör på plats, på fem minuter, och nästa modul öppnar sig inte förrän den är
avbockad. Femton moduler: läsa, göra, prövas — tre varv.

**Tre dagar, 20–30 minuter om dagen.**

- **Dag 1** — trettio motstånd, trettio följdfrågor. Du spelar in tio av dem,
  lyssnar på dig själv och räknar hur många som blev riktiga frågor och hur
  många som blev pitchar med ett frågetecken efter.
- **Dag 2** — tre lager djupt. Du skriver två kedjor på papper och stryker under
  varje ord du lånat ur kundens svar. Går inget att stryka under är det ett
  förhör och inte en kedja.
- **Dag 3** — motstånd i slumpmässig ordning, tre sekunders betänketid. Och var
  gränsen går: kursen tränar dig att inte släppa för tidigt, inte att aldrig
  släppa. Tre av de tio du får är riktiga nej, och dem ska du höra.

**Sluttestet är ett riktigt samtal.** Fem minuter med chefen eller en kollega
som spelar kund, inspelat och uppladdat här i navet. Du bedöms mot åtta
kriterier — som du ser innan du spelar in, inte efter. Godkänt ger ett
certifikat som gäller i ett år.

Däremellan ligger fyra prov på sammanlagt 46 frågor. **De går inte att gissa
sig igenom:** i de flesta frågorna är tre av fyra svar riktiga följdfrågor, och
i några är rätt svar att avsluta samtalet.

Gränsen är 80 procent. **Missar du får du se exakt vilka frågor som blev fel**
och kan göra om provet direkt — men vilket svar som var det rätta visas först
när du klarat provet. Annars hade omtaget bara varit att skriva av.

**Du behöver** en telefon som spelar in, något att skriva på, och en kollega i
tjugo minuter på dag 2.`,
    datum: "2026-09-22",
    roller: ["salesperson", "team_lead"],
    href: "/utbildning/slapp-inte-kunden-for-tidigt",
  },
  {
    // SLUGGEN ÄR ORÖRD MED FLIT. Den bär avfärdningen i
    // `notification_dismissed`, så en ändring hade väckt posten till liv igen
    // för alla som redan läst den. Texten är däremot vidgad samma dag den kom
    // ut: den sa "inget annat har flyttat", och en timme senare flyttade allt
    // annat också. Ett felaktigt besked som står kvar är värre än ett som
    // rättas.
    slug: "inspelningarna-har-flyttat",
    rubrik: "Navets filer har flyttat — allt fungerar som förut",
    ingress:
      "Inspelningar, läkarintyg, orderbilagor, dokumentbilagor och rollspel ligger inte längre i samma lagring som förut. Du märker ingen skillnad: samma spelare, samma uppladdning, samma regler. Säg till om något inte går att öppna eller ladda upp.",
    text: `**Det här är en flytt under golvet, inte en ny funktion.** Samtalen
ligger kvar på ordern, spelaren ser likadan ut, uppladdningsknapparna sitter
där de satt, och du gör ingenting annorlunda. Att det ändå står här är för att
du ska veta vad som hänt om något strular — och vem du ska säga det till.

**Varför:** lagringen navet använde är full. Ungefär 350 samtal om dagen
spelas in, och bara de tar drygt 200 MB per arbetsdag. Allt navet lagrar —
inspelningar, läkarintyg, orderbilagor, dokumentbilagor och rollspel — skrivs
nu till en egen lagring inom EU, byggd för just det här. Filer som redan
fanns ligger kvar där de låg och fungerar precis som förut.

**Inspelningar sparas i 30 dagar.** Det är samma regel som förut, men den är
värd att upprepa: ett samtal som **inte** hör till en order får sitt ljud
raderat efter 30 dagar. Samtalet självt står kvar — tid, längd, motpart och
vem som ringde — men det går inte längre att lyssna på.

**Hör samtalet till en order raderas ljudet aldrig.** Så fort ett samtal
kopplats till en affär tas fristen bort, och inspelningen ligger kvar. Är det
ett samtal du vet att du kommer att behöva: se till att det sitter på ordern.

**Om något inte fungerar** — ett samtal som inte spelas upp, en spelare som
står tyst eller tar slut mitt i, en fil som inte går att ladda upp eller öppna
— rapportera det via Fel och förbättringar. Det är värt att veta snabbt just
nu, medan flytten är ny.`,
    datum: "2026-09-21",
    roller: ["salesperson", "team_lead", "sales_manager", "ceo", "finance"],
    href: "/order",
  },
  {
    slug: "upprepade-uppgifter",
    rubrik: "Uppgifter som återkommer — varje dag, varje vardag eller vissa veckodagar",
    ingress:
      "Kryssa i ”Återkommer” när du lägger in något i kalendern, så läggs det upp åtta veckor framåt. Ändrar du en av dem frågar navet om det gäller bara den dagen eller hela rutinen.",
    text: `**Rutiner behövde skrivas in en gång i veckan.** Nu skriver du dem en gång.

Tryck på en tom tid i kalendern som vanligt och kryssa i **Återkommer**. Dagen du
klickade på är redan förvald som veckodag — klickar du i måndagens ruta blir det
en måndagsrutin utan att du väljer måndag en gång till.

**Tre mönster.** Varje dag, varje vardag, eller vissa veckodagar — du kryssar i
dem du vill ha, en eller flera. Ett slutdatum går att sätta men behövs inte;
utan det löper rutinen vidare.

**Det som läggs upp är riktiga uppgifter.** Åtta veckor framåt står de i
kalendern direkt, och navet fyller på efter hand. Var och en går att flytta,
bocka av, kommentera och koppla precis som vilken uppgift som helst — de är
uppgifter, inte en regel som ritas ut.

**Ändrar du en av dem frågar navet vad du menar.** ”Bara den här förekomsten”
flyttar måndagen den 5:e till klockan tio och lämnar resten i fred. ”Hela
serien” skriver om alla kommande. Den förekomst du en gång ändrat för sig står
kvar som du lämnade den, även när du senare ändrar hela serien.

**Bara den närmaste säger till.** Åtta veckors uppgifter skulle annars ha blivit
åtta rader i klockan på en gång. Det som står på tur plingar; resten är tysta
tills det blir deras tur.

**Coachningsuppgifter kan också återkomma.** Lägger du upp en veckorutin åt en
säljare ser hon den i sin kalender och på sitt coachningskort — en i taget, inte
alla åtta på måndagsmorgonen.

**Vill du sluta?** Öppna en av uppgifterna och tryck **Avsluta rutinen**.
Kommande förekomster som ingen rört tas bort; dagens, tidigare och allt någon
börjat på eller bockat av står kvar. Historiken skrivs aldrig om.

En sak den INTE gör: den tar ingen hänsyn till ledighet eller röda dagar.
Landar en förekomst på en dag du är ledig ligger den kvar där — det är ditt val
om den ska flyttas eller bockas bort.`,
    datum: "2026-09-17",
    roller: [],
    href: "/kalender",
  },
  {
    slug: "utkop-och-orderformularet",
    rubrik: "Utköp på affären — och ett orderformulär som inte längre tappar det du skrivit",
    ingress:
      "Lägg in utköpet direkt på ordern så räknas provisionen på det som blir kvar. Samtidigt: kommentaren är inte längre obligatorisk, fälten står kvar när något blir fel, och datumet säger vilken månad ordern hamnar i.",
    text: `**Har affären ett utköp?** Kryssa i rutan och skriv beloppet. Det dras
från ordervärdet, och säljaren får **12 % av det som blir kvar** i stället för
matrisens belopp. Rutan under formuläret visar hela räkningen medan du skriver:
ordervärdet, avdraget, vad som är kvar, provisionen och övertäcket.

Ett exempel: ordervärde 20 000 kr, utköp 5 000 kr. Kvar blir 15 000 kr, och
säljaren får 1 800 kr. Ordervärdet står kvar på 20 000 kr på ordern — det är vad
kunden tecknat, och det är det avtalet säger. Utköpet står bredvid, med sitt eget
minustecken.

**Kommentaren är inte längre obligatorisk.** Sätter du ordervärde och provision
för hand går ordern igenom utan att du skriver ett skäl. Fältet står kvar, och
det är fortfarande värt att fylla i — det är nästa person som läser det — men det
stoppar dig inte längre.

**Och det du skrivit står kvar.** Blir något fel återställs inte formuläret
längre. Datumet, beloppen, kunduppgifterna — allt ligger kvar precis som du
lämnade det, och du rättar bara det som var fel. Tidigare tömdes allt, och
signeringsdatumet hoppade tillbaka till i dag utan att säga till. Det gick att
lägga en augustiorder som tyst hamnade i september.

**Datumet säger nu vilken månad ordern hamnar i.** Under signeringsdatumet står
en rad: *"Räknas på augusti 2026."* Är den månaden redan fastställd blir raden en
varning som säger vad som kommer att hända — att ordern hör dit, men att
provisionen bokförs i den öppna månaden. Du ser det innan du trycker.

**Mejl på ordern.** Kundens mejladress har fått en egen rad, bredvid telefonen.
Den är frivillig, och order som lades in tidigare har ingen.

**Volymbonusen räknas nu per affär.** Nivåerna stod som ett engångsbelopp när
nivån nåddes — sex order gav 200 kr. Nu ger varje affär sin bonus: sex order på
nivå 5 ger 1 200 kr. September räknas om; stängda månader står orörda.`,
    datum: "2026-09-15",
    roller: [],
    href: "/order",
  },
  {
    slug: "slutdatum-i-kalendern",
    rubrik: "Projektens deadline syns i kalendern, och chefen ser coachningen",
    ingress:
      "Sätter du ett slutdatum på ett projekt står det nu som en frist i din dag. Och lägger du upp en coachningsuppgift åt någon ser du den i hennes kalender, på sitt klockslag.",
    text: `Två slutdatum som fanns i navet men inte i kalendern har hittat dit.

**Projektets deadline står i dagen.** Datumet du satt på projektet syntes bara
på projektkortet. Nu ligger det som en frist i kalendern den dagen — i din egen
dag, och i alla projektmedlemmars. Ett arkiverat projekt står inte kvar.

**Den räknas INTE in i "planerat 4 h av 6 h".** Uppgifterna inuti projektet
räknas redan var för sig, och hade projektet räknats med hade samma arbete
räknats två gånger. En deadline är en vägg, inte ett arbetspass — den ritas i
samma färg som orderfristen av just det skälet.

**Coachningsuppgiften syns i personens kalender.** Den som fått uppgiften har
alltid sett den i sin egen dag. Nu ser också **du som lade upp den** den när du
öppnar hennes kalender, med rubrik, klockslag och en väg in i uppgiften.

**Bara chefen ser den.** En kollega som inte är chef ser ingenting alls — inte
ens att tiden är tagen. Det är ett medvetet val: att någon har coachning
klockan två är känsligare än att hon har ett möte. Priset är att en kollega kan
råka boka den tiden.

**En uppgift utan klockslag ritades två gånger** — en gång överst bland
heldagsposterna och en gång i raden "Idag utan klockslag". Nu står den bara på
det ena stället, det du kan dra ifrån.`,
    datum: "2026-09-15",
    roller: [],
    href: "/kalender",
  },
  {
    slug: "ny-post-i-kalendern",
    rubrik: "Skriv in något direkt i kalendern",
    ingress:
      "Tryck på en tom tid i dagen, så öppnas ett formulär med dag och klockslag ifyllda. Välj om det ska bli en uppgift eller — om du coachar någon — en coachningsuppgift.",
    text: `Kalendern har fått en väg in. Tryck på **Ny post**, eller rakt på en tom tid
i rutnätet, så öppnas ett litet formulär med dagen och klockslaget redan
ifyllda.

**Överst väljer du vad posten ska bli.** Det avgör resten av fälten, och därför
står valet först.

**"Uppgift"** lägger upp den i din egen lista, precis som om du skrivit den på
Uppgifter — med rubrik, prioritet, klockslag och hur lång tid du tror att den
tar. Tiden du fyller i räknas in i "Planerat 4 h av 6 h" under dagen.

**"Coachningsuppgift"** syns bara för dig som är teamledare, säljchef eller VD,
och den lägger upp uppgiften åt någon du är chef för. Alla coachningens egna
fält finns med: vad det är för sorts moment, vilken kurs, modul eller rutin den
hänger på, vem som är motpart, vem som kvitterar och vad som krävs för att få
bocka. Uppgiften hamnar i **hennes** kalender och på hennes coachningskort — inte
i din — och det står utskrivet i formuläret.

**Coachningsuppgifter syns nu i kalendern.** Tidigare stod bara
coachnings*samtalen* där. Nu ligger uppgifterna med, på sitt klockslag om de har
ett, och de plingar tio minuter innan precis som vanliga uppgifter.

**Kalendern bokar fortfarande inga möten.** Det som skapas är ingen
kalenderhändelse för sig — det ÄR en uppgift eller en coachningsuppgift, och den
bor i sin egen modul med sin egen historik. Kalendern är fönstret, inte lådan.`,
    datum: "2026-09-14",
    roller: [],
    href: "/kalender",
  },
  {
    slug: "kalendern",
    rubrik: "Kalendern: lägg ut dagen genom att dra",
    ingress:
      "Uppgiftslistan till vänster, dagen till höger. Dra en uppgift till ett klockslag och se direkt hur mycket du planerat. Ledighet, coachningssamtal och frister ligger redan där.",
    text: `Navet har fått en kalender, och den är byggd för att planeras i.

**Planeringsvyn är huvudvyn.** Till vänster står allt du har öppet — det
försenade först, sedan det som saknar dag. Till höger står dagen. **Dra en rad
till ett klockslag**, eller tryck på raden och sedan på tiden om du sitter vid
en pekskärm.

**"Planerat 4 h av 6 h"** står under dagen. Sex timmar och inte åtta är med
flit: två timmar av en arbetsdag går åt till avbrott och sådant som dyker upp,
och den som fyller alla åtta planerar att misslyckas. Uppgifter utan
tidsuppskattning räknas som noll och redovisas separat — talet ska vara det du
faktiskt lovat dig själv, inte en gissning.

**Det navet redan vet ligger där automatiskt.** Beviljad ledighet,
coachningssamtal, dina kursfrister och den sista dagen i månaden en order
räknas till månadens provision. Ingenting av det behöver läggas in.

**Kalendern bokar inga möten.** Det finns ingen inbjudan och inga ja/nej-svar —
möten bor kvar i Outlook. Det här är din egen dag och dina egna åtaganden.

**Alla ser när alla är upptagna.** Det är grundläget och går inte att stänga av;
det är hela poängen med en delad kalender. Vad tiden *gäller* ser bara den du
säger till, och det finns fem nivåer att välja mellan — från "kan se rubriker"
till "delegat", som arbetar som du. Du hittar dem under **Delning** på
kalendersidan.

**Pling i webbläsaren.** Slå på det med knappen på kalendersidan så får du en
påminnelse tio minuter innan en uppgift ska börja — så länge du har navet öppet
i en flik. Inställningen gäller den webbläsaren, så du får säga ja en gång per
enhet.`,
    datum: "2026-09-14",
    roller: [],
    href: "/kalender",
  },
  {
    slug: "navet-mejlar",
    rubrik: "Navet mejlar dig när något faktiskt kräver att du gör något",
    ingress:
      "Ett brev på morgonen med det som väntar, och ett direkt när något brådskande händer — en makulerad order, en inställd ledighet, ett nytt schema.",
    text: `Notisklockan har ett problem: den syns bara för den som öppnar navet. Den
som redan har koll loggar in ändå, och den som glömt bort något gör det inte.
Nu når navet dig även när du inte är inne.

**Ett brev på morgonen, de dagar du har något som väntar.** Inte varje dag —
ett brev som oftast är tomt är ett brev man filtrerar bort, och då försvinner
även det som betydde något. Brevet samlar allt i ett: försenade uppgifter,
dagens uppgifter, det som väntar på ditt godkännande, ledighetsansökningar du
ska besluta om, coachningsuppgifter som passerat fristen, utbildning du inte
påbörjat och rutiner du äger som ska granskas.

**Och ett brev direkt när något brådskar.** De här går ut i samma sekund de
händer:

- din order har **returnerats** eller **makulerats**
- en **godkänd ledighet har ställts in** eller dragits tillbaka
- du har fått ett **nytt schema**
- ett **ärende har tilldelats dig**, eller ditt ärende har fått ett beslut
- en **rättelse av din stämpling** har beslutats
- dina **minuter har justerats** efter att löneperioden låstes
- du har **tilldelats en uppgift**

**Glömt stämpla in?** En kvart efter att ditt skift börjat säger navet till —
både i klockan och per mejl — så att du kan rätta det medan dagen är kvar. Är
du ledig, sjukanmäld eller registrerad som frånvarande hör du ingenting.

**Det du INTE får mejl om** är allt som gick bra: godkända order, godkända
uppgifter, bokförd provision, nya kollegor, nyhetsinlägg. Det står kvar i
klockan. Ett mejl ska betyda att du behöver göra något — annars slutar det
betyda något alls.

*Breven kommer från nav@clicknet.se. Svara inte på dem — allt finns i navet.*`,
    datum: "2026-09-14",
    roller: [],
    href: "/uppgifter",
  },
  {
    slug: "samtal-pa-ordern",
    rubrik: "Samtalen ligger på ordern, med inspelning",
    ingress:
      "Varje order visar samtalen till kundens nummer — hela historiken, inte bara det sista — och inspelningen går att spela direkt på sidan.",
    text: `Öppna en order. Under kunduppgifterna står nu en rad som säger hur många
samtal affären har och hur lång sammanlagd taltid. Klicka på den så fälls
listan ut.

**Alla samtal, inte bara de sista.** Navet parar ihop samtal och order på
kundens telefonnummer, utan bortre gräns bakåt. Ringde du kunden fem gånger
under tre veckor innan det gick i lås ligger alla fem där — också det första,
som ofta är det intressantaste.

**Köpte kunden två gånger?** Då delas samtalen mellan affärerna: de som ringdes
innan den första ordern hör till den, och de som kom mellan affärerna hör till
den andra. Det är de samtalen som ledde dit.

**Inspelningen spelas på sidan.** Tryck på play i listan. Varje uppspelning
skrivs i åtkomstloggen precis som när någon öppnar ett läkarintyg eller ett
avtal — den som lyssnar syns.

**Vem ser vad:** du ser dina egna samtal, din chef ser sitt lag, säljchef och VD
ser huset. Dessutom ser den som får hantera affären samtalen som hör till just
den — ett ordersamtal är bevis på det muntliga avtalet och hör hemma hos den
som sköter ordern.

*Inspelningar av samtal som inte leder till en order sparas i trettio dagar och
raderas sedan automatiskt. Blir samtalet en affär sparas det så länge affären
finns.*`,
    datum: "2026-09-14",
    roller: [],
    href: "/order",
  },
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
