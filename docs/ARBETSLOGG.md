# Arbetslogg — Clicknet Nav

Läs denna före arbete. Uppdatera efteråt.
Kort lägesbild och nästa steg: **`docs/NASTA_SESSION.md`**.

---

## 2026-08-27 (kväll) · E0.7: nattjobbet larmar om sig självt

Ingen migration, inga nya tabeller. Två nya filer, tre rörda, ett nytt prov.
E0.7 går från DELVIS till KLAR för det som finns att larma om.

### Kvittot fanns redan — det ingen gjorde var att titta på det

Nattjobbet har sedan länge skrivit `job.night_ok` eller `job.night_partial` i
`audit_log` med `meta = { sekunder, resultat, fel }`. Uppdraget var alltså inte
att producera mer information utan att någon ska se den som redan finns.

De fem senaste kvittona, avlästa innan något byggdes:

| Natt | Skrevs | Steg som föll | Körtid |
|---|---|---|---|
| 08-23 | 02:44 | inga | 8,1 s |
| 08-24 | 03:19 | inga | 1,7 s |
| 08-25 | 02:30 | inga | 1,6 s |
| 08-26 | 02:52 | inga | 1,6 s |
| 08-27 | 02:34 | inga | 5,2 s |

**Det är den tabellen som satte gränsen.** Vercel startar jobbet när den har
plats, inte på sekunden, och största uppmätta avstånd mellan två körningar är
**24,6 timmar** (08-24 03:19 → 08-25 02:30 är 23,2; 08-25 → 08-26 är 24,4;
08-23 02:44 → 08-24 03:19 är 24,6). `MAX_TIMMAR = 26` ligger alltså 1,4 timmar
över det värsta normala fallet. Härledningen står utskriven i filen — 24 timmar
mellan körningarna plus två timmars slack — och båda riktningarna är fel: under
24 larmar navet varje natt strax före körningen, över 26 blir tystnaden lång.

### Det som var värt mest att tänka igenom: vad som INTE byggdes

Det fanns en ledig cron-slot. Den användes inte, och `vercel.json` är orörd.

> En cron som vaktar cron dör samma död. Det var precis det som hände: tre
> cron-poster deklarerades, planen tar två, ingen av dem kördes, och en
> instämpling stod öppen i två dygn utan att någon märkte det. En vaktpost hade
> varit tyst genom hela det förloppet.

Den enda observatör som är oberoende av att cron fungerar är **en människa som
öppnar en sida**. Kontrollen ligger därför på `/fel` och på startsidan. Se
D-E0.7.

### Larmvägen är `error_report`, och digesten är hela poängen

Ingen ny tabell. Notisklockan läser redan `error_report`, `/fel` är kön med
status och ansvar, och `registrera_fel` räknar upp `occurrences` på
`(digest, path)`.

Det sista är skälet till att `normaliseraFel()` finns. Ett steg som faller
varje natt i en månad ska bli **en** rad med siffran 30, inte trettio rader —
och ett felmeddelande som bär nattens tidsstämpel eller radens uuid ger en ny
digest varje natt. Ordningen på utbytena är inte godtycklig: tidsstämplar
först (de bär både datum och siffror), uuid före datum (ett rent numeriskt uuid
kan annars klippas mitt i), siffergrupper sist.

Provet kör det verkliga fallet: samma bugg två nätter, där allt som skiljer är
tidsstämpeln, radens uuid och antalet rader den hann med. Samma digest.

**Fällan som fångades av att den provades mot den riktiga funktionen:**
`rensaSokvag()` klipper bort fragment, så `/api/jobb/natt#satser` hade blivit
`/api/jobb/natt` och alla sex stegen grupperats ihop till en rad. Sökvägen är
därför `/api/jobb/natt/<steg>`, och `tests/larm.mjs` importerar `rensaSokvag`
och kontrollerar att den lämnar den orörd — inte att den *tros* göra det.

### `blocking` lånades inte

Ett larm om nattjobbet skrivs med `blocking: false`. Fältet svarar på om en
människa hindrades från att jobba vidare (0026), inte på hur allvarligt felet
är. Att sätta det till sant för att hamna högt i kön hade gjort flaggan
obrukbar för det den finns till. Kön sorterar `new` överst ändå, och det som
faktiskt blir sett är raden på startsidan.

### `aldrig` är ett eget läge

I koden ser en körning som aldrig skett ut som en oändligt gammal körning. För
en människa är det två olika besked, och de pekar på olika saker att titta på:
"jobbet har aldrig lämnat något kvitto" pekar på cron-posten, "har inte kört på
över ett dygn" pekar på steget. `bedomDrift()` svarar därför `ok`, `forsenat`
eller `aldrig`, och det tredje bär inga timmar.

Ett kvitto som ligger i **framtiden** larmar inte. Det är en klocka som gått
fel, och att larma om det hade bytt ett problem mot ett annat.

### Noll rader betyder två saker, och det är därför frågan är villkorad

Kvittot läses med användarens **egen token**, aldrig service role.
`audit_log_read` släpper in `sales_manager`, `ceo` och `admin` — exakt kretsen
`hanterar` på `/fel`, så RLS har redan svarat på frågan om vem som får se
raden.

Men RLS ger noll rader åt en säljare, och noll rader är precis vad "jobbet har
aldrig kört" också ser ut som. Utan en gräns hade varje säljare fått en röd rad
på sin startsida som påstod att nattjobbet aldrig lämnat något kvitto. Frågan
ställs därför bara för den krets `audit_log_read` släpper in. Det är inget
andra rollfilter — kretsen kan inte bli vidare än RLS — det är skillnaden
mellan "det finns inget kvitto" och "det är inte din sak".

### Ett delvis fallet jobb ritar ingen rad på startsidan

Med flit. Jobbet larmar självt om varje fallet steg, larmet hamnar i
`error_report` och därmed i notisklockan. Raden är reserverad för det enda fel
jobbet omöjligt kan rapportera om sig självt: att det inte kört alls. En rad
som ritas för sådant som redan syns någon annanstans blir en rad man slutar
läsa — samma skäl som göms ärendekortet.

### Kontrollen har eget try/catch, och det var ett fel som nästan gick igenom

Färskhetskontrollen står **först** i jobbet, före alla sex stegen. Första
versionen läste kvittot utan skydd — och då hade ett nätavbrott i den frågan
fällt hela natten innan en enda stämpling stängts. Ett larm som kan släcka det
den vaktar är värre än inget larm.

Kontrollen har därför samma try/catch som varje steg, och faller den skrivs
`kvitto` i `fel` som vilket steg som helst. Läget sätts då till `ok`, inte
`aldrig`: att larma om en utebliven natt vore att dra en slutsats ur en fråga
som aldrig fick något svar.

### Vågantalet är oförändrat

Hämtningen på startsidan lades i den **befintliga** `Promise.all`. På `/fel`
blev det tvärtom en våg färre: felraderna, personerna och driftläget ställdes
i tre led efter varandra och står nu i ett.

### Prov och mätning

`tests/larm.mjs`, 46 kontroller, ren logik utan Supabase. Lagd i kedjan som
`test:larm` mellan `test:fel` och `test:avtal`.

**Hela sviten omkörd oskyddad: exit 0, 1 721 godkända kontroller, noll fallna.**
1 675 + 46 = 1 721, alltså är ingen gammal kontroll borta.

**Skrivvägen är redan provad, och det är därför inget nytt db-prov skrevs.**
`tests/rls.mjs` kör `registrera_fel` mot den riktiga databasen: att två anrop
med samma `(digest, path)` blir en rad med räknaren 2, att ett avslutat fel som
kommer tillbaka inte tyst återgår till `new`, och att check-villkoret nekar en
automatisk rad utan digest. Det larmet lägger ovanpå är hur digesten och
sökvägen byggs, och det är ren logik.

**Nattjobbet kördes INTE i gång för hand för att prova larmet.** Steget `tid`
stänger öppna stämplingar och `konsekvenser` lägger förslag om ogiltig frånvaro
— att köra det mitt på dagen är en skrivning i skarp persondata som ingen bett
om. Larmvägen verifierar sig själv 02:30.

### Mätningen efter deployen (`a8668b8`, Ready)

`scripts/mat-inloggad.mjs`, fem körningar som säljare. Median av medianerna:

| Sida | Nu | Före (2026-08-27) | Krav |
|---|---|---|---|
| Startsidan | ~442 ms | ~450 ms | 1 500 |
| Stämplingsvyn | ~516 ms | ~489 ms | 2 000 |
| Sökningen | **~478 ms** | ~406 ms | **500** |
| Rutinerna | ~428 ms | ~427 ms | 1 500 |

**Mätskriptet loggar in som SÄLJARE, och för en säljare ställs driftfrågan inte
alls.** Siffran ovan mäter alltså den väg som är oförändrad. För att täcka den
nya frågan kördes samma mätning som **säljchef** i tre varv: 566, 472 och
469 ms, alltså **~472 ms mot kravet 1 500**. Skillnaden mot säljarens ~442 ms
är chefens köer, inte en våg till — driftfrågan ligger i den befintliga
`Promise.all`. (Kopian av mätskriptet var tillfällig och är borttagen;
`mat-inloggad.mjs` står orörd.)

**Sökningen svängde mellan 375 och 526 ms över fem körningar** och låg över sitt
krav i två av dem. Den rördes inte av det här bygget — commiten delar ingen fil
med `/sok` — men marginalen är fortfarande den minsta i navet, och intervallet
straddlar numera kravet. Det är den siffra som ska hållas ögonen på, och en
enskild avläsning säger ingenting om den.

---

## 2026-08-27 · Mätningen som avbröts, volymtrappan, och sviten på `822269f`

Inget byggt. Tre lösa trådar knutna, och en av dem visade sig dölja något.

### Vågrättningen är bekräftad — och siffran gick längre tillbaka än den skulle

`822269f` flyttade in `far_godkanna_franvaro()` i samma `Promise.all` som dagens
stämplingar, men mätningen som skulle bekräfta det blev aldrig körd. Tre
körningar av `scripts/mat-inloggad.mjs`, median av medianerna:

| Sida | Nu | Efter E13-bygget | Krav |
|---|---|---|---|
| Startsidan | ~450 ms | ~536 ms | 1 500 |
| Stämplingsvyn | **~489 ms** | ~582 ms | 2 000 |
| Sökningen | ~406 ms | ~442 ms | 500 |
| Rutinerna | ~427 ms | ~456 ms | 1 500 |

