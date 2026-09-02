# Läs detta först

Kort överlämning mellan sessioner. `docs/ARBETSLOGG.md` har hela historiken och
varför-resonemangen; det här är bara läget just nu och vad som står på tur.

**Senast uppdaterad:** 2026-09-02 — inloggningen efter tvingat lösenordsbyte rättad

## Rättat 2026-09-02: nyanställda fastnade på "Väntar på aktivering"

Var och en som bytte sitt tillfälliga lösenord landade på AC-1.2-skärmen i
stället för i navet, i upp till en timme. Flaggan `byt_losenord` togs bort hos
Auth men fanns kvar i den redan utfärdade tokenen, och migration 0017:s spärr i
databasen läser den **ur tokenen** — alltså noll rader ur `employee`, alltså
`employee: null`. Mellanvaran, som frågar Auth direkt, tyckte samtidigt att allt
var i sin ordning.

`utforBytLosenord` förnyar nu sessionen efter att flaggan lyfts. Hela
resonemanget i `ARBETSLOGG.md` under 2026-09-02.

**Regeln att ta med sig:** allt som ligger i `app_metadata` finns på två ställen
med olika färskhet — hos Auth och i tokenen. Ändra aldrig något där utan att
fråga vad den gamla tokenen gör under den timme som återstår.

## Passet 2026-08-31 i korthet

**Den interaktiva onboardingen finns och startar av sig själv.** Beställningen
med alla beslut står i `docs/SYSTEMGUIDER.md`; hela resonemanget i
`ARBETSLOGG.md` under 2026-08-31.

Vad som är påslaget:

- **Startguiden** "Kom igång i navet" — tio steg, ~4 min, startar automatiskt
  vid första inloggningen och kommer tillbaka tills den är genomgången. Går att
  pausa, inte att hoppa över.
- **Femton modulguider** — rutiner, nyheter, ärenden, frånvaro, stämpling,
  avtal, fel, order, provision, K&V, personal, rekrytering, avvikelser,
  lönerapport, lönekostnad. Var och en startar första gången modulen öppnas,
  monterad av sidan själv med `<GuideVard slug="…" />`. Aldrig samtidigt som
  startguiden.
- **Utbildning → Systemguider** — listan, med "Gör om".
- **Utbildning → Översikt → Systemguider** — chefsvyn. Teamledaren ser sitt
  team, ledningen alla. Klara, pågående steg, senaste rörelse, läge och en
  Knuffa-knapp där den betyder något.
- **Onboardad sätts av systemet.** `employee.status` går `onboarding → active`
  när rollens alla guider är genomgångna. Personkortet speglar läget i en egen
  ruta som inte går att kvittera för hand.
- **Påminnelser.** 3 dygn utan rörelse ger en post i personens klocka, 7 dygn
  ger chefen en, en knuff ger en med chefens namn på. Passerad frist (14 dagar)
  ger ett **ärende** till närmaste chef via nattjobbet.
- Overlayen ligger i (app)-layouten och pekar på riktiga element via
  `data-guide`. `npm run test:guider` failar bygget om ett ankare försvinner.

**Två beslut ändrades 2026-08-31 och gäller framåt:** funktionsspärrarna är
**strukna** (`course.blocks_capability` används inte), och K12-uppdateringen
utgår. Bygg inga spärrar.

**Rör inte den här gränsen:** progressen räknas i guidens FULLSTÄNDIGA steglista,
aldrig i den synliga. Den synliga är olika på telefon och dator, och en position
räknad i den gör att den som byter skärm hoppar över ett steg eller får ett i
repris. Se rubriken i `src/lib/guider.ts` och provet som vaktar den.

**Modulguiderna pekar ut och förklarar — de skapar ingenting.** Det är den
ärliga halvan tills övningsläget finns; en guide som ber någon lägga en order på
riktigt lägger en riktig order. När G3 är byggd byggs momenten in i samma filer
och versionen höjs med `omtag`.

**Näst på tur: G3, övningsläget.** Det är det enda som återstår av
beställningen utöver textredigeringen (G7) och rutinerna i punkt 11.

Flagga `ovning` på order, avtal och ärende — men **INTE** på stämplingen, se
beslut 2 i SYSTEMGUIDER.md. Varje ställe som räknar eller listar måste fråga
efter `ovning = false`, och ett källkodsprov ska larma om en tabell med
övningsflagga läses någonstans utan filtret. Först när det finns kan
modulguiderna kräva att momentet faktiskt utförs; tills dess pekar de ut och
förklarar.

---

## Passet 2026-08-28 i korthet

**VD, säljchef, ekonomi och projektledare stämplar inte längre.** Regeln bor i
`src/lib/stampelfri.ts` — ändra listan där, ingenting annat.

Det som faktiskt var problemet låg i nattjobben, inte i knappen: två motorer
letar efter dagar då ingenting hände, och för den som inte stämplar är varje
arbetsdag en sådan. `jobb/konsekvenser.ts` hade lagt ett **förslag om ogiltig
frånvaro** — första steget i konsekvenstrappan — per schemalagd dag, och
`jobb/franvaro.ts` en påminnelse. Båda hoppar nu över dem, och drar tillbaka
respektive stänger det som redan hunnit läggas.

`korTidjobbet` **bedömer** inte (sen ankomst, rastavvikelser) men **bokför**
fortfarande (auto-stängning, journalrad). Rör inte den gränsen: utan
bokföringen blockerar en gammal öppen dag löneperioden för den som varit
säljare innan hen blev säljchef.

I gränssnittet: stämpelkortet är borta på startsidan och `/tid`, och
bottennavets stämpelknapp följer personen. `/tid` finns kvar i menyn för
säljchef och VD (rättelser respektive ogiltig frånvaro) men försvinner för
ekonomi och projektledare. **Lönerapporten är en egen menypost och rördes
inte.**

Prov: `npm run test:stampelfri` — regeln plus en källkodsavläsning som vaktar
att jobben och vyerna alls ställer frågan.

---

## Passet 2026-08-27 (kväll) i korthet

| Punkt | Utfall |
|---|---|
| **E0.7** | KLAR. Nattjobbet larmar om sig självt; färskhetskontroll på `/fel` och startsidan |
| **E6.1** | KLAR. Sju händelsetyper som **data**, prov som håller efter dem. Inloggningen loggas nu |
| **E1.5** | KLAR. Schemat behövde ingen kod — det som saknades var beviset i loggen |
| **Prestanda** | Mätt. Filtrering av notisfrågorna ger **ingenting**; sökningen är en våg grundare |
| **X3** | Uppskattningen står kvar med avsikt. Metoden att mäta den står nu i `matning.mjs` |
| **X1/X2** | Genomgångna. Två brister rättade: hoppa-till-innehåll och `role="alert"` |

**Två saker kräver en människa och står därför kvar:** en skärmläsargenomgång
(X1) och en avläsning på riktig telefon (X2). Allt som gick att granska
statiskt är granskat.


---

## E6.1 är klar sedan 2026-08-27 (kväll)

Handelseloggen täcker samtliga sju händelsetyper, och **det går att
kontrollera** — `src/lib/handelselogg.ts` klassar varje action och
`tests/handelselogg.mjs` jämför registret mot både källkoden och produktionens
logg.

Tre saker att inte riva:

1. **Typerna beskriver VAD som hände, inte vilken modul.** Första försöket
   delade in efter modul och föll på `case.*` — en modulindelning växer med
   navet, så "sju" hade blivit åtta vid nästa modul. Se D-E6.1.
2. **`typFor()` är avsiktligt total:** en okänd ändelse i en känd modul blir
   `andring` i stället för att falla ur loggvyn. Det som fångar en HELT ny
   modul är `MODUL`-registret och provet. Rör du reglerna: kör
   `npm run test:handelselogg`.
3. **Inloggningen loggas nu.** `auth.login` skrivs **före** `redirect()` —
   `redirect()` fungerar genom att kasta, så en rad efter den körs aldrig. Och
   utloggningen slår upp personen **före** `signOut()`.

**Beställaren bör stämma av enumerationen.** PRD:n ligger inte i repot, så de
sju typerna är härledda och inte avlästa. Ändras listan är det `TYPER` och
provet som ändras, inte loggen.

---

## E0.7 är klar sedan 2026-08-27 (kväll)

Nattjobbet larmar nu om sig självt, och färskhetskontrollen ligger på en
**mänsklig väg**. Fyra saker att inte riva:

1. **`vercel.json` är orörd, och den lediga cron-slotten används inte.** En
   cron som vaktar cron dör samma död — det var precis det som hände när tre
   poster deklarerades, planen tog två och en instämpling stod öppen i två
   dygn. Kontrollen sitter på `/fel` (driftkort) och på startsidan (en rad som
   bara ritas när något är fel). Se D-E0.7.
2. **Digesten måste vara stabil över nätter.** `normaliseraFel()` i
   `src/lib/jobb/larm.ts` byter tidsstämplar, uuid:n och siffergrupper mot
   platshållare innan hashen. Utan det räknar `registrera_fel` aldrig upp
   `occurrences`, och en månads haveri blir trettio rader i kön i stället för
   en rad med siffran 30.
3. **Sökvägen är `/api/jobb/natt/<steg>`, aldrig ett fragment.**
   `rensaSokvag()` klipper bort fragment, så `#satser` hade grupperat ihop alla
   sex stegen. Provet importerar den riktiga funktionen och kontrollerar det.
