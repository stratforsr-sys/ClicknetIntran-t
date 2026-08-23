# Arbetslogg — Clicknet Nav

Läs denna före arbete. Uppdatera efteråt.
Kort lägesbild och nästa steg: **`docs/NASTA_SESSION.md`**.

---

## 2026-08-23 (sent) · Startsidan byggs om, och provisionen får sin första skiva

Beställarens uppdrag: startsidan ska ge rollstyrda snabbval — stämpla in, ut,
rast — plus ett litet ärendekort och ett kort som visar lönen. Fyra frågor
ställdes innan något byggdes, och tre av svaren ändrade vad som gick att göra.

### Frågan om lönen ledde till en annan modul än den som efterfrågades

"Ett kort där man ser sin lön" går inte att bygga som det står. Navet lagrar
ingen lönesumma den anställda får se: `salary_basis` är stängd för alla utom
`payroll_cost_viewer` (K26), och lönerapporten bär minuter och antal, aldrig
kronor (K5, AC-2.17).

Beställarens svar: **det ska stå intjänad provision, och den kommer med
Inkio-integrationen.** Alltså E13, som var blockerad av Q78–Q80 och A5.

Lösningen är en huvudbok utan motor. `commission_entry` tar emot poster som
någon annan bestämt — inga satser, ingen trappa, ingen procentsats i en `if`.
Det är samma linje som 0025 drog för lönekostnaden, och skälet är detsamma: en
gissad sats ser exakt ut och är påhittad, och just den siffran är den folk
kommer att bråka om.

**Rättelsen är en negativ post, inte en överskrivning.** Det är den enda
skillnaden mot `salary_basis`, och den är nödvändig: intjänad provision
ackumuleras, så "ny rad med nytt värde" hade dubbelräknats av varje summering.

**Sömmen mot Inkio är lagd men inte kopplad.** `source` och `external_ref` med
ett partiellt unikt index gör importen idempotent — samma affär kan skickas två
gånger utan att bli två poster. När A5 besvaras skriver Inkio i samma tabell och
ingen vy behöver röras.

**Behörigheten skiljer sig från K26 med flit.** Den anställda ser sin egen rad.
Lönekostnaden är bolagets kalkyl *på* en person; provisionen är personens egen
intjäning. Andras poster ser bara ekonomi och VD — beställaren sa "ekonomi/VD",
och säljchefen står därför utanför. En roll till är en rad i
`far_hantera_provision()`.

### K13 omprövades, och en del av den står kvar

K13 sa att provisionsdata och tiddata inte får samköras i någon vy. Uppdraget
krävde båda på startsidan. Frågan ställdes rakt ut, och beställaren valde att
K13 skrivs om.

Det som står kvar utan att kosta något:

- **Ingen fråga joinar tabellerna.** De hämtas var för sig i samma våg och möts
  i webbläsaren. Ingen vy kan alltså börja sortera säljare efter tid mot
  intjäning.
- **Rastavvikelser och sen ankomst når fortfarande aldrig provisionen.** Den
  delen är ett uttryckligt löfte till personalen i K12-intresseavvägningen §5
  och är inte omprövad. Att ompröva den kräver att K12 beslutas på nytt.

Se D-K13 i `DECISIONS.md`.

### Tidslinjen är en avbildning, inte en bedömning

Dagskortet ritar dagens stämplingar som segment mot schemat, med en markör för
nu och en nedräkning för den som är på rast.

**Ingenting färgas rött.** Det är inte en utebliven detalj. En linje som blir röd
när rasten drog över är en bedömning — och bedömningar hör hemma i
avvikelsemotorn, som har toleranser, kvittenskrav (AC-2.36) och en loggad
chefsöppning (K19) omkring sig. En sådan bedömning på startsidan hade dessutom
stått framför näsan på den som just kom tillbaka från lunch.

**Nedräkningen är byggd åt den som är på rast, inte åt någon annan.** Siffran
syns bara i personens egen vy. Den som får veta att rasten snart är slut *medan*
den pågår kan avsluta i tid — och då finns det ingen avvikelse att bedöma alls.
Det är samma uppgift som avvikelsemotorn annars räknar fram i efterhand, men
med motsatt verkan.

**Zens öppna stämpling provades särskilt.** Renderas sidan dygnet efter en
stämpling som aldrig stängdes blir `nu` mindre än starten. Segmentet fylls då
till dygnets slut i stället för att få negativ bredd. `tests/dagslinje.mjs`
håller det.

### Statusbandet är ett avsteg från UI-PRD §7

§7 sa att startsidan inte har någon hero. Beställaren bad om ett band med
personlighet, och det finns nu: hälsning, levande läge och arbetad tid som
tickar. Skillnaden mot en hero är att bandet bär information — det svarar på "är
jag inne och hur länge" utan en sidladdning till `/tid`.

**Tiden tickar i webbläsaren, och första renderingen använder serverns siffra
oförändrad.** Utan det blir det en hydreringskrock: servern skriver 192 minuter,
webbläsaren 193, och React kastar om hela trädet. Tickandet startar först i
effekten. Samma mönster i tidslinjen.

### Ärendekortet syns bara när det har något att säga

Beställarens val. Ett kort som varje dag säger "inga ärenden" är en ruta man
slutar läsa, och när den en dag säger något annat har ögat redan lärt sig att
hoppa över den. Vägen till ett nytt ärende ligger i snabbvalen och försvinner
alltså aldrig.

Kortet upprepar heller inte "över tiden" och "snart förfallna" — de står redan i
chefens kö, och en siffra som står på två ställen på samma skärm blir en siffra
man börjar jämföra i stället för att agera på.

### Två saker som fångades under arbetet

**`kronor()` skriver U+2212 MINUS SIGN**, för det är vad sv-SE använder. Ett
kopierat belopp gick därför inte att klistra tillbaka i rättelseformuläret —
navet nekade ett tal det själv skrivit ut. `tolkaBelopp` känner igen tecknet nu,
och provet kör hela vändan display → inmatning.

**En hjälpare höll på att bli en publik ändpunkt igen.** `foreslagenManad` låg
exporterad ur `"use server"`-filen innan den togs bort. Det är exakt bristen som
säkerhetsgenomgången hittade i `sattKvitto` samma dag. Filen har nu en rubrik som
säger att den exporterar en enda sak, och varför.

### Läget efter passet

Migration `0031_provision`. Typecheck grön, hela sviten grön: **1 175
kontroller**, varav två nya sviter (`provision`, `dagslinje`).

## 2026-08-23 (kväll) · Genomgång av säkerhet och prestanda

Användaren beskrev navet som "otroligt segt". Det stämde, och orsaken låg inte i
koden utan under den — men koden bidrog också. Fem commits, ingen ny migration.

### Funktionerna stod på fel kontinent

`vercel.json` saknade `regions`. Vercels standard är `iad1`, Washington DC.
Supabase står i `eu-north-1`, Stockholm. **Varje databasfråga i navet gick över
Atlanten och tillbaka.**

Mätt mot produktionen, isolerat. `/api/ical/[token]` gör noll frågor när token
är kortare än 32 tecken och exakt en när den är längre — den enda skillnaden
mellan de två anropen är en databastur:

| | 0 frågor | 1 fråga | skillnad |
|---|---|---|---|
| iad1 (före) | ~330 ms | ~790 ms | **~460 ms** |
| arn1 (efter) | ~250 ms | ~280 ms | **~30 ms** |

Samma fråga från en maskin i Stockholm med återbrukad anslutning: ~50 ms.

En rad i `vercel.json` gjorde varje databastur i navet ungefär **femton gånger
billigare**. Startsidans nio vågor kostade före fixen omkring fyra sekunder i
ren väntan.

### X3-mätningen kunde aldrig ha upptäckt det

`scripts/lib/matning.mjs` räknar vågor och multiplicerar med `MS_PER_VAG = 20`.
Talet står med motiveringen att "latensen härifrån till Supabase är HÖGRE än
från Vercels funktion, som står i samma region som databasen".

**Den meningen var fel, och det var den enda antagandet i hela X3.** Alla
X3-siffror var därför ungefär tjugo gånger för låga per våga. Startsidans
"762 ms på normalt 4G" var i verkligheten flera sekunder.

Läxan är inte att talet var fel utan att det var **ett antagande om produktion
som aldrig mättes mot produktion**. `scripts/mat-inloggad.mjs` finns nu och gör
just det: skapar en riktig användare, bygger sessionskakan i `@supabase/ssr`:s
format och hämtar sidorna över nätet som en webbläsare. `npm run mat:inloggad`.

Skriptet vägrar räkna ett svar som inte är 200 som godkänt. Första körningen
gick mot en gammal deploy-adress, fick fyra 302:or till Vercels inloggning och
rapporterade "alla sidor klarar sitt krav". **En mätning som ser grön ut när den
misslyckats är sämre än ingen mätning.**

### Vågorna: sex omgångar där en räckte

Startsidan ställde sina frågor i sex omgångar efter varandra. Ingen av dem
behövde svaret från den förra — de väntade för att de råkade stå i den ordningen
i filen. Nu är det en `Promise.all`. De villkorade frågorna står kvar som
villkorade; `Promise.resolve` håller platsen utan att kosta en tur.

`getCurrentUser()` gjorde tre frågor: användaren, `employee`, och sedan roller
och rättigheter. Nu en enda, med rollerna inbäddade. Varje sida i navet börjar
med det anropet.

**De inbäddade relationerna måste namnge sin främmandenyckel.** `employee_role`
och `employee_permission` pekar båda *två* gånger på `employee` — en gång på den
som har rollen (`employee_id`) och en gång på den som delade ut den
(`granted_by`). Utan namn avvisar PostgREST hela frågan med `PGRST201`, och då
blir `employee` null och **varje inloggad ser "väntar på aktivering"**.
Typecheck säger ingenting om det; det syns först mot databasen. Båda varianterna
provades mot produktionsdatabasen innan de gick in.

### Notisklockan höll tillbaka hela navet

`hamtaNotiser()` ställer sexton frågor. De går parallellt, men de låg i
`(app)/layout.tsx` — och **en layout måste vara klar innan någon del av sidan
får skickas.** Sexton frågor som ingen bett om höll alltså tillbaka både skalet
och innehållet vid varje sidvisning.

Nu ligger de bakom `<Suspense>` i `components/shell/Klocka.tsx`. Ingen fråga är
borttagen och ingenting läser annorlunda — det som ändrats är vad som får vänta
på vad. `Skal` och `Topbar` tar numera en färdig nod (`klocka`) i stället för en
lista notiser, just för att toppraden ska kunna ritas innan svaren finns.

### Det som inte handlade om millisekunder

**Navet hade ingen `loading.tsx` någonstans.** Utan en laddningsgräns gör ett
klick i menyn ingenting synligt förrän servern är helt färdig: skärmen står
still, den gamla sidan ligger kvar, och den som klickade vet inte om trycket
togs emot — så hen klickar igen.

Det är den delen av "segt" som ingen mätning fångar. En sida som tar 600 ms och
svarar direkt känns snabbare än en som tar 400 ms och står stilla hela vägen.
`src/app/(app)/loading.tsx` täcker allt bakom inloggningen.

Formen är med flit innehållslös. Ett skelett som gissar sidans form har fel på
de flesta sidor, och ett skelett med fel form är ett hopp till när det rätta
kommer.

### Sökningen, och en skrivning som stod i vägen

Sökmissen skrevs med `await` **före** svaret. Den träffade alltså just den
sökning som redan varit långsammast — den som inte hittade något och därför
hunnit prova både den smala och den breda frågan. Nu `after()` från
`next/server`: körs efter att svaret gått iväg men innan funktionen får
avslutas. Ett lösryckt löfte utan `await` hade plattformen kunnat avbryta mitt
i, och då hade statistiken tappat rader utan att någon märkt det.

Rollerna i träfflistan bäddas in i personalfrågan i stället för en följdfråga.

### `raknaPeriod` gjorde femtio turer för ett knapptryck

Två frågor per anställd inuti loopen — en för lönen, en för raden — och de gick
efter varandra. Nu hämtas lönerna i en fråga (`hamtaLonerFor`) och raderna
skrivs i en `insert`. Beräkningen är oförändrad; det som ändrats är när
databasen frågas, inte vad den svarar.

### Mellanvaran betalade för besked den inte behövde

`/api` hoppar nu över hela sessionskontrollen. Rutterna där autentiserar sig
själva — nattjobbet med `CRON_SECRET`, kalenderflödet med sin hemliga adress,
felrutten med sitt ursprung. Nattjobbet betalade en tur till Supabase Auth för
att få reda på att det inte har någon session.

### Resultat

Inloggad, median av sex hämtningar, varm funktion. Nätgolvet från mätmaskinen är
~215 ms — även en statisk fil från CDN:en kostar så mycket härifrån.

| Sida | Före | Efter | Krav |
|---|---|---|---|
| Startsidan | 1 029 ms | ~550–660 ms | 1 500 |
| Stämplingsvyn | 722 ms | ~630 ms | 2 000 |
| Sökningen | 1 231 ms | ~460–570 ms | 500 |
| Rutinerna | 954 ms | ~470–500 ms | 1 500 |

"Före" är mätt **efter** regionfixen. Mot iad1 var siffrorna flera sekunder, och
den jämförelsen går inte att göra om — gamla deploy-adresser är skyddade och
svarar 302.

Sökningen ligger på gränsen till sitt krav. Kravet gäller mjuk navigering utan
uppkopplingskostnad, och mätningen ovan bär hela HTTP-anropet, så den är
strängare än kravet. Marginalen är ändå den minsta i navet — håll ögonen på den.

**Siffrorna varierar mycket mellan körningar.** En kall funktion ger 1 300 ms
där en varm ger 470. Läs medianen av flera körningar, inte en enskild.

### Säkerhetsgenomgången

Genomgång av RLS, behörighetskontroller, nyckelhantering, CSP och rutter.
**Grunden är genomgående stark:**

- RLS är påslaget på **samtliga 68 tabeller**, ingen har noll policyer av
  misstag (de fyra som har det — `activity_day`, `search_miss`, `quiz_option`,
  `schema_migrations` — är avsiktliga och ger klienten noll rader).
- **Ingen skrivrätt alls** för `anon` eller `authenticated` direkt på någon
  tabell.
- Varje server action kontrollerar behörighet **först**, före varje
  `supabaseAdmin()`. Ångra-dispatchern gör om hela kontrollen och litar inte på
  kvittot. Genomgången hittade ingen handling som saknar kontroll.
- `log_audit` och `registrera_fel` är stängda för klienten — 0027 gjorde det den
  påstår.
- Markdown renderas utan `rehype-raw`, så ett dokument kan inte smuggla skript.
- Ingen `"use client"`-fil importerar serverkod eller service role-nyckeln.

**Det som bör åtgärdas, i ordning:**

1. **`STEG2_SECRET` är inte satt i Vercel.** `src/lib/mfa.ts` faller då tillbaka
   på `SUPABASE_SERVICE_ROLE_KEY` som HMAC-nyckel för steg två-kvittot.
   Fallbacken är medveten och dokumenterad, men den kopplar ihop två skilda
   säkerhetsdomäner: samma hemlighet signerar enhetskvitton och ger full
   förbigång av RLS. Sätt en egen. **Följd att veta innan:** alla chefer måste
   bekräfta sin enhet på nytt en gång.
2. **`sattKvitto` är exporterad ur en `"use server"`-fil** och är därmed en
   publik ändpunkt, inte bara en intern hjälpare. Den kan bara sätta ens egen
   toast-kaka och texten renderas av React, så det är ingen XSS — men en
   hjälpfunktion ska inte publiceras som en handling. Flytta den, eller låt den
   ta emot bara det som `ANGRABARA` tillåter.
3. **`CRON_SECRET` jämförs med `!==`.** Byt till en konstanttidsjämförelse. Låg
   risk över HTTP, men det är två rader.
4. **`anon` har `execute` på tretton RLS-predikat** (`has_role`,
   `leads_employee`, `far_rekrytera` med flera). Det är avsiktligt enligt 0027
   och 0028 och läcker ingenting — alla utgår från `auth.uid()`, som är null för
   `anon`. Men granten behövs inte, och den gör nästa `security definer`-funktion
   lättare att skriva fel. Överväg `authenticated` ensamt.

Ingen av punkterna är en öppen dörr. Punkt 1 är den enda med verklig
konsekvens om något annat går fel.

---

## 2026-08-23 · Testhärdning, adoptionsstatistik, X3 färdigmätt och E10 påbörjad

Fyra punkter i den ordning användaren bad om dem: radräkningarna i proven, E6.5,
resten av X3 och första skivan av E10. Migrationerna `0029_adoption` och
`0030_rekrytering`. 957 → 1 080 kontroller.

Sviten var **grön** när passet började — andra gången i rad. Två av tre
körningar dog dock på nätverket innan de kom fram (`Connection terminated`,
`ETIMEDOUT` mitt i en inloggning), utan en enda fallen kontroll. Det är värt att
veta för nästa session: **en röd körning ska läsas innan man tror på den.** Ett
avbrott mitt i ser i förbifarten ut som ett fel i navet.

### Radräkningarna: hypotesen var fel, och det som fanns var värre

NASTA_SESSION sa "det finns troligen kvar några". Genomgången av samtliga 105
radräkningar i `tests/rls.mjs` plus de 51 i övriga tjugo sviter gav ett annat
svar: **säljchefen och ekonomin är redan rättade**, från passen 21 och 22
augusti. Av de 105 är 66 stycken `=== 0`, vilket alltid är säker riktning.

Två slutsatser föll bort på vägen och båda är värda att skriva ner, så att ingen
gör om arbetet:

- **`absence_policy` med exakt en rad är inte skört.** Tabellen har
  `id boolean primary key default true check (id)` — den kan aldrig få en andra
  rad. Provet är bevisbart stabilt.
- **De rena logiksviterna räknar inte databasrader.** raster, franvaro,
  lonerapport, lonekostnad, arenden, tid, avtal, rollspel och utbildning provar
  funktioner mot påhittade indata. Deras 51 räkningar kan inte falla på drift.