Stämplingsvyn ligger **under** de ~530 ms som gällde före E13-bygget, inte bara
tillbaka på dem, och de tre körningarna gav 489, 491 och 470 ms — spridningen är
för liten för att siffran ska vara en slump. Samtliga sidor rör sig nedåt, så en
del av skillnaden är körning-till-körning; men den enda sidan som fick en
åtgärd är också den som rör sig mest.

**Sökningens marginal är ~94 ms**, fortfarande den minsta i navet.

### Volymtrappan: beslutet var enkelt, det som låg under det var inte det

Beställaren valde att bara byta plats på 15 och 20 — 1 000 respektive 1 200 kr —
med verkan från nästa månadsskifte. Gjort som `sparaNiva()` gör det: `valid_to`
på de gamla raderna, nya rader med `valid_from = 2026-09-01`, två rader i
`audit_log`. Se D-E13.3.

**Självkontrollen efter ändringen visade noll rader för augusti.** Det såg först
ut som ett fel i frågan och var det inte: samtliga fyra rader, även de orörda 5
och 10, har `valid_from = 2026-08-25`, och `gallandeNivaer()` slår upp trappan på
**månadens första dag**. `2026-08-25 <= 2026-08-01` är falskt, alltså gäller
ingen nivå i augusti. Den första månad trappan över huvud taget gäller är
september.

Det är inte en bugg — det är Ö16 som fungerar som den ska, plus att raderna
matades in med "gäller från och med nu" mitt i en månad. Men det står ingenstans,
och det är precis en sådan sak någon läser tabellen och drar fel slutsats om.
Verkan i dag är noll: `commission_entry` är tom och augusti bär två testorder.
**Ingenting gjordes åt det** — att flytta trappan bakåt till den 1 augusti är ett
beslut om pengar och alltså beställarens.

Det är också en påminnelse om vad valet mellan "nu" och "denna månad" faktiskt
betyder: mitt i en månad ser de likadana ut i formuläret och skiljer sig med en
hel månads bonus.

### Konsekvenstrappan får ingen egen godkännare

`attendance_approver` tilldelas ingen. Beställarens besked, och registret
stödjer det: den enda aktiva personen är Zen, som redan bär `sales_manager` och
`ceo`; Simon och Vlado står i onboarding. En permission som ger *eget team* till
någon som redan får besluta om *alla* är inte en behörighet, den är en rad till
att hålla reda på. Behörigheten finns kvar i `PERMISSIONS` och går att ge under
Personal den dag en teamledare kommer in.

`attendance_incident` är fortfarande tom — trappan är seedad och oanvänd.

### Provsviten kördes om på `822269f`

**Exit 0, 1 675 godkända kontroller, noll fallna, inget nätavbrott.** Commiten
hade bara `typecheck` och `test:tid` bakom sig.

En sak att inte upprepa: första omgången kördes som `npm test | tail -120`, och
en pipe ger sista ledets exit-kod. `EXIT=0` betydde där att `tail` gick bra, inte
att sviten gjorde det. Körningen var grön — den sista sviten i `&&`-kedjan
skrevs ut som godkänd, vilket bara kan ske om alla före den också var det — men
exit-koden bevisade det inte. Kör sviten oskyddad och läs `$?`.

---

## 2026-08-26 (kväll) · E13 steg 6, 7 och 9: konsekvenserna, underlaget och orderbilagan

E13 är färdigbyggt utom steg 8, som väntar på A6. En migration: `0039`.
Konsekvenssystemet behövde ingen — schemat låg redan i `0037`, det var motorn,
kön och vyerna som saknades.

### Två frågor ställdes innan något räknades, och båda gav svar

**Volymtrappan är omkastad, och databasen bekräftar det.**
`commission_bonus_level` har 15 → 1 200 kr och 20 → 1 000 kr. Tidsstämplarna är
talande: 5 kl 13:31:35, 10 kl 13:31:45, **20 kl 13:32:13**, **15 kl 13:32:38** —
de två sista inmatade i omvänd ordning mot de andra, vilket är precis vad som
händer när två fält byter plats. Beställaren bekräftade att det är fel och ger
nya belopp. **Trappan är rättad först när de kommit; det är den enda delen av
E13 som väntar på indata.** Raden i `NASTA_SESSION.md` som påstod
`15/20 → 1000/1200` var fel och är rättad.

**Ö13 är besvarad: behåll `betald`, men gör den nåbar.** Det som hittades under
frågan var värre än frågan: statusen fanns i schemat, i övergångsmatrisen och i
triggern i `0034` medan **ingen kod kunde sätta den**. Den var alltså oåtkomlig,
inte bara verkningslös — och en död väg tolkas förr eller senare som en
bortfallen knapp. `markeraBetald()` är vägen in, för **ekonomi och VD**, alltså
snävare än `farHantera` som också släpper in säljchefen. Statusen rör fortfarande
inga pengar: `harGodkants()` behandlar `signerad` och `betald` lika.

### Steg 6: hela systemet vilar på att navet inte drar slutsatsen själv

**`uteblivenInstampling()` mäter en HELT utebliven dag, inte en lucka.** Det är
Ö18, en fråga som aldrig ställdes, och valet är det som håller D-K12:s linje:

> En mätning av "schemalagd tid utan stämpling bakom sig" hade av ren aritmetik
> fångat sen ankomst — minuterna före dagens första instämpling *är* förseningen.
> Då hade gränsen glidit utan att någon flyttat den med avsikt, och K12 1.2 är ett
> löfte i en intresseavvägning som beslutades i morse.

Finns det en enda stämpling lämnar funktionen `null`, oavsett hur sent den kom,
hur långa glapp dagen har eller hur tidigt någon gick hem. Provet skickar in en
person som stämplat in en timme för sent och kräver noll. **Faller den
kontrollen har någon sänkt gränsen utan att gå via K12 avsnitt 6 och 7.**

Följden är att femminutersgränsen sällan biter — en schemalagd dag är längre än
så. Den står kvar ändå, i `MINSTA_MINUTER` och som check-villkor i `0037`, för
att den är det beställaren svarade.

**Fråga 42 och 47 lät motstridiga och är det inte.** 42 säger att perioden räknas
*från den första*, 47 att varningen nollställs tre månader efter *den senaste*.
Ett fönster ankrat i den första uppfyller 42 men inte 47. Ett fönster som räknas
**bakåt från det datum man frågar om** uppfyller båda — ligger den senaste utanför
ligger alla utanför. Det står utskrivet i `iFonstret()` så att nästa läsare inte
"rättar" tillbaka det till 42:s ordalydelse.

**`raknas()` i `konsekvens.ts` är motsatsen till `harGodkants()` i `order.ts`,
och det är med flit.** En makulering är två händelser: signeringen *hände*, så
den räknas fortfarande. En hävning är ett underkänt beslut: chefen säger att
händelsen aldrig borde ha registrerats, så den ska sluta räkna mot nästa också.
Provet kräver att nästa händelse efter en hävning är steg **ett** igen.

**Två antal i underlaget, och de är olika med flit.** `antal.netto` är vad
personen sålde; `antal.bonusgrundande` är vad volymtrappan räknar på. Efter en
bonusförlust börjar räknaren om (fråga 45), så den som stod på 20 och sedan
säljer fem till får nivå 5 på de fem. Blandas de ihop blir antingen vyn en lögn
eller bonusen fel.

Omstarten går från **händelsens dag**, inte beslutets — annars hade utfallet
hängt på när chefen hann titta i kön. Och **från och med**, inte efter: gränsen
går att tolka åt två håll och faller därför ut till den anställdas fördel, samma
princip som toleransen i `raster.ts`.

**Ö17, också aldrig ställd: K&V-bonusen faller helt.** Beställaren sa "samtliga
bonusar faller" och gjorde *en* undantagsregel — orderräknaren. Ett utskrivet
undantag för det ena talar för att det andra inte har något. Det strukturella
skälet är starkare: en order har ett signeringsdatum och går att lägga före eller
efter en händelse, **en vecka har inte det**, och avsnitt 6.2 säger redan att en
halv vecka inte är något man bedömer.

**Förslagsmotorn läser sjukfrånvaro för att INTE göra något.** AC-3.26 och E7.14
förbjuder att vyer joinar `sick_report` — men den regeln handlar om vyer, där RLS
tyst kan ge noll rader. Nattjobbet kör med service role, `payroll_row` bär
minuter per period och inte vilka *dagar* som var frånvaro, och riktningen är
omvänd: uppgiften används uteslutande för att **underlåta** att föreslå en
disciplinär händelse. Faller filtreringen bort blir varje sjukdag i bolaget ett
förslag i chefens kö. Skälet lagras aldrig — `attendance_incident` har ingen
kolumn för det.

Jobbet **återkallar** dessutom förslag som frånvaron hunnit ikapp: den som
sjukanmäler sig i efterhand ska inte ha ett förslag liggande. Raderingen är
tillåten just för att statusen är `foreslagen`.

**Gårdagen föreslås inte.** Två dygns karens, för att den som var sjuk igår ringer
i dag och en rättelse har 48 timmar på sig. Ett förslag som läggs samma natt låg i
chefens kö innan personen hunnit förklara sig.

**Ärendet vid tredje gången får kategorin `other` och är konfidentiellt.**
`development` är den kategori en anställd själv använder för ett samtal om sin
utveckling; ett disciplinärt ärende där hade förgiftat AC-4.5-statistiken.
`confidential` snävar chefskretsen till säljchef och VD — men `hr_case_read`
börjar med `employee_id = current_employee_id()`, så **den det gäller ser sitt
eget ärende**, vilket fråga 49 kräver.

**`attendance_approver` fanns i databasens check-villkor sedan `0037` men inte i
`PERMISSIONS`** — behörigheten gick alltså inte att tilldela. Den är tillagd, och
behörighetsvyn plockar upp den av sig själv.

### Steg 7: två papper som följs åt, aldrig ett

`/provision/underlag/[manad]`. Skillnaden mot lönerapporten är inte kosmetisk:
`payroll_row` bär **minuter och antal** för att navet inte får gissa vad en minut
är värd (K5), medan kronorna i underlaget inte är en beräkning utan en
**huvudbokssumma som redan är attesterad**. Navet räknar inte fram dem — det
listar upp dem.