4. **Frågan om kvittot är villkorad på `sales_manager`/`ceo`/`admin`, och det
   är inte ett andra rollfilter.** `audit_log_read` ger noll rader åt alla
   andra, och noll rader är precis vad "jobbet har aldrig kört" också ser ut
   som. Utan gränsen hade varje säljare fått en röd larmrad på sin startsida.

`MAX_TIMMAR = 26` är mätt, inte gissad: största uppmätta avstånd mellan två
körningar över fem nätter är 24,6 timmar. Härledningen står i filen.

**Larmvägen är sedd i skarp drift 2026-08-28.** Nattjobbet körde 03:13:49 UTC
med de nya nycklarna i kvittot: `larm: 0`, `forra_kvittot: {ok, 24.7 h}`. Noll
larm skrevs, vilket är rätt utfall — inget steg föll och kvittot var färskt.

**Gränsen prövades första natten: avståndet var 24,7 timmar.** Alltså över ett
dygn på en natt när ingenting var fel. Med `MAX_TIMMAR = 24` hade det blivit ett
falsklarm direkt; med 26 finns 1,3 timmars marginal. **Sänk inte talet utan att
mäta om avstånden först.**

**Sökningen svängde 375–526 ms i mätningen efter bygget** och låg över sitt krav
på 500 ms i två av fem körningar. `/sok` rördes inte av bygget — men marginalen
är den minsta i navet och intervallet straddlar numera kravet. Läs medianen av
flera körningar, aldrig en enskild avläsning.

---

## Läget efter genomgången 2026-08-26

**Provsviten är grön: exit 0, 1 782 kontroller, noll fallna** (omkörd
2026-08-27 kväll med `test:larm` och `test:handelselogg` i kedjan;
1 675 + 46 + 61).

### Tre saker som ändrades och som du behöver veta om

1. **`0037_konsekvenser` var körd mot produktionen men aldrig committad.** Filen
   är återskapad ur databasen, är idempotent, och bokföringen är omgjord så att
   checksumman beskriver filen som ligger här. **Schemat finns, koden gör det
   inte** — E13 steg 6 är fortfarande obyggd, och `attendance_incident` är tom.
   Notisavfärdningen fick därför nummer **0038**.

2. **En klickad notis försvinner ur klockan** (`notification_dismissed`, 0038).
   Alla notis-id:n går genom `notisId()` — skriv aldrig ett id som en hopskriven
   sträng, då slutar avfärdningen tyst fungera för just den sorten.

3. **Sessionen verifieras en gång per anrop i stället för två.** Mellanvaran
   skickar identiteten vidare i en request-rubrik.
   **`rensaIdentitet(headers)` på första raden i `updateSession()` är hela
   säkerheten** — faller den raden bort kan vem som helst skicka en egen
   identitetsrubrik och bli den personen, utan att något annat slutar fungera.
   `tests/identitet.mjs` skickar en riktig förfalskning mot produktionen.

### Två saker du själv måste göra för att slå på rasterna

Spärren har **exakt ett villkor kvar**. `sparr_saknas('raststampling')` svarar
*"K14: 1 anställda har inte kvitterat informationen."*

1. **Sätt rastschemat** under `/tid/schema`. Du sa att du vill göra det själv.
   Det som ligger där nu — 10 minuter, fönster 10:50–13:00 — ger **var och en som
   äter lunch en avvikelse varje dag**, mätt mot den riktiga motorn. Ett schema
   ändras aldrig: en ny längd är en ny rad med nytt `valid_from`. Sidan visar nu
   vilket schema som gäller nu och vilka som är historik.
2. **Kvittera K14** på `/rutiner/k14-information-arbetstid`, och kvittera de nya
   rastschemaraderna. Ingenting bedöms mot ett schema som inte kvitterats.

Sedan slås spärren på under `/tid/sparrar`. **K12 är beslutad och publicerad**
(beslutsdatum 2026-08-26, "Beslutad av: Zen, VD"). Avsnitt 6 och 7 skrevs i det
här passet och bär ditt namn — **läs dem.**

### Prestanda, senast mätt 2026-08-27 (kväll) på `a8668b8`

Fem körningar som säljare, median av medianerna. **Mätskriptet loggar in som
säljare**, så E0.7:s driftfråga ställs inte alls i den här mätningen; samma
mätning som säljchef gav **~472 ms** på startsidan mot kravet 1 500.

| Sida | Median | Krav | Marginal |
|---|---|---|---|
| Startsidan | ~442 ms | 1 500 | ~1 058 ms |
| Stämplingsvyn | ~516 ms | 2 000 | ~1 484 ms |
| **Sökningen** | **~478 ms** | **500** | **~22 ms** |
| Rutinerna | ~428 ms | 1 500 | ~1 072 ms |

Tabellen nedan är från mätningen dessförinnan och står kvar som jämförelse.

### Prestanda, mätt mot produktionen 2026-08-27 (efter vågrättningen `822269f`)

Median av tre körningar, var och en själv en median av fem hämtningar:

| Sida | Median | Krav | Marginal | Före rättningen |
|---|---|---|---|---|
| Startsidan | ~450 ms | 1 500 | ~1 050 ms | ~536 ms |
| Stämplingsvyn | **~489 ms** | 2 000 | ~1 511 ms | ~582 ms |
| **Sökningen** | **~406 ms** | **500** | **~94 ms** | ~442 ms |
| Rutinerna | ~427 ms | 1 500 | ~1 073 ms | ~456 ms |

**Vågrättningen är bekräftad.** `far_godkanna_franvaro()` låg som ett eget
`await` på `/tid` och drev stämplingsvyn från ~530 till ~582 ms. Sedan den
flyttats in i samma `Promise.all` som dagens stämplingar ligger vyn på ~489 ms —
alltså **under** siffran före E13-bygget, inte bara tillbaka på den. De tre
körningarna gav 489, 491 och 470 ms, så spridningen är liten.

Vågantalet är det som växer när navet växer — lägg nya hämtningar i en befintlig
våg när de inte beror på något ovanför.

**Sökningen är fortfarande den minsta marginalen i navet**, ~94 ms. Den rördes
inte av E13-bygget; hela intervallet ~385–442 ms över de senaste mätningarna är
körning-till-körning.

**Läs medianen av flera körningar.** Enstaka avläsningar i samma mätning gav
1 574 ms på startsidan och 1 392 ms på sökningen på kalla funktioner. Var och en
hade ensam sett ut som en regression.

---

## Pågående uppdrag: E13 provisions-, bonus- och konsekvensmotor

**Läs `docs/PROVISION_SPEC.md` innan du rör provisionen.** Beställaren besvarade
59 frågor 2026-08-24 och specifikationen bär hela regelverket: paketmatrisen,
volymbonusens trappa, K&V-protokollet, konsekvenstrappan och byggordningen i
nio steg.

**Ingenting blockerar längre utom A6.** Rast och sen ankomst når fortfarande
aldrig provisionen; utebliven instämpling gör det, men bara via ett förslag som
chefen måste godkänna.

**Tre öppna punkter tillkom under bygget och har förslag som gäller:** Ö16
(vilken volymtrappa en månad som en ändring skär igenom får), Ö17 (K&V-bonusen
faller helt vid en konsekvens, den börjar inte om som orderräknaren) och Ö18
(vad "utebliven instämpling" är — en dag helt utan stämpling, inte en lucka).
Skälen står i specifikationens avsnitt 10.

**Steg 1–7 och 9 är klara 2026-08-26** (migrationerna `0034`–`0037` och `0039`).
**Bara steg 8 återstår, och det är blockerat av A6** (dialer-API för K&V-urvalet).

**Volymtrappan är rättad 2026-08-27, så E13 väntar inte på någon indata alls.**
Sömmen till steg 8 ligger färdig: `source` (`manual`/`dialer`) och `external_ref`
med partiellt unikt index. Ingen vy behöver röras den dagen A6 besvaras.

**Konsekvenstrappan står seedad och oanvänd, och det är avsiktligt.**
`attendance_incident` är tom. Beställaren beslutade 2026-08-27 att **säljchef och
VD räcker** som beslutskrets — `attendance_approver` tilldelas ingen. Skälet är
att det inte finns någon separat teamledare att tilldela: Zen bär både
`sales_manager` och `ceo`, och de två andra i registret står i onboarding.
Behörigheten finns och går att ge under Personal den dag en teamledare kommer in;
kretsen blir då **eget team**, inte alla.

### Vad som byggdes 2026-08-26 (kväll)

| Steg | Vad | Migration |
|---|---|---|
| **6** | Konsekvenssystemet: motor, förslag i nattjobbet, chefens kö på `/tid/ogiltig-franvaro`, trappan som inställning, notiser, ärende vid tredje | **Ingen** — schemat låg i `0037` |
| **7** | Separat provisionsunderlag på `/provision/underlag/[manad]`, CSV och utskrift | Ingen |
| **9** | Orderbilagan: PDF på ordern, utläsning som förifyller | `0039` |

Ö13 är dessutom besvarad och byggd: `betald` går nu att sätta, av ekonomi och VD.

### Vad beställaren svarade 2026-08-25, och vad steg 6 måste följa

**Ö8: övrig bonus faller INTE vid en konsekvens.** Specifikationens förslag var
tvärtom. Volymbonus och K&V-bonus faller som förut; grundprovisionen är orörd.