Det som däremot fanns var **teamledaren**, och bristen var av ett annat slag än
den letade efter. Sex kontroller räknade hela tabellen för Cecilia:
`sick_report`, `sick_deadline`, `absence_request`, `absence_balance`,
`file_object`, `file_access_log` och `roleplay_submission`.

De var gröna. Men de var gröna **av fel skäl**, och det syns först när man
räknar i datan i stället för i koden:

| Tabell | Rader i produktionen |
|---|---|
| sick_report, sick_deadline | 0 |
| absence_request, absence_balance | 0 |
| file_object, file_access_log | 0 |
| roleplay_submission | 0 |

Sju tomma tabeller. Kontrollen `(await las(tC, "sick_report")).length === 1`
bevisade alltså ingenting om policyn — den bekräftade bara att tabellen var tom
i övrigt. Den hade svarat likadant om teamledaren kunnat se **allt**.

Och alla sju fylls så fort piloten börjar. Den dagen blir de röda utan att något
är trasigt, precis som kalenderflödet blev 2026-08-20.

Rättningen är samma som för David: fråga på provradens id. Regeln står nu
utskriven överst i `rls.mjs` med de två undantagen (`=== 0` alltid, `>= n`
likaså) och med de fyra tillfällena uppräknade, så att nästa modul inte
återinför formen.

**Kvar att veta:** teamledarens krets består i dag bara av provets egna
användare, eftersom testet skapar Cecilia och pekar Anna på henne. Det är en
egenskap hos uppsättningen och inte hos policyn — därför fråga på id även där.

### E6.5: varför adoption inte får bli en närvaroregistrering

`audit_log` bär skrivningar. En säljare som loggar in, läser tre rutiner och går
hem skriver ingenting där. En DAU räknad ur händelseloggen hade mätt hur många
som **ändrar** något, inte hur många som **använder** navet — och siffran hade
sett rimlig ut, vilket är det som gör den farlig. `last_sign_in_at` bär bara
senaste gången och kan inte svara på hur många som var inne i tisdags.

Alltså en egen tabell. Och där ligger hela beslutet:

**`activity_day` bär en dag, inte ett spår.** En rad per person och dygn. Inget
klockslag, ingen sökväg, ingen sida. Navet har redan en närvaroregistrering (M2)
med rättelse, attest och lönepåverkan omkring sig. Ett andra, informellt spår
utan den styrningen är sådant som ser ofarligt ut när det byggs och används till
något annat när det väl finns.

**Tabellen har ingen select-policy alls.** RLS är påslagen och ingen policy
släpper igenom någon — per-person-raderna går inte att läsa via API:t, inte ens
för säljchefen. Siffrorna kommer ut genom `adoption_aktivitet()`, som svarar med
antal. Provet i `rls.mjs` frågar därför både på listan och på den egna raden: en
policy som döljer listan men släpper igenom en punktfråga är ingen policy.

**Raden följer däremot med i registerutdraget.** Den handlar om personen, alltså
har hen rätt att få ut den (artikel 15). Utdraget körs med service role och
påverkas inte av att policyn saknas. `activity_day` står i `KALLOR` — och det är
inte frivilligt: utan raden faller `tests/registerutdrag.mjs`, vilket är precis
vad den kontrollen finns till för. Den fällde det här passet en gång.

**`search_miss` har ingen person.** Inte en policy som döljer vem som sökte —
ingen kolumn att dölja. AC-12.5 frågar vad folk söker efter utan att hitta, och
svaret behöver texten, inte vem som skrev den. En rad per unik sträng med en
räknare, samma form som `error_report` i 0026 och av samma skäl: en logg per
sökning hade vuxit utan tak och sagt mindre.

#### Kakan sätts efter rpc-anropet, inte före

Dagsstämpeln ligger i mellanvaran — det enda stället som ser varje begäran — och
hålls tillbaka av en kaka med dagens datum. Högst ett anrop per person, enhet och
dygn.

Den detalj som kostade en omskrivning: `setAll` i Supabase-klienten **byter ut
hela `response`-objektet** när tokenen förnyas. En kaka satt före `rpc()` hade
suttit på det gamla objektet och försvunnit tyst — och dagen hade bokförts om
vid varje sidbyte. Kakan sätts därför sist, på `response` som den står då.

#### Två normaliseringar som ser små ut

`registrera_sokmiss` gör `btrim(left(lower(btrim(...)), 100))`. Den **yttre**
btrim är inte överflödig: kapningen till 100 tecken kan sluta mitt i ett
mellanslag, och då hade tabellvillkoret `q = lower(btrim(q))` nekat raden. En
lång sökning hade fallit i stället för att bokföras. Provet täcker exakt det
fallet.

`klibbighet()` och `tackning()` svarar `null` och inte `0` när nämnaren saknas.
En nolla hade sett ut som ett svar.

### X3: sök och stämpling mäts som något man gör när man redan är inne

Kravet på startsidan är 1,5 s och gäller den som **öppnar** navet. Kraven här är
500 ms och 2 s och gäller den som **redan står på en sida** och skriver i
sökrutan eller trycker på knappen. I Next är det en mjuk navigering respektive
ett server action-svar: skalet med notisklockans tretton frågor renderas inte om,
och skriptet är redan hämtat. Uppkopplingen räknas därför inte heller.

Att räkna med dem hade mätt en helt annan händelse än den kravet handlar om, och
gjort båda måtten hopplösa av fel skäl.

| Mått | Vågor | Normalt 4G | Trängt 4G | Krav |
|---|---|---|---|---|
| Sök | 4 | 296 ms | **404 ms** | 500 ms |
| Stämpling | 15 | 525 ms | 651 ms | 2 s |

**Sökningens marginal på trängt nät är 96 ms — den minsta i navet.** Startsidan
har 338 ms och stämplingen 1 349 ms. Lägger någon till en sjätte källa i
sökningen ryms den i den befintliga vågen; lägger någon till ett steg som måste
vänta in sökningen gör den inte det.

**Stämplingens 15 vågor är sex i actionen och nio i omrenderingen av `/tid`**,
som `revalidatePath` tvingar fram. Omrenderingen är alltså dyrare än själva
stämplingen. Det är där en åtgärd ligger om siffran någonsin blir ett problem —
inte i `stampla()`.

En sak som förvånade: **en sökning utan träff kostar lika mycket som en med.**
Med träff går en våg åt att slå upp rollnamn för personerna i träffen; utan
träff går samma våg åt att bokföra sökmissen (E6.5). Fyra vågor i båda fallen.

Det gemensamma är utbrutet till `scripts/lib/matning.mjs`. Startsidan mättes om
efteråt och gav samma struktur: 9 vågor, 162 kB.

#### Städningen måste koppla ur AC-2.3

Mätningen skriver en riktig stämpling, och den går inte att radera — inte ens
via en cascade från `employee`. Triggern kopplas ur medvetet, precis som i
`tests/rls.mjs`. `audit_log` städas på `actor_id` och aldrig bredare: driftens
rader är bevis (AC-12.1) och får inte försvinna för att någon mätte en sida.

Två avbrutna körningar hann lämna en mätanvändare kvar innan det var på plats.
`stad()` körs därför både före och efter, så att nästa körning självläker.

### E10: tre av tio delar går inte att bygga, och det upptäcktes före kodningen

Vid planeringen, innan något skrevs: **E10.1** (IMAP-parser mot jobb@clicknet.se),
**E10.4** (.ics-bilaga och påminnelser via e-post) och **E10.7** (avslagsmail)
förutsätter alla E0.8 transaktionell e-post, som är pausat på användarens
begäran.

Valet blev att bygga de sju övriga och lämna en söm. Alternativet — att låta
hela epicet vänta på ett spår användaren själv pausat — hade varit att låta ett
gammalt beslut blockera fyra veckor arbete som inte berörs av det.

Sömmen är konkret: kandidaten kommer in via `source_slug` oavsett vem som skapade
raden, och `candidate_stage_event` bär redan varje steg som ett mejlutskick skulle
hänga på. Parsern och utskicken kan läggas till utan schemaändring.

#### En kandidat får inte bli en anställd av misstag

Ingen rad i `employee` skapas från rekryteringen. `candidate.hired_employee_id`
pekar åt andra hållet och sätts först av E10.9.

Skälet är inte prydlighet. Varenda RLS-policy i navet är skriven utifrån att en
rad i `employee` är någon som **arbetar** här. En kandidat i samma tabell hade
samma sekund blivit synlig i personalregistret, i den globala sökningen och i
notisklockan — för folk som inte ens vet att hen sökt.

#### Stegen och scorecardvillkoret ligger i databasen

AC-7.3 vill ha stegflödet med varje byte loggat, AC-7.6 att ett erbjudande är
omöjligt utan minst en ifylld scorecard. Båda är triggrar, inte if-satser i en
knapp:

- Loggen kan inte glömmas bort av en server action som skrivs om ett halvår.
- Ett steg kan inte hoppas över av en klient som postar rakt mot API:t.
- `hired` går bara från `offer`. Kunde man gå direkt från screening vore
  scorecardvillkoret verkningslöst.

Provet kör **hela matrisen** — varje steg mot varje annat — och det är samtidigt
provet på att `nastaSteg()` i biblioteket stämmer med triggern. Listan står på
två ställen med flit: gränssnittet måste veta vilka knappar det ska rita. Något
måste märka när de glider isär.

#### Gallringsfristen är inte skriven, så ingen seedas

Det här är passets viktigaste fynd, och det motsäger en formulering jag själv
hade skrivit in i NASTA_SESSION tidigare samma dag.

AC-7.8 och K21 säger att `gdpr_purge_at` ska sättas automatiskt. De säger
**inte efter hur länge**. Siffran finns inte i ROADMAP, inte i P0.6 — som inte
är skriven — och ingen annanstans i repot. Påståendet att "fristen står i
AC-7.8/K21" var en slutsats dragen ur AC-referensen, inte ur en text.

Det är exakt läget som blockerar E6.2, och svaret är detsamma:
`recruitment_policy.purge_after_days` är NULL, ingen frist sätts, och
gallringsjobbet ska vägra köra tills någon bestämt. En påhittad frist raderar
personuppgifter enligt en gissning och **ser samtidigt ut att uppfylla kravet**.

Skillnaden mot E6.2 är att kolumnen finns från början. När siffran kommer räcker
en rad i konfigurationen; ingenting byggs om. Provet kontrollerar båda hållen:
utan frist sätts ingen, med frist sätts den, och talangpoolen undantas.

#### K27 gäller intervjuanteckningen, inte bara avtalet

Rekrytering har fler fritextfält än någon annan modul, och en intervjuanteckning
är precis där ett personnummer hamnar. Villkoret ligger därför på varje sådant
fält — `notes`, `strengths`, `concerns` — och inte bara på ett.

Uttrycket är detsamma som 0028 använder, nu som en funktion så att det finns en
definition och inte en per modul. **Följden, utskriven:** ett mobilnummer skrivet
som tio siffror i rad faller också. Det går inte att skilja `0701234567` från ett
samordningsnummer utan sekel. Numret har ett eget fält, så det som stängs ute är
att skriva det i en anteckning i stället. Med bindestreck går det igenom.

#### Behörigheten är en permission, inte bara en roll

Q71: flera personer rekryterar, och vilka det är följer inte av rollen. En
teamledare kan rekrytera till sitt eget team utan att därför få se löneunderlag.

Ledningen får det på rollen så att modulen fungerar direkt; andra får `recruiter`
tilldelad. **Skillnaden mot K26 är avsiktlig.** Lönekostnad kräver behörigheten
av *alla* — och det är en av de fyra saker användaren fortfarande måste göra för
hand innan den vyn visar något. Rekrytering ska inte kräva samma steg för att ens
starta.

#### Två fel som byggkedjan fångade, och ett tredje som proven gjorde

`vercel` fällde bygget på att Supabase härleder radens typ ur select-**litteralen**.
En sträng hopslagen med `+` går inte att läsa, så raden blev `GenericStringError`
och varje fältåtkomst ett typfel. Produktionen påverkades inte — en trasig build
ersätter aldrig den version som kör — men det kostade en runda.

Efter det fick jag användarens ja till att köra `npm run typecheck` lokalt före
push. Det fångade fel två direkt: `recruiter` saknades i `PERMISSIONS` i
`roles.ts`, listan som speglar check-villkoret i databasen. Utan den går
behörigheten inte att tilldela i gränssnittet.

Det tredje hittade provet: en kandidatradering kaskaderar till stegloggen, som
triggern nekade. Samma fälla som `file_object` löste i 0023 — och den hade dödat
E10.8 gallringsjobbet mitt i natten, på en främmande nyckel, utan att någon såg
det. Stegloggen släpper nu igenom en radering när kandidaten redan är borta, och
aldrig annars. Migrationen rättades i stället för att lappas: den hade aldrig
lämnat scratchpaden, tabellerna var tomma, så den rullades tillbaka och kördes om.

---

## 2026-08-22 · Felrapportering, avtalsmallar, ångra — och två fel som proven hittade

Fyra punkter i den ordning användaren bad om dem: E0.6, E9.1, E5.7 och
E5.3/X3. Migrationer `0026_felrapportering`, `0027_rpc_stangs_for_klienten`,
`0028_avtalsmallar`. 831 → 957 kontroller.

Sviten var **grön** när passet började, för första gången på tre pass. Den blev
röd en gång under vägen, och det avsnittet står sist här nere eftersom det är
det som är värt något.

### E0.6: varför det inte blev Sentry

ROADMAP säger "Sentry eller motsvarande". Det blev motsvarande, och valet följer
av beslut som redan var fattade snarare än av en åsikt om Sentry:

1. **K23.** En stackspårning bär sökväg, `employee_id` och ibland ett värde ur
   en rad. Sentry är ett personuppgiftsbiträde till, och P0.6
   registerförteckningen som ska redovisa det är inte skriven. Exakt samma skäl
   blockerar E6.2 gallringsjobbet — det vore inkonsekvent att låta det stoppa
   det ena och inte det andra.
2. **CSP:n.** `connect-src` är `'self'` plus Supabase. En tredjepartsvärd kräver
   att den öppnas.
3. **Larmvägen.** Sentry larmar med mejl, och mejl är pausat. En felrapportering
   vars enda utgång är avstängd mäter ingenting.
4. **A14-lärdomen.** Ett obesvarat leverantörsval ska inte blockera funktionen.
   Egen tabell går att byta mot Sentry senare; det omvända går inte.

**Det fanns ingen felgräns alls i navet.** Varken `error.tsx` eller
`global-error.tsx` fanns, så ett renderingsfel gav Next standardsida och ingen
fick veta. Det var det största hålet, inte avsaknaden av en tjänst.

#### Digesten är det enda som håller ihop de två halvorna

I produktion ger Next klienten **bara** `error.digest`, aldrig meddelandet — med
flit, eftersom ett felmeddelande berättar hur systemet är byggt. Klientens
felgräns kan alltså inte rapportera vad felet var.

Därför `instrumentation.ts` och `onRequestError`, som är samma krok Sentry själv
hakar i. Servern skriver raden med text och stack, klienten skriver samma
digest, och `registrera_fel` lägger ihop dem. Utan den filen hade kön bestått av
rader som säger "fel på /franvaro (a1b2c3d4)" och inget mer.

#### En automatisk rapport är en grupp, inte en händelse

Ett trasigt anrop på startsidan är inte ett fel per besök, det är ETT fel som
träffat tjugo personer. Dedupliceringen ligger på ett partiellt unikt index på
`(digest, path)`. Utan den skriver en kraschloop tusen rader i minuten och
begraver nästa bugg.

Ett avslutat fel som kommer tillbaka återgår **inte** tyst till `new` —
räknaren går upp så att återfallet syns, men en människa får fatta beslutet igen.

#### Maskeringen är förutsättningen för att släppa in admin

`file_access_log` i 0022 stängde ute `admin`, eftersom en rad där bär uppgiften
att någon är sjuk. Felkön släpper in admin — och det behövde motiveras, inte
bara bestämmas.

Skillnaden är vad raden bär. En felrapport bär en sökväg och en maskerad
feltext, och den som ska laga felet är admin. Men "maskerad" måste betyda något:
postgres svarar `Key (email)=(anna@clicknet.se) already exists`, och då ligger en
e-postadress i tabellen. `maskera()` tar bort e-post, personnummer och uuid.

**Faller maskeringen faller också skälet att släppa in admin.** Därför provas
den för sig i `tests/fel.mjs`, med det verkliga postgres-felet som testfall.

Maskeringen sker före klippet. Klipps texten först kan ett halvt personnummer
överleva klippet och slippa undan maskeringen — det provas också.

#### Knappen är hela poängen

Tre pilotanvändare som hittar buggar utan att de når någon är en pilot som inte
mäter något. `/fel/nytt` är därför öppen för **alla** inloggade, utan
rollkontroll, och posten i sidopanelen heter "Rapportera fel" för den som inte
är chef. En rapportväg som kräver behörighet rapporterar bara de fel cheferna
själva stöter på.

Formuläret har ett fält och en kryssruta. Allt annat — sidan, webbläsaren,
tidpunkten, vem du är — vet navet redan. Sidan läses ur `document.referrer`,
inte ur `location.pathname`: formuläret ligger på `/fel/nytt`, alltså den enda
sida i navet där felet garanterat inte var.

Rapportören ser sin egen rapport i kön. Utan det är knappen en brevlåda utan
lucka — man skickar in något, får aldrig veta om det lästes, och slutar skicka.

### E9.1: tre beslut, och ett som användaren bör titta på

Avtalsmallar går att bygga utan A14. E9.2 e-signering är fortsatt blockerad, och
ingenting i schemat förutsätter vilken leverantör det blir.

**Avtalet fryser malltexten.** `contract.body_md` är det färdigrenderade
dokumentet, inte en pekare till mallen. Det som en människa skrev under är det
som stod då. En trigger nekar att ett utfärdat avtal skrivs om; det går att dra
tillbaka, inte att ändra. Följden är trevlig: en publicerad mall går att
stavfelsrätta utan att arkivera den, eftersom rättningen inte kan nå bakåt.