En stängd månad läses ur `commission_entry`, aldrig ur motorn: körs motorn om kan
en ändrad inställning ge ett annat tal än det som faktiskt bokfördes. En öppen
månad räknas live och stämplas **Preliminär** — ett papper som ser likadant ut i
båda fallen är ett papper någon betalar ut efter av misstag.

**PDF:en är utskriften.** Alternativet var ett nytt beroende som genererar PDF på
servern, vilket är stort att dra in för ett dokument som redan är en tabell — och
en till plats där layouten kan glida isär från vad sidan visar.

**Filen har snävare krets än sidan.** Sidan visar det RLS släpper fram, så en
säljare ser sig själv. En fil lämnar navet och går inte att ta tillbaka. Provet
låser formatet: BOM, semikolon, **komma som decimaltecken och ASCII-minus** — och
kräver uttryckligen att `kronor()` inte används, för den skriver U+2212 och hårt
mellanslag, vilket är rätt i en vy och obrukbart i ett kalkylblad.

### Steg 9: utläsningen förifyller, den sparar aldrig

Migration `0039` vidgar `file_object` med ett fjärde ändamål. Samma form som
`0024` gav rollspelen: villkoren skrivs **om** i stället för att läggas bredvid,
för två check-villkor som båda beskriver tillåtna kopplingar är två ställen att
hålla lika.

**`subject_employee_id` måste vara NULL för en orderbilaga.** Sätts den till
säljaren blir kundens avtal en uppgift om den anställda och följer med ut i hens
registerutdrag. Migrationen har en självkontroll som faller om någon rad bryter
mot det.

**Raderingstriggern fick sitt fjärde undantag** — samma fälla som `0023` och
`0033` gick i: `on delete cascade` kör en DELETE, och ett orderutkast går att
kasta. Utan undantaget hade en spärr mot att städa bort bevis blivit en spärr mot
att kasta ett utkast.

**Bara PDF.** Ö14 sa PDF, och en JPEG hade gett en bild som `pdftext.ts` inte kan
läsa — då hade förifyllningen tyst uteblivit för just de orderna.

Utläsningen är avsiktligt försiktig och lämnar hellre tomt än gissar:

- **Två olika värden ger tomt.** Ett avtal bär både kundens och vårt eget
  bolagsnamn; fylls kundens plats med vårt syns det aldrig.
- **Bara ISO-datum.** "05/08/26" går inte att tolka, och datumet styr vilken
  **månad** någon får betalt.
- **Orgnummer kräver bindestreck.** Tio siffror i rad är lika gärna ett
  telefonnummer.
- **Kontaktperson kräver ledtext.** Ett avtal är fullt av egennamn.

Ett verkligt fel hittades av provet: efter att blanksteg kollapsats ser
`Telefon:` ut som ett efternamn, och namnmönstret åt upp det. Fixen behövde **två
lookaheads** — utan den första backar motorn ett tecken och matchar "Telefo",
som mycket riktigt inte följs av kolon. `\b` dög inte i den rollen: `\w` är ASCII
i JavaScript, så det finns en ordgräns mitt i "Åsa".

Förslaget visas **mot orderns nuvarande värden**, med utdraget ur avtalet som gav
svaret, och bara det som kryssats i skrivs. En godkänd order går inte att rätta
alls — både actionen och triggern i `0034` nekar det, för provisionen är frusen
på den.

### Mätt efter deployen

46 sidor som fyra roller mot produktionen: **184 renderingar, noll serverfel,
noll läckage.** Säljchefens negativa kontroll gick från 91 till 95 träffar — de
två nya sidorna visar namn för den som får se dem, vilket är meningen. Säljare,
teamledare och ekonomi får fortfarande noll.

| Sida | Median | Krav | Marginal |
|---|---|---|---|
| Startsidan | ~536 ms | 1 500 | ~964 ms |
| Stämplingsvyn | ~582 ms | 2 000 | ~1 418 ms |
| **Sökningen** | **~442 ms** | **500** | **~58 ms** |
| Rutinerna | ~456 ms | 1 500 | ~1 044 ms |

**Mätningen hittade en regression jag själv infört.** `far_godkanna_franvaro()`
låg som ett eget `await` på `/tid` och kostade ~50 ms. Det ligger nu i samma
`Promise.all` som dagens stämplingar. Samma sak gjordes förebyggande på
`/provision`, där de tre nya hämtningarna hade blivit en tionde sekventiell våg.

Sökningen rördes inte av bygget; skillnaden mot ~429 ms är körning-till-körning.
Enstaka avläsningar gav 1 574 ms på startsidan och 1 392 ms på sökningen, båda på
kalla funktioner — var och en hade ensam sett ut som en regression.

### Provsviten

35 sviter. Första körningen dog på `ECONNRESET` mitt i `tests/sidor.mjs` med
**noll fallna kontroller** — precis det nätavbrott som står beskrivet här sedan
23 augusti. Omkörning från den sviten och framåt gick igenom. Sammanlagt 1 272 +
347 godkända kontroller plus de tre nya sviterna.

---

## 2026-08-26 · Genomgång inför pilot: notisavfärdning, tre fel, och 0037 tillbaka i repot

Beställaren bad om en hård genomgång: allt säljarna ser, alla roller, buggar,
prestanda, och en konkret önskan om att en notis ska försvinna när man klickar
på den. Passet hittade tre verkliga fel, varav ett var att repot slutat beskriva
databasen.

### Repot beskrev inte längre produktionen

`0037_konsekvenser` kördes mot produktionsdatabasen **2026-08-25 13:31** och
bokfördes i `schema_migrations`. **Varken filen eller koden committades.** Passet
tog slut mellan körningen och commiten.

Det hittades av `tests/registerutdrag.mjs`, som faller när en kolumn pekar på
`employee` utan att stå i vare sig `KALLOR` eller `UNDANTAG` — den hittade fem
sådana kolumner i två tabeller (`attendance_incident`, `consequence_rule`) som
ingen migration i repot nämnde. Utan det provet hade nästa färdiga miljö tyst
fått ett annat schema än produktionen.

**Filen är återskapad ur den körda databasen** och är idempotent. Bokföringen för
raden togs bort och migrationen kördes om, så checksumman beskriver nu filen som
faktiskt ligger i repot. Det är alltså inte en gissning att repot och databasen
stämmer — det är kontrollerat genom att köra filen mot produktionen och låta
självkontrollerna avgöra.

**Schemat finns, koden gör det inte.** Ingen sida och ingen motor skriver i
`attendance_incident`. E13 steg 6 är fortfarande obyggd, och det står nu utskrivet
överst i migrationen så att nästa läsare inte tror något annat.

Min egen migration flyttades till `0038` för att inte bli ett andra 0037.

### E5.7: en klickad notis försvinner (0038)

Klockan räknade fram sina poster ur raderna som redan fanns och lagrade **en enda
tidpunkt per person**: när den senast öppnades. Den släcker pricken på allt
samtidigt men tar inte bort någonting — en kurs man bestämt sig för att göra på
fredag låg kvar och trängde ut allt annat i fjorton dagar.

Det är två olika frågor. *"Har du sett att det fanns något nytt?"* besvaras av en
tidpunkt. *"Har du tagit hand om just den här?"* kan bara besvaras per post.
`notification_dismissed` bär en rad per post personen klickat på.

**Filtreringen sker före kapningen till femton.** Hade de avfärdade räknats bort
efter kapningen hade de fortfarande ätit upp sina platser, och den som klickade
bort tre poster hade fått en kortare lista i stället för tre nya — tvärtemot vad
knappen lovar.

**Id:t bär det som gör posten ny.** `rutin-<id>-<version>`,
`arende-<ärendeid>-<meddelandeid>`. En ny version av en rutin får ett nytt id och
dyker upp igen även för den som klickade bort den förra. Alla id:n går nu genom
`notisId()` med en typad källista, vilket gör att listan i `notiser.ts` och
listan i `notiser-server.ts` **inte kan glida isär** — det finns bara en lista,
och en ny sorts notis som skrivs med en hopskriven sträng faller på typkontrollen.

Ingenting annat försvinner. Den okvitterade rutinen står kvar på `/rutiner`, den
obeslutade ansökan på `/franvaro` och på startsidans "Att göra". Klockan är
påfarten, inte bokföringen.

### `registreraVisning` var en publik ändpunkt utan kontroll

**Tredje gången samma fel** — `skrivFel` 22 augusti, `sattKvitto` natten till 24
augusti. Allt som exporteras ur en `"use server"`-fil får ett id och tar emot
anrop från webbläsaren.

Funktionen låg i `rutiner/actions.ts` med signaturen `(dokumentId, employeeId)`,
skrev med service role och kontrollerade ingenting. Vem som helst kunde skriva en
rad som påstod att **vilken anställd som helst läst vilket dokument som helst**,
och räkna upp räknaren fritt. `document_view` heter "Lästa rutiner" i
registerutdraget och är underlaget för `adoption_glomda_dokument` — en
arbetsmiljörutin som ser läst ut för att någon skickat ett anrop är precis det
uppgiften finns för att motbevisa.

Den ligger nu i `src/lib/rutiner-data.ts`, som fanns redan för just det ändamålet,
och **personen kommer ur sessionen i stället för ur ett argument**.

### Sessionen verifierades två gånger per anrop

`supabase.auth.getUser()` verifierar tokenen genom att **fråga Supabase Auth över
nätet**, och den kördes två gånger per sidvisning: en gång i mellanvaran och en
gång till i `getCurrentUser()`. Två turer till samma tjänst med samma token för
samma svar.

Det märktes. X3-mätningen mot produktionen gav sökningen **4 ms marginal** mot
kravet på 500 ms — den var 96 ms förra gången. Ingen sida hade blivit
långsammare; det är bara så lite marginal det alltid varit.

Mellanvaran skickar nu vidare det den redan tagit reda på i en request-rubrik.
**Det som gör rubriken pålitlig är `rensaIdentitet(headers)` på första raden i
`updateSession()`** — en rubrik som kom från webbläsaren finns inte kvar när
servern läser.

Den raden är hela säkerheten, och faller den bort går allt annat fortfarande att
använda: vem som helst kan då skicka en egen identitetsrubrik och bli den
personen. En tyst total förbigång som inget annat prov skulle märka. Därför går
`tests/identitet.mjs` mot den riktiga adressen och skickar en riktig förfalskning,
både mot startsidan och mot `/lonekostnad`.