**Ö15: ogiltig frånvaro kräver minst 5 minuter OCH att personen faktiskt inte
var på plats.** Den som stämplar in för sent men varit här räknas **aldrig** —
beställarens egna ord. Chefen godkänner varje fall.

Det sista är viktigare än det ser ut: **det håller D-K12:s linje.** K12 1.2 sen
ankomst når fortfarande inte provisionen, och intresseavvägningen behöver därför
inte omprövas. En 5-minutersgräns som även gällt sen ankomst hade krävt att
avsnitt 6 och 7 i K12 skrevs och beslutades först — av någon med
dataskyddskompetens. Bygg inte steg 6 så att den gränsen glider.

**Ö4 är besvarad: 200 poäng totalt för båda samtalen**, alltså tröskeln 160 =
80 %. Steg 5 är byggt.

### K&V-maxpoängen ÄR ifylld (kontrollerat 2026-08-26)

Texten här sa länge att den var NULL för samtliga sex områden. Det stämmer inte
längre — beställaren fyllde i den 2026-08-25:

| Område | Max |
|---|---|
| Intro | 10 |
| Behovsanalys | 10 |
| ROI | 10 |
| Avslut | 10 |
| Kvalitet på samtalet | 30 |
| Korrekt avtalshantering | 30 |
| **Summa** | **100 per samtal** |

Två samtal per vecka ger 200 totalt, vilket är precis vad Ö4 svarade, och
tröskeln 160 är alltså 80 %. **Det stämmer.** K&V går att bedöma.

### Nio saker att inte riva

1. **En makulering är TVÅ händelser.** Ordern ger provision i sin
   signeringsmånad och drar tillbaka den i sin makuleringsmånad. Använd
   `harGodkants()` och aldrig `raknas()` när det handlar om pengar — se
   arbetsloggen 2026-08-25 (kväll) för de två felen som uppstod när de blandades
   ihop. Nettoantalet kan bli negativt, och det är avsiktligt.
2. **Provisionen är frusen på ordern.** Satsen slås upp på signeringsdatumet och
   kopieras in vid godkännande. Läs aldrig `commission_rate` för att räkna om en
   gammal order.
3. **Volymtrappan slås upp på MÅNADENS första dag**, inte på orderns datum. De
   två uppslagen är olika med flit — se Ö16 i specifikationen. Blandas de ihop
   blir "från och med nu" och "allt intjänat denna månad" samma sak.
4. **En öppen period räknas live, en stängd är bokförd.** Och "öppen" är
   frånvaron av en rad i `commission_period`. Attesten bokför posterna FÖRST och
   stänger perioden SEDAN; den ordningen är det som gör ett halvfärdigt försök
   möjligt att köra om.
5. **En vecka räknas först när ALLA dess samtal är bedömda.** Tröskeln är
   summan av båda samtalen, så en halvbedömd vecka hade underkänts av ett skäl
   som är chefens och inte säljarens. Och periodstängningen hämtar samtal en
   vecka före och efter månaden — torsdagsregeln gör randveckorna halva annars.
6. **`revoke ... from public` räcker inte för en ny funktion.** Supabase har en
   egen default-ACL som ger `anon` en explicit grant. Skriv
   `revoke all ... from public, anon`. Migrationen 0034 föll på sin egen
   självkontroll första gången just där — behåll kontrollen i nya migrationer.
7. **Allt som exporteras ur en `"use server"`-fil är en publik ändpunkt.** Det
   har gått fel tre gånger: `skrivFel`, `sattKvitto`, `registreraVisning`.
   Hjälpare hör hemma i `src/lib/`, och personen ska komma ur **sessionen**,
   aldrig ur ett argument.
8. **`raknas()` i `konsekvens.ts` är MOTSATSEN till `harGodkants()` i
   `order.ts`.** En makulering är två händelser — signeringen hände, så den
   räknas fortfarande. En hävning är ett underkänt beslut, så den räknas för
   ingenting alls, varken som konsekvens eller mot nästa steg. Blandas de ihop
   står någon kvar på steg två efter att steg ett rivits.
9. **`uteblivenInstampling()` räknar ALDRIG någon som stämplat in.** Inte hur
   sent som helst, inte tidig hemgång, inte glapp mitt på dagen. En mätning av
   "schemalagd tid utan stämpling bakom sig" hade av ren aritmetik fångat sen
   ankomst — och då hade D-K12:s linje glidit utan att någon flyttat den. Att
   vidga den är en rad; att smalna av den efter att data finns är det inte, och
   det kräver att K12 avsnitt 6 och 7 beslutas om på nytt.

### Volymtrappan är RÄTTAD 2026-08-27 — E13 väntar inte på någon indata längre

Omkastningen är åtgärdad enligt ditt besked: **bara 15 och 20 byter plats**, 5
och 10 står orörda. De gamla raderna är stängda med `valid_to = 2026-09-01` och
ersatta av nya rader från samma dag — en nivå ändras aldrig, den stängs och
ersätts.

| Tröskel | Belopp | Gäller från |
|---|---|---|
| 5 | 200 kr | 2026-08-25 |
| 10 | 500 kr | 2026-08-25 |
| **15** | **1 000 kr** (var 1 200) | **2026-09-01** |
| **20** | **1 200 kr** (var 1 000) | **2026-09-01** |

Trappan stiger nu hela vägen. Tidigare fick den som sålde tjugo order 200 kr
mindre än den som sålde femton — motorn slår upp den högsta tröskel som nåtts,
så det var precis vad som hände, och det var aldrig ett fel i koden.
Tidsstämplarna vid inmatningen sa vad som skett: 5 kl 13:31:35, 10 kl 13:31:45,
**20 kl 13:32:13**, **15 kl 13:32:38** — de två sista i omvänd ordning mot de
andra, vilket är vad som händer när två fält byter plats.

**Ändringen gjordes i databasen, inte via `/provision/regler`**, men med exakt
samma två skrivningar som `sparaNiva()` med valet "gäller från och med nästa
månad" gör: `valid_to` på den gamla raden, ny rad med nytt `valid_from`, och två
rader i `audit_log` med Zen som `actor_id`. `note` på de nya raderna säger att de
lagts via SQL. Rör du trappan igen: gör det på sidan.

**Trappan gäller från och med september, inte augusti — och det gjorde den redan
före rättningen.** Samtliga rader, även 5 och 10, har `valid_from` efter den
1 augusti, och uppslaget sker på **månadens första dag**. Augusti har alltså
ingen volymtrappa alls. Det spelar ingen roll i dag (augusti bär två testorder
och `commission_entry` är tom), men det är inte det någon läser ur tabellen.
**Vill du att augusti ska omfattas** är det fyra nya rader med
`valid_from = 2026-08-01` — säg till, det är fem minuter.

**Nivåerna 25 och 30 lämnas tomma tills vidare** — ditt besked 2026-08-26. Nås de
i dag ger de samma bonus som 20, och trappan står still över 30 enligt avsnitt
5.3.

---

## Arbetsregler i det här repot

- **Inga lokala byggen eller kloner** — allt ska gå direkt mot GitHub-repot.
  Verifieringen är Vercels egen build: en trasig build ersätter aldrig den
  version som körs.
  *Avvikelser som är kända av användaren:* migrationer och tester körs från en
  scratchpad-klon, eftersom de behöver `pg` och `DATABASE_URL`.
- Committa som `stratforsr-sys <stratforsr@gmail.com>`.
- **`npm run typecheck` fore varje push.** Godkant av anvandaren 2026-08-23.
  Vercel ar fortfarande det som verifierar bygget, men ett typfel som fangas
  lokalt kostar tjugo sekunder i stallet for en misslyckad deploy.
- Pusha rakt till `main`. Inga feature-branches. `main` deployar automatiskt
  till Vercel.
- Migrationer är handskriven SQL i `supabase/migrations/`, körs med
  `node --env-file=$HOME/.clicknet/nav.env scripts/apply-sql.mjs`. Aldrig
  `prisma migrate` eller motsvarande.
- Nycklar ligger i `~/.clicknet/nav.env`.
- **`vercel.json` har `"regions": ["arn1"]`. Rör den inte.** Funktionerna måste
  köra i samma region som Supabase (`eu-north-1`). Utan raden hamnar de i
  Vercels standard `iad1` och varje databasfråga går över Atlanten — det kostade
  ~460 ms per tur i stället för ~30.
- ASCII i kodkommentarer och commit-meddelanden. Svenska i allt som en
  människa läser i produkten.
- Läs `docs/ARBETSLOGG.md` före arbete, uppdatera den efteråt.

## Kör testerna

```
set -a && . $HOME/.clicknet/nav.env && set +a && npm test
```

**Trettiosju sviter.** `larm` (46 kontroller, ren logik) och `handelselogg`
(61 kontroller, går mot riktiga databasen) kom till 2026-08-27 (kväll). Tre kom till 2026-08-26: `konsekvenser`,
`provisionsunderlag` och `orderbilaga` — alla ren logik utan Supabase. `tests/rls.mjs` går mot den **riktiga**
databasen och skapar och städar sina egna användare (prefix `rlstest+`).
Även `tests/provision-period-db.mjs` går mot den riktiga databasen — den kör allt
i en transaktion som rullas tillbaka, och kontrollerar till sist att ingenting
blev kvar.

Sviten var **grön** när passet 2026-08-23 började, och när det slutade.