**Lönen skrivs in i avtalet och läses inte ur `salary_basis`.** Två skäl, och
det andra är det viktigare: `salary_basis` ligger bakom `payroll_cost_viewer`
(K26) medan den som lägger upp en anställd är en bredare krets — men framför
allt är riktningen omvänd. Avtalet är *källan* till siffran. 0025 säger det
redan rakt ut: den anställda får sin lön "ur sitt anställningsavtal". Avtalet
skriver därför heller ingen rad *i* `salary_basis`; den tabellen är append-only
med eget `entered_by`, och en automatisk rad hade sett ut som en inmatning.

**En ofylld platshållare renderas aldrig som tomt.** `{{manadslon}}` som blev en
tom rad ger ett avtal utan lön som går att skriva under. Okända fält stoppas när
mallen sparas — den som skriver har texten framför sig och vet vad hon menade —
och saknade värden när avtalet skapas.

Ett utkast syns **inte** för den det gäller. RLS släpper fram raden först när
den är `issued`. Ett utkast där någon provar sig fram med en siffra ska inte
ligga synligt för den siffran handlar om.

#### Personnummer: det du bör titta på

Navet lagrar inget personnummer någonstans, och `tests/rls.mjs` faller den dag
en **kolumn** som bär ett dyker upp. `contract.variables` är jsonb — alltså
precis stället där ett kunde smyga in utan att den kontrollen ser det.

Lösningen blev ett check-villkor som nekar personnummerformade strängar i hela
jsonben, plus samma kontroll i koden för att ge ett begripligt besked. Ett prov
faller om någon lägger till `personnummer` som mallvariabel.

**Följden är verklig:** det utskrivna anställningsavtalet har en rad där
personnumret fylls i för hand. Det är ovanligt, och det är en konsekvens av
K27-linjen snarare än av ett krav på avtal. Vill du att navet ska bära numret
är det K27 som ska omprövas medvetet — jag har byggt så att det inte går att
kringgå av misstag, inte så att beslutet är fattat.

Utskrift i stället för PDF-generering: `pdf.ts` **läser** en PDF, den skriver
ingen, och att välja ett bibliotek är ett större beslut än E9.1 behöver fatta.
`globals.css` fick ett `@media print`-block — det fanns inget förut.

### E5.7: ångra är en invers åtgärd, inte en fördröjd skrivning

Det vanliga mönstret är att vänta åtta sekunder med att utföra något och avbryta
om någon trycker ångra. Det går sönder på första kontakten med verkligheten:
användaren stänger fliken, nätet dör, funktionen skalas ned — och åtgärden hon
*trodde* var gjord blev aldrig av. Ett tyst uteblivet arkiverande är värre än
ett arkiverande hon får ångra.

Här sker åtgärden direkt, och ångra kör motsatsen som en **egen rad** i
`audit_log`. Den ursprungliga raden står kvar; att sudda den hade gjort loggen
till en berättelse om vad som blev kvar, inte om vad som hände.

Det avgör vilka knappar som får finnas. Tre gör det: arkivera nyhet, avsluta
felrapport, arkivera avtalsmall. Publicera nyhet får ingen — det går inte att ta
ur någons minne, och den spärren stod redan skriven i nyheternas `actions.ts`.
Stämpling får ingen (AC-2.3). Utfärda avtal får ingen; det heter "dra tillbaka"
och kräver ett skäl.

Att nyheten går att ångra beror på en regel som redan fanns: `published_at`
sätts bara första gången, så ett återpublicerat inlägg dyker inte upp som nytt i
någons klocka. Utan den hade arkiveringen inte varit ångrabar utan biverkning.

Kvittot går via en kortlivad kaka i stället för klienttillstånd, eftersom
åtgärderna är server actions som omdirigerar. **Dispatchern litar inte på den:**
listan är stängd, id-formen provas, och varje gren gör om hela
behörighetskontrollen. Att kvittot bara *visas* för den som gjorde åtgärden är
en följd av att kakan sattes i hennes svar — och en följd är inte ett skydd.

Nedräkningen pausar under pekaren och stängs av helt vid tangentbordsfokus. En
ångra-knapp som försvinner mitt i ett tangentbordssteg finns inte för den som
använder tangentbord.

### E5.3 / X3: mätt för första gången

`scripts/mat-startsidan.mjs`. Skriven som ett skript och inte som en
engångsmätning, så att siffran går att ta om när navet vuxit.

**Startsidan klarar 1,5 s i båda profilerna.**

| | Normalt 4G (10 Mbit/s, 50 ms) | Trängt 4G (3 Mbit/s, 100 ms) |
|---|---|---|
| Uppkoppling | 150 ms | 300 ms |
| Svar | 480 ms | 530 ms |
| Hämtning | 133 ms | 442 ms |
| **Totalt** | **762 ms** | **1 272 ms** |
| Marginal | 738 ms | 228 ms |

Vad som är mätt och vad som är räknat, eftersom skillnaden avgör hur mycket
siffran är värd:

- **Mätt:** nyttolasten (162 kB över nätet, komprimerat), mellanvarans svarstid
  mot produktionen (250 ms median), och de nio vågorna mot riktiga databasen.
- **Uppskattat:** 20 ms per våga inifrån Vercel. Funktionen och Supabase står
  båda i eu-north-1, så det är pessimistiskt tilltaget.
- **Inte mätt:** den inloggade sidans TTFB från produktionen. Sidan ligger bakom
  inloggning och en session går inte att skapa från ett skript utan att göra
  avkall på något. **Det kräver en riktig webbläsare med en riktig session** —
  det är den enda siffran som saknas, och den ersätter uppskattningen ovan.

Två fällor på vägen är värda att skriva ut. Nodes `fetch` sätter sin egen
`accept-encoding` och packar upp svaret, så både `arrayBuffer().byteLength` och
`content-length` gav den **uppackade** storleken — 513 kB där curl ger 162 kB.
En 4G-uppskattning byggd på den blir tre gånger för pessimistisk, och den första
körningen sa följaktligen "över 1,5 s". Skriptet använder curl nu.

Den andra: många snabba anrop i rad ger ibland ett TLS-handslag som inte går
igenom, och det tog ned hela mätningen på sista filen. Ett återförsök, inte ett
avbrott.

**Det som faktiskt är värt något i mätningen är inte totalsiffran utan de nio
vågorna.** Startsidan och layouten hämtar data i nio *sekventiella* omgångar —
varje `await` väntar in den förra. Notisklockan är den tyngsta ensam (13 frågor
i en våga, vilket är rätt: de går parallellt). Det är vågorna som växer när
navet växer, och det är den enda delen som går att göra något åt i kod. I dag
kostar de inte tillräckligt för att motivera en omskrivning; noteringen finns
för den dag marginalen på 228 ms äts upp.

### Två fel som proven hittade, och det ena är en säkerhetsbrist

#### `revoke ... from anon, authenticated` gjorde ingenting

Det nya provet "registrera_fel går inte att anropa som inloggad" föll direkt.
Orsaken visade sig gälla 0002 lika mycket som 0026.

Postgres ger EXECUTE på en ny funktion till **PUBLIC** som standard. Att sedan
skriva `revoke execute on function ... from anon, authenticated` tar bort de
*explicita* granterna till de två rollerna — som aldrig fanns. PUBLIC-granten
står kvar, `authenticated` är en del av PUBLIC, och kommandot går igenom utan
varning och ändrar ingenting. I ACL:en syns det som posten `=X/postgres`.

**Följden: `log_audit` har gått att anropa från vilken inloggad session som helst
ända sedan 0002.** Funktionen är security definer och skriver till `audit_log`,
så en säljare kunde posta godtyckliga händelser till händelseloggen.

Ingen data läckte — funktionen skriver, den läser inte, och `audit_log_read` har
hela tiden släppt in bara sales_manager, ceo och admin. Det som stod på spel är
loggens **värde som bevis**, alltså precis det AC-12.1 och K10 behöver den till.

0027 stänger båda, ger service role tillbaka det den behöver, och lägger
`alter default privileges ... revoke execute on functions from public` så att
nästa migration inte får samma hål. Läsfunktionerna som anropas inifrån
RLS-policyer behåller sina explicita granter — utan dem ger varje tabell noll
rader åt alla.

Provet finns kvar för båda funktionerna.

#### Fjärde gången: en radräkning för en roll som ser allt

`tests/rls.mjs` blev röd i AC-3.19-avsnittet: "David ser den inte heller",
`(await las(tD, "absence_reminder")).length === 0`.

Nattjobbet hade klockan 03:07 lagt in riktiga påminnelser för Zen och Simon, och
äldre påminnelser hade passerat sin `visible_to_manager_from`. David är säljchef
och ser **alla**. Provet blev alltså rött av att funktionen används på riktigt.

Det är exakt det NASTA_SESSION varnade för efter tre likadana 2026-08-21, och nu
har det hänt en fjärde gång i ett avsnitt ingen rörde. Rättat på samma sätt:
frågan ställs på provradens id.

**Regeln är värd att upprepa:** en roll som ser alla rader får aldrig provas med
en radräkning. De nya avsnitten för E0.6 och E9.1 är skrivna så från början.

---

## 2026-08-21 · E15: en modul som får räkna kronor, och en som fortfarande inte får

E15 M13 lönekostnadsvy, hela epicet utom E15.7 som är blockerat av E11.
Migration `0025_lonekostnad`.

Tre frågor besvarades först, och de styrde vad som byggdes: Q71 — **flera
personer rekryterar**, så E10 är inte akut och E15 gick före. A3 — **inget
lönesystem, lön görs för hand**, så exportkolumnerna lämnades orörda. Och
satsfrågan: **bolaget har varken tjänstepension eller försäkringar**, bara
arbetsgivaravgift.

### Den bärande gränsen: vad som är ett underlag och vad som är ett beslut

0012 slog fast K5 och AC-2.17 med ord som inte lämnar mycket utrymme: "Så fort
en krona räknas fram här blir navet ett lönesystem." Nu räknar navet kronor.
Skillnaden måste därför gå att säga, och den är inte kosmetisk:

**Lönerapporten är ett underlag som lämnar navet.** Den ska stämma med vad
någon får ut, den attesteras av en människa och blir oföränderlig. Den får inte
gissa, och därför får den inte räkna.

**Lönekostnadsvyn är ett beslutsunderlag som stannar i navet.** Den svarar på
"vad kostar den här säljaren, och hur mycket måste hon sälja för att bära sin
egen kostnad". Den är en uppskattning, den lämnas aldrig till någon myndighet,
och den har en egen behörighet.

Kolumnerna i `payroll_row` är fortfarande minuter och antal. Kronorna bor i
egna tabeller som `finance` inte ser.

### K27 är inte en kompromiss, och det tog en stunds räknande att se

AC-13.5 kräver åldersvillkor, och K27 tillåter bara födelseår. Det ser ut som
en konflikt där man får nöja sig med ungefär rätt sats.

Det är det inte. Båda nedsättningarna — ungdomarnas och de äldres — utgår från
åldern **vid årets ingång**. Den som är född år B har den 1 januari år Y fyllt
exakt Y − B − 1 år, oavsett vilken månad hen fyller år. Födelseåret ger alltså
rätt sats **exakt**, och ett födelsedatum hade inte gjort svaret bättre. Bara
mer persondata.

Det som faktiskt är per kalendermånad i AC-13.5 är **taket**: den lägre satsen
för unga gäller upp till ett belopp per månad. En löneperiod 16 mars–15 april
har därför två tak, inte ett, och `manaderIPerioden()` delar perioden för att
komma åt det. Provet räknar just det fallet.

`tests/rls.mjs` frågar dessutom `information_schema` efter varje kolumn i navet
vars namn antyder personnummer eller födelsedatum, och faller om någon någonsin
lägger till en. Samma mekanik som K35-provet mot `sick_report`.

### Frånvaron kommer ur löneunderlaget, och det är byggt så att den måste

ROADMAP E7.14 varnade: hämta frånvaro via `payroll_row.absence_minutes`, aldrig
genom att joina `sick_report`, eftersom den tabellen ger **noll rader** för
`payroll_cost_viewer` — alltså tyst fel data i stället för ett felmeddelande.
Noll sjukminuter ser ut som en frisk säljare.

Varningen räckte inte som konstruktion. Den gjordes strukturell: beräkningen
hänger på en **löneperiod** och inte på ett datumintervall. Minuterna finns bara
i `payroll_row`, och `payroll_row` finns bara för en period. Det finns ingen
naturlig väg att skriva frågan fel.

Provat: en användare med `payroll_cost_viewer` ser lönen, beräkningen och
satserna — och fortfarande noll rader ur `sick_report`. K26 ger tillgång till
kostnad, aldrig till hälsa.

### K26: fyra roller får noll rader

Behörigheten ligger i en egen tabell sedan 0001, med motiveringen att den ska
tilldelas per person. Provet visar vad det betyder: Anna, teamledaren,
**säljchefen** och **ekonomi** får alla noll rader ur `salary_basis`,
`cost_calculation` och `cost_rate`. Ingen roll räcker.

Ingen ser heller sin **egen** lönekostnad. Det låter hårt och är avsiktligt:
raden bär arbetsgivaravgift och break-even, alltså bolagets kalkyl på en person
— inte personens egen löneuppgift. Den senare vet hon redan, och får den ur sitt
anställningsavtal. Undantaget är registerutdraget, som går via service role.

### Inga tal ur skattelagstiftningen i koden

E15.2 och §13.2 kräver att varje sats ligger i `cost_rate`. Sök efter en siffra
i `src/lib/lonekostnad.ts` och du ska hitta 0, 1, 12 och 100 — noll, ett,
antalet månader på ett år, och procentnämnaren. Allt annat kommer in som
argument.

Följden är att en satsändring är en rad och inte en deploy, och att `rates_used`
kan bevara exakt vad en historisk siffra byggde på (AC-13.8). Den kolumnen bär
både satserna **och underlaget de tillämpades på** — en procentsats förklarar
ingenting utan talet den gällde.

Saknas en sats faller den tillbaka på **noll**, inte på ett "rimligt
standardvärde". En arbetsgivaravgift på noll ser fel ut direkt i vyn; ett dolt
standardvärde på 31,42 hade sett rätt ut och tyst gjort `cost_rate` överflödig.

### Tre ställen där siffran hellre är för hög än för låg

Ett break-even är en siffra någon fattar beslut på. En underskattad kostnad är
farlig där, en överskattad bara försiktig. Tre val följer av det:

**Frånvaro kostar som standard fullt.** Faktorn per frånvarotyp är
konfigurerbar och saknas den gäller 100 % — alltså inget avdrag. Att koda in
sjuklöneregler hade varit att gissa i en fråga som hör till ett lönesystem.

**Saknas födelseåret används full arbetsgivaravgift.** Nedsättningen kräver ett
år; utan det är det dyra alternativet det säkra.

**Täckningsgraden seedas inte alls.** En påhittad täckningsgrad ger ett
break-even i kronor som ser exakt ut och är gissat, och just den siffran är hela
skälet att vyn finns. Vyn säger i stället att den saknas, tills någon sätter
den — samma linje som `sparr_saknas` i 0016.

### Vilken siffra som bör kontrolleras

31,42 % och 10,21 % är stabila och 25 000 kr är månadstaket. **Åldersgränsen för
den äldre nedsättningen är seedad till 66 och bör stämmas av mot Skatteverket** —
den följer pensionsåldern och har flyttats flera gånger. Den berör ingen i
bolaget i dag, och att den är en rad och inte ett tal i koden är hela poängen:
rättelsen kostar ingenting.

### E15.8: en sats utan ägare är själv problemet

Nattjobbet fick ett femte steg. En sats vars datum för översyn passerat ger ett
ärende till ägaren. Saknas ägare går ärendet till säljchefen i stället för att
inte skapas — en sats som ingen äger är precis den som blir föråldrad. Samma
mönster som chefsfallbacken i sjukanmälans ringordning: en lucka i
konfigurationen får inte bli tystnad.

Ett ärende och inte en notis, för ett ärende har en handläggare, en frist och en
kvittens. Och femte steget i **ett** jobb — Hobby-planen tar fortfarande två
cron-poster.

### Prov

Nu arton sviter, 831 kontroller. `tests/lonekostnad.mjs` har 60 och skickar in
sina **egna** satser, precis som frånvaroprovet gör med sina regler: ett prov som
läste seeden hade blivit rött den dag arbetsgivaravgiften ändras, utan att något
var fel.

Det som provas mot riktiga databasen: att fyra roller får noll rader, att
behörigheten öppnar allt utom hälsodata, att en löneuppgift och en beräkning
inte går att skriva om, att ett personnummer inte går att stoppa in som
födelseår, och att ingen kolumn i hela navet bär ett personnummer eller ett
födelsedatum.

En detalj provet fångade: svensk sifferformatering använder **hårt** mellanslag
som tusenavgränsare. Den som jämför strängar någon annanstans behöver veta det.

### Nästa steg

`docs/NASTA_SESSION.md`.

---

## 2026-08-21 · Filer: en väg in, en väg ut, och en logg som är själva tillgången

Storage-spåret i sin helhet. E7.10 läkarintyg, E2.12 bilagor med PDF-text,
E8.7 rollspelscertifiering och X5 signerade URL:er — fyra punkter i tre epic
som alla väntade på samma sak. Dessutom E2.13 global sökning, som föll ut
gratis när bilagornas text hamnade i samma index.

Fyra migrationer: `0022_filer`, `0023_bilagor`, `0024_rollspel`.

### Sviten var röd när passet började. Igen.

`tests/rls.mjs` krävde att säljchefen ser **exakt en** rad i `calendar_feed`.
Policyn var rätt — `sales_manager` ska se alla flöden. Det som ändrats var
datan: Zen skapade ett riktigt flöde 2026-08-20 när iCal-rutten provades
skarpt, och David såg därmed två rader.