**Svaret byggs nu en gång, sist.** Rubriken måste in i requesten efter
`getUser()`, och `NextResponse.next` med request-rubriker låser fast dem när den
skapas. Kakorna samlas därför i en lista och sätts i `avsluta()`. Det rättade två
saker på köpet: en omdirigering byggde förut ett eget svar och **tappade den
förnyade sessionskakan tyst**, och aktivitetskakan sattes på ett `response`-objekt
som `setAll` kunde byta ut mitt under handen.

Mätt som median av tre körningar mot produktionen:

| Sida | Före | Efter | Krav |
|---|---|---|---|
| Startsidan | 653 ms | **482 ms** | 1 500 |
| Sökningen | 496 ms | **429 ms** | 500 |
| Rutinerna | 506 ms | **446 ms** | 1 500 |
| Stämplingsvyn | 533 ms | 530 ms | 2 000 |

Sökningens marginal: 4 ms → ~71 ms. **Läs medianen av flera körningar.** En
enstaka avläsning gav 586 ms direkt efter att sidprovet hämtat 176 sidor, alltså
på en kall funktion, och den siffran hade ensam sett ut som en regression.

### Två nya prov, och varför det ena skrevs om

`tests/sidor.mjs` öppnar **44 sidor som fyra roller mot den riktiga adressen** —
176 renderingar, noll serverfel. Ingen annan svit *renderar* något, så ett fel i
en server component har hittills varit osynligt för provsviten.

Det provar **inte** HTTP-status mot en rollmatris. Första versionen gjorde det och
såg ut att hitta elva behörighetsluckor för en säljare. **Det gjorde den inte.**
Två saker gör statuskoden oanvändbar som behörighetsmått:

1. **`redirect()` inuti en strömmad komponent ger HTTP 200.** Next skickar sidans
   skal först, och när `SchemaInnehall` sedan kastar sin omdirigering finns
   statusraden redan hos webbläsaren. Omdirigeringen hamnar i strömmen i stället.
   Det skyddade innehållet renderas aldrig — kontrollerat på markörer i HTML:en.
2. **Flera sidor är med flit ospärrade** och låter RLS avgöra. `/personal` är den
   tydligaste: öppen för alla, och en säljare ser exakt en rad — sig själv. Det är
   PRD §5.2, inte en lucka.

Provet söker i stället efter riktiga namn och e-postadresser ur driften i varje
svar. Säljare, teamledare och ekonomi får **noll** träffar. Säljchefen får 91,
vilket är provets **negativa kontroll** — utan den bevisar ett läckprov som inte
hittar något ingenting alls.

### Två prov föll på riktig data, inte på kod

**`tests/rls.mjs` gick inte att köra alls.** Städningen raderade bara auth-konton
den hittade via `employee.auth_user_id`. En kraschad körning 2026-08-25 lämnade
kvar ett **föräldralöst** konto — raden borta, kontot kvar — som städningen aldrig
såg. `skapa()` fick tillbaka "email exists", la in en employee-rad utan
`auth_user_id`, och inloggningen dog på `invalid_credentials`. Provet hade fått ett
permanent minne av sin egen krasch. Kontona hämtas nu ur Auth i stället.

**`tests/provision-period-db.mjs`** antog att `commission_period` och
`commission_bonus_level` var tomma. Det är de inte längre — beställaren fastställde
två perioder och fyllde i volymtrappan (5/10/15/20 → 200/500/1000/1200 kr) den 25
augusti. Provet väljer nu en ledig månad och en ledig tröskel, och städkontrollen
frågar på **sina egna rader** i stället för att räkna hela tabellen. Det är tredje
gången regeln överst i `rls.mjs` biter, den här gången åt skrivhållet.

### K12 och K14 är beslutade och publicerade

Beställaren gav klartecken 2026-08-26: *"k12 är helt godkänd och olåst"*.

Avsnitt 6 och 7 i K12 — avvägningen och beslutet — var avsiktligt tomma och är nu
ifyllda, med beslutsdatum 2026-08-26 och "Beslutad av: Zen, VD". **Texten är
skriven här och bär beställarens namn; den ska läsas.** Båda behandlingarna
tillåts: sen ankomst med tolerans 1 minut, och raststämpling under förutsättning
att skyddsåtgärderna i avsnitt 5 står kvar.

**Toleransen på 1 minut är systemets lägsta**, och dokumentets eget avsnitt 4 säger
att minutprecision kan upplevas som kontrollerande. Beslutet motiverar den med hur
uppgiften *används* — mönster, aldrig en enskild dag — och skriver ut att
avvägningen inte längre gäller om uppgiften börjar användas för att avgöra en
enskild dag.

K14:s rastavsnitt sa `"Rasten stämplas inte i dagsläget"`. Hade den publicerats så
och raststämplingen slagits på hade texten blivit fel och krävt en ny version och
en ny kvittens av alla. Den beskriver nu båda lägena, de fyra avvikelsetyperna och
att ingen rastavvikelse når provisionen.

### Rastschemat: beställaren sätter det själv

Schemat i produktion är **10 minuter, fönster 10:50–13:00**. Mätt mot den riktiga
avvikelsemotorn ger det:

| Vad någon gör | Vad som registreras |
|---|---|
| 10 min rast 11:00 | inga avvikelser |
| 30 min lunch | Rast blev längre 20 min |
| 60 min lunch | Rast blev längre 50 min |
| lunch + kaffepaus | Rast blev längre 20 min + Extra rast |

Alltså: **var och en som äter lunch får en avvikelse varje dag.** Beställaren fick
frågan och svarade *"låt mig sätta detta själv"*. Rör inte `scheduled_break`.

För att hjälpa den som ska sätta det visar `/tid/schema` nu vilket schema som
**gäller nu**, vilket som träder i kraft senare och vilka som är historik. Ett
schema ändras aldrig (AC-2.35), så listan bar varje version som någonsin lagts in
och en ersatt rad såg exakt ut som den gällande. Rastnumret saknades också helt.

**Spärren har nu exakt ett villkor kvar:** `sparr_saknas('raststampling')` svarar
*"K14: 1 anställda har inte kvitterat informationen."* Den kvittensen skapades
inte åt någon — hela poängen med AC-2.36 och K29 är att en människa läst texten.

---

## 2026-08-25 (kväll) · E13 steg 5: K&V-protokollet

Migration `0036`. Beställaren besvarade Ö4, Ö8, Ö12 och Ö15 innan bygget
började — Ö4 var det som blockerade steget.

### Ö4 var inte en detalj, den var tre olika system

Svaret "200 poäng" kunde betyda maxpoäng 200, 400 eller 2 400, och samma tröskel
— 160 — blev då 80 %, 40 % eller **6,7 %**. Den sista läsningen gör tröskeln
meningslös: varje vecka godkänns, och K&V-bonusen blir automatisk för alla.

Beställarens svar 2026-08-25: **200 totalt för båda samtalen**, alltså 80 %.

**Fördelningen på de sex områdena är fortfarande inte sagd, och gissas inte.**
`kv_criterion.max_points` är NULL för samtliga sex, och migrationen har en
självkontroll som **fäller sig själv om någon seedar ett värde där**. Utan
maxpoäng går inget samtal att bedöma — det är avsiktligt, och det är samma linje
som täckningsgraden i `0025` och volymtrappan i `0035`.

Det som däremot **är** seedat är det beställaren faktiskt svarat: sex områden
med sina namn, två samtal per vecka, tröskel 160, 1,25 % per godkänd vecka och
tak 5 %.

### Räknaren på inställningssidan är hela poängen med sidan

`/kv/regler` visar **medan man skriver** vad tröskeln motsvarar i procent — ur
talen i formuläret, inte ur det sparade. Den som sätter 200 på varje område ser
direkt att tröskeln blev 6,7 %, innan det är sparat och innan någon får en bonus
av misstag. Var maxpoängen omöjligt låg säger den i stället att tröskeln inte
går att nå.

Det var precis den kontrollen specifikationen bad om i avsnitt 6.1, och skälet
att den behövs är att felet inte syns någon annanstans: en trasig skala ger inga
felmeddelanden, bara fel bonus.

### Torsdagsregeln, och varför randveckorna nästan blev fel

En ISO-vecka som spänner över ett månadsskifte hör till den månad där dess
**torsdag** ligger (Ö9). Det ger alltid fyra eller fem veckor per månad utan
överlapp och utan glapp.

Fällan låg i periodstängningen. Hämtas bara augustis samtal blir randveckorna
halva — och en halv vecka är per definition inte fullständigt bedömd, alltså
ingen bonus. `hamtaKvPerPerson` hämtar därför **en vecka före och en efter**
månaden och låter `kvManad` filtrera. Utan det hade varje månadsrand tyst tappat
en godkänd vecka.

### En halvbedömd vecka hoppas över, och det är inte snällhet

Tröskeln är definierad som summan av **båda** samtalen. En vecka med bara ett
bedömt samtal kan därför aldrig nå 160 — maxpoängen per samtal är 100 — och
veckan hade blivit **underkänd av ett skäl som är chefens och inte säljarens**.

Avsnitt 6.2 säger redan att en vecka hoppas över "oavsett skäl — — eller att
chefen inte hann". Att chefen hann halva vägen är samma sak. Regeln följde av
specifikationen men stod inte utskriven; den är inarbetad i 6.2 nu.

Rutnätet visar `1/2` för de halva veckorna, så att de går att se.

### Rutnätets tomma rutor är det enda som avslöjar en glömd vecka

En vecka utan bedömning räknas varken för eller emot, så ingen siffra någonstans
visar att den saknas. Chefens rutnät säljare × vecka är därför inte en översikt
utan **den enda kontrollen** — det är därför den vyn står i specifikationen.

### Bedömningen får ändras, till skillnad från huvudboken

En bokförd krona är en händelse som inträffat; en bedömning är en människas
omdöme. Ett omdöme som visar sig fel ska gå att rätta, annars blir chefen
försiktig med att skriva något alls — och då tappar protokollet det som gör det
till ett utvecklingsprotokoll.

Ändringen loggas med **både det gamla och det nya talet**. En logg som bara
säger att något ändrades går inte att granska.