**Senast omkörd i sin helhet 2026-08-27 på `822269f`: exit 0, 1 675 godkända
kontroller, noll fallna, inget nätavbrott.** Det var den körning som saknades —
`822269f` hade bara `typecheck` och `test:tid` bakom sig. Räkna alltid exit-koden
från ett oskyddat kommando: `npm test | tail` ger dig `tail`:s status, inte
svitens.

**Två av tre körningar dog på nätverket** (`Connection terminated`, `ETIMEDOUT`
mitt i en inloggning) utan en enda fallen kontroll. Läs en röd körning innan du
tror på den — ett avbrott ser i förbifarten ut som ett fel i navet.

**Radräkningarna är genomgångna 2026-08-23 och regeln står nu utskriven överst
i `rls.mjs`.** Samtliga 105 i den filen plus 51 i övriga sviter. Leta inte om:

- Säljchefen och ekonomin var redan rättade (21 och 22 augusti).
- `absence_policy === 1` är bevisbart stabilt — tabellen är en singleton
  (`id boolean primary key check (id)`).
- De rena logiksviterna (raster, franvaro, lonerapport, lonekostnad, arenden,
  tid, avtal, rollspel, utbildning) räknar inte databasrader alls.
- **Teamledaren rättades detta pass.** Sex kontroller räknade hela tabellen för
  Cecilia. De var gröna — men bara för att de sju tabellerna är TOMMA i
  produktionen. De hade svarat likadant om hon kunnat se allt, och blir röda så
  fort piloten börjar.

**Fråga alltid på provradens id.** Undantagen är `=== 0` och `>= n`.

---

## Läget i produktion

| Sak | Status |
|---|---|
| In- och utstämpling | **Påslagen.** `compliance_gate.stampling` |
| Raststämpling | Avstängd. **Ett villkor kvar: K14 okvitterad av 1 person.** K12 och K14 är publicerade |
| Sen ankomst | Påslagen, tolerans 1 minut, larm samma dag till chef |
| Nattjobb | Ett jobb, `/api/jobb/natt`, 02:30. Hämtar igen 14 dygn bakåt. **Larmar om sig självt sedan 2026-08-27:** fallna steg och uteblivna nätter blir rader i `error_report` |
| **Driftläget** | **I drift sedan 2026-08-27.** Driftkort på `/fel` och en rad på startsidan som bara ritas när något är fel. Ingen andra cron — se D-E0.7 |
| Lönerapport | Klar, med attest och oföränderlig period |
| Personalärenden | Klara, med SLA och konfidentialitet |
| Tvingat lösenordsbyte | Spärr i databasen sedan 2026-08-20 |
| Startsida | **Ombyggd 2026-08-23.** Statusband, snabbval, dagens tidslinje, ärende- och provisionskort |
| Bottennavigering | Under 768 px: Hem, Sök, Stämpla, Mer |
| Sidopanelen | **Menyn scrollar sedan 2026-08-24.** Låst botten: profil och utloggning rullar aldrig bort |
| **Inställningar** | **I drift sedan 2026-08-24.** Ruta över fönstret från profilbilden. Konto, Säkerhet, Utseende, Administration. `/profil` visar samma sektioner som egen sida |
| Registerutdrag | Klart, **inklusive filer och vem som öppnat dem** |
| **Händelseloggen** | **Sju typer sedan 2026-08-27.** `/logg` med filter per typ. Inloggning, utloggning och misslyckade försök loggas nu |
| Nyheter | `/nyheter`. Målgrupp per roll och team, fäst överst, utkast |
| Notisklockan | Ärenden, nyheter, rutiner, kurser, frånvaro, rollspel. **En klickad notis försvinner (0038)** |
| Frånvaro och ledighet | I drift sedan 2026-08-20. **E7 är helt klar sedan 2026-08-21** |
| Kalenderflöde | `/api/ical/[token]`. Bär aldrig sjukfrånvaro och aldrig frånvarotyp |
| **Filer** | **I drift sedan 2026-08-21.** Läkarintyg, bilagor, rollspel |
| **Global sökning** | **I drift sedan 2026-08-21.** `/sok`, kortkommando `/` |
| **Lönekostnad** | **I drift sedan 2026-08-21.** `/lonekostnad`. Kräver `payroll_cost_viewer` |
| **Felrapportering** | **I drift sedan 2026-08-22.** `/fel` och `/fel/nytt`. Egen tabell, inte Sentry |
| **Avtalsmallar** | **I drift sedan 2026-08-22.** `/avtal`. E9.2 e-signering fortsatt blockerad |
| **Kvitto med ångra** | **I drift sedan 2026-08-22.** Nere till höger, tre ångrabara åtgärder |
| **Adoptionsstatistik** | **I drift sedan 2026-08-23.** `/adoption`. DAU/WAU, träfflösa sökningar, glömda dokument. Säljchef, VD, admin |
| **Rekrytering** | **I drift sedan 2026-08-23.** `/rekrytering`. Steg, scorecards, tratt per källa. Behörighet `recruiter` eller ledningsroll |
| **Anställningsflöde** | **I drift sedan 2026-08-24.** `/rekrytering/[id]/anstall`. Konto, roll, rutiner, kurser, avtalsutkast och onboarding-checklista i ett steg |
| **Provision** | **I drift sedan 2026-08-23.** `/provision`. Manuell inmatning av ekonomi/VD. Alla ser sin egen. Inkio-sömmen lagd, inte kopplad |
| **Kundorder** | **I drift sedan 2026-08-25.** `/order`. Paketmatrisen i `commission_rate`, provisionen fryses vid godkännande |
| **Volymtrappan** | **I drift sedan 2026-08-25.** `/provision/regler`. **Rättad 2026-08-27:** 5/10/15/20 → 200/500/**1000**/**1200** kr. 15 och 20 gäller från 2026-09-01; hela trappan slår igenom först i september |
| **Periodstängning** | **I drift sedan 2026-08-25.** Kort på `/provision`. Öppen månad räknas live, fastställd är bokförd |
| **Progressvy** | **I drift sedan 2026-08-25.** `/provision`. "3 order kvar till nästa bonus" med prognosens antagande utskrivet |
| **K&V** | **I drift sedan 2026-08-25.** `/kv`. Rutnät säljare × vecka, bedömning, utvecklingskurva. Maxpoängen är ifylld |
| **Ogiltig frånvaro** | **I drift sedan 2026-08-26.** `/tid/ogiltig-franvaro`. Nattjobbet föreslår, chefen beslutar. Behörighet: säljchef, VD, eller `attendance_approver` för eget team |
| **Provisionsunderlag** | **I drift sedan 2026-08-26.** `/provision/underlag/[manad]`. Eget dokument, CSV och utskrift. `payroll_row` bär fortfarande inga kronor |
| **Orderbilaga** | **I drift sedan 2026-08-26.** PDF på ordern (`0039`). Utläsningen förifyller, den sparar aldrig |

### Raststämplingen: två steg kvar, och båda är dina

Rastschemat finns redan (K29 uppfylld), K12 och K14 ligger som **utkast** i
rutinbiblioteket och är kopplade till spärren. Det som återstår:

1. **Publicera K12 och sätt beslutsdatum.** `/rutiner` → "Intresseavvägning —
   registrering av arbetstid" → redigera → fyll i avsnitt 6 och 7, som är
   avsiktligt tomma, sätt beslutsdatum och publicera.
2. **Publicera K14** ("Så registreras din arbetstid"). Därefter måste **varje
   aktiv anställd kvittera den** — i dag är det en person (Zen), så det är ett
   klick.

Sedan slås spärren på under `/tid/sparrar`. Triggern i databasen kontrollerar
villkoren, inte koden.

**Jag publicerade dem inte åt dig med flit.** En intresseavvägning med
beslutsdatum är ett arbetsgivarbeslut enligt art. 6.1.f, och dokumentets egen
ingress säger att det ska läsas av någon med dataskyddskompetens innan det
beslutas. Avsnitt 6 och 7 — själva avvägningen och beslutet — är tomma.

### Kontrollera rastlängden INNAN du slår på

Rastschemat säger **10 minuter**, fönster 10:50–13:00, tolerans 5 min. Det ser
ut som ett testvärde. Konsekvensen är uppmätt mot avvikelsemotorn:

| Vad någon gör | Vad som registreras |
|---|---|
| 10 min rast 11:00 | inga avvikelser |
| **30 min lunch 12:00** | **overrun, 20 min** |
| **60 min lunch 12:00** | **overrun, 50 min** |
| lunch + kaffepaus | overrun 20 min + unscheduled |
| ingen rast alls | missing, 180 min |

Med den här längden får alltså **var och en som äter lunch en avvikelse varje
dag**. Det gör avvikelsevyn oläslig från dag ett, och det är den vy K12 lovar
personalen ska vara sparsam.

Ett schema ändras aldrig (AC-2.35) — en ny längd är en **ny rad med nytt
`valid_from`**, upplagd under `/tid/schema`. Gamla rader är historik och ska
ligga kvar.

### Fem saker användaren själv måste göra

1. **Zen står instämplad sedan måndag 2026-08-17 18:08.** Dagen lämnades
   avsiktligt öppen — schemat slutar 17:00, så en autostängning hade satt
   utstämplingen före instämplingen. Den behöver en rättelse, annars blockerar
   den löneperioden. Samma stämpling gav en registrerad sen ankomst på 548
   minuter som ser ut att vara ett test.