Provet räknade rader i en tabell som bär driftdata. Två kontroller till hade
samma fel latent — sjukanmälan och ledighetsansökan — och de hade blivit röda
vid första riktiga sjukanmälan respektive semesteransökan. Alla tre frågar nu
på provradens id.

Det är andra passet i rad som börjar med en röd svit, och båda gångerna av
samma sort: ett prov som var rätt när det skrevs och som driften sedan gick
förbi. Skillnaden mot förra gången är att det inte var koden som gled — det var
antagandet att testdatabasen är tom.

### K36 är byggt som en sak, inte som två

Kravet läser lätt som två: filen ska vara åtkomstbegränsad, **och** varje
öppning ska loggas. Byggt som två blir loggen något man passerar på vägen till
filen, och den som en gång fått adressen kan dela den vidare utan att nästa
öppning syns.

Därför finns exakt en väg till en fil i hela navet: `/filer/[id]`. Rutten
läser filens rad **med användarens egen token** — ger RLS ingen rad finns filen
inte för hen — skriver öppningen, och skickar först därefter vidare till en
signerad URL som lever i trettio sekunder. Ingen handling lämnar tillbaka en
adress till webbläsaren, och ingen sida ritar en.

**Går loggskrivningen fel blir det ingen URL.** Det är tvärtemot den vanliga
regeln att loggning aldrig ska kunna fälla en funktion, och här är den vanliga
regeln fel: loggen *är* kravet. En fil som gick att öppna utan att det syns är
precis vad K36 förbjuder, och ett tyst tapp i loggen ser i en granskning ut som
en fil ingen öppnat. Samma val som registerutdraget redan gjort i 0018.

Att det är en omdirigering och inte en knapp har en följd till: `<a>` och
aldrig `<Link>`. Next förladdar länkar när musen nuddar dem, och varje sådan
förladdning hade blivit en loggad öppning som aldrig skedde. En logg med
påhittade rader är sämre än ingen.

### Bucketen är stängd på ett sätt som inte går att öppna av misstag

`storage.objects` har RLS på och inga tillåtande policyer, vilket redan ger noll
rader. Det räckte inte som konstruktion: nästa person som behöver en fil någon
annanstans lägger till en tillåtande policy, permissiva policyer OR:as, och
bucketen står öppen.

Därför ligger en **restriktiv** policy där. En restriktiv policy AND:as med
samtliga tillåtande och går inte att OR:a bort. Service role påverkas inte, och
signerade URL:er valideras på signaturen och inte via tabellen — provat skarpt:
uppladdning med service role 200, hämtning via signerad URL utan någon nyckel
alls 200, samma sökväg med anon-nyckel 400, listning med en inloggad användares
token noll rader.

### Öppningarna ligger inte i `audit_log`, och det är inte en smaksak

Den uppenbara platsen för "vem öppnade vad" är händelseloggen. Den är fel plats,
och skälet är exakt en rad i 0001: `audit_log_read` släpper in `admin`.

En rad som säger "Cecilia öppnade Annas läkarintyg" hade berättat för admin att
Anna har en sjukanmälan — och admin är med flit utestängd från `sick_report`
sedan 0020, eftersom AC-3.26 drar gränsen där. Den allmänna loggen kan alltså
inte bära den här händelsen utan att läcka det 0020 stängde.

`file_access_log` har därför sin egen behörighet: den som får se filen ser vem
som öppnat den. **Att den som är sjuk själv ser vilka som läst hennes intyg är
inte en bieffekt utan halva poängen med K36** — och det syns både på
`/franvaro/sjuk` och i registerutdraget.

### K35 gäller filnamnet också

`sick_report` har noll textkolumner för att det inte ska finnas någonstans för
en diagnos att hamna. Ett uppladdat intyg som heter `cancerbesked.pdf` hade
gjort hela den insatsen meningslös: filnamnet är text som användaren skrivit,
det hade lagrats bredvid sjukanmälan, och det hade dessutom stått i klartext i
den signerade URL:en och därmed i varje webbläsarhistorik den hamnar i.

`filename` är därför **NULL** för `sick_certificate`, tvingat av ett
check-villkor. Namnet som visas räknas fram ur datumet, och sökvägen i bucketen
är filens uuid. Ingenting användaren skrivit följer med.

Samma resonemang stoppade den uppenbara lösningen för PDF-sökningen. En kolumn
`extracted_text` på `file_object` hade varit naturlig — och den tabellen bär
också läkarintyg. Till skillnad från ett filnamn, som någon åtminstone måste
skriva, hade den fyllts **automatiskt** med innehållet i ett intyg. Diagnosen i
databasen och sedan i sökindexet, utan att någon bestämt det. Texten ligger
därför i `document.attachment_text`, och en sjukanmälan har ingen sådan kolumn
att skriva till.

### En fil raderas inte för sig — men en människa går att radera

Raderingsspärren på `file_object` skrevs först som ett rakt förbud. Den föll på
sitt eget prov: `delete from employee` går genom en kaskad, och en spärr mot att
städa bort bevis hade blivit en spärr mot att radera personen bevisen handlar
om. E6.2 gallringsjobbet hade en dag fallit på en främmande nyckel mitt i natten.

Regeln är därför: en fil får bara försvinna **tillsammans med** den rad den hör
till. Triggern släpper igenom en radering när personen eller dokumentet redan är
borta, och nekar den när den står ensam. `file_access_log` har samma undantag
mot filen. Provat åt båda hållen: ett ensamt delete nekas, en kaskad från ett
dokument tar med både bilagan och dess logg.

### Vercel tar emot 4,5 MB, och det upptäcktes för sent

Uppladdningen byggdes först genom en server action. Den fungerar — under 4,5
megabyte, som är Vercels gräns för kroppen till en serverlös funktion. En
intygssida fotograferad med telefon är ofta större. En kvart inspelat samtal är
det alltid.

Felet hade kommit från plattformen, med ett meddelande som inte säger något om
vad användaren gjorde, och det hade träffat just de filer modulen finns för.
Uppladdningen är därför omlagd i tre steg: servern kontrollerar behörighet och
öppnar en signerad uppladdningslänk, webbläsaren lägger filen **direkt** i
bucketen, och servern frågar sedan Storage vad som faktiskt kom in.

Det tredje steget provar reglerna en gång till, och det är viktigare än det
låter: efter omläggningen är det klienten som beskriver sin egen fil i steg ett.
Ett påstående om storlek och typ är ingen kontroll. Provat att länken bara duger
en gång, och att en uppladdning utan länk nekas av den restriktiva policyn.

En fil som stannar mellan steg två och tre blir ett spöke i bucketen som ingen
når — hela vägen till innehållet går genom `file_object`. Det är rätt sida att
fela åt. Alternativet vore en rad utan fil, som syns i ett registerutdrag och
ger 404 när någon klickar.

### E2.12: bilagans text väger minst

`document.search` byggdes om till att omfatta `attachment_text` med vikt `D`,
den lägsta. Det är ingen detalj: en trettio sidor lång PDF innehåller fler ord
än något dokument har i sin rubrik, och utan viktningen hade bilagorna kommit
först i varje sökning. Den som söker "prislista" ska få dokumentet som **heter**
prislista. Uppmätt mot databasen är rubrikvikten tio gånger högre.

En bilaga skapar ingen ny version och kräver därför ingen ny kvittens. Hade den
gjort det vore trettio kvittenser den enda följden av att någon byter ut en
prislista, och kvittensen hade snabbt slutat betyda något.

Provat skarpt: en riktig PDF upp, texten in i indexet, och en sökning på ett ord
som bara står inuti filen hittar dokumentet.

### E2.13: sökningen frågar med användarens egen token

Fem frågor — rutiner och deras bilagor, nyheter, kurser, personal, egna ärenden
— alla med den inloggades token. Det är hela behörighetsmodellen på sidan: ett
utkast, en nyhet till ekonomi, ett konfidentiellt ärende och en kollega man inte
får se i registret ger noll rader ur databasen.

Följden är att sidan inte behöver veta någonting om målgrupper, och att den inte
kan glömma en regel som läggs till i en modul senare. Samma val som
`hamtaNotiser()` gjorde för klockan.

**Ett kommatecken slog ut hela träffsidan.** PostgREST separerar villkoren i en
`or` med kommatecken och tolkar dem innan Postgres ser dem, så en sökning på
"Anna, Bertil" gav HTTP 400 — inte noll träffar, utan ett trasigt sidsvar.
Mönstret citeras nu, citattecken och bakstreck escapas inuti citaten, och fyra
knepiga strängar bevakas i `tests/rls.mjs`. Det hittades genom att fråga API:t,
inte genom att läsa koden.

### E8.7: två regler som gör rollspelet till något annat än ett omdöme

**Rubriken syns före inspelningen.** `roleplay_criterion` ärver modulens
läsbehörighet, så den som ska bedömas ser exakt vad hon bedöms på innan hon
spelar in. En bedömning mot kriterier man får se först i efterhand är inte en
bedömning — det är ett omdöme med en tabell framför sig. Samma linje som AC-3.13
drog för frånvaroreglerna: den som ska följa en regel ska kunna läsa den före.

**Den som inte öppnat inspelningen får inte bedöma den.** Spärren är en trigger
som frågar `file_access_log` — samma logg K36 kräver för läkarintyg. Det är
första gången åtkomstloggen används till något annat än att kunna granskas i
efterhand, och användningen är sund: ett betyg på ett samtal ingen lyssnat på är
värre än inget betyg alls.

Kryphålet finns kvar — man kan öppna filen och låta bli att lyssna — och går
inte att täppa till. Skillnaden mellan "gick inte att göra av misstag" och "gick
att göra med avsikt" är hela vad en spärr kan åstadkomma här, och den
skillnaden är värd något.

Två saker till: återkopplingen är obligatorisk, för ett betyg utan ord lärde
ingen sig något av. Och bara ljud, aldrig video — en videofil hade dragit in
ansikten i en bedömning som handlar om vad någon säger.

Certifieringen fick gå att köra för en **utpekad person**. Ett rollspel bedöms av
chefen, och utan den ändringen hade chefen fått certifikatet på en kurs hon inte
gått.

### Prov

Nu sjutton sviter, 753 kontroller. Fyra nya: `filer`, `pdf`, `sokning`,
`rollspel`. `tests/rls.mjs` fick tre nya avsnitt — filer, rollspel och global
sökning — med 41 kontroller.

Det som provas mot riktiga databasen och inte mot koden: att bucketen är stängd
för en inloggad användares token, att den signerade URL:en fungerar utan nycklar,
att ekonomi får noll rader på ett läkarintyg även med `payroll_cost_viewer`, att
Cecilia inte kan radera bort att hon läst intyget, att ett intyg inte kan bära
ett filnamn, och att en bedömning från någon som aldrig öppnat inspelningen
nekas — men går igenom efter att hon öppnat den, och inte om någon *annan*
lyssnat.

### Nästa steg

`docs/NASTA_SESSION.md`.

---

## 2026-08-20 · M3 Frånvaro: en modul som är byggd kring vad den inte får veta

E7 i sin helhet utom E7.10. Tre migrationer, en regelmotor, åtta vyer och ett
kalenderflöde. Den största modulen som gick att bygga utan att vänta på någon
integration — och den som blir akut när 25 säljare rekryteras.

Tre frågor besvarades först, eftersom de styrde seeden: semesteråret är
**1 april–31 mars**, **kollektivavtal saknas** (A2), och **saldon matas in för
hand** per person.

### Det bärande beslutet: sjukfrånvaro delar inte tabell med ledighet

K35 och AC-3.21 säger att ingen orsak, diagnos eller symtombeskrivning får
registreras, och att det inte får finnas ett fritextfält där något sådant kan
hamna. Den enda formuleringen av det kravet som går att *prova* är den
absoluta: **`sick_report` har noll textkolumner.** Inte "inga som är tänkta för
orsak" — noll.

Provet i `tests/rls.mjs` frågar `information_schema` och faller den dag någon
lägger till en textkolumn på tabellen, oavsett vad den skulle heta och hur väl
motiverad den vore. Samma mekanik som `tests/registerutdrag.mjs` använder mot
främmande nycklar: kravet bevakas av schemat, inte av minnet.

Det är också hela skälet till att sjukfrånvaro *inte* är en rad i
`absence_request`. Den tabellen **har** två textfält — chefens motivering till
avslag (AC-3.13) och till överstyrning (AC-3.12) — och båda är rimliga för en
semesteransökan. Delade de tabell med sjukfrånvaron hade K35 hängt på att ingen
chef någonsin skriver fel sak i rutan. Ett krav som hänger på att ingen gör fel
är inget krav. Nu finns rutan inte.

### Reglerna bor i databasen, som provisionsreglerna ska göra

E7.15 räknar upp sju knappar: ansökningsfrist, huvudsemesterfönster,
spärrperiod, bemanningstak, maxlängd, karens och attestnivå per typ. Alla sju
ligger i tabeller — `absence_type`, `absence_policy`, `absence_blackout`,
`staffing_cap` — och ändras i `/franvaro/regler`.

`src/lib/franvaro.ts` innehåller **inget tal ur semesterlagen**. Varje gräns
motorn dömer efter kommer in som argument. Det gör två saker: reglerna går att
ändra utan deploy, och de går att *visa* för den som ska följa dem. AC-3.13
kräver att den anställda ser reglerna före inskick, och `reglerFor()` skriver
listan ur samma tabellrader som `provaRegler()` dömer efter. Att skriva listan
för hand i vyn hade gett en sida som säger en sak och ett avslag som säger en
annan — samma resonemang som `sparr_saknas` i 0016.

Ett regelbrott är en **varning, aldrig en spärr**. Chefen ska kunna godkänna
ändå, men då med en motivering, och motiveringstvånget är ett check-villkor i
databasen och inte bara en kodregel. En regel som blockerar tvingar fram vägen
runt systemet, och då vet ingen längre vem som är ledig — vilket var hela
poängen med modulen.

`rules_broken` fryses vid inskicket. Ändras en frist i morgon får det inte göra
gårdagens ansökan regelvidrig i efterhand — samma linje som `hr_case.sla_hours`
och AC-2.35.

### Sjuksidan har ingen anmälningsknapp

AC-3.6 förbjuder den, och sidan är byggd därefter: **telefonlistan står först i
trädet**, registreringsformuläret under, rubricerat "Registrera efter samtalet".
Ordningen är kravet och får inte kastas om med CSS.

Ett samtal till en människa är den enda punkten på hela dagen då någon märker
att en kollega inte mår bra. En knapp hade tagit bort den.

Spärren mot att detta blir en knapp ligger i databasen:
`absence_type_sjuk_ansoks_inte` gör det omöjligt att sätta `requestable` på
typen `sick`. Utan villkoret hade en kryssruta i regelvyn kunnat skapa knappen,
och då hade kravet hängt på att ingen kryssar i den.

Chefsfallbacken i AC-3.18 är inbyggd i ringordningen i stället för som ett
undantag i koden: har personen ingen chef hoppas plats 1 över, och nästa i
ordningen blir den man ringer.

### AC-3.16: fristerna räknas från första sjukdagen, aldrig från registreringen

`first_sick_day` skilt från `registered_at` är hela poängen. Den som blir sjuk
på lördagen och ringer på måndagen har varit sjuk sedan lördagen. Räknades
fristerna i K37 från registreringen kunde en sen anmälan flytta lagens frister
framför sig — och det är precis vad de finns för att hindra. Efter chefens
bekräftelse vägrar en trigger att första sjukdagen ändras, eftersom fristerna
redan är uträknade ur den.

### AC-3.19: den anställda ser sin egen lucka först

En schemalagd dag utan stämpling och utan registrerad frånvaro är en
**påminnelse**, inte en anklagelse — den vanligaste förklaringen är att någon
glömde registrera sin VAB-dag.

Fördröjningen sitter därför i RLS-policyn och inte i en vy som låter bli att
rita raden: `visible_to_manager_from` ligger ett dygn fram, och chefen får noll
rader tills dess. Hinner personen registrera sin frånvaro innan dess får chefen
aldrig veta att det fanns en lucka. Det är hela poängen, och en vy som bara
undviker att visa raden hade gett den bort i första API-anrop.

### AC-3.26: var gränsen går, och varför den inte är gratis

Sjukminuter **når** löneunderlaget. Sjuklöneperioden dag 1–14 är arbetsgivarens,
och ett löneunderlag utan sjukfrånvaro är fel underlag. Minuterna hamnar i
`payroll_row.absence_minutes` under nyckeln `sick` — kolumnen som stått tom
sedan 0012 med kommentaren att `{}` betyder "inte mätt", inte "ingen frånvaro".

Själva `sick_report` är stängd för `finance`, `admin` och `payroll_cost_viewer`.
Första sjukdagen, antalet tillfällen och rehabsignalen når aldrig den som räknar
kostnad eller provision. Det provas mot API:t: ekonomi får noll rader både på
listan och på en direkt fråga på id, och noll även med lönekostnadsbehörigheten
påslagen — K26 ger tillgång till kostnad, inte till hälsa.

E13 och E15 är inte byggda. Att provet inte kan visa att en provisionsvy låter
bli att läsa härifrån är en begränsning i vad som finns, inte i provet: RLS ger
noll rader för de rollerna, så vyn kan inte läsa även om någon skriver den.
**Villkoret står i ROADMAP E7.14** — hämta frånvaro via `absence_minutes`,
aldrig genom att joina `sick_report`.

### iCal-flödet bär varken typ eller sjukdom

Ett flöde är en URL utan inloggning. Klistras den in i Google Calendar ligger
innehållet därefter hos Google, och ingen rotation av adressen tar tillbaka det
som redan synkats dit.

Posterna heter därför **"Namn — Ledig"**. Att någon är föräldraledig eller
vabbar är en upplysning om varför, och den hör hemma bakom inloggning.
`SAMMANFATTNING` i `src/lib/ical.ts` är en konstant och inte ett fält: det ska
krävas en kodändring, inte en konfigurationsändring, för att lägga till typen.
Sjukfrånvaro har ingen väg in i filen alls — funktionen tar emot `Ledighet[]`,
och den typen kan inte bära en sjukperiod.