Är perioden redan stängd ändras ingen utbetalning: den är bokförd i
`commission_entry` och rättas i så fall med en negativ post.

### K&V räknas aldrig på K&V

Basen är grundprovision **plus volymbonus** (Ö3), alltså hela månadens intjäning
före K&V. Läggs K&V-bonusen till basen blir den beroende av sig själv, och då
avgör ordningen mellan raderna vad någon får betalt. Provet kontrollerar det
explicit.

### Utvecklingskurvan räknar snitt, inte summa

En månad med fem bedömda samtal ger en högre summa än en med tre utan att något
blivit bättre. En kurva som stiger när man arbetar mer är inte en
utvecklingskurva.

### Säljaren ser fritexten

Fråga 38, och det är hela poängen med ett utvecklingsprotokoll. Formuläret säger
det rakt ut till chefen: *"Säljaren läser det du skriver här."*

Och skälet till att en vecka hoppats över får **aldrig** synas — "ej bedömd,
sjukfrånvaro" i en prestationsvy är sjukdata i en provisionsvy (AC-3.26, E7.14).
Vyn säger "Ej bedömd" och ingenting mer.

### Prov

`tests/kv.mjs`, 54 kontroller: torsdagsregeln inklusive årsskiftet vecka 53,
halvbedömda veckor, taket i en femveckorsmånad, och de två Ö4-läsningar som
*inte* valdes — för att visa att kontrollen skiljer dem åt. Plus 18 nya i
`tests/provision-motor.mjs` för pengarna, som därmed är uppe i 137.

---

## 2026-08-25 (kväll) · E13 steg 4: säljarens progressvy

Kort, för motorn hade redan allt som behövdes. `nasta` låg i underlaget sedan
steg 3; det som saknades var prognosen och vyn.

### Prognosen räknar på månadens snitt, och antagandet står utskrivet

`prognosNastaNiva()` i motorn, med prov. Beställarens val på fråga 52: prognosen
utgår från **nuvarande snittprovision per order**, inte från paketpriset.

Antagandet skrivs ut i vyn — *"vid samma snitt som hittills, 1 500 kr per
order"* — och det är inte artighet. "Du får 22 000 kr vid tio order" är fel så
snart de tre sista orderna är mindre än de sju första, och då är det navet som
ljög. Med villkoret utskrivet är det samma tal med något som går att
kontrollera.

**Prognosen svarar `null` i tre lägen** i stället för att gissa: över trappans
slut finns ingen nästa nivå, utan order finns inget snitt, och utan konfigurerad
trappa finns ingen nivå att sikta på. En prognos ur noll order är en gissning
utklädd till en beräkning.

### Sidan får aldrig addera de två sanningarna

`/provision` visar nu två saker som båda handlar om samma månad: motorns live-tal
och de handinmatade posterna i `commission_entry`. För en **öppen** månad läggs
de ihop. För en **fastställd** gör de inte det — attesten har då redan bokfört
motorns rader, och att addera dem igen hade dubbelräknat månaden.

Det är en rad kod (`minStangd`) och den är hela skillnaden mellan rätt och
dubbelt. Den står utskriven överst i filen.

### Två saker står medvetet inte i säljarens vy

**K&V-bonusen** — den ligger på K&V-sidan (steg 5). Den bedöms av en människa och
hör ihop med bedömningen, inte med ordervolymen.

**Hela beräkningskedjan** — säljaren får underlaget i en enklare version än
chefens (fråga 54): vilka order, vilken nivå, vilka avdrag, men inte varje
mellanled.

---

## 2026-08-25 (kväll) · E13 steg 2 och 3: räknemotorn, volymtrappan och periodstängningen

Två leveranser, ett räknefel i det som redan låg i produktion, och en fråga som
aldrig var ställd. Migration `0035`.

### Räknefelet i steg 1: en makulering är två händelser, inte en

Det här är passets viktigaste rad, och det hittades genom att bygga motorn ovanpå
steg 1 i stället för att lita på att steg 1 var rätt.

En order ger provision i sin **signeringsmånad** och drar tillbaka den i sin
**makuleringsmånad**. Det är hela poängen med två månadskolumner, och det är det
som gör att en stängd period aldrig behöver skrivas om.

`orderIPeriod` räknade signeringsbidraget på `raknas()`, som är falskt för
`makulerad`. Alltså försvann den första av de två händelserna i det ögonblick
statusen ändrades, och två fel följde:

| Fall | Gav | Skulle ge |
|---|---|---|
| Order signerad **och** makulerad i augusti | **−1 500 kr** | 0 kr |
| Order från mars, makulerad i augusti — vad säger **mars**? | **0 kr** | 3 000 kr |

Det första bokför pengar tillbaka som aldrig betalades ut. Det andra är värre:
det **räknar om mars**, en stängd och attesterad period, vilket är exakt det
avsnitt 4.4 i specifikationen säger aldrig får ske. Ordern hade gett 3 000 kr i
mars och gav plötsligt noll — bara för att någon makulerade den fem månader
senare.

Rättat med `harGodkants()`, som är sann även för `makulerad`. Statusen är ett
giltigt bevis på att ordern en gång godkändes: både stegtriggern i `0034` och
villkoret `sales_order_provision_satt` garanterar att `makulerad` bara nås via
`signerad`.

**Tre påståenden i `tests/order.mjs` kodade in felet** och var alltså gröna på
fel svar. Ett av dem hette till och med "mars star oforandrat pa noll" — mars
stod aldrig på noll, den stod på 3 000. Ett prov som beskriver felet i klartext
och ändå passerar är den dyraste sortens prov.

### Motorn returnerar ett underlag, inte ett tal

`src/lib/provision-motor.ts`. Beställarens krav i avsnitt 12: både säljaren och
chefen ska kunna se **varför** en summa blev som den blev.

`summa` är radernas summa och ingenting mer. En funktion som svarar `12400` går
inte att ifrågasätta och därmed inte att lita på — den första gången någon tycker
att siffran är fel finns det ingenting att peka på. Provet kontrollerar på varje
ställe att de två aldrig glider isär.

Filen importerar ingenting från Supabase. Reglerna kommer in som argument, och
provet kör motorn utan att starta Next — samma linje som `raster.ts`,
`lonekostnad.ts` och `franvaro.ts`.

### Avrundningen går bort från nollan åt båda hållen

`Math.round` ensamt avrundar mot plus oändligheten: −1 500,50 blir −1 500. Följden
hade varit att varje **avdrag** är systematiskt snällare mot bolaget än ett lika
stort **tillägg**. Ingen hade sett det; alla belopp i paketmatrisen är jämna
kronor. Det dyker upp först den dag någon sätter en procentsats.

Avrundningen sker **en gång, på den färdiga bonusraden** (avsnitt 5.4). Trettio
örebelopp som avrundas var för sig blir upp till trettio kronors avvikelse.

### Volymtrappan: retroaktiviteten ligger i multiplikationen

Nås nivå 10 får **alla tio** orderna nivå 10:s belopp, inte bara de över
tröskeln (avsnitt 5.2). Med `amount_per_order` betyder det `belopp × hela
antalet`, inte `belopp × antalet över tröskeln`. Det är den enda formen där
ordet "retroaktiv" har en synlig innebörd i själva beloppet.

Nivån blir **aldrig negativ**. Ett negativt ordersaldo — fler makuleringar än
order i månaden — ger ingen nivå alls, men provisionsavdraget sker ändå.

**Ingenting seedas.** `commission_bonus_level` föds tom, för beställaren har satt
nivåerna men inte vad de är värda (fråga 18). Tills någon fyller i den ger motorn
noll bonus. Samma linje som täckningsgraden i `0025`: en nolla i vyn syns, ett
standardvärde ser rätt ut och blir tyst sanning.

### Ö16: en fråga som aldrig ställdes

Vilken trappa gäller för en månad som en ändring skär igenom? Specifikationen
svarar inte, för frågan var inte ställd.

Byggt så att **trappan slås upp på månadens första dag**, och skillnaden mot
`commission_rate` följer av vad de två är. Provisionssatsen är en egenskap hos
**en order** och slås upp på den orderns datum. Volymbonusen är en egenskap hos
**hela månaden** — nivån bestäms av månadens samlade volym — och en trappa som
byter form mitt i månaden går inte att tillämpa per order utan att bli
obegriplig.

Det gör dessutom beställarens tre val i avsnitt 8.1 entydiga. "Från och med nu"
och "från och med nästa månad" sammanfaller mitt i en månad och skiljer sig den
1:a, vilket är rätt: den som ändrar trappan på första dagen menar den månaden.

Står som **Ö16** i specifikationen med förslaget gällande tills annat sägs, och
med vad som ska ändras om beställaren vill ha det annorlunda.

### Periodstängningen: två sätt att svara på samma fråga

En **öppen** månad räknas live ur orderna. Den måste det — order elva höjer
bonusen på order ett till tio, så varje ny order ändrar hela månadens siffra.

En **stängd** månad är bokförd i `commission_entry` och räknas aldrig om. Den
måste det — annars ändrar en bonusnivå som sätts i november vad någon fick betalt
i augusti.

**Öppen är frånvaron av en rad.** `commission_period` bär bara stängda perioder.
En rad med status `oppen` hade varit ett tillstånd utan innebörd som någon förr
eller senare glömt att skapa, och då hade en månad utan rad blivit tvetydig i
stället för öppen.

**Ordningen i attesten är medveten: posterna först, perioden sedan.** Faller det
mitt i står månaden kvar som öppen med sina poster bokförda, och ett nytt försök
går igenom — det partiella unika indexet på `(source, external_ref)` nekar en
andra bokföring av samma sak, och den kollisionen behandlas som "redan bokfört" i
stället för som ett fel. Omvänd ordning hade gett en stängd period utan poster,
som varken går att räkna live eller att bokföra om.

Referensen är `manad:person:slag`, alltså deterministisk. Det är den som gör
attesten idempotent.

Huvudboken fick en tredje källa, `motor`, vid sidan av `manual` och `inkio`.

### Två kretsar, inte en

| Funktion | Vem | Uppgift |
|---|---|---|
| `far_hantera_provision()` | säljchef, ekonomi, VD | **ser** andras provision, **fastställer** period |
| `far_andra_provisionsregler()` | säljchef, VD | **ändrar** trappan |