2. **Supabase-panelen**: Site URL pekar fortfarande på localhost,
   registreringen är öppen, och det delade lösenordet är inte bytt.
3. **Telefonnummer i mottagarordningen och bemanningstak** under
   `/franvaro/regler`. Utan numren är telefonlistan vid sjukanmälan namn utan
   nummer; utan tak varnar ingen ansökan för bemanning.
4. **P0.6 registerförteckningen måste uppdateras med kunduppgifter som ny
   kategori.** Orderbilagan kan bära en enskild firmas personnummer — hos en
   enskild firma *är* organisationsnumret ett personnummer — och en signerad PDF
   kan bära en namnteckning. Filen ligger rätt skyddad (stängd bucket,
   åtkomstlogg), men förteckningen beskriver den inte. Se D-E13.9. Det är ett
   dokument, ingen migration kan göra det åt någon. **Samma dokument blockerar
   E6.2 gallringsjobbet**, som inte kan byggas förrän fristerna finns.
5. **Lönekostnaden saknar tre saker innan den visar något:** ingen har
   `payroll_cost_viewer` (tilldelas per person under Personal), inga
   månadslöner är inmatade, och täckningsgraden är inte satt. Allt tre görs
   under `/lonekostnad/satser`. **Kontrollera också åldersgränsen för den äldre
   nedsättningen** — den är seedad till 66, följer pensionsåldern och har
   flyttats flera gånger. Den berör ingen i bolaget i dag.

---

## Vad som byggdes 2026-08-24 (kväll) — skalet

Ingen migration. Två saker, och den första var ett verkligt fel i produktion.

**Sidopanelens meny scrollar.** Panelen är `inset-y-4` och alltid exakt så hög
som fönstret, men listan saknade egen scroll. På en 690 px hög vy föll fem av
sjutton poster utanför — och under dem **hela bottenraden med profilen och
utloggningen.** Bara listan scrollar nu; logotyp, hopfällning och profilrad är
`shrink-0`.

Fällan att komma ihåg: `scrollbar-width`/`scrollbar-color` slår sedan Chrome
121 av hela `::-webkit-scrollbar`-blocket, och då ritar macOS en overlay-list
med bredd noll. Listan scrollade men såg fortfarande avklippt ut. Det står
utskrivet i `.nav-scroll` i `globals.css` att de två inte får läggas tillbaka.

**Inställningarna är en ruta över fönstret**, öppnad från profilbilden.
`<dialog>` + `showModal()`. Sektionerna ligger i `src/app/(app)/profil/
Sektioner.tsx` och används av både rutan och `/profil` — rör du den ena ändras
båda, vilket är meningen. Administration-fliken finns bara för den som ställer
in något, och varje post har samma villkor som sidan den pekar på.

Sidopanelens hopfällning delas via `shell/panellage.tsx` i stället för att
kopieras. Lägeshållaren är `Skal`.

---

## Vad som byggdes 2026-08-24 — E10.9 anställningsflödet

Migration `0033`. Hela resonemanget står i arbetsloggen; det här är vad du
behöver veta för att inte riva något.

### Kopplingen och steget skrivs i SAMMA update

`hired_employee_id` och `stage = 'hired'` går i en enda skrivning.
`candidate_stegbyte` i 0030 nekar `hired` utan koppling, så delar du upp dem
måste kopplingen sättas först — och en kandidat som pekar på en anställd utan
att stå på `hired` är precis det motsägelsefulla läget ordningen finns för att
undvika.

Ordningen i övrigt: **auth-konto och employee-rad först, kopplingen sedan, allt
annat sist.** Faller det mitt i står kandidaten kvar på `offer` med en anställd
som redan finns — ett läge någon kan se och rätta.

### `revoke`-fällans motsvarighet här: undantaget för null

Triggern `candidate_anstallning_star_fast` nekar att kopplingen pekas om, **men
bara till ett annat värde.** `on delete set null` kör en UPDATE, så en trigger
som nekade all ändring hade fällt `delete from employee`. Samma fälla som
`file_object` gick i 0023. Rör du triggern: provet raderar en person och
kontrollerar att kandidatraden står kvar.

### Uppläggning och avtalsrendering ligger i lib, inte i actions

`src/lib/anstallning-server.ts` och `skapaAvtalsutkast()` i
`src/lib/avtal-server.ts`. Två vägar leder till båda, och ingen av filerna bär
`"use server"`.

**Behörigheten kontrolleras aldrig där** utan av anroparen — kretsarna är olika,
och det är avsiktligt. Lägger du till en tredje väg in: kontrollera behörigheten
i din egen kod, inte i biblioteket.

### Avtalsdelen är valfri, och tre saker styr det

Kretsen som får skapa avtal (`sales_manager`, `ceo`, `admin`) är **smalare** än
rekryterarkretsen, som också släpper in `recruiter`. Det finns **ingen
publicerad mall** än. Utan mall skapas inget utkast och checklistan får punkten
i stället — åtgärden flyttar, den försvinner inte.

Skriv den första mallen så börjar flödet skapa utkast av sig självt.

### Tre av tolv checklistepunkter föds avbockade

Konto, rutiner och kurser är redan gjorda av flödet. De står kvar som bevis men
markerade `done` — en lista med utförda punkter som ser öppna ut lär användaren
att bocka av utan att läsa. Lägger du till en punkt som flödet utför: sätt
`automatisk: true` i `src/lib/onboarding.ts`.

**Den nyanställda ser inte sin egen lista.** Samma behörighet som offboardingens.
Punkterna är chefens arbetsredskap; det den anställda ska se ligger på `/rutiner`
och `/utbildning`. Raden står ändå i registerutdraget (artikel 15).

---

## Vad som ändrades natten till 2026-08-24 — tre säkerhetspunkter

Migration `0032`. Hela resonemanget står i arbetsloggen; det här är de tre
reglerna som är värda att ha med sig.

**En `"use server"`-fil exporterar handlingar och ingenting annat.** `sattKvitto`
låg i `angra/actions.ts` och var därmed en publik ändpunkt — allt som exporteras
ur en sådan fil får ett id och tar emot anrop från webbläsaren. Den ligger nu i
`src/lib/toast-server.ts`, och `angra()` är det enda som exporteras därifrån.
Samma sak hände `skrivFel` 22 augusti. Det är alltså andra gången.

**Jobbrutternas hemlighet jämförs i konstant tid**, i `src/lib/jobb/behorighet.ts`
i stället för i fyra kopior. Båda sidorna hashas först — `timingSafeEqual` kräver
lika längd och en längdkontroll före hade läckt längden.

**`revoke ... from anon` gör oftast ingenting, och det är fortfarande den fällan
som biter.** Tretton av femton funktioner hade ingen explicit anon-grant utan den
PUBLIC-grant Postgres ger varje ny funktion. Rätt form är `revoke från public` +
explicit `grant` tillbaka till `authenticated` och `service_role`. Regeln stod
redan i 0027 och räckte inte — det som fångade felet var **självkontrollen längst
ned i `0032`**, som frågar databasen och river transaktionen om något står kvar.
Den ligger kvar. Skriver du en ny funktion och den syns där: det är meningen.

Triggerfunktioner rörs aldrig — de exponeras inte som RPC av PostgREST.

---

## Vad som byggdes 2026-08-23 (sent) — startsidan och E13

Migration `0031_provision`. Hela resonemanget står i arbetsloggen; det här är
vad du behöver veta för att inte riva något.

### Provisionen är en huvudbok utan motor

`commission_entry` tar emot poster som någon annan bestämt. **Navet räknar ingen
provision** — Q78–Q80 är obesvarade, och AC-10.1 kräver konfiguration, inte kod.
Lägger du till satser: gör dem till data, inte till ett `if`.

**En rättelse är en NEGATIV post.** Tabellen är append-only och triggern nekar
både update och delete. Skillnaden mot `salary_basis` är avsiktlig: intjäning
ackumuleras, så "ny rad med nytt värde" hade dubbelräknats av varje summering.

**Inkio-sömmen är `source` + `external_ref`** med ett partiellt unikt index.
Importen blir idempotent, och ingen vy behöver röras när A5 besvaras.

**Den anställda ser sin egen rad** — till skillnad från K26/lönekostnad. Andras
ser bara ekonomi och VD. Säljchefen står utanför; en roll till är en rad i
`far_hantera_provision()`.

### K13 är omprövad, men bara till hälften

Provision och tid får stå på samma sida (beställarbeslut, se D-K13). Det som
står kvar: **ingen fråga joinar tabellerna**, och **rastavvikelser når
fortfarande aldrig provisionen**. Det senare är ett löfte till personalen i
K12-intresseavvägningen §5 och kräver att K12 beslutas om på nytt för att ändras.

Rör du startsidan: håll de två hämtningarna åtskilda. De ligger i samma våg men
är två frågor, och det är hela skyddet som är kvar.

### Tidslinjen bedömer ingenting

`src/lib/dagslinje.ts` ritar dagens stämplingar. **Inget färgas rött, och det är
avsiktligt.** Bedömningar hör hemma i avvikelsemotorn, som har toleranser,
kvittenskrav (AC-2.36) och loggad chefsöppning (K19) omkring sig.

Rastnedräkningen syns **bara i personens egen vy**. Den som avslutar i tid får
ingen avvikelse alls — det är hela poängen med att räkna ner i stället för att
räkna efteråt.

### Startsidan hämtar nu tre frågor till, i samma våg