Provet läser filen som text och kräver att orden "Semester", "Sjuk", "VAB",
`vacation`, `sick` och `parental` inte förekommer. Det är hela säkerhetskravet,
och därför provas det på utfallet och inte på hur det byggdes.

**E1.7 är därmed halvlöst.** Offboarding ska spärra flödet, och vägen ut
kontrollerar ägarens `status` vid varje hämtning. Ingen åtgärd behövs i
offboardingkoden — samma resonemang som notisklockan i 0018: en spärr som kräver
att en annan del av systemet kommer ihåg att stänga den står en dag öppen.

### Bemanningen räknas på servern, och bara antalet lämnar den

E7.2 kräver en bemanningsvy vid ansökan. Den behöver veta hur många i teamet som
är borta en viss dag — men den som ansöker ska inte kunna läsa vilka de är.

Med användarens egen token hade frågan gett noll rader för en säljare, och
varningen hade tyst blivit "ingen är borta". Räkningen sker därför med service
role på servern, och `varstaBemanningsdag()` lämnar tillbaka ett datum och en
siffra. Namnen lämnar aldrig servern.

Taket varnar per dag och inte per period: en vecka där tre är lediga på
onsdagen och ingen annan dag ska varna för onsdagen.

### E7.10 lämnas öppen, med motivering

K36 kräver att läkarintyget är åtkomstbegränsat och att varje öppning loggas.
Filen kan inte laddas upp — Supabase Storage finns inte, samma beroende som
E2.12 och E8.7.

Byggt är kvittensen: dag 8-fristen kan markeras klar och
`certificate_received_on` säger vilken dag intyget kom in. Navet vet **att** ett
intyg finns, inte vad det innehåller.

Att bygga öppningsloggen nu vore sämre än att låta bli. En logg över noll
öppningar av en fil som inte finns ser i en granskning ut precis som en uppfylld
K36 — och den dagen filen läggs till minns ingen att loggen aldrig provades.

### Rättat utanför uppdraget

`tests/registerutdrag.mjs` föll direkt när det kördes: `news_post.author_id` och
`notification_seen.employee_id` saknades i `src/lib/registerutdrag.ts` sedan
0018 byggdes. **`npm test` var alltså rött på main när passet började.**

Provet gjorde exakt vad det byggdes för. Det är värt att notera att det ändå
tog ett dygn innan någon körde det — ett prov som fångar rätt sak fångar
ingenting om sviten inte körs före push.

Sexton nya rader lades till i `KALLOR` och `UNDANTAG`, elva av dem E7:s egna.
Sjukanmälan är en uppgift om hälsa och därmed en särskild kategori enligt
artikel 9, vilket gör den viktigare att kunna få ut i ett registerutdrag, inte
mindre.

### ROADMAP-rättelser

E7.4 stod BLOCKERAD av E4b, som blev klar 2026-08-17. E0.9 och X6 stod EJ
PÅBÖRJAD om test per modul; `tests/rls.mjs` har 22 avsnitt och täcker varje
byggd modul. Punkterna stängs inte helt — kravet följer med varje ny modul, och
E7 lade till sina fem avsnitt.

### Prov

Fjorton sviter nu. `tests/franvaro.mjs` har 115 kontroller på ren logik och
skickar in sina egna regler — ett prov som läste seed-värden ur databasen hade
slutat prova motorn och börjat prova seeden. `tests/rls.mjs` fick fem nya
avsnitt.

Fjorton konstruktionsvillkor provades mot riktiga databasen i en transaktion som
rullades tillbaka: överlappande godkänd ledighet, godkännande av regelbrott utan
motivering, avslag utan skäl, del av dag över flera dygn, två pågående
sjukperioder, radering av en sjukanmälan, flyttad första sjukdag efter
bekräftelse, omskrivet saldo. Alla nekar.

Nattjobbet och iCal-rutten provades skarpt mot produktion. Jobbet skapade fem
påminnelser, alla dolda för chefen. Flödet svarar 200 med `text/calendar`, 404
på fel adress, och räknaren tickar.

### Nästa steg

`docs/NASTA_SESSION.md`.

---

## 2026-08-20 · Klockan börjar ringa, och nyheterna får någonstans att ta vägen

Tre saker: offboardingen slutar lämna ärenden efter sig, nyhetsinlägg med
målgrupp, och klockan i toppraden som varit en död knapp sedan skalet byggdes.

### E1.8 Offboarding och öppna ärenden

En avslutad anställd lämnade efter sig trådar som ingen kunde svara på — kontot
bannlyses i samma andetag — medan fristen fortsatte ticka och drog med sig
SLA-statistiken i AC-4.5.

De stängs nu, men inte tyst. `resolution` säger varför, varje stängning får en
rad i loggen, och fanns det öppna ärenden läggs en extra punkt **först** i
offboardingchecklistan. Den punkten är hela poängen: statistiken blir ren av att
tråden stängs, men frågan i den kan mycket väl leva vidare. Ett ärende om
provision på en affär som ligger kvar hos kunden slutar inte existera för att
den som ställde frågan slutat. AC-1.7 låter inte punkten hoppas över utan
motivering, och det är den enda notis navet kan ge så länge E0.8 saknas.

Ärenden där personen var **handläggare** rör andra anställda och stängs därför
inte — men tilldelningen tas bort så att de går tillbaka till inkorgen. En
kvarglömd tilldelning är ett ärende som ingen tittar på fast alla tror att någon
gör det.

`tests/offboarding-db.mjs` kör exakt de två satserna handlingen kör, i en
transaktion som rullas tillbaka. Den fångar två saker som är lätta att få fel:
`hr_case_avslut` kräver att `resolved_at` sätts i samma andetag som status blir
`resolved`, och utan `is null`-filtret hade en resolution från mars skrivits över
med "anställningen avslutades i augusti".

### E5.2 Nyhetsinlägg

`news_post` med samma målgruppsmönster som rutinbiblioteket. Att återanvända
`matches_audience()` och inte hitta på ett eget filter är inte bekvämlighet:
funktionen bär redan spärren för konton som måste byta lösenord (0017), och ett
eget filter hade tappat den tyst.

Målgruppen är kryssrutor och inte en flervalslista. Den som skriver ska se hela
mottagarkretsen samtidigt utan att scrolla, för det är det enda valet i
formuläret som inte går att göra ogjort efter publicering. Ingen ruta ikryssad
betyder alla, och det står utskrivet under rutorna — en "Alla"-ruta som styr de
andra har tre lägen i praktiken, och det tredje förklarar ingen.

`published_at` sätts bara första gången. Ett inlägg som avpubliceras och
publiceras igen ska inte dyka upp som nytt i allas klockor en andra gång; det är
samma besked, och en klocka som upprepar sig slutar man titta i.

Ett villkor i databasen gör det omöjligt att ha status `published` utan
`published_at`. Ett sådant inlägg går inte att sortera och skulle aldrig synas
som nytt i klockan — alltså ett inlägg som ser publicerat ut men inte når någon.

### Klockan

Den var en `<button>` utan `onClick`. Nu visar den allt som är riktat till
personen: nytt ärende eller svar i ett ärende, nyhetsinlägg, ny rutin att
kvittera, ny kurs — både det som är personligt och det som kommer via målgrupp.

**Klockan lagrar inga notiser.** Det fanns en enklare väg: en
`notification`-tabell där varje handling skriver en rad. Den valdes bort. Varje
ny producent måste då komma ihåg att skriva sin rad, och den som glömmer ger en
tyst lucka — en kurs som läggs upp utan att någon får veta ser precis ut som en
kurs ingen brydde sig om. Raderna som redan finns är dessutom sanningen: en
okvitterad rutin är okvitterad oavsett vad en notistabell påstår.

Posterna räknas därför fram vid läsning, precis som `lageNu()` räknar fram
stämpelläget ur händelserna. Det enda som lagras är en tidpunkt per person:
`notification_seen.seen_at`, alltså när hen senast öppnade klockan. Saknas raden
är allt oläst — rätt håll att fela åt, en nyanställd ska se sina rutiner och
kurser, inte en tom klocka.

**Målgruppen sitter i RLS, inte i den här filen.** `hamtaNotiser()` läser med
användarens egen token. `news_post_read`, `document_read` och `course_read` går
alla genom `matches_audience()`, så databasen har redan svarat på frågan "är det
här riktat till mig". Ett eget filter hade varit ett andra svar på samma fråga,
och två svar glider isär. Det är också därför konfidentiella ärenden inte behöver
nämnas i notiskoden alls.

Ett nytt ärende skapar alltid ett första `case_message` (se `skapaArende`), så
en enda fråga — meddelanden skrivna av någon annan än mig — täcker både "någon
skrev ett ärende" och "någon svarade". Att leta efter båda separat hade gett
dubbletter på det första. Ett meddelande per ärende räcker: tre svar i samma tråd
är en notis, inte tre.

**Markeringarna fryses vid öppningen.** Att öppna klockan skickar iväg "senast
sedd", och utan frysningen hade raderna tappat sina prickar mitt framför ögonen
på den som just öppnade — man hinner se att det fanns något nytt, men inte vad.
Prickarna står kvar tills panelen stängs.

Kursen fick en `published_at`-kolumn. `created_at` dög inte: ett utkast kan ligga
i tre veckor innan det slås på, och då hade kursen varit "ny" i klockan sedan
den dagen någon började skriva den. Befintliga publicerade kurser fick sitt
`created_at` — det bästa som går att veta i efterhand, och alternativet vore att
de aldrig syns.

**Provat mot riktiga data** med en riktig inloggning: en säljare ser nyheten till
säljare men inte den till ekonomi, ser svaret i sitt eget ärende, sin okvitterade
rutin och sin påbörjade kurs. Inbäddningen `case_message → hr_case` ger ett
objekt och inte en lista, vilket är vad koden antar.

18 nya kontroller i `tests/rls.mjs`: målgrupp per roll och per team, utkast som
bara författaren och ledningen ser, noll rader vid direkt fråga på id, och att
ingen kan skriva någon annans `notification_seen` — kunde man det gick det att
tysta någon annans klocka.

### Nästa steg

`docs/NASTA_SESSION.md`.

---

## 2026-08-20 · Tvånget flyttar in i databasen, och startsidan slutar ljuga

Fyra saker: restpunkterna från lösenordstvånget, startsidan enligt E5, en
bottenrad för telefonen, och registerutdraget som K14 lovar personalen.

### Ett tvång som inte gällde API:t

Överlämningen bad om ett prov på att ett flaggat konto får noll rader ur API:t.
Provet skrevs — och visade att det inte stämde. Ett konto med
`app_metadata.byt_losenord = true` loggade in rakt mot token-endpointen, frågade
PostgREST och fick ut sin egen rad ur `employee` och ett dokument ur `document`.
Mellanvaran var aldrig inblandad; den ser bara trafik som går genom navets sidor.

Det var inget litet hål. Hela poängen med tvånget är att ett tillfälligt
lösenord är känt av två personer från första sekunden — chefen läste upp det.
Så länge ordet går att använda för att hämta data är tvånget en artighetsfras.

Migration `0017` gör om det till en spärr i databasen, samma flytt som K12 gjorde
i `0015`. Villkoret ligger i `public.kraver_losenordsbyte()`, som läser flaggan
ur JWT:n — den följer med i token, så frågan kostar ingen tabelläsning. Den
sitter sedan i de fem hjälpfunktioner nästan varje policy går igenom
(`current_employee_id`, `has_role`, `has_any_role`, `leads_employee`,
`matches_audience`), plus i de fem policyer som inte frågar någon av dem.

`matches_audience` var den intressanta: den svarar ja på ett dokument som riktar
sig till alla, alltså **utan att titta på vem som frågar**. Det var precis den
vägen provet fick ut ett dokument. Villkoret måste därför stå först i funktionen
och inte inuti något `exists`.

Fyra policyer släppte dessutom in varje inloggad utan vidare: `company_read`,
`team_read`, `case_category_read` och `compliance_gate_read`. Var för sig är det
uppslagsdata — men teamlistan bär ledarnas id och spärrtabellen visar vad
organisationen slagit på och när.

**Gränsen går vid API:t, inte vid servern**

Flaggan stänger `authenticated`-vägen. Servern har kvar sin service role, och
det behövs på två ställen medan tvånget står kvar:

- `/byt-losenord` nekar ett lösenord som innehåller det egna namnet. Utan
  namnet faller den regeln tyst bort — och det är den enda sidan där den
  verkligen behövs.
- Steg två måste kunna läsa rollerna för att få komma **före** bytet. Utan
  undantaget hade ett flaggat chefskonto sett ut som ett konto helt utan
  roller, alltså ett som inte behöver MFA, och då hade ordningen kastats om.
  Den som kommit över ett tillfälligt lösenord för ett chefskonto hade fått
  sätta ett eget utan att bekräfta enheten — precis det ordningen finns för
  att hindra. (`MFA_REQUIRED_ROLES` är tom idag, så det var latent, inte akut.)

Därför faller `getCurrentUser()` tillbaka på service role just för flaggade
konton, och `behoverSteg2()` i mellanvaran gör detsamma för sin enda fråga.
Alla andra läses fortfarande med användarens egen token.

15 nya kontroller i `tests/rls.mjs`, inklusive vägen tillbaka: efter att flaggan
tagits bort ser säljchefen registret igen, 8 rader av 8. En spärr som inte går
att öppna är inte en spärr utan ett oupptäckt fel — samma resonemang som provet
av raststämplingen.

### Skriptet som når konton som redan fanns

`scripts/krav-losenordsbyte.mjs`. Flaggan sattes bara vid upplägg och vid
återställning, så alla konton som fanns innan tvånget byggdes gick fria.

Torrkörning är normalläget och `--kor` krävs för att något ska hända. Det är
inte försiktighet för sakens skull: en körning med fel urval skickar hela navet
till `/byt-losenord`, och den som inte kan sitt gamla lösenord kommer inte vidare
därifrån — sidan kräver det. Skriptet skriver också ut just den varningen efter
en lyckad körning.

Inga beroenden, bara `fetch`. Skrivningen går mot GoTrues admin-API och inte mot
`auth.users` med SQL: `raw_app_meta_data` är auth-schemats egen kolumn och det
finns ingen utfästelse om att den får skrivas utifrån.

En bugg som provet mot riktig databas hittade: `Prefer: return=minimal` svarar
201 med tom kropp, inte 204. Att lita på statuskoden och ändå anropa `.json()`
gav ett "Unexpected end of JSON input" som såg ut som ett avvisat anrop — fast
skrivningen hade gått igenom.

### Startsidan

Kortet "Byggstatus" visade Personalärenden, Utbildning och **Stämpling** som
"Planerad". Alla tre har varit i drift sedan 16–17 augusti. Kortet är borta, inte
rättat: en lista över vad som är byggt är utvecklarens vy, inte säljarens.

- **E5.4 rollstyrd ordning.** Säljaren ser stämpelknappen först — det är det
  enda hen gör här varje dag. Chefen ser sin kö först. Ordningen byter plats i
  trädet och inte med CSS, så att den håller även på 375 px där allt ligger i en
  spalt.
- **Chefens kö** samlar ärenden över tiden, ärenden i sista fjärdedelen av
  fristen, och rättelser som väntar på beslut. Behörigheterna står var för sig:
  "chef" är inte en roll utan tre olika saker, och ett samlat begrepp hade gett
  teamledaren en ärendekö hen inte kan röra.
- **Avvikelserna räknas medvetet inte.** K19 kräver att varje chefsöppning av
  avvikelsevyn loggas. En siffra på startsidan hade betytt en öppning per
  sidladdning — både en logg full av brus och en insyn som skedde utan att någon
  valde den. Posten är en länk och ingenting mer.
- **E5.1**: "Att göra" lovade ärenden i sin egen beskrivning men hämtade dem
  inte. Nu ligger de där de hör hemma. `waiting` sätts när någon *annan* än
  ägaren skrivit i tråden, alltså precis när ledningen svarat och bollen ligger
  hos den anställda.

### Bottenrad och hopfällbar panel

**E5.5**, under 768 px: Hem, Sök, Stämpla, Mer. Säljaren stämplar in i dörren,
med telefonen i ena handen och något annat i den andra, och tummen når
underkanten — inte hamburgaren i motsatt hörn. AC-2.1 lovar max två knapptryck,
och ett går åt till att öppna menyn om det är enda vägen dit.

Stämpelposten visas bara när modulen är på, samma regel som sidopanelen följer.
Hamburgaren i toppraden är samtidigt dold under 768 px: två knappar som öppnar
samma panel, en i varje hörn, är en fråga för läsaren utan svar.

Sökknappen flyttar fokus till toppradens fält via en händelse i stället för en
prop. Två sökfält på samma skärm är två ställen att undra över.

**E5.6**, hopfällbar sidopanel. Läget ligger i en kaka och inte i localStorage,
och skälet är vad man ser första halvsekunden: localStorage går bara att läsa
efter att sidan ritats, så en hopfälld panel hade hunnit ritas utfälld och sedan
slagit ihop sig vid varje sidladdning. Kakan följer med i requesten, så servern
vet det innan den skickar något. Kakan följer webbläsaren och inte kontot — på
en delad kioskdator får nästa person föregående persons läge. Det är en
vyinställning utan personuppgifter, och en kolumn plus en fråga per sidvisning
är fel pris för det.

### E6.4 Registerutdrag

K14 lovar personalen det i klartext, och det är artikel 15. Nu finns det:
`/personal/[id]/registerutdrag` ger en JSON-fil med allt navet registrerat om
personen, tabell för tabell, med ändamålet utskrivet för varje.

Två får hämta: personen själv, och den som förvaltar registret. Teamledaren står
utanför med flit — hen ser sitt team i vardagen, men utdraget är hela innehållet
inklusive lönerader och ärenden. Länken sitter på `/profil`: en rättighet man
måste be någon om är en rättighet man låter bli att använda.