Ekonomi ser men ändrar inte (avsnitt 2). Den som betalar ut ska inte också vara
den som bestämmer vad som ska betalas ut. Handinmatningen på `/provision` är
kvar hos ekonomi och VD som förut.

### Fällan från 0034 höll på att bita igen

`revoke ... from public` räcker inte — Supabase har en egen default-ACL som ger
`anon` en explicit grant på varje ny funktion. `0035` skriver `from public, anon`
och avslutas med samma självkontroll som `0032` och `0034`.

Självkontrollen i `0035` gör dessutom en sak till: den **provar att bokföra en
`motor`-post och rullar tillbaka den**. Går det fel står ett gammalt
check-villkor kvar under ett namn slingan inte hittade, och då hade
periodstängningen fallit först i produktionen.

### Prov

- `tests/provision-motor.mjs` — 104 kontroller, ren logik, ingen databas.
- `tests/provision-period-db.mjs` — 16 kontroller mot den **riktiga** databasen.
  Triggrarna och villkoren ligger i databasen och gäller därför även service
  role; en regel som bara finns i en server action är en regel nästa server
  action inte känner till. Allt rullas tillbaka, och provet kontrollerar till
  sist att ingenting blev kvar.

Fällan i det andra provet är värd att minnas: `pg` ger ett `date` som en JS-Date
på lokal midnatt, och `toISOString()` flyttar den till UTC — i svensk sommartid
två timmar bakåt, alltså till dagen innan. Den 1 juli blev "2026-06-30" och
villkoret föll. Datumen hämtas nu som text ur databasen.

---

## 2026-08-25 · E13 steg 1: kundordern, och regelverket bakom hela bonusbygget

Beställaren beskrev fem sammanhängande delar — manuell order- och
provisionsregistrering, volymbonus, K&V-protokoll, konsekvenssystem och en
progressvy för säljaren. Passet gick i tre delar: 59 frågor, en
regelspecifikation, och den första skivan kod.

**Specifikationen är `docs/PROVISION_SPEC.md`** och är den som gäller. Det här
är varför-resonemangen.

### Q78–Q80 är besvarade. E13 är inte blockerad längre

Provisionen är en **engångsbetalning per order**, ur en matris med tre paket och
tre löptider. Nio belopp, samtliga i `commission_rate` och inget av dem i koden.
Beställaren angav dem 2026-08-24.

Att de ligger i en versionerad tabell med `valid_from`/`valid_to` är inte
prydlighet. Uppslaget sker på orderns **signeringsdatum**, inte på dagens datum,
och det är svaret på frågan "vilken sats gällde när den här ordern skrevs" —
precis den fråga som ställs när en utbetalning ifrågasätts. `tests/order.mjs`
kör hela skarven: 30 september ger den gamla satsen, 1 oktober den nya, och
`valid_to` är exklusivt så att dagen varken tillhör båda raderna eller ingen.

### Order, inte avtal

`/avtal` och `contract` är **anställningsavtal** (E9.1). Kundaffären heter
**order** — beställarens eget ord — och bor i `sales_order` på `/order`. Två
saker som båda heter avtal i samma nav blir fel för någon.

### Makuleringen bokförs i makuleringsmånaden

Beställarens beslut, och det är det som gör periodstängningen möjlig. En order
från mars som makuleras i augusti **river augusti**: en negativ post och en
minskad orderräknare där, medan mars står orört. Alternativet — att backa in i
mars — hade krävt att en stängd och utbetald period skrivs om.

Därför har makuleringen en **egen** genererad månadskolumn,
`cancel_period_month`. Utan den hade avdraget behövt hittas via
signeringsmånaden, alltså via just den period som inte får röras.

Nettoantalet kan bli **negativt** om fler order makuleras än som tecknats. Det
är avsiktligt: bonusnivån blir noll, men provisionsavdraget sker ändå.

### Provisionen fryses på ordern vid godkännande

Samma linje som `contract.body_md` i 0028: dokumentet fryser malltexten, så
mallen går att ändra fritt efteråt. Här fryser ordern satsen, så en höjning i
november inte tyst ändrar vad någon tjänade i augusti. Triggern
`sales_order_stegbyte` nekar att belopp, paket, löptid, säljare eller
signeringsdatum skrivs om efter `signerad`.

### Ett handsatt belopp kräver en anteckning

Faller ordern utanför paketreglerna sätter godkännaren provisionen själv. Då är
anteckningen **obligatorisk**, via ett check-villkor och inte bara i formuläret.
En avvikande provision utan skäl är det första någon ifrågasätter i efterhand,
och då finns svaret ingenstans.

### K27: orgnumret är ett medvetet undantag

En **enskild firma har personnummer som organisationsnummer**. Ett check-villkor
av `contract.variables`-modell hade alltså nekat en fullt laglig kund. Kolumnen
tillåter därför tio siffror, provet kontrollerar uttryckligen att `850101-1234`
går igenom, och undantaget står i DECISIONS.md. Följden: numret får inte in i
den globala sökningen, och **P0.6 registerförteckningen behöver kunduppgifter
som ny kategori**.

### Fyndet: 0027 räckte inte, och självkontrollen fångade det

Migrationen **föll första gången den kördes**, på sin egen sista kontroll:
`anon har annu execute pa: far_hantera_order`.

0027 la in `alter default privileges ... revoke execute on functions from
public` och skrev att nästa funktion därmed är stängd som standard. Det är halva
sanningen. Supabase har en **egen default-ACL på schemat**, satt av
`supabase_admin`, som ger `anon` en **explicit** grant på varje ny funktion:

```
public | {postgres=X/…, anon=X/…, authenticated=X/…, service_role=X/…}
```

Ett revoke från PUBLIC rör den inte. Rätt form för en ny funktion är
`revoke all ... from public, anon` — båda måste nämnas. Det förklarar också
varför 0032 var tvungen att skriva ut `from public, anon` för alla femton
funktioner; skälet stod inte utskrivet där, och står nu i 0034.

**Kontrollen längst ned i migrationen är det som gjorde skillnaden.** Utan den
hade `far_hantera_order()` gått i produktion anropbar för en utloggad. Skriv en
ny security definer-funktion: ta med både `public` och `anon`, och låt
kontrollen ligga kvar.

### Det som INTE byggdes, och varför

- **Bonusen räknas inte.** Volymtrappan är steg 3. `commission_entry` från 0031
  är orörd — ordern är sanningen om vad som sålts, huvudboken om vad som
  bokförts, och att låta dem mötas innan perioden kan stängas hade gett två
  ställen som båda påstår sig veta månadens summa.
- **Ingen filuppladdning.** Beställaren vill kunna bifoga avtalet som PDF, och
  det är frivilligt. `file_object` i 0022 har ett stängt `purpose`-villkor och
  ett "exakt en koppling"-villkor, och den tabellen bär **läkarintyg**. Att
  vidga den förtjänar en egen migration och en egen provkörning, inte ett
  påhäng på den här.
- **Delade order.** Beställaren sköt på frågan. Ingen andelskolumn lades in — en
  kolumn som alltid är 100 lär folk att den inte betyder något, och den dagen
  den ska betyda något går den inte att lita på bakåt.

### K12 är omskriven, inte kringgången

Se D-K12. Konsekvenssystemet utgår från utebliven instämpling, vilket
K12-utkastets §5 räknade upp som en byggd skyddsåtgärd att inte göra.
Beställaren beslutade att bygga det ändå.

Det visade sig vara billigare än det såg ut: **1.1 in- och utstämpling vilar
inte på intresseavvägningen alls** utan på ATL 11 § och anställningsavtalet, och
dokumentet är fortfarande ett **utkast utan beslutsdatum** — löftet har alltså
aldrig lämnats till personalen. Rast (1.3) och sen ankomst (1.2) når fortfarande
aldrig provisionen; beställaren har inte bett om det, och det är de två
behandlingar som faktiskt kräver avvägningen.

---

## 2026-08-24 (sent) · Administrationspanelerna flyttade in i rutan

Rutan hade Administration som en lista med **länkar**. Klickade man Scheman
byttes sidan ut och rutan försvann — man fick stänga inställningarna för att
se det man just öppnat. Panelerna ritas nu inne i rutan.

### Rutan är inte längre ett tillstånd, den är en adress

Det är hela ombyggnaden. Förut höll `Skal` en boolean och sektionerna kom som
färdiga noder från layouten. Det bär inte fem administrationspaneler: de gör
flera databasfrågor var, och att rita alla på varje sidvisning för en ruta de
flesta aldrig öppnar är att betala för ingenting.

En serverkomponent går inte att hämta lazily utan en rutt. Alltså en rutt:
**parallell slot `@ruta` med intercepting routes.** Klickar man sig dit inifrån
navet fångas navigeringen och panelen ritas i rutan ovanpå sidan man står på.
Laddar man om samma adress finns ingen interception — `default.tsx` lämnar
sloten tom och panelen ritas som helsida.

Vinsten utöver lazy-laddningen: **en panel, en adress.** Länken till
Frånvaroregler inne på `/franvaro` pekar på samma ställe som posten i rutans
meny, och båda öppnar rutan. Inga parallella adresser att hålla i synk.

### Tre saker som var lätta att bygga fel

**Ramen måste vara en layout.** Låg `<dialog>` i varje panelsida byttes
elementet ut vid varje panelbyte — rutan stängdes och öppnades igen, med blink
och tappat fokus. Nu ligger den i `@ruta/(dialog)/layout.tsx`, och en layout
står kvar mellan syskonrutter.

**Rutt-gruppen `(dialog)` behövs.** Utan den hade `default.tsx` fått samma
layout, och rutan hade ritats tom på varje sida i navet.

**Panelbyten använder `replace`, inte `push`.** Annars hade historiken fyllts
med ett steg per flik man tittat på, och stängningen — som är ett enkelt
`back()` — hade landat på förra fliken i stället för på sidan man kom ifrån.
Nu är ett steg bakåt alltid vägen ut, även efter fem panelbyten.

### Fem sidor delade i två

Varje panel har nu `Innehall.tsx` bredvid sin `page.tsx`. Sidan äger sitt
sidhuvud — tillbakalänk och rubrik — och innehållet äger resten. I rutan står
panelens namn redan i toppraden, och en tillbakalänk inne i en modal pekar åt
ett håll som inte finns.