Schemat, rastschemat och provisionen lades i den befintliga `Promise.all`.
Vågantalet är oförändrat. **X3-mätningen är inte omkörd efter ombyggnaden** —
`npm run mat:inloggad` när du vill ha en färsk siffra. Kravet är 1 500 ms och
marginalen var ~850 ms före.

### Två fällor som redan trampats i

**`kronor()` skriver U+2212 MINUS SIGN**, inte ASCII-bindestreck — det är vad
sv-SE använder. `tolkaBelopp` känner igen båda, och provet kör hela vändan
display → inmatning. Tar du bort raden går ett kopierat belopp inte att klistra
tillbaka i rättelseformuläret.

**Exportera ingenting mer ur `provision/actions.ts`.** Allt som exporteras ur en
`"use server"`-fil blir en publik ändpunkt. En hjälpare låg där och togs bort —
samma brist som säkerhetsgenomgången hittade i `sattKvitto`.

---

## Vad som byggdes 2026-08-23

Migration `0029_adoption`. Resonemangen står i arbetsloggen; det här är vad du
behöver veta för att inte riva något.

### E6.5: adoption får inte bli en närvaroregistrering

**`activity_day` bär en dag, inte ett spår.** En rad per person och dygn. Inget
klockslag, ingen sökväg, ingen sida. Navet har redan en närvaroregistrering (M2)
med rättelse, attest och lönepåverkan omkring sig — ett andra informellt spår
utan den styrningen är sådant som används till något annat när det väl finns.

**Tabellen har ingen select-policy alls, och det är avsiktligt.** Ingen läser
per-person-raderna via API:t, inte ens säljchefen. Siffrorna kommer ut genom
`adoption_aktivitet()`, `adoption_sokmissar()` och `adoption_glomda_dokument()`,
som svarar med antal och bär rollvillkoret själva. Lägger du till ett mått: gör
likadant, och skriv inget rollfilter i sidan.

**`search_miss` har ingen person** — inte en dold kolumn, ingen kolumn alls.

**`activity_day` står i `KALLOR` i `src/lib/registerutdrag.ts`.** Raden handlar
om personen, så den ska med i utdraget (artikel 15). Tar du bort den faller
`tests/registerutdrag.mjs`. Den fällde passet en gång.

**Kakan i mellanvaran sätts EFTER rpc-anropet.** `setAll` byter ut hela
`response`-objektet när tokenen förnyas, så en kaka satt före försvinner tyst —
och då bokförs dagen om vid varje sidbyte.

### E10 rekrytering: första skivan, och tre delar som inte gick

**Byggt:** E10.3 stegflödet, E10.5 no_show, E10.6 scorecard, E10.10 tratten,
E10.2 delvis (uppläggning för hand — den publika ansökningssidan återstår).

**Går inte att bygga:** E10.1, E10.4 och E10.7 förutsätter alla E0.8 e-post, som
är pausat. Sömmen är lagd så att de kan läggas till utan schemaändring.

**Ingen kandidat blir en anställd av misstag.** Ingen rad i `employee` skapas
härifrån. Varenda RLS-policy i navet utgår från att en rad där är någon som
arbetar här — en kandidat hade blivit synlig i personalregistret, i sökningen
och i notisklockan samma sekund.

**Stegen och scorecardvillkoret är triggrar, inte knappar.** `nastaSteg()` i
`src/lib/rekrytering.ts` ritar knapparna; `candidate_stegbyte` i 0030 avgör.
Listan står på två ställen med flit, och provet kör hela matrisen för att märka
när de glider isär. Rör du den ena: kör `npm run test:rekrytering`.

**Gallringsfristen finns fortfarande inte.** `purge_after_days` är NULL, så
`gdpr_purge_at` sätts aldrig och E10.8:s nattjobb ska inte byggas än. Kolumnen
finns däremot, så när siffran kommer räcker en rad i konfigurationen.

**Behörigheten är `recruiter`, en permission.** Ledningen får den på rollen så
att modulen fungerar direkt — till skillnad från K26/lönekostnad, som kräver
tilldelning av alla och därför fortfarande står tom.

**K27 gäller intervjuanteckningar.** Ett mobilnummer skrivet som tio siffror i
rad nekas också — det går inte att skilja från ett samordningsnummer. Med
bindestreck går det igenom, och numret har ett eget fält.

### X3 mättes om från grunden kvällen 2026-08-23 — siffrorna nedan är ERSATTA

**Tabellen som stod här var fel.** Den byggde på `MS_PER_VAG = 20`, ett antagande
om att Vercels funktion står i samma region som databasen. Det gjorde den inte —
den stod i `iad1` och databasen i `eu-north-1`. Se arbetsloggen 2026-08-23 kväll.

Gällande siffror, mätta inloggat mot produktionen med `npm run mat:inloggad`:

| Sida | Median (varm) | Krav |
|---|---|---|
| Startsidan | ~550–660 ms | 1 500 ms |
| Stämplingsvyn | ~630 ms | 2 000 ms |
| **Sökningen** | **~460–570 ms** | **500 ms** |
| Rutinerna | ~470–500 ms | 1 500 ms |

Mätningen bär hela HTTP-anropet och är därför strängare än kravet, som gäller
mjuk navigering. Nätgolvet från en mätmaskin är ~215 ms.

**Läs medianen av flera körningar.** En kall funktion ger 1 300 ms där en varm
ger 470.

**Sökningens 96 ms är den minsta marginalen i navet.** En sjätte källa ryms i
den befintliga vågen; ett steg som måste vänta in sökningen gör det inte.

**Stämplingens 15 vågor är sex i actionen och nio i omrenderingen av `/tid`**,
som `revalidatePath` tvingar fram. Omrenderingen är dyrare än stämplingen — det
är där en åtgärd ligger om siffran blir ett problem, inte i `stampla()`.

Sök och stämpling mäts som **mjuk navigering**: skalet renderas inte om och
uppkopplingen räknas inte. Startsidans 1,5 s gäller den som öppnar navet; de här
två gäller den som redan är inne.

`npm run mat:startsidan` och `npm run mat:sok-stampling`. Det gemensamma ligger
i `scripts/lib/matning.mjs`. **Städningen kopplar ur AC-2.3-spärren** för att
kunna radera mätningens egen stämpling, och rör aldrig `audit_log` bredare än på
`actor_id`.

---

## Vad som byggdes 2026-08-22

Fyra punkter i den ordning användaren bad om dem. Migrationerna `0026`, `0027`,
`0028`. Resonemangen står i arbetsloggen; det här är vad du behöver veta för
att inte riva något.

### E0.6: felrapportering, och varför det inte är Sentry

Fyra skäl, alla utskrivna i `0026`: K23 med P0.6 oskriven, CSP:n som bara
släpper igenom Supabase, att Sentrys larmväg är mejl som är pausat, och
A14-lärdomen att ett obesvarat leverantörsval inte ska blockera funktionen.
Egen tabell går att byta mot Sentry senare; det omvända går inte.

**`onRequestError` i `src/instrumentation.ts` är enda stället där meddelandet
finns.** I produktion får klienten bara `error.digest`, aldrig texten. Servern
skriver raden med text, klienten skriver samma digest, `registrera_fel` lägger
ihop dem. Rör du den filen: kön blir rader som säger "fel på /franvaro
(a1b2c3d4)" och inget mer.

**Automatiska rapporter dedupliceras** på `(digest, path)` via ett partiellt
unikt index. En kraschloop blir en rad med en räknare. Ett avslutat fel som
kommer tillbaka återgår inte tyst till `new`.

**`maskera()` i `src/lib/fel.ts` bär hela behörigheten.** Felkön släpper in
`admin`, till skillnad från `file_access_log` i 0022. Det håller bara så länge
maskeringen tar bort e-post, personnummer och uuid ur feltexter — postgres
skriver ut krockande värden i klartext. Ändrar du den: läs rubriken
"Behörighet" i 0026 först, och kör `tests/fel.mjs`.

**`/fel/nytt` har ingen rollkontroll, med flit.** Den som råkar ut för ett fel
är oftast en säljare. Sidan läser sidan-man-kom-från ur `document.referrer` —
`location.pathname` hade gett "/fel/nytt" på varenda rapport.

### E9.1: avtalsmallar

**Avtalet fryser malltexten.** `contract.body_md` är det renderade dokumentet.
En trigger nekar att ett utfärdat avtal skrivs om — det går att dra tillbaka,
inte att ändra. Därför går en publicerad mall att stavfelsrätta fritt.

**Lönen läses aldrig ur `salary_basis`.** K26 gör kretsarna olika, men framför
allt är riktningen omvänd: avtalet är källan. 0025 säger redan att den anställda
får sin lön ur sitt anställningsavtal. Avtalet skriver heller ingen rad *i*
`salary_basis`.

**Ett utkast syns inte för den det gäller.** RLS släpper fram raden först vid
`issued`.

**Inget personnummer.** `variables` är jsonb, alltså stället där ett kunde smyga
förbi schemakontrollen i `tests/rls.mjs`. Ett check-villkor nekar
personnummerformade strängar i hela jsonben, och ett prov faller om någon lägger
till det som mallvariabel. Följden: det utskrivna avtalet har en rad som fylls i
för hand. **Vill du att navet ska bära numret är det K27 som ska omprövas — se
punkt 5 nedan.**

### E5.7: ångra är en invers åtgärd