Hämtningen går med service role och inte med den frågandes egen token. RLS är
byggd för vardagsvyerna — en säljare ser sin egen rad i `payroll_row` men ingen
rad alls i `document_view` — och ett utdrag som speglade vyerna hade undanhållit
precis det som är mest angeläget att få se: vad navet registrerar utan att visa.

Loggen skrivs **före** svaret skickas, och misslyckas den lämnas filen inte ut.
Ett utdrag är ett utlämnande av samtliga personuppgifter om en människa; går
loggningen fel efteråt har det redan skett utan spår.

**Provet är det som gör listan värd något.** `tests/registerutdrag.mjs` frågar
databasen efter varje främmande nyckel mot `employee` — 45 stycken — och kräver
att var och en står antingen i `KALLOR`, alltså följer med i utdraget, eller i
`UNDANTAG` med ett skäl. Skälet: ett utdrag som saknar en tabell ser exakt
likadant ut som ett utdrag där den tabellen var tom. Den som begär ut sina
uppgifter kan inte se att något fattas, och den som byggde tabellen har för
länge sedan glömt att utdraget finns. En handunderhållen lista slutar stämma,
tyst.

`UNDANTAG` är kolumner som pekar på `employee` utan att bära uppgifter *om* den
personen — `granted_by`, `attested_by`, `decided_by`. De säger vem som gjorde
något åt någon annan. Att ta med dem hade gjort utdraget till en lista över
andras ärenden och löner, ett dataintrång utklätt till en rättighet.

Prövat mot riktiga data: 23 tabeller, noll fel, 33 rader plus 64 loggrader för
ett verkligt konto.

### E6.2 gallringsjobbet — inte byggt, och det är ett beslut

`retention_until` finns inte som kolumn i någon tabell. Att bygga jobbet betyder
alltså att först bestämma vilka tabeller som ska bära en gallringsfrist och hur
lång den är — och det är ingen teknisk fråga. **P0.6 registerförteckningen** är
dokumentet som ska svara på det, och den står som EJ PÅBÖRJAD.

Ett gallringsjobb med påhittade frister raderar personaldata enligt en gissning.
Det är sämre än inget jobb alls, för det ser ut att uppfylla K10. Punkten står
kvar som blockerad av P0.6 tills fristerna är skrivna.

### Nästa steg

`docs/NASTA_SESSION.md`.

---

## 2026-08-20 · Ett tillfälligt lösenord ska vara tillfälligt

Chefen läser upp ordet, den anställda skriver in det — och sedan gällde det för
alltid. Två personer kan kontot, och loggen bygger på att en person kan det.

Flaggan bor i auth-kontots `app_metadata` och inte i en kolumn i `employee`.
Två skäl: `user_metadata` får användaren själv skriva i, och en spärr den
spärrade kan stänga av är ingen spärr; och mellanvaran hämtar redan `getUser()`
på varje sidladdning, så kontrollen kostar ingen extra fråga.

Spärren sitter i mellanvaran. En server action är ett POST till sidans egen
adress och passerar därför samma väg — ett flaggat konto kan alltså inte
**skriva** något heller, inte bara inte titta. Den ligger efter steg två med
flit: en chef som bytt enhet bekräftar enheten först, annars kan den som kommit
över ett tillfälligt lösenord sätta ett eget och låsa ute den rätta ägaren.

**Reglerna följer NIST och inte vanan**

`Sommar2026!` uppfyller versal, gemen, siffra och specialtecken, och står högt
upp i varje ordlista. `src/lib/losenordskrav.ts` tittar i stället på längd,
spärrlista, tangentbordsrader, upprepning, och om namn eller e-post ur den egna
profilen står i ordet. Alla fel visas på en gång — ett i taget är en pina, där
man rättar längden och får veta att ordet står i listan, rättar det och får
veta att namnet står i det.

Styrkemätaren i formuläret är en uppskattning och avgör ingenting. Den finns
för att en människa ska se skillnad på tre ord och ett ord med en trea i.

**Testet hittade en bugg innan koden nådde någon**

Spärrlistan innehöll `abc`, matchad som delsträng. Ungefär vartannat hundrade
slumpat tillfälligt lösenord innehåller de tre bokstäverna i följd — chefen
hade alltså kunnat dela ut ord som navet självt vägrade ta emot, utan att någon
förstod varför. Korta ord matchas nu bara när de utgör hela lösenordet.
`tests/losenordskrav.mjs` slumpar 500 tillfälliga lösenord och granskar dem,
just för att den sortens regel ska falla direkt.

**Två vägar, ett regelverk**

Profilsidan hade sitt eget byte sedan tidigare, med bara längdkrav och en
kontroll av e-postadressen. Den tvingade sidan hade hela spärrlistan. Två vägar
in i samma konto med olika krav är detsamma som att bara ha det svagare kravet,
så bytet ligger nu i `src/lib/losenordsbyte-server.ts` och delas.

**Kvar:** befintliga konton är inte flaggade — flaggan sätts vid skapande och
vid återställning. Se `docs/NASTA_SESSION.md`.

---

## 2026-08-20 · Behörighetsprovet hann inte i kapp bygget

Definition of Done p. 4 kräver att fel roll får noll rader, per modul, mot den
riktiga databasen. `late_arrival`, `late_arrival_month` och `compliance_gate`
byggdes utan den täckningen. De påståenden som stod i migrationerna — att
ekonomin aldrig ser en sen ankomst, att spärren bara går att ändra av servern —
var alltså skrivna men obevisade.

34 nya kontroller. Det som faktiskt provas:

- Ekonomin får **0 rader** ur `late_arrival` och `late_arrival_month`. Det är
  K13 och K17 i praktiken: att låta bli att bygga vyn räcker inte, raden ska
  inte gå att hämta ur API:t heller.
- Teamledaren ser den som rapporterar till henne, inte den som ligger bredvid.
- Den bedömda kan varken skriva ner sina egna minuter eller radera raden, och
  säljchefen kan inte skriva en sen ankomst för hand.
- `compliance_gate` går att **läsa** för alla inloggade. Det är avsiktligt och
  provas som ett krav, inte som ett tillåtet läckage: öppenhet om vad som
  övervakas är hela poängen. Ändra får bara servern.

**Spärren provas hela vägen fram till ett lyckat påslag**

Ett prov som bara visar att knappen vägrar är värdelöst — en spärr som aldrig
går att öppna är inte en spärr, det är ett fel som ingen upptäckt än. Så testet
bygger upp underlaget bit för bit och kontrollerar att rätt sak fattas i varje
läge: utkast till avvägning, publicerad men odaterad, en enda okvitterad av
sex. Sedan slår det på spärren, konstaterar att den står på med namn på den som
beslutade, och slår av den igen.

Allt det sker i en transaktion som rullas tillbaka, och testet kontrollerar
efteråt att driftläget står orört. Att prova det skarpt vore att slå på
raststämplingen i produktion.

**Sidoupptäckt: tre gamla kontroller hade börjat ljuga**

`hr_case` och `payroll_row` räknades med `=== 3` respektive `=== 2`. Det höll så
länge databasen bara innehöll testdata. Nu finns riktiga ärenden och riktiga
löneperioder där, så kontrollerna föll — inte för att behörigheten var fel,
utan för att provet räknade fel saker. De letar numera efter sina egna id:n.
Ett test som knäcks av att någon använder systemet är ett dåligt test.

---

## 2026-08-19 · Spärren flyttar in i databasen

K12 gick inte att "bygga" — det är ett beslut någon ska fatta och datera. Det
som gick att bygga är maskineriet runt omkring, och det är där felet satt.

Fram till nu var spärren en kommentar i `src/lib/tid.ts` och en konstant som
någon skulle komma ihåg att ändra i samma stund som juridiken blev klar. Två
saker som ska hända samtidigt, på två ställen, av två olika personer. Det
håller inte över tid, och det går inte att visa för någon utomstående.

**Så fungerar det nu**

`compliance_gate` bär läget. En trigger vägrar slå på raststämplingen förrän
tre saker finns i databasen: K12 publicerad **och daterad**, K14 kvitterad av
varje aktiv anställd, och minst ett rastschema (K29). Villkoren ligger i
databasen och inte i koden av samma skäl som AC-2.3 — navets skrivningar sker
med en nyckel som går förbi rättigheter, och en regel som bara finns i en
server action gäller tills någon skriver en annan.

Funktionen `sparr_saknas()` driver både triggern och listan i vyn. Att de läser
ur samma källa är avsiktligt: en lista som räknas ut på två ställen hinner
glida isär, och då står det "allt klart" på sidan medan knappen vägrar.

Koden läser läget i stället för att äga det. Kvar i `tid.ts` finns bara
nödstoppen, och de är enkelriktade — de stänger av något databasen säger är på,
aldrig tvärtom.

**Att slå av kräver ingenting**

Ingen motivering, inga villkor, ett klick. En spärr ska aldrig vara svårare att
stänga än att öppna: den dag något visar sig fel ska vägen tillbaka inte vara
ett ärende.

**Utkasten är omskrivna**

K12 täcker nu tre behandlingar i stället för en, eftersom sen ankomst byggdes i
tisdags och också är övervakning. In- och utstämpling vilar på ATL och
anställningsavtalet och behöver ingen avvägning; sen ankomst och raststämpling
gör det, och de bedöms var för sig. Skyddsåtgärderna i avsnitt 5 är inte
avsiktsförklaringar — varje rad går att kontrollera i koden.

K14 är omskriven i du-form och säger rakt ut att rasten inte stämplas, att
ingenting händer automatiskt vid sen ankomst, och att en felaktig tid rättas men
aldrig raderas.

Båda ligger som **utkast** i rutinbiblioteket. Skriptet
`scripts/seed-sparrdokument.mjs` la in dem; det publicerar ingenting och sätter
inget beslutsdatum. Det är ditt beslut, och spärren släpper inte igenom något
annat ändå.

**Kvar för att kunna slå på raststämpling**

1. Låt någon med dataskyddskompetens läsa K12-utkastet.
2. Fyll i slutsatsen, sätt beslutsdatum i redaktören, publicera.
3. Publicera K14 och låt alla kvittera den.
4. Rastschemat finns redan.

Då tänds knappen under Tid → Spärrar. Inte förr.

---

## 2026-08-19 · Tidszonsbuggen — larmet var dött från början

Nattjobben hade inte kört på två nätter. En instämpling stod öppen sedan
måndag kväll, journalen saknade rader och noll sena ankomster hade upptäckts.
Två fel, och det andra var värre.

**Ett: tre cron-poster på en plan som tar två**

`vercel.json` deklarerade tre jobb. Hobby-planen tar två per projekt, och
resultatet var att inget kördes. Ett schemalagt jobb som inte kör ser exakt
likadant ut som ett som inte hade något att göra — tills någon råkar titta i
databasen.

Nu är det ett jobb, `/api/jobb/natt`, som kör alla tre stegen. Varje steg för
sig, ett fel stoppar inte de andra, och varje körning skriver ett kvitto i
loggen. De tre enskilda rutterna finns kvar för manuell körning.

Jobbet letar dessutom fjorton dagar bakåt efter dygn som saknar journalrad i
stället för att bara titta på igår. En missad natt läks av nästa körning.

**Två: all väggtid räknades i serverns tidszon**

Koden gjorde `new Date(iso).getHours()` och `new Date("2026-08-17T17:00:00")`.
På min maskin är tidszonen Europe/Stockholm och allt såg rätt ut. På Vercel är
den UTC:

- En instämpling 09:05 svensk tid lästes som 07:05 — två timmar FÖRE
  arbetsdagens start. **Ingen kunde bli sen. Larmet var dött innan det byggdes.**
- Ett schema som slutar 17:00 blev 17:00 UTC, alltså 19:00 svensk tid.
  Automatstängningen låg två timmar fel.
- Rastmotorn hade samma fel, orört sedan i somras. Det hade slagit till dagen
  K12 blev klar.

`src/lib/klocka.ts` räknar nu all väggtid mot `Europe/Stockholm` uttryckligen,
inklusive de två dygn om året då offseten ändras. Testet körs med TZ=UTC,
TZ=Europe/Stockholm och TZ=America/New_York och måste ge identiska svar — det
är hela poängen.

**Tre saker till som föll ut ur samma genomgång**

- Autostängningen kunde sätta en sluttid FÖRE dagens sista stämpling. Den som
  stämplade in 18:08 på ett schema som slutar 17:00 hade fått en utstämpling
  före sin instämpling. Nu lämnas dagen öppen och skälet skrivs i loggen.
- En öppen dag får ingen journalrad längre. Siffran hade blivit "från
  instämpling till midnatt", vilket är en påhittad arbetsdag i ett
  lönegrundande arkiv. Dagen plockas upp av nästa körning i stället.
- Sen ankomst bedöms före journalen. Att någon kom sent är känt även innan
  dagen är avslutad, och en öppen dag ska inte dölja förseningen.

**Verifierat**

141 kontroller på ren logik, alla gröna under TZ=UTC. Nattjobbet kört skarpt
mot produktion.

---

## 2026-08-17 · Sen ankomst — och toleransen ner till en minut

Beställt samma kväll: en minut för sent ska synas, inte fem. Två saker, och de
var inte samma sak.

**Fältet i schemaformuläret mätte inte det du trodde**

Toleransen som stod på "minst 5" satt i *rastschemat* och användes bara av
avvikelsemotorn — rast som börjar för tidigt, drar över eller uteblir. Sen
ankomst till arbetsdagen mättes inte alls. `start_time` användes enbart till
att visa tiden i listan; bara `end_time` gjorde något skarpt.

**Byggt**

- Migration `0014`: `work_schedule.tol_late` (minst 1), tabellerna
  `late_arrival` och `late_arrival_month`, och rastens tre toleranser sänkta
  från minst 5 till minst 1.
- `src/lib/narvaro.ts` — noll importer. Dagens första instämpling jämförs mot
  schemats start plus tolerans.
- Nattjobbet skriver raden, med id:t på schemat den dömdes mot.
- **Chefsvyn larmar samma dag.** Nattjobbet skriver historiken, men larmet får
  inte vänta till imorgon — kortet räknar ut det ur dagens stämplingar med
  samma funktion.
- Den anställda ser sina egna sena dagar. Det som registreras om dig ska du
  kunna läsa.

**Tre val**

- **Noll tillåts inte, en minut är golvet.** Telefonens klocka och serverns går
  isär med sekunder och knapptrycket tar tid att nå fram. Med noll larmar
  systemet på folk som var i tid, och ett larm som ljuger slutar man lyssna på.
- **Toleransen läggs till gränsen.** 08:01 med en minuts tolerans är i tid,
  08:02 är två minuter sent — förseningen räknas från schemat, inte från
  toleransen. Samma princip som i rastmotorn: gränsen faller ut till den
  anställdas fördel.
- **Dagens första instämpling avgör.** Den som stämplar ut och in igen efter
  lunch kommer inte för sent en andra gång.

**Avvikelse från PRD:n**

AC-2.26 säger minst fem minuters tolerans för rastavvikelser. Den är sänkt till
en på beställning. Avvikelsen står i migration 0014 så att nästa läsare ser att
det är ett beslut och inte ett slarv.

**Vad som INTE hänger i det här**

Ingen automatisk konsekvens, och sen ankomst blockerar inte löneperioden.
K13 och K17 gäller likadant: datan når varken provision eller lönekostnadsvyn.
Larmet talar om för chefen att något hände — vad som ska göras åt det är en
mänsklig fråga.

**Verifierat**

`npm run test:narvaro`: 20 kontroller, varje regel åt båda hållen — inte bara
att förseningen upptäcks, utan att den inte upptäcks när personen var i tid.
Bygget och typkollen körda lokalt.

---

## 2026-08-17 · Stämplingen påslagen — in och ut, inte rast

`M2_AKTIV = true`. Säljarna börjar stämpla imorgon. `RAST_AKTIV` står kvar på
false: raststämpling kräver K12 daterad, och den är inte skriven. Mellanläget
var byggt för precis det här och behövde inte snickras ihop i efterhand.

Konsekvensen ska vara uttalad, inte underförstådd: **navet drar inga raster
från arbetad tid.** Registrerad tid är från instämpling till utstämpling. Den
som vill ha rasten avdragen stämplar ut över lunchen. Det står som en notis
överst i vyn, inte bara i den här loggen.

**Byggt i samma push**

- E4.20, AC-2.22: rättelser som legat över 48 timmar märks i chefens kö och får
  en rad i händelseloggen från nattjobbet. En rad per rättelse, inte en per
  natt — en upprepad notis blir brus, och brus läser man förbi. Tyst mot den
  anställda med flit: det är chefen som ska agera, inte den som redan väntar.
- E4.22, K20: `RAST_PASLAGET` och `omprovningSenast()`. Omprövningsdatumet
  räknas fram ur påslagsdatumet och visas för chefen. Sätts när rasten slås på.
- Varning i chefsvyn när **inget arbetsschema finns**. Det var ett tyst hål:
  utan schema stänger nattjobbet ingen glömd utstämpling — med flit, en påhittad
  sluttid i en lönegrundande logg är värre — men ingen fick veta det. Högen med
  öppna dagar hade vuxit tills löneperioden vägrade generera.

**Läget i produktionsdatan när detta skrevs**

Två anställda upplagda, noll arbetsscheman, noll stämplingar. Säljarna som ska
stämpla imorgon finns alltså inte i navet än, och arbetstiderna är inte satta.
Koden är klar; de två sakerna är inte kod.

**Verifierat**

`npm run test:tid`: 34 kontroller, åtta nya. Bygget kört lokalt eftersom
Vercels kö låg 40 minuter efter.

---

## 2026-08-17 · E3 M4 Personalärenden — och en trasig import i E4b

Migration `0013`. Modulen som avlastar chefen mest per dag: frågan som idag
kommer på Teams, i korridoren eller i en SMS-tråd får en plats där den inte
tappas bort.

**Byggt**

- `case_category` med de sju kategorierna ur PRD:n, svarstid per kategori.
  `hr_case` (`case` är reserverat i SQL), `case_message`.
- `src/lib/arenden.ts` — noll importer. Frist, SLA-läge, median och förslaget
  om att skriva en rutin.