**Behörigheten ligger i `Innehall`**, inte hos anroparen. Båda vägarna in är
publika adresser, och en kontroll som ligger i sidan ovanför är en kontroll
som nästa väg in glömmer. Undantaget är `design/Innehall.tsx`, som inte har
någon — det har sidan aldrig haft, den rör ingen data, och kommentaren säger
det rakt ut i stället för att påstå motsatsen.

### `installningar-delade.ts` finns för att server-only smittar

`installningar-poster.ts` bygger listan utifrån användaren och importerar
därför `@/lib/lonekostnad-server`, som är `server-only`. Sidopanelen och rutan
är klientkomponenter. Importerar de ett **värde** därifrån dras hela grafen med
till webbläsaren och bygget faller. Typen och de två konstanter båda sidor
behöver ligger därför för sig.

`AdministrationSektion` på helsidan bygger också på `installningsPoster` numera.
Två listor med var sin uppsättning if-satser hade varit två ställen att lägga
till en panel på, och det andra stället är det som glöms.

### Provat i produktion

Alla fem panelerna i rutan, hård laddning av `/tid/sparrar` och `/profil` som
helsidor, länken från `/franvaro`, Esc efter panelbyte. `npm run typecheck`
grön.

**En hydreringsvarning (React #418, textskillnad) sågs en gång** mitt i
klickandet och gick inte att återskapa på fem försök. Navet renderar
minutberoende text — den sortens varning kommer av att en minut slår om mellan
server och klient, och den fanns i så fall före det här passet. Noterad, inte
utredd.

---

## 2026-08-24 (kväll) · Inställningarna blev en ruta ovanpå fönstret

Profilbilden nere till vänster ledde till helsidan `/profil`. Nu öppnar den
inställningarna som en ruta över fönstret, med kategorier till vänster —
samma form som macOS Systeminställningar och Claudes inställningar.

Skälet är att **inställningar sällan är ärendet.** Man kommer från något man
höll på med, ställer om en sak och ska tillbaka. En helsida river bort det man
hade framför sig och kräver ett steg bakåt för att komma tillbaka dit.

### Elementet är ett `<dialog>`, och det är hela poängen

`showModal()` ger fokusfälla, Esc, inert bakgrund och placering i webbläsarens
topplager. Var och en av de fyra är lätt att bygga fel för hand, och en
fokusfälla som läcker gör rutan obrukbar med tangentbord.

Två saker `<dialog>` INTE ger, och som därför står i koden:

- **Rullning bakom rutan.** Modalen spärrar klick men inte hjul i alla
  webbläsare. `overflow: hidden` på `<html>` medan rutan är öppen.
- **Klick på bakgrunden.** Ett sådant klick rapporteras med `<dialog>` som mål.
  Rutan har därför ingen egen inre marginal — panelen fyller den helt, annars
  hade ett klick på marginalen stängt av misstag.

### Sektionerna ligger i `profil/Sektioner.tsx`, och det är inte av lathet

Rutan och `/profil` visar **samma komponenter**. `/profil` finns kvar för
djuplänkar, bokmärken och den som hellre läser allt under varandra.

Två uppsättningar hade varit den glidning anställningsflödet flyttade två
funktioner till lib för att slippa: ett fält som läggs till på ena stället och
glöms på det andra. Filen ligger kvar i routekatalogen — Next behandlar bara
reserverade filnamn som rutter, och actionerna som `Losenord` och `Steg2`
anropar bor redan där.

### Fyra sektioner, och Administration finns bara ibland

Konto, Säkerhet, Utseende, Administration. Den sista visas för den som ställer
in något, och **varje post har samma villkor som sidan den pekar på** — samma
regel som avgör vad som får stå i sidopanelen. En länk som leder till en
omdirigering är en meny som ljuger.

`harAdministration()` avgörs i layouten och inte i rutan. En serverkomponent
som returnerar `null` är fortfarande en nod, så klienten kan inte skilja "tom
sektion" från "ingen sektion", och en flik som öppnar en tom yta är sämre än
ingen flik.

### Utseendet delar läge med panelen i stället för att kopiera det

Hopfällningen gick hittills bara att nå från en knapp längst ner i panelen —
och på en kort skärm var den knappen dessutom bortklippt (se nästa avsnitt).
Nu finns den också som reglage i inställningarna.

Läget bor kvar i `Skal` och delas nedåt genom `shell/panellage.tsx`. Reglaget
ritas på två ställen, i rutan och på `/profil`, och ett eget tillstånd där hade
gett tre källor som kan säga olika saker: panelen hopfälld, reglaget utfällt.

### Sektionerna ritas på servern, bakom var sin Suspense

Rutan ska öppnas färdig och inte börja hämta när man klickat. Samma linje som
klockan drog: den enda fråga sektionerna kostar — teamets namn — får inte hålla
tillbaka en sidvisning, så den ligger bakom en egen Suspense i layouten.

`npm run typecheck` grön. Provkört i produktion: alla fyra sektionerna, Esc,
reglaget och `/profil` som egen sida. Inga konsolfel. **Testsviten är inte
körd** — passet rör varken RLS eller någon server action, och ingen svit mäter
layout.

---

## 2026-08-24 (kväll) · Sidopanelen klippte av sin egen meny

Användaren kunde inte se alla sidflikar. Felet var verkligt och äldre än det
såg ut: panelen är `inset-y-4` och därmed **alltid exakt så hög som fönstret**,
men `<nav>` inuti hade `flex-1` och ingen egen scroll. Allt som inte fick plats
ritades utanför panelen och gick inte att nå.

Uppmätt i produktion på en 1440×690-vy: `scrollHeight` 816 px i en 417 px hög
vy. Fem av sjutton poster föll bort — **och under dem hela bottenraden med
profilen och utloggningen.** Att inte kunna logga ut är det allvarligaste av
det; det syntes inte i någon test eftersom ingen svit mäter höjd.

Menyn har vuxit med varje modul. Felet fanns alltså latent från början och slog
till först när sjuttonde posten lades in.

### Bara listan scrollar

`min-h-0 flex-1 overflow-y-auto` på listan, `shrink-0` på logotyp,
hopfällningen, skiljelinjen och profilraden. Det man behöver oftast ska inte
kunna rulla bort, och en utloggningsknapp man måste leta efter är ett
säkerhetsproblem och inte ett skönhetsfel.

`min-h-0` är det som gör jobbet. Utan den vägrar en flex-post krympa under sitt
innehåll och `overflow-y-auto` får aldrig något att göra — listan hade fortsatt
växa ur panelen precis som förut.

### Första försöket scrollade men såg exakt likadant ut

Och det är den lärdom som är värd att bära vidare. `.nav-scroll` fick både
`scrollbar-width: thin` och ett `::-webkit-scrollbar`-block. **Sedan Chrome 121
slår de standardiserade egenskaperna av hela webkit-blocket**, och då faller
macOS tillbaka på sin overlay-scrollbar: bredd noll, osynlig tills man rullar.

Mätningen som avslöjade det: `offsetWidth === clientWidth === 232`. En
scrollbar som tar plats hade gett en skillnad. Listan scrollade alltså redan,
men såg fortfarande avklippt ut — vilket för användaren är samma fel.

De två egenskaperna är borta ur `.nav-scroll` och det står utskrivet i CSS:en
att de inte får läggas tillbaka. Firefox får sin standardlist, som på desktop
är synlig ändå.

### Toningar, för att 6 px på en mörk platta är en svag signal

Listan tonar mot över- och underkant när det finns mer att rulla till.
Toningarna ligger **utanför** det som rullar — inuti hade de följt med och tonat
bort en post i taget i stället för kanten. `aria-hidden`: skärmläsaren vet redan
att posterna finns, den läser inte av en gradient.

Den aktiva posten rullas in i vy vid montering, `block: "nearest"` så att
ingenting rör sig på en skärm där hela listan får plats. Utan det öppnar
`/design` en meny som ser ut att stå på `Hem`.

---

## 2026-08-24 · E10.9 anställningsflödet

Migration `0033`. Den sista obehindrade delen av rekryteringsmodulen: en
kandidat som fått ett erbjudande blir anställd i ett steg, och konto, roll,
rutiner, kurser, avtalsutkast och en onboarding-checklista faller ut ur samma
handling.

Spärren fanns sedan 0030 — `hired` nekas utan `hired_employee_id`. Det som
saknades var flödet spärren pekade på.

### Två funktioner flyttade till lib, och det är hela poängen med passet

Uppläggningen av en anställd låg i `laggUppAnstalld` i `personal/actions.ts`.
Avtalsrenderingen låg i `skapaAvtal` i `avtal/actions.ts`. Anställningsflödet
behöver båda.

Alternativen var att anropa en server action från en annan, eller att kopiera.
Båda är fel, och det andra är värre: **två ställen som skapar inloggningar
glider isär**, och den glidningen slutar med att det ena stället glömmer
`byt_losenord`-flaggan.

Nu ligger de i `src/lib/anstallning-server.ts` och `src/lib/avtal-server.ts`.
Ingen av filerna bär `"use server"` — samma linje som säkerhetspasset natten
innan drog för `sattKvitto` och som `skrivFel` fick 22 augusti. Actionerna är
kvar som formulärets halva: läs fälten, kontrollera behörigheten, visa svaret.

**Behörigheten kontrolleras aldrig i lib-funktionerna.** Anroparna har olika
kretsar — `canManageEmployees` för chefen, `far_rekrytera()` för rekryteringen —
och en kontroll på det djupet hade antingen varit fel för den ena eller så bred
att den inte sagt något. Det står utskrivet i båda filerna.

### Ordningen på skrivningarna är det enda som spelar roll om något brister

Flödet spänner över auth och databasen och har därför ingen gemensam
transaktion. Stegen ligger i den ordning där ett avbrott lämnar något
halvfärdigt men **inget motsägelsefullt**:

1. auth-konto och `employee`-rad — en anställd utan kandidatkoppling är giltig
2. `hired_employee_id` **och** `stage` i EN update — det enda som inte går att
   göra om
3. avtalsutkast, checklista, logg — bekvämlighet, går att göra om

Faller det mellan 2 och 3 står kandidaten kvar på `offer` med en anställd som
redan finns. Det är ett läge någon **kan se och rätta**. Motsatsen — en kandidat
märkt som anställd utan att personen finns — hade inte gått att upptäcka utan
att leta, och det är därför ordningen är som den är.

Att kopplingen och steget skrivs i samma update är inte en optimering. Triggern
`candidate_stegbyte` nekar `hired` utan koppling, så två skrivningar hade krävt
att kopplingen sattes först — och en kandidat som pekar på en anställd utan att
stå på `hired` är precis det motsägelsefulla läget ordningen finns för.

### 0033: två spärrar, och ett undantag som måste finnas

**En anställd är resultatet av högst en rekrytering.** Partiellt unikt index på
`hired_employee_id`. Det låter som en kantfallsfråga men är det inte: ett
dubbelklick på Anställ är den vanligaste vägen dit, och följden är att
trattrapporten (AC-7.10) räknar en anställning som två. Partiellt, så att de
många kandidater som inte är anställda inte krockar med varandra på null.

**Kopplingen skrivs en gång.** Vem som rekryterades till en tjänst är en
historikuppgift; går den att peka om i efterhand är den inget värd som bevis.

**Men triggern nekar bara ändring till ett annat värde, inte till null.**
`hired_employee_id` har `on delete set null`, så en radering av personen kör en
UPDATE på kandidatraden. En trigger som nekade all ändring hade fällt
`delete from employee` — exakt samma fälla som `file_object` gick i 0023 och som
E6.2 gallringsjobbet en dag hade dött på mitt i natten. Provet kör hela vändan:
raderar personen och kontrollerar att kandidatraden står kvar som historik utan
att peka någonstans.

### Avtalsdelen är valfri, och det är inte en uppmjukning av AC-7.9

Två saker är sanna i dag. Det finns **ingen publicerad avtalsmall** — modulen
byggdes 22 augusti men ingen mall är skriven. Och kretsen som får hantera avtal
(`sales_manager`, `ceo`, `admin`) är **smalare** än den som får rekrytera, som
också släpper in `recruiter`.

En rekryterare utan ledningsroll får därför ingen mallväljare alls. Sidan
frågar inte ens — och att kringgå 0028:s behörighetsgräns för att flödet råkar
ligga i rekryteringsmodulen vore att flytta en gräns av bekvämlighet.

Utan mall skapas inget utkast och checklistan får punkten "Anställningsavtal
upprättat, undertecknat och arkiverat" i stället. Åtgärden försvinner alltså
inte, den flyttar.

**Avtalsfelet tigs inte ihjäl.** Går allt annat igenom men utkastet faller,
säger svaret det rakt ut. Tystnad hade betytt att någon letar efter ett utkast
som aldrig skapades.

### Tre punkter i checklistan föds avbockade

Kontot finns, rutinerna och kurserna är tilldelade. De står kvar i listan — de
är bevis på vad som gjordes, och en checklista som tiger om det som gick
automatiskt låter som om det aldrig skedde.

Men de står som **klara**. En lista som öppnar med tolv punkter där tre redan är
utförda lär användaren att bocka av utan att läsa, och då är de nio som verkligen
kräver något inte längre skyddade av listan.

AC-1.7 gäller åt båda hållen: ingen punkt kan hoppas över utan motivering, och
blanktecken räknas inte som en. Villkoret är samma check som offboardingens.

### Den nyanställda ser inte sin egen checklista

`onboarding_task` har samma läsbehörighet som offboardingens:
`can_read_all_employees()`. Punkterna är arbetsgivarens att-göra — beställ
dator, lägg upp i Inkio, boka introduktionen — och skrivna för den som ska
utföra dem. En lista som också läses av den den handlar om skrivs annorlunda,
och då tappar den sin funktion som chefens arbetsredskap.

Det den nyanställda ska se ligger redan där det hör hemma: rutinerna på
`/rutiner` och kurserna på `/utbildning`.

**Raden står ändå i registerutdraget.** Artikel 15 frågar inte vem tabellen är
skriven för — den frågar om uppgiften handlar om personen, och det gör den.

### E-posten hämtas inte från kandidatraden

Ansökningsadressen är privat och följer inte med anställningen; det är
jobbadressen som blir inloggning i navet. Att förifylla den privata hade gjort
den till standardvalet, och då hade halva personalregistret loggat in med
gmail-adresser.

Namnet kommer däremot från kandidatraden och går inte att ändra i flödet. Det
ska handla om den person raden pekar på.

### Verifiering

`npm run typecheck` grön. **26 sviter, alla gröna mot den riktiga databasen** —
`tests/anstallningsflodet.mjs` är ny och kör 26 kontroller, varav de fyra
spärrarna och undantaget för `on delete set null`. Migration `0033` körd i
produktionen.

---

## 2026-08-23 (natt) · Säkerhetsgenomgångens tre kodpunkter

Genomgången samma kväll landade i fyra punkter. Tre av dem är kod och gjordes
här. Den fjärde, `STEG2_SECRET`, är ett miljöbyte och står kvar på användaren —
den beskrivs sist.

Ingen av punkterna var en öppen dörr. Det som gör dem värda ett pass är att alla
tre är av samma sort: en rad som är ofarlig där den står och blir farlig när
någon kopierar mönstret till nästa ställe.

### Punkt 2: en hjälpare som var en publik ändpunkt

`sattKvitto` låg i `angra/actions.ts`, som bär `"use server"`. Allt som
exporteras ur en sådan fil får ett id av Next och tar emot anrop från
webbläsaren — oavsett om någon UI-kod anropar det eller inte. Funktionen var
alltså en ändpunkt trots att den aldrig var tänkt som en.

Följden var i sig liten: den skriver en kortlivad kaka i den anropandes egen
webbläsare, och React escapar texten när kvittot ritas. Men det är samma brist
som genomgången hittade, och att den var ofarlig den här gången är inte ett
skäl att låta den ligga kvar. Nästa hjälpare som läggs bredvid kanske inte är
det.

Flyttad till `src/lib/toast-server.ts`. **`angra()` är nu det enda som
exporteras ur `angra/actions.ts`, och det ska den förbli** — det står numera i
filens egen rubrik. Tre anropsställen (`avtal`, `fel`, `nyheter`) importerar
från det nya stället.

Det är andra gången samma sak hittas — `skrivFel` flyttades till
`src/lib/fel-server.ts` av samma skäl 22 augusti. Mönstret är därmed etablerat:
en server action-fil exporterar handlingar, ingenting annat.

### Punkt 3: `!==` på en hemlighet

`CRON_SECRET` jämfördes med `!==` i fyra kopior, en i varje jobbrutt.
Strängjämförelse avbryter vid första tecknet som skiljer, så tiden det tar att
få nej berättar hur långt fram i hemligheten gissningen stämde. Den som får
gissa fritt kan bygga hemligheten tecken för tecken i stället för att prova alla
kombinationer.

I praktiken är angreppet svårt att genomföra mot rutter bakom nätet — skillnaden
är nanosekunder. Men en konstanttidsjämförelse kostar ingenting.

Ligger nu i `src/lib/jobb/behorighet.ts`, ett ställe i stället för fyra.
**Båda sidorna hashas före jämförelsen**, och det är inte kosmetik:
`timingSafeEqual` kräver lika långa buffertar och kastar annars, och en
längdkontroll före hade läckt längden. sha256 ger alltid 32 byte oavsett vad som
kom in i headern.

De två utfallen betyder fortfarande olika saker och ska göra det: **503** är att
`CRON_SECRET` inte är satt hos oss, ett driftfel, inte ett nekat anrop. **401**
är fel eller saknad hemlighet.

### Punkt 4: `anon` tappar femton granter — och 0027:s fälla slog till igen

`anon` hade `execute` på femton av navets egna funktioner. Ingen av dem läcker
något: ingen policy i navet gäller rollen `anon` (enda träffen i `pg_policies`
är den restriktiva `filer_ar_stangd`, som nekar hela bucketen), och ingen
utloggad väg rör databasen med anon-nyckeln — `/uppstart` använder service role.
Granten följde med `authenticated` på samma rad av vana.

Första versionen av `0032` skrev det uppenbara, `revoke execute ... from anon`,
och **självkontrollen längst ned fällde den: tretton av femton hade kvar sin
execute.**

Det är exakt fällan 0027 skrev upp den 22 augusti, och jag gick på den ändå.
Tretton av funktionerna har ingen explicit anon-grant — de har PUBLIC-granten
Postgres ger varje ny funktion, och både `anon` och `authenticated` är delar av
PUBLIC. Ett revoke från `anon` tar bort en grant som inte finns, går igenom utan
varning och ändrar ingenting. Två bet: `far_hantera_avtal` (0028) och
`far_rekrytera` (0030) skrevs med `to anon, authenticated, service_role` och
hade en riktig grant att ta bort.

Rätt form är att ta PUBLIC-granten och ge tillbaka explicit — `authenticated`,
som är den grant som får RLS-policyerna att fungera alls, plus `service_role`.
Revoken körs före granten i samma transaktion; tvärtom hade revoken tagit bort
den nya granten igen.

**Lärdomen är inte regeln utan kontrollen.** Regeln stod redan utskriven i 0027
och hjälpte inte. Det som fångade felet var att migrationen frågar databasen om
resultatet och river transaktionen om något står kvar. Den kontrollen ligger
kvar i filen och fångar nästa funktion som glider in med en PUBLIC-grant.

**Triggerfunktionerna rördes inte.** Tjugotvå av dem har samma ärvda grant, men
en funktion som returnerar `trigger` exponeras aldrig som RPC av PostgREST. Att
revoka dem hade varit att ta risken att en trigger slutar brinna för att vinna
ingenting.

### Punkt 1 gjordes inte, och det är med flit

`STEG2_SECRET` är inte satt i Vercel. Utan den signeras steg två-kvittot med
`SUPABASE_SERVICE_ROLE_KEY` — samma hemlighet som ger full förbigång av RLS.
Fallbacken är medveten och funktionen är inte trasig, men de två bör inte vara
samma nyckel.

Att sätta den är ett miljöbyte, inte kod, **och den har en följd i produktionen:
alla chefer måste bekräfta sin enhet en gång till.** Det är ett litet men
verkligt avbrott för den som använder navet, och det är användarens beslut när
det ska ske — inte något som ska ramla ut ur ett säkerhetspass.

### Verifiering

`npm run typecheck` grön. Samtliga 25 sviter gröna mot den riktiga databasen.
Migration `0032` körd i produktionen 20:48, deployen grön.

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