Åtgärden sker direkt; ångra kör motsatsen som en egen rad i `audit_log`. Inte en
fördröjd skrivning — den går sönder när användaren stänger fliken.

**Bara åtgärder med äkta invers får knappen.** Tre finns i dag: arkivera nyhet,
avsluta felrapport, arkivera avtalsmall. Lägger du till en fjärde: lägg den i
`ANGRABARA` i `src/lib/toast.ts` OCH i dispatchern i `(app)/angra/actions.ts`,
som gör om hela behörighetskontrollen. Listan i kakan är inte ett skydd.

Publicera nyhet får aldrig en ångra-knapp. Stämpling heller (AC-2.3).

### E5.3 / X3: startsidan är mätt

**Klarar 1,5 s.** 762 ms på normalt 4G, 1 272 ms på trängt — 228 ms marginal.
`node --env-file=$HOME/.clicknet/nav.env scripts/mat-startsidan.mjs` kör om det.

Det värdefulla är inte totalsiffran utan att startsidan och layouten hämtar data
i **nio sekventiella vågor**. Det är vågorna som växer när navet växer. I dag
kostar de inte nog för att motivera en omskrivning.

Mätningen saknar en sak: inloggad TTFB från produktionen. Den kräver en riktig
session i en webbläsare, och 20 ms per våga är uppskattat tills den finns.

### E0.6-passet hittade en säkerhetsbrist i 0002

`revoke execute on function ... from anon, authenticated` tar **inte** bort
PUBLIC-granten som Postgres ger varje ny funktion. Kommandot går igenom utan
varning och ändrar ingenting.

Följden: **`log_audit` har gått att anropa från vilken inloggad session som helst
sedan 0002.** En säljare kunde skriva i händelseloggen. Ingen data läckte, men
loggens värde som bevis gjorde det. `0027` stänger det och lägger
`alter default privileges` så att nästa funktion inte får samma hål.

**Skriver du en ny security definer-funktion:** den är nu stängd för klienten
som standard. Behöver den anropas inifrån en RLS-policy måste du ge den
`grant execute ... to authenticated` explicit, annars ger tabellen noll rader
åt alla.

---

## Vad som byggdes 2026-08-21 (storage-passet)

Hela storage-spåret plus den globala sökningen. Migrationerna `0022_filer`,
`0023_bilagor`, `0024_rollspel`. Resonemangen står i arbetsloggen; det här är
vad du behöver veta för att inte råka riva något.

### Det finns exakt en väg till en fil, och den skriver loggen först

`/filer/[id]`. Rutten läser filens rad **med användarens egen token**, skriver
öppningen i `file_access_log`, och skickar först därefter vidare till en
signerad URL som lever i trettio sekunder.

**Går loggskrivningen fel utfärdas ingen URL.** Det är avsiktligt och tvärtemot
den vanliga regeln att loggning inte ska fälla en funktion — här är loggen
själva kravet (K36).

**Lägger du till en fil någonstans:** använd `src/components/Filuppladdning.tsx`
och länka till `/filer/[id]` med ett vanligt `<a>`. Aldrig `<Link>` — Next
förladdar länkar när musen nuddar dem, och varje förladdning hade blivit en
loggad öppning som aldrig skedde.

### Uppladdningen går inte genom navet

Vercel tar emot högst **4,5 MB** i kroppen till en serverlös funktion, och en
server action är en sådan. Filen går därför direkt från webbläsaren till Storage
via en signerad uppladdningslänk, i tre steg: `forberedUppladdning()` →
webbläsaren laddar upp → `registreraFil()` frågar Storage vad som faktiskt kom
in och skriver raden.

Det tredje steget provar reglerna på nytt, och det måste det: efter omläggningen
är det klienten som beskriver sin egen fil i steg ett.

### Bucketen är stängd med en restriktiv policy

`storage.objects` har en **restriktiv** policy som nekar allt i bucketen `filer`
för `authenticated` och `anon`. En restriktiv policy AND:as med samtliga
tillåtande och går därför inte att OR:a bort med en ny policy någon lägger till
senare. Service role och signerade URL:er påverkas inte.

### Två textfält som inte får finnas

**Filnamnet på ett läkarintyg.** `filename` är NULL för `sick_certificate`,
tvingat av ett check-villkor: en fil som heter `cancerbesked.pdf` bär en diagnos.
Namnet som visas räknas fram ur datumet.

**Extraherad PDF-text på filraden.** Texten ligger i `document.attachment_text`
och aldrig på `file_object` — den tabellen bär också läkarintyg, och en
textkolumn där hade fyllts *automatiskt* med innehållet i ett intyg. Läs
rubriken i `0023` innan du flyttar den.

### Öppningarna ligger inte i `audit_log`

`audit_log_read` släpper in `admin`, som med flit är utestängd från
`sick_report` (AC-3.26). En rad om att någon öppnat ett läkarintyg hade
berättat precis det 0020 stängde. `file_access_log` har därför sin egen
behörighet: den som får se filen ser vem som öppnat den — **inklusive den som
är sjuk själv**, vilket är halva poängen med K36.

### En fil raderas inte för sig, men en människa går att radera

Triggern på `file_object` släpper igenom en radering när personen eller
dokumentet redan är borta, och nekar den när den står ensam. Utan det undantaget
hade `delete from employee` fallit, och E6.2 gallringsjobbet en dag dött på en
främmande nyckel mitt i natten.

### E8.7: två regler som är hela modulen

**Rubriken syns före inspelningen** — `roleplay_criterion` ärver modulens
läsbehörighet. **Den som inte öppnat inspelningen får inte bedöma den** — en
trigger frågar `file_access_log`. Det är första gången åtkomstloggen används
till något annat än att granskas i efterhand.

Kön ligger på `/utbildning/rollspel`, i chefens "Din kö" och i notisklockan.

### E2.13: sökningen frågar med användarens egen token

Fem källor, alla med den inloggades token — RLS avgör vad som syns. Lägger du
till en källa: gör likadant, och skriv inget eget målgruppsfilter.

**Fällan som redan trampats i:** PostgREST separerar villkoren i `or()` med
kommatecken. Ett osskyddat kommatecken i sökrutan gav HTTP 400 på hela sidan.
Använd `orVillkor()` i `src/lib/sokning.ts`, aldrig en handskriven sträng.

---

## Vad som byggdes 2026-08-21 (E15 lönekostnad)

Migration `0025_lonekostnad`. Hela epicet utom E15.7, som är blockerat av E11.

### Lönerapporten räknar fortfarande ingen lön

K5 och AC-2.17 står kvar. Skillnaden mot den nya vyn är inte kosmetisk:
lönerapporten är ett **underlag som lämnar navet** och får därför inte gissa;
lönekostnadsvyn är ett **beslutsunderlag som stannar här**, med en egen
behörighet. Kolumnerna i `payroll_row` är fortfarande minuter och antal.

**Blandar du ihop dem blir navet ett lönesystem.** Läs rubriken i 0025 först.

### K26: fyra roller får noll rader

`payroll_cost_viewer` och ingenting annat. Anna, teamledaren, **säljchefen** och
**ekonomi** får alla noll rader utan den. Ingen ser heller sin egen
lönekostnad — raden bär bolagets kalkyl på en person, inte personens egen
löneuppgift.

### Frånvaron kommer ur löneunderlaget, strukturellt

Beräkningen hänger på en **löneperiod**, inte ett datumintervall. Minuterna
finns bara i `payroll_row`, så det finns ingen naturlig väg att skriva frågan
fel. Det var precis vad ROADMAP E7.14 varnade för, och samma villkor gäller
**E13 provision** när den byggs.

### K27: födelseåret räcker exakt

Både ungdoms- och äldrenedsättningen utgår från åldern **vid årets ingång**, och
den som är född år B har den 1 januari år Y fyllt exakt Y − B − 1 år oavsett
födelsemånad. Det som är per kalendermånad i AC-13.5 är **taket**, inte åldern —
därför delas perioden på månadsskiften.

`tests/rls.mjs` frågar `information_schema` och faller om någon någonsin lägger
till en kolumn som bär personnummer eller födelsedatum.

### Inga tal ur skattelagstiftningen i koden

Sök i `src/lib/lonekostnad.ts` och du hittar 0, 1, 12 och 100. Allt annat kommer
ur `cost_rate`. **Saknas en sats blir den noll**, aldrig ett dolt
standardvärde — en nolla syns i vyn, ett standardvärde hade sett rätt ut och
tyst gjort tabellen överflödig.

### Tre ställen där siffran hellre är för hög

Frånvaro kostar som standard **fullt** (faktorn per typ är konfigurerbar).
Saknas födelseåret används **full** arbetsgivaravgift. Och täckningsgraden
seedas **inte alls** — en gissad täckningsgrad ger ett break-even som ser exakt
ut och är påhittat, och just den siffran är hela skälet att vyn finns.

För ett break-even är en underskattad kostnad farlig och en överskattad bara
försiktig.

### Ingen pension och inga försäkringar

Användarens besked 2026-08-21. De är därför inte seedade och ska inte läggas
till "för säkerhets skull" — en sats på noll i vyn ser ut som en kostnad någon
glömt fylla i.

---

## Vad som står på tur

### Säkerhetsgenomgången: en punkt kvar, och den är din

Grunden är stark — RLS på samtliga 68 tabeller, ingen skrivrätt för klienten,
behörighetskontroll först i varje server action. **Punkt 2, 3 och 4 är gjorda
natten till 2026-08-24** (migration `0032`). Kvar:

1. **Sätt `STEG2_SECRET` i Vercel.** Utan den signeras steg två-kvittot med
   `SUPABASE_SERVICE_ROLE_KEY` — samma hemlighet ger full förbigång av RLS.
   Fallbacken är medveten, men de två bör inte vara samma nyckel.
   *Följd:* alla chefer måste bekräfta sin enhet en gång till. Det är därför den
   inte gjordes åt dig — bytet avbryter för den som använder navet, och när det
   sker är ditt val.

### Prestanda: det som är kvar

- **Sessionen valideras två gånger per anrop** — `auth.getUser()` i mellanvaran
  och igen i `getCurrentUser()`. Att skicka vidare den verifierade identiteten i
  en request-header sparar en tur (~30–50 ms). *Gjordes inte:* `setAll` byter ut
  hela `response` när tokenen förnyas, så headern måste sättas efter det, och en
  miss där tappar den förnyade sessionskakan tyst. Värt att göra, men med prov.
- **`hamtaNotiser()` ställer sexton frågor per sidvisning, och det är MÄTT
  2026-08-27:** varje fråga kostar ~55 ms och ingen ger fler än nitton rader.
  Kostnaden är turen, inte frågan — en filtrerad `course_module` mätte 58 ms mot
  ofiltrerade 57. **Att filtrera de enskilda frågorna ger alltså ingenting.**
  Det enda som biter är sexton turer till en, alltså en `security
  invoker`-funktion som returnerar allt i ett svar. RLS skulle hålla, men sexton
  delfrågor ska då skrivas om i SQL och en som glider tyst ger en klocka som
  visar fel. Beställarens beslut när piloten växer. `employee` är ofiltrerad med
  avsikt — se arbetsloggen.
- **Sökningen är en våg djupare rättad 2026-08-27.** Rutinerna och nyheterna
  ställde prefixfrågan FÖRST när den snäva gett noll rader — alltså två vågor i
  precis det fall som redan är långsammast. De går parallellt nu. Marginalen är
  ändå den minsta i navet; håll ögonen på den.


E6.5 och X3 är gjorda 2026-08-23. **Piloten kan nu både rapportera fel och
mätas** — `/fel` fångar buggarna, `/adoption` visar om navet används alls. Alla
tre prestandakraven är mätta och klarade.

1. **Supabase-panelen och Zens stämpling** — användarens eget arbete, men
   påminn. Se listan ovan.
2. **X7 pilot** med tre personer i två veckor innan bredd. Inget tekniskt
   blockerar den längre. Peka pilotdeltagarna på "Rapportera fel" i
   sidopanelen — det är den vägen som gör piloten mätbar.
3. **E8.9 kursinnehåll** — åtta kurser ska skrivas. Ingen kod, men det är det
   som gör att 25 säljare kan lära sig samma sak utan att du upprepar dig. Nu
   går det dessutom att lägga ett rollspel sist i varje kurs.
4. **Skriv den första avtalsmallen.** `/avtal/mallar/ny`. Modulen är byggd men
   det finns ingen mall, och utan en publicerad mall går det inte att skapa ett
   avtal. Det är den enda av de nya funktionerna som inte gör något förrän du
   matat in innehåll — och sedan 2026-08-24 hänger **anställningsflödet** på
   den: utan mall skapar det inget avtalsutkast, utan lägger punkten i
   onboarding-checklistan i stället.
5. **Personnumret i anställningsavtalet — ett beslut som är ditt.** Navet lagrar
   inga personnummer (K27), så det utskrivna avtalet har en rad som fylls i för
   hand. Det går att ändra, men då är det K27-linjen som ska omprövas medvetet.
   Jag har byggt så att den inte går att kringgå av misstag.
6. **E10 resten**, ~1 vecka. **E10.9 anställningsflödet är klart 2026-08-24.**
   Kvar utan blockering: **E10.2 den publika ansökningssidan** med
   screeningfrågor — uppläggning för hand finns redan, och källattributionen är
   obligatorisk. Den rör den utloggade ytan, så CSP och spamskydd hör till
   arbetet. E10.8:s nattjobb väntar på fristen, E10.1/4/7 på mejlspåret.

### Mindre saker som ligger och väntar

- **`MS_PER_VAG = 20` är X3:s enda kvarvarande uppskattning, och den står kvar
  med avsikt.** En vågas kostnad är skillnaden mellan två körningar av samma
  sida där vågantalet skiljer med exakt en, och gamla deploy-adresser går inte
  att mäta mot (Vercel svarar 302). Tillfället fanns 2026-08-27 när sökningen
  gick från två vågor till en — före-mätningen missades. **Metoden står nu
  utskriven i `scripts/lib/matning.mjs`:** nästa gång en våg försvinner, mät
  `/sok?q=nagot-som-inte-finns` fem gånger före push och fem efter. Gissa inte
  in en siffra — talet var en gång 20 ms under ett antagande som visade sig vara
  fel med en faktor tjugo.
- **E0.7 är klar sedan 2026-08-27 (kväll).** Nattjobbet larmar om sig självt
  och färskhetskontrollen ligger på `/fel` och startsidan. Kvar när A5/A6
  besvaras: integrationerna själva, som ännu inte finns.
- **Sökningens marginal är 96 ms** på trängt 4G. Håll ögonen på den när en ny
  källa läggs till i `/sok`.

### E10: tre delar väntar på mejlspåret, en på en siffra

**E10.1** (IMAP-parser), **E10.4** (.ics och påminnelser) och **E10.7**
(avslagsmail) förutsätter E0.8, som är pausat. De är inte byggda. Sömmen är lagd
så att de kan läggas till utan schemaändring — säg till om mejlspåret tas upp.

**E10.8:s nattjobb väntar inte på kod utan på en siffra.** Hur länge ska en
kandidats uppgifter sparas efter avslutad process? Den frågan är inte besvarad
någonstans i repot. Sätt `recruitment_policy.purge_after_days` så börjar
`gdpr_purge_at` fyllas i av sig självt, och då — men först då — går jobbet att
bygga.

### E13 provision: skivan som är byggd, och resten

**Byggt 2026-08-23:** `commission_entry`, `/provision`, kortet på startsidan.
Manuell inmatning av ekonomi och VD.

**Byggt 2026-08-25:** steg 1–3. Kundordern, räknemotorn, volymtrappan och
periodstängningen. **Q78–Q80 är besvarade och E13 är inte blockerad längre** —
paketmatrisen ligger i `commission_rate`.

**Kvar och blockerat:** bara Inkio-importen (A5). Sömmen finns —
`source = 'inkio'` och `external_ref` — så integrationen kan skrivas utan
schemaändring. Huvudboken har sedan `0035` en tredje källa, `motor`, som
periodstängningen använder.

**Villkoren som styrde E15 gäller fortfarande E13:**

- **AC-3.26 / E7.14:** hämta frånvaro via `payroll_row.absence_minutes`. Aldrig
  genom att joina `sick_report` — RLS ger noll rader för `finance` och
  `payroll_cost_viewer`, så en vy som försöker får tyst fel data i stället för
  ett felmeddelande.
- **E13.1 / AC-10.1:** provisionsregler som konfiguration, inte kod. Samma linje
  som `absence_policy` och `cost_rate` redan drog. Lägg dem gärna i `cost_rate`
  om de är satser, annars i en egen tabell — men inte i ett `if`.
- **K13 / E13.9:** **omprövad 2026-08-23, se D-K13.** Provision och tid får stå
  på samma sida. Det som står kvar: ingen fråga joinar tabellerna, och
  rastavvikelser når fortfarande aldrig provisionen — det senare är ett löfte i
  K12 §5 och är inte omprövat.

### E6.2 gallringsjobbet är blockerat, inte bortglömt

`retention_until` finns inte som kolumn någonstans. Att bygga jobbet betyder att
först bestämma vilka tabeller som ska bära en gallringsfrist och hur lång den
är. Det är **P0.6 registerförteckningen** som ska svara på det, och den är inte
skriven.

Ett gallringsjobb med påhittade frister raderar personaldata enligt en gissning
och ser samtidigt ut att uppfylla K10. Bygg det inte förrän fristerna finns.

### Pausat på användarens uttryckliga begäran

Spåren **E0.8 transaktionell e-post**, **notisutskick** och **eget domännamn**
är pausade ("skippa mejl grejen helt", "glöm domän"). Ta inte upp dem igen utan
att bli tillfrågad.

### Obesvarat

- **A14** e-signeringsleverantör. Blockerar E9.2. **E9.1 är byggd utan den**
  (2026-08-22) och `contract` är förberedd — signeringen blir ett steg efter
  `issued`.
- **E15:** vem äger arbetsgivaravgift, pension och försäkringssatser.
- **Ö9, Ö11, Ö13** i `docs/PROVISION_SPEC.md`. Alla har ett förslag som gäller.
- **Ö16** vilken volymtrappa som gäller för en månad en ändring skär igenom.
  Byggd med ett förslag som gäller tills annat sägs.
- **A5** Inkio, **A6** dialer. Blockerar E11, E12 och E13 steg 8.
- **Personnumret i anställningsavtalet.** Navet lagrar inget (K27), så
  utskriften har en rad som fylls i för hand. Vill du ändra det är det
  K27-linjen som ska omprövas, inte avtalsmodulen.