- `/arenden` som inkorg med SLA-status som färgad kant, `/arenden/nytt`,
  `/arenden/[id]` med hela dialogen, `/arenden/statistik`.
- Nattjobb `/api/jobb/arenden` 07:00 som eskalerar det som passerat fristen.

**Fyra val**

- **Ingen intern anteckning finns, och ska inte läggas till.** AC-4.4 lovar att
  den anställda ser hela dialogen. Ett fält som chefen kan skriva i utan att
  den berörda ser det gör ärendet till något annat än det utger sig för.
- **Fristen fryses vid upplägget.** Ändras kategorins svarstid i morgon flyttar
  det inte gårdagens löfte.
- **Varningen skalar med fristen.** Ett dygnsärende varnar vid sex timmar kvar,
  ett veckoärende vid fyrtiotvå. Ett fast antal timmar hade varit för tidigt
  för det ena och för sent för det andra.
- **Loggen bär aldrig rubriken på ett konfidentiellt ärende.** Den som läser
  händelseloggen ska se att ett ärende skapades, inte vad det gällde.

**Eskaleringen är en markering, inte ett mejl**

E0.8 är pausad, så jobbet färgar posten i inkorgen och räknar upp "över tiden"
i stället för att skicka något. När notisspåret finns är det den raden som
utlöser mejlet. Jobbet är avsiktligt tyst mot den anställda: ett automatiskt
"ditt ärende är försenat" hjälper ingen som redan väntar.

**Rättat i samma push**

Gårdagens E4b-push byggde inte. `Atgarder.tsx` importerade `./actions` men
filen ligger en nivå upp. Vercel hann fånga det innan någon annan gjorde det —
och det är värt att notera att inget lokalt test hade hittat felet, eftersom
testerna kör ren logik och aldrig laddar sidorna.

**Verifierat**

- `npm run test:arenden`: 21 kontroller på ren logik.
- `npm run test:rls`: 145 kontroller, fjorton nya för M4. Cecilia som
  teamledare ser noll ärenden, Eva på ekonomi likaså, och en tilldelning öppnar
  ett vanligt ärende men aldrig ett konfidentiellt. Anna kan varken stänga
  Bertils ärende eller skriva i det, och ett skickat meddelande går inte att
  skriva om ens med servicerollen.

**Kvar i E3**

Anonyma ärenden (AC-4.6) är förberedda i datamodellen men avstängda i
`ANONYMA_ARENDEN` tills bolaget passerar 50 anställda.

---

## 2026-08-17 · E4b Lönerapport — M2 är färdigbyggd

Migration `0012`. Sista stora biten i M2: underlaget som går till lönekörningen.
Navet räknar fortfarande ingen lön (AC-2.17, K5) — det redovisar minuter och
antal, och kolumnen `amount` finns inte att skriva till ens för den som vill.

**Byggt**

- `payroll_period`, `payroll_row`, `payroll_adjustment`, `payroll_export_column`.
- `src/lib/lonerapport.ts` — noll importer, samma regel som avvikelsemotorn.
  Blockeringar, öppna dagar och CSV-formatering.
- `/tid/lonerapport` med periodlista, generering, attest och justeringsposter.
- `/tid/lonerapport/[id]/csv` — kolumnerna kommer ur tabellen, inte ur koden.
- Avvikelser kan avslutas på `/tid/avvikelser`. Det saknades helt, och utan det
  hade AC-2.14 varit en spärr utan nyckel.

**Fyra val**

- **Spärren förklarar sig.** AC-2.14 kräver att rapporten inte går att generera
  när något är oavslutat. Ett nej utan lista är en återvändsgränd, så
  `blockeringar()` lämnar tillbaka vad, vem och vilken dag — väntande rättelser,
  dagar utan utstämpling, oavslutade avvikelser.
- **Kontrollen görs om vid attest.** Underlaget kan ha skrivits i tisdags och en
  rättelse kommit in i onsdags. Attesten gäller läget nu, inte då.
- **Frånvarofältet står tomt, inte noll.** M3 finns inte. En kolumn som alltid
  visar noll ljuger tystare än en som saknas, så `absence_minutes` är `{}` och
  vyn säger varför.
- **Ekonomi får läsa och exportera men inte attestera.** Attesten är en
  underskrift, och den som håller i lönekörningen ska inte skriva under sitt
  eget underlag.

**Verifierat**

- `npm run test:lonerapport`: 23 kontroller på ren logik.
- `npm run test:lonerapport-db`: 16 kontroller mot riktig databas, inuti en
  transaktion som rullas tillbaka. Attesterad period går varken att skriva om,
  flytta eller ta bort; justeringsposten går in men kan sedan aldrig ändras;
  `amount` som exportfält avvisas av kolumnvillkoret.
- `npm run test:rls`: 124 kontroller, tio nya. Anna ser sin egen rad men noll
  när hon frågar på Bertils id, Cecilia som teamledare ser ingen alls, och inte
  ens säljchefen skriver underlaget via API:t — det gör servern.

**Kvar i M2**

E4.20 (tyst 48-timmarsnotis) och E4.22 (kalenderpost för omprövning). Båda
väntar på notisspåret. Allt annat i E4 och E4b är byggt och testat, och hela
modulen står fortfarande avstängd bakom `M2_AKTIV` tills K12 är daterad.

---

## 2026-08-17 · Tillfälliga lösenord — inloggning utan e-post

E-postspåret pausat på beställning. Sändlagret finns på main (`src/lib/epost.ts`,
`npm run epost:test`) men används av ingenting ännu — clicknet.se är redan
verifierad i Resend med DKIM och bounce-MX, så det som återstår där är en nyckel
i miljön och SMTP-inställningen i Supabase.

Under tiden behövde inloggningen fungera utan utskick. Den gjorde den inte:
`laggUppAnstalld` skapade ett auth-konto **utan lösenord**, och den enda vägen
in — magisk länk — pekar mot `localhost:3000`. Formuläret påstod samtidigt att
"personen kan logga in med lösenord". En nyanställd hade inte kommit in alls.

**Byggt**

- `src/lib/losenord.ts` — tillfälliga lösenord ur 31 tecken som går att läsa
  upp i telefon. Inga nollor mot O, inga ettor mot l. Fyra grupper om fem,
  knappt 100 bitar.
- Upplägget sätter lösenordet direkt och visar det **en gång**. Omdirigeringen
  till personalkortet är borttagen: ordet hade behövt följa med i en URL, och
  där hamnar det i webbhistorik, i Vercels loggar och i varje proxy på vägen.
- Kort "Inloggning" på personalkortet: chefen sätter ett nytt tillfälligt
  lösenord åt den som står utanför. Utan utskick finns ingen självbetjäning —
  "glömt lösenord" är ett mejl.
- Inloggningssidan öppnar på Lösenord i stället för Magisk länk.

**Två val**

Loggen får raden `auth.temp_password_set` med vem och för vem, aldrig ordet.
En logg som innehåller lösenord är en lösenordslista med tidsstämpel.

Ingen kopieringsknapp i rutan. Ett lösenord i urklipp följer med till nästa
fönster utan att någon ber om det.

**Kvar**

Den anställda tvingas inte byta vid första inloggningen — det kräver en flagga
i middleware och byggs när e-posten ändå tas upp igen. Så länge chefen känner
ordet är kontot inte bara den anställdas, och loggen bygger på att det är det.
Rättelser i M2 och kvittenser i M5 pekar ut en person.

Sessioner nollställs inte vid lösenordsbyte. Supabase kräver användarens egen
token för det, och admin-vägen finns inte i klienten.

---

## 2026-08-16 · M2 färdigbyggd — schema, journal, rastavvikelser

Fortsättning samma dag. Nu är hela stämplingsmodulen byggd utom två poster.
Den är fortfarande avstängd: `M2_AKTIV` och `RAST_AKTIV` står på false.

**Levererat**

- Migration `0010`: `work_schedule` och `work_time_journal`. `0011`:
  `scheduled_break`, `break_schedule_ack`, `break_deviation` och
  `break_deviation_month`.
- `src/lib/raster.ts` — avvikelsemotorn. Fyra typer enligt AC-2.24, tolerans
  per typ, och regeln att en rast som börjar efter önskad senaste starttid
  aldrig ger avvikelse (AC-2.25).
- `/tid/schema` (AC-2.34): arbets- och rastschema per bolag, team eller person.
- `/tid/avvikelser` (AC-2.10): chefens vy. Varje öppning loggas.
- `/admin/arbetstid` (AC-2.6): compliance-vyn med CSV. Inte länkad från menyn.
- Nattjobb `/api/jobb/tid` 02:30: stänger glömda utstämplingar vid schemaslut,
  skriver journalen, genererar avvikelser och gallrar. I den ordningen — en dag
  måste vara stängd innan den kan bedömas, och bedömd innan den får gallras.

**Fyra val värda att känna till**

- **Avvikelsemotorn har noll importer.** Den fick dem först, och testet vägrade
  ladda filen. Det var inte ett testproblem utan ett designfel: motorn ska
  bedöma en färdig lista, inte också bestämma vad listan innehåller. Vilka
  händelser som räknas avgörs av `gallande()` hos den som anropar. Nu går
  motorn att prova utan att starta något annat.
- **Varje avvikelse bär id:t på schemat den dömdes mot.** Det är beviset för
  AC-2.35: en schemaändring kan inte i efterhand skapa avvikelser för någon som
  följde reglerna som gällde då.
- **Toleransen läggs till gränsen, aldrig dras ifrån.** Den som arbetat fem
  timmar och tre minuter utan rast har inte gjort något fel. Varje gräns som
  kan tolkas åt två håll faller ut till den anställdas fördel.
- **Ingen sluttid hittas på.** Saknas arbetsschema stängs en glömd utstämpling
  inte alls — en påhittad tid i en lönegrundande logg är värre än en öppen dag
  som någon får reda ut.

**Verifierat**

- `npm run test:raster`: 31 kontroller. Varje regel provad åt båda hållen —
  inte bara att avvikelsen upptäcks, utan att den **inte** upptäcks när
  personen följde schemat. Inklusive att ett schema som träder i kraft senare
  inte dömer en dag som redan varit.
- `npm run test:rls`: 114 kontroller, tolv nya. Anna kan varken lägga sig ett
  eget rastschema, kvittera i Bertils namn, skriva ner sin egen avvikelse eller
  radera den. Teamledaren ser ingen arbetstidsjournal — den är ledningens.
- AC-2.21 kontrollerad med grep: orden övertid, mertid och jourtid förekommer
  bara i arbetstidsjournalen och i jobbet som skriver kolumnerna.
- AC-2.9 kontrollerad likadant: ingen kolumn eller kod för position finns.

**Kvar i M2**

E4.20 (tyst 48-timmarsnotis — kräver transaktionell e-post) och E4.22
(kalenderpost för omprövning efter 6 månader). Samt hela E4b lönerapport.

---

## 2026-08-16 · E4 M2 Stämpling — kärnan byggd, avstängd av K12

Beställt som "det viktigaste". Byggt och testat, men levererat avstängt:
PRD §11 säger att M2 inte får aktiveras i produktion innan intresseavvägningen
för raststämpling är skriven och daterad. Samma stycke säger att det är
billigt att bygga i förväg — så det är precis vad som gjorts.

**Levererat**

- Migration `0009`: `time_event` med in, ut, rastens början och slut.
- `/tid`: stämpelknappar, dagens rader, arbetad tid, rättelseflöde,
  "på plats nu" för chef och chefens beslutskö.
- Två strömbrytare i `src/lib/tid.ts`, inte en: `M2_AKTIV` för in och ut,
  `RAST_AKTIV` för rasten. De vilar på olika rättslig grund — in och ut på
  anställningsavtalet och arbetstidslagen, rasten på en intresseavvägning. Att
  kunna köra in och ut utan rast är ett riktigt mellanläge, inte en genväg.
- Utkast till K12 (intresseavvägning) och K14 (information till personalen)
  ligger i `docs/`. De är det som faktiskt blockerar, inte koden.

**Tre val värda att känna till**

- **AC-2.3 ligger i en trigger, inte i återkallade rättigheter.** Navets alla
  skrivningar sker med service role, som går förbi rättigheter — en spärr på
  den nivån hade skyddat mot alla utom oss själva. Triggern gäller varje roll
  utan undantag. Enda vägen att ta bort en stämpling är att medvetet koppla ur
  skyddet, vilket kräver ett aktivt handgrepp och syns.
- **Läget lagras inte, det räknas fram** ur händelserna. En sparad status kan
  hamna ur fas med raderna den bygger på, och raderna är sanningen eftersom de
  aldrig ändras.
- **AC-2.9 löstes genom att inte bygga något.** Det finns ingen kolumn för
  position. Det som inte kan lagras kan heller inte läcka, och det behöver
  ingen kodgranskning för att intyga.

**Verifierat**

- `npm run test:tid`: 24 kontroller på ren logik — läget ur händelserna,
  rättelser som ersätter utan att radera, rasten borträknad ur arbetad tid,
  och att ogiltiga övergångar nekas.
- `npm run test:rls`: 98 kontroller, tio nya för M2. Anna ser bara sin egen
  stämpling, Eva på ekonomi ser ingens, och **varken hon eller säljchefen kan
  flytta eller radera en tid** — testat både via API:t och via den direkta
  databasanslutningen med fulla rättigheter.
- Triggern provad mot fem försök att ändra: tid, typ, person, radering och ett
  beslut på en rad som ingen begärt rättelse för. Alla nekade. Den enda
  tillåtna ändringen — att fastställa en väntande rättelse — går igenom exakt
  en gång.

**Kvar i E4**

E4.4 (automatisk stängning vid schemaslut, kräver schema), E4.6–E4.7
(arbetstidsjournal), E4.10–E4.19 (rastschema och avvikelser, blockerade av
K29), E4.20–E4.22. Och hela E4b lönerapport.

---

## 2026-08-16 · E8 M6 Utbildning och certifiering

Modulen som gör att 25 nya säljare kan lära sig samma sak utan att chefen
upprepar introduktionen trettio gånger.

**Levererat**

- Migration `0007`: `course`, `course_module`, `quiz_question`, `quiz_option`,
  `module_progress`, `course_attempt`, `certification`. `0008` lade till
  `due_days`.
- `/utbildning` med kurslista och läge per kurs, `/utbildning/[slug]` med
  innehåll i ordning, modulvy med läsning eller prov, redigeringsvy och
  `/utbildning/oversikt` (AC-6.6).
- Kurser tilldelas av målgruppen precis som rutinerna, och loggas vid upplägg
  som `onboarding.courses_assigned` (AC-6.4). Pågående kurser hamnar i
  "Att göra" på startsidan.

**Fyra val värda att känna till**

- **Rätt svar lämnar aldrig servern.** `quiz_option` har ingen RLS-policy alls,
  så tabellen ger noll rader åt varje inloggad — inte ens säljchefen. Vyn
  hämtar alternativen med service role och skickar dem utan `is_correct`, och
  rättningen sker i en server action. Facit går alltså inte att läsa ur
  sidkällan hur mycket man än letar.
- **Ett försök raderas aldrig.** `course_attempt` är en logg, inte ett
  tillstånd. Godkänt och underkänt är lika mycket bevis, och spärrtiden i
  AC-6.2 går inte att råka kringgå om historiken kan städas bort.
- **Frågor skrivs som text**, en per stycke med `*` framför det rätta svaret.
  Den som skriver en kurs gör det i ett svep, ofta genom att klistra in från
  ett underlag — ett formular med "lägg till alternativ" tre gånger per fråga
  gör samma arbete tio gånger långsammare.
- **Fristen räknas i dagar från anställningens start**, inte som ett fast
  datum. En kurs som ska vara klar inom två veckor blir då rätt för var och en
  som börjar, utan att någon sätter om datumet vid varje nyanställning.

**Två buggar hittade under provkörning**

1. `Input`-komponenten sätter `name={namn}` efter sin spread och skrev därmed
   över modulformulärets fältnamn med sitt eget id. Följden: rubriken kom fram
   tom och modulen sparades aldrig. Rättat med ett rått `<input>` där id och
   name behöver skilja sig åt.
2. `revalidatePath("/utbildning")` täcker bara den exakta sidan, så en sparad
   modul syntes inte i redigeringsvyn. Numera `"layout"`, som tar hela grenen.

**Verifierat**

- `node --experimental-strip-types tests/utbildning.mjs`: 26 kontroller på ren
  logik — frågetolken, lägesberäkningen, spärrtiden och certifikatets
  giltighet. Bland annat att ett utgånget certifikat väger tyngre än att man
  sitter mitt i en omtagning, och att en passerad frist väger tyngre än att man
  inte börjat.
- `node tests/rls.mjs`: 87 kontroller. Femton nya för M6: Anna ser den öppna
  kursen men varken chefskursen eller utkastet, hon får noll rader när hon
  frågar direkt efter deras id, **varken hon eller säljchefen kommer åt facit**,
  och hon kan inte bocka av en modul, posta ett godkänt försök eller utfärda
  ett certifikat åt sig själv.
- Hela flödet kört i produktion: kurs skapad, två moduler, prov med två frågor,
  publicerad, läst, prov med 50 % → underkänt med spärrtid till nästa dag,
  omtag med 100 % → godkänt, certifikat utfärdat och kopplat till försöket.
  Allt i `audit_log`.

**Kvar i E8**

E8.5 (dialerspärr, kräver E12), E8.7 (rollspel, kräver Storage), E8.8
(påminnelse 30 dagar före utgång, kräver transaktionell e-post) och E8.9
(kursinnehållet, ditt arbete).

---

## 2026-08-16 · E1.5 Tilldelning vid upplägg + E1.12 Oanvända konton

**E1.5 — vad en nyanställd får på sig (AC-1.3)**

- Team går nu att sätta redan i upplägget. Det avgör både vilka rutiner som
  blir obligatoriska och vem som ser personens uppgifter, så att sätta det i
  efterhand var att göra fel sak först.
- Rutinerna tilldelas inte som kopior per person — de följer av målgruppen.
  Det som saknades var **beviset**: utan en rad i loggen går det inte att i
  efterhand visa vad någon faktiskt fick på sig dag ett. Nu skrivs
  `onboarding.documents_assigned` med antal och slugar.
- Kort "Obligatoriska rutiner" på personens sida: vad som gäller för hen och
  vad som är kvitterat. Frågan gäller någon annan än den inloggade, och
  databasen svarar alltid utifrån den som frågar — därför räknas målgruppen ut
  i `riktarSigTill()`, en tvilling till `matches_audience()` i migration 0003.
  **Ändras den ena måste den andra följa med**, annars får en nyanställd en
  lista som inte stämmer med vad hon ser.
- Kurser och schema kvarstår: de kräver E8 och E4.

**E1.12 — konton som ingen använt på 45 dagar (AC-1.8, R11)**

- Migration `0006`: `employee.inactive_flagged_at`. Flaggan lagras i stället
  för att räknas fram vid varje visning — inte för prestanda, utan för att
  kolumnen säger **när** larmet gick. Ett räkneuttryck kan bara svara "just nu".
- Schemalagt jobb `/api/jobb/konton`, dagligen 05:00 via `vercel.json`. Speglar
  senaste inloggning från auth till personalregistret och flaggar, eller tar
  bort flaggan när kontot använts igen. Båda riktningarna loggas.
- Har kontot aldrig använts räknas tiden från upplägget. Annars hade en
  nyanställd flaggats direkt, och en som aldrig loggat in aldrig alls.
- Saknas `CRON_SECRET` svarar rutten 503 i stället för att köra oskyddat. En
  öppen rutt som skriver i personalregistret är inget att ha.
- `/api` är nu publik i middleware. Rutterna där autentiserar sig själva, och
  ett schemalagt jobb har ingen session att visa upp — utan detta hade det
  omdirigerats till inloggningssidan och tyst gjort ingenting.

---

## 2026-08-16 · E1.13 Teamhantering + E1.15 Lönekostnadsbehörighet

**Levererat**

- `/personal/team`: skapa team, döp om, sätt teamledare, ta bort tomma team.
  Varje team visar sina medlemmar rakt upp och ner, och en egen ruta listar
  dem som saknar team.
- Kort "Organisation" på personens egen sida: team och närmaste chef.
- Fyra nya händelser i loggen: `team.created`, `team.updated`, `team.deleted`,
  `employee.org_changed`.

**Tre val värda att känna till**

- Medlemmarna listas på teamsidan med flit. `leads_employee()` i databasen
  släpper in teamledaren på medlemmarnas rader, så den som sätter en ledare
  ska se exakt vilka personuppgifter hen just gav bort.
- Bara tomma team går att ta bort. Att slänga ut medlemmarna med teamet är en
  tyst ändring av vem som ser vem.
- Chefskedjan kollas mot ringar innan den sparas. Databasen skriver gladeligen
  A→B→A, och sedan snurrar varje vy som följer kedjan uppåt tills den ger upp.

**E1.15: `payroll_cost_viewer` (AC-13.13)**

Kort "Särskild behörighet" på personens sida. Den delas ut av **säljchef och
VD, inte av den som får hantera personal** — PRD §1.4 varnar uttryckligen för
att knyta lönedata till `admin`, eftersom den som hjälper till med IT då ser
allas ersättning på köpet. En teknisk administratör kan alltså inte ge den
till sig själv. `permission.granted` och `permission.revoked` i loggen.

**Verifierat**

- `node tests/rls.mjs`: 65 kontroller, alla godkända. Tretton nya. För team:
  Cecilia ser inte Bertil före kopplingen, ser honom efter, Eva på ekonomi ser
  honom aldrig, och varken Anna eller Cecilia kan skapa team, göra sig till
  teamledare eller peka ut sig själv som chef via API:t. För behörigheten: Anna
  kan inte ge sig själv den, Eva ser sin egen, ingen annan än säljchefen ser
  vem som har den, och inte ens han kan dra in den via API:t.
- Hela teamflödet kört i produktion: team skapat, ledare satt, person kopplad
  och bortkopplad, teamet borttaget — alla fem händelserna i `audit_log`.
  Testdatat är bortstädat, databasen står med noll team.

---

## 2026-08-16 · Steg två byts från app till kod via e-post

Beställt efter att TOTP levererats: en kod till mejlen är enklare att leva med
än en app att skanna. Bytet är gjort och TOTP-vägen är helt borttagen.

**Levererat**

- Steg två är nu en engångskod till e-posten. Supabase har ingen e-postfaktor
  bland sina MFA-typer, så steget är byggt här: koden skickas med Supabase
  e-post-OTP, och när den stämmer skrivs ett signerat kvitto i en kaka.
- Kvittot är HMAC över användarens id och en utgångstid. Det går inte att
  skriva utan hemligheten och inte att flytta till ett annat konto. Utan giltig
  session är det värdelöst — det är ett kvitto på ett genomfört steg, inte en
  inloggning.
- Enheten kommer ihåg dig i 30 dagar. Det var hela poängen med bytet.
- `/tvafaktor` är borta. Med kod via mejl finns ingen inskrivning att göra, så
  grinden och verifieringen är samma sida: `/logga-in/verifiera`.
- Migration `0005`: `mfa_recovery_code` borttagen. Koderna fanns för en tappad
  telefon. Den som tappar sin brevlåda återställer den hos e-postleverantören.

**Vad bytet kostar i säkerhet**

Med TOTP kom den som har brevlådan ändå inte in. Nu räcker brevlådan ensam —
den bär både den magiska länken och koden. Kvar finns skyddet mot ett stulet
lösenord, vilket är det vanligaste angreppet. Avvägningen är verksamhetens och
är gjord med öppna ögon. K33 säger "MFA aktiverat" utan att peka ut faktortyp,
så kravet är uppfyllt.

**Ett val värt att känna till**

Spärren ligger kvar i middleware, men behovet kan inte längre läsas ur token —
det krävde rollerna. Ordningen är därför: kakan först (bara en HMAC, inget
nätverk), och rollerna hämtas bara när kakan saknas eller gått ut, alltså en
gång per enhet och månad. Svarar Supabase inte alls faller middleware tillbaka
på att släppa igenom, och `(app)`-layouten tar det som andra led — ett ja hade
låst ute alla chefer när Supabase har en dålig minut.

**Verifierat**

- `node tests/rls.mjs`: 52 kontroller, alla godkända. Hela kodvägen provas utan
  att något mejl skickas, via `admin/generate_link` som ger samma engångskod:
  fel kod nekas, rätt kod ger en session som är rätt persons, och samma kod går
  inte att använda igen.

**Beroende som måste lösas innan detta fungerar i drift**

Se `DRIFTSATTNING.md` punkt 0: mallen för magisk länk måste innehålla
`{{ .Token }}`, och egen SMTP måste vara påslagen. Utan det kommer koden inte
fram, och chefsrollerna kommer inte in.

**Samma dag: kravet avstängt igen.** Mejlet kom fram men innehöll bara en
"sign in"-länk, ingen kod — och länken fungerar inte, av samma orsak som
DRIFTSATTNING punkt 1. `MFA_REQUIRED_ROLES` är därför tom. Koden, spärren och
kvittot står kvar orörda och testade; det är en rad att slå på igen. Så länge
listan är tom är K33 inte uppfylld, och inloggning sker med lösenord.

---

## 2026-08-16 · E1.2 + E1.14 Tvåfaktor och profilsida

**Levererat**

- Migration `0004_mfa.sql`: `mfa_recovery_code` med RLS utan policyer. Ingen
  inloggad ser raden, inte ens sin egen — hashen hjälper ägaren noll och är en
  angreppsyta om den läcker vidare.
- `/profil` (E1.14): egna uppgifter, byte av lösenord, hantering av tvåfaktor.
  Namnet i sidopanelen är vägen dit.
- Tvåfaktor med TOTP (E1.2, AC-1.1, K33). Inskrivningen sker i webbläsaren mot
  Supabase, så hemligheten passerar aldrig vår egen server.
- Tio återställningskoder om 50 bitar, sha256 i databasen, klartext en enda
  gång vid utskrift. En kod tar bort faktorn och tvingar fram en ny
  inskrivning — den loggar alltså inte in någon på egen hand.
- Två grindar: `/tvafaktor` för den som **måste** ha MFA men saknar den, och
  `/logga-in/verifiera` för den som har en faktor men står kvar på aal1.
- Loggat i `audit_log`: `mfa.enrolled`, `mfa.disabled`, `mfa.recovered`,
  `mfa.recovery_failed`, `mfa.recovery_codes_created`, `auth.password_changed`.

**Två val värda att känna till**

- AAL-kontrollen ligger i middleware, inte i en layout. Då gäller den även
  route handlers och sidor som byggs till senare, utan att någon behöver minnas
  att lägga in den.
- MFA-faktorerna bärs med i `getCurrentUser` i stället för att hämtas separat.
  `mfa.listFactors()` gör om samma `getUser()`-anrop, och kontrollen sker på
  varje sidvisning — det hade blivit ett extra nätverksanrop per sida.

**Verifierat**

- `node tests/rls.mjs`: 54 kontroller, alla godkända. Åtta av dem nya, och
  testet räknar själv ut TOTP-koden enligt RFC 6238 i stället för att lita på
  att Supabase gör rätt: rätt kod ger en token på aal2, fel kod ger 422, och
  lösenordstoken står kvar på aal1.
- TOTP är påslaget i Supabase-projektet. Provat mot en engångsanvändare innan
  spärren aktiverades — en spärr mot en avstängd funktion hade låst ute alla
  chefer.

**Konsekvens vid driftsättning**

`zen@clicknet.se` har `sales_manager` + `admin` och möts därför av
`/tvafaktor` vid nästa sidladdning. En autentiseringsapp behövs för att komma
vidare. Utvägen är att logga ut; kontot kan inte låsas ute permanent.

**Kvar i E1**

E1.5 (automatisk tilldelning), E1.12 (45-dagarsflaggan, kräver schemalagt
jobb), E1.13 (teamhantering i UI), E1.15 (admin-vy för `payroll_cost_viewer`).

---

## 2026-08-16 · E0 Fundament + E1 Identitet

**Levererat**

- Repo, Next.js App Router, TypeScript, Tailwind v4.
- Designsystem enligt UI-PRD §4 som tokens i `src/app/globals.css`.
  Kontrastkraven i AC-U5.1 mätta och verifierade, se DECISIONS D-U2.
- Supabase-projekt `kwsyvqymebamiqnxqjgj` i **eu-north-1** (K23 uppfylld).
- Migration `0001_identitet.sql`: `company`, `team`, `employee`,
  `employee_role`, `employee_permission`, `audit_log`, `offboarding_task`,
  hjälpfunktioner och RLS-policyer.
- Inloggning med magisk länk och lösenord (AC-1.1, MFA-delen kvarstår).
- Personalregister: lista, upplägg, roller, aktivering, offboarding med
  checklista (AC-1.2, 1.3, 1.4, 1.5, 1.7).
- Händelselogg (AC-12.1, delvis — täcker M1:s händelser).
- Levande stilguide på `/design`.

**Verifierat**

- AC-1.6: anonym anslutning returnerar `[]` från employee, employee_role,
  audit_log, offboarding_task, company och team. Testat mot REST-API:t.

**Kvar i M1 innan modulen får räknas som klar**

- AC-1.1: MFA obligatoriskt för `sales_manager`, `ceo`, `finance`, `admin`
  och alla med `payroll_cost_viewer` (K33). Kräver TOTP-inskrivning i UI:t
  och en spärr i middleware som tvingar fram det vid nästa inloggning.
- AC-1.3: automatisk tilldelning av rutiner, kurser och schema. Kan först
  byggas när M5 och M6 finns — hooken läggs i `laggUppAnstalld`.
- AC-1.8: konton utan inloggning på 45 dagar flaggas för granskning.
  Kräver ett schemalagt jobb; `employee.last_sign_in_at` finns redan.
- AC-1.4: dialer-kö och iCal-flöde kan inte stängas än — de systemen finns
  inte i navet. Checklistan täcker dem manuellt tills M9 och M3 byggs.

## 2026-08-16 (samma dag) · Granskning av kod, säkerhet och prestanda

**Genomfört på riktigt system, inte genom kodläsning:** `tests/rls.mjs` skapar
fem användare med olika roller, loggar in som var och en och mäter vad de
faktiskt får ut ur databasen. 33 kontroller. Hela personalflödet kördes
dessutom manuellt i webbläsaren, inklusive offboarding, med efterkontroll mot
databasen och auth-API:t.

**Fyra brister hittade och lagade**

1. **Skrivförsök gav HTTP 204 i stället för 403.** Ingen data ändrades — RLS
   höll — men svaret var missvisande och konstruktionen skör. Skrivrätten är
   nu borttagen helt från `anon` och `authenticated` (0002).
2. **`log_audit` gick att anropa som RPC.** PostgREST exponerar varje funktion
   i `public`. En säljare hade kunnat posta godtyckliga händelser och göra
   loggen obrukbar som bevis. Rättigheten återkallad (0002).
3. **Offboardad anställd kunde läsa sin egen rad.** Rollbaserad åtkomst var
   redan stängd. Policyn kräver nu `status <> 'offboarded'` även för egen rad,
   som tredje led efter bannlysning och middleware (0002).
4. **Klickytor under 44 px.** Utloggningsknappen mätte 36 × 36 och namnlänken
   i personallistan 27 × 19. Båda uppfyller nu AC-U5.5.

**Headers**

CSP med nonce per svar, satt i middleware. Krävde att rendering tvingas
dynamisk — ett prerenderat svar kan inte bära ett nonce som varierar, och utan
nonce blockerade `strict-dynamic` Next:s egna inline-skript. Felet hade gett en
sida som såg korrekt ut men aldrig hydrerade. Upptäckt genom att räkna
nonce-attribut i det levererade svaret.

Därtill X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy som
stänger kamera, mikrofon och plats, COOP same-origin, och `no-store` på
persondatavyerna.

**Prestanda**

TTFB 0,24–0,44 s mot produktionsdomänen. Delad JS-bunt 103 kB. Startsidan
långt under kravet på 1,5 s i AC-11.3, men det är mätt på ett nästan tomt
register — mätningen ska göras om när rutinbiblioteket har innehåll.

**Verifierat i webbläsare**

Inloggning, upplägg av anställd, rolltilldelning och offboarding fungerar hela
vägen. Efter offboarding: status satt, alla roller återkallade, åtta
checklistposter skapade, auth-kontot bannlyst, inloggningsförsök nekat med
`user_banned`, och databasen vägrar hoppa över en checklistpost utan motivering.

**Kvarstår, kräver åtgärd i Supabase-panelen — se docs/DRIFTSATTNING.md**

- Magiska länkar omdirigerar till `localhost:3000`. Blockerande.
- Registreringen är öppen för vem som helst.

**Nästa steg**

E2 — M5 Rutinbibliotek. Det är modulen som skalar chefen (PRD §1.6 prio 1)
och den som måste finnas innan onboardingvågen i höst.

**Öppet som blockerar senare epics**

- K12 intresseavvägning för raststämpling: blockerar M2, skrivs av dig.
- K32 arbetsmiljöpolicy och uppgiftsfördelning vid 10 anställda:
  deadline cirka fyra veckor, oberoende av intranätet.
- A2 kollektivavtal, A3 lönesystem, A5 Inkio-API, A6 dialerns API.


---

## 2026-08-16 — E2, M5 Rutinbibliotek

Migration `0003_rutiner.sql`: `document`, `document_version`, `document_ack`,
`document_view`. `owner_id` och `review_due` är NOT NULL på databasnivå, så
AC-5.1 går inte att kringgå ens från en server action med servicerollen.
Kvittensens primärnyckel innehåller versionen — en ny version ger därför en ny
rad, inte en uppdaterad, och gammal kvittens står kvar som historik (AC-5.5).

**Byggt**

- Lista med fritextsök (svensk `tsvector`, GIN-index, `websearch`), kategorichips
  ur den faktiska datan och statusmärkning per dokument.
- Läsvy med markdown, versionshistorik, klistrad kvittensknapp och 404 för den
  som står utanför målgruppen (AC-5.8).
- Redaktör med förhandsgranskning, målgrupp per roll och ägarbyte.
- Kvittensrapport med de okvitterade överst (AC-5.6).
- Startsidans "Att göra" hämtar nu okvitterade rutiner och egna dokument med
  förfallen granskning.

**Två avsiktliga val**

Versionsnumret höjs bara när rubrik eller brödtext ändrats. En rättad kategori
tvingar alltså inte fram ny kvittens från alla — en kvittens som krävs utan
skäl är den snabbaste vägen till att folk klickar utan att läsa.

Markdown-parsern laddas med `next/dynamic` först när någon trycker
Förhandsgranska. Redigeringsvyn gick från 154 kB till 112 kB första laddning.

**Behörighetstestet**

`tests/rls.mjs` utökat med tolv kontroller för rutinbiblioteket. Verifierat mot
riktig databas med riktiga inloggningar: en säljare ser den öppna rutinen men
varken utkastet eller chefsdokumentet, får noll rader när hon frågar direkt på
deras id, kan inte skapa eller ändra dokument via API:t, kan inte kvittera i
någon annans namn och ser bara sin egen kvittens. 45 kontroller totalt, alla
godkända.

**Kvar i E2**

- E2.5 påminnelser 30/7/0 dagar — kräver transaktionell e-post (E0).
- Bilagor i Supabase Storage med signerade URL:er, och textextraktion ur PDF
  så att bilagornas innehåll också blir sökbart. Medvetet uppskjutet, inte
  bortglömt: sök över brödtext och titel täcker det som skrivs i navet, PDF
  täcker det som lyfts in utifrån.
- Global sökning i toppraden (E2.13).

**Nästa steg**

E3 — M4 Personalärenden med SLA, eller E8 — M6 Utbildning. Utbildning låser
upp E1.5 automatisk tilldelning vid upplägg, och är det som gör onboardingen
självgående. Ärenden är det som avlastar chefen mest per dag.
