# Beslutslogg

Definition of Done p. 5: beslut med konsekvens antecknas här, inte i marginalen.

---

## D-U1 · Varumärkesfärgen avläst från clicknet.se
**2026-08-16.** PRD:n listade B4/B5 som blockerande. Sajtens stilmall använder
`#17BAA2` för aktiva menyval och kantlinjer, och `Plus Jakarta Sans` som
typsnitt — det senare stod redan på UI-PRD §4.4:s kandidatlista.

**Konsekvens:** B4 och B6 är inte längre blockerande. B1 (logotyp för ljus
bakgrund) och B3 (symbolmärke) saknas fortfarande; tills vidare används ett
sättet C-märke i sidopanelen.

## D-U2 · `#17BAA2` får aldrig bära vit text
**2026-08-16.** Mätt kontrast: vit text på `#17BAA2` ger **2,45:1**, mot kravet
4,5:1 i AC-U5.1. UI-PRD förutspådde det ("turkosa toner mot vitt underkänns
nästan alltid").

**Beslut:** `--color-brand-600: #0B7F6E` (**4,91:1** mot vit) är den enda tonen
som får användas till fyllda knappar och till text på ljus bakgrund.
`--color-brand-500: #17BAA2` behålls som varumärkeston men endast på mörka ytor,
där den ger 6,2:1 mot sidopanelen.

**Konsekvens:** knappar ser något djupare ut än referensbilderna. Det är ett
medvetet byte av utseende mot läsbarhet.

## D-U3 · Statuspiller använder tonad platta med mörk text
**2026-08-16.** Alla fem kombinationer mätta till mellan 5,8:1 och 7,3:1.
Mättad färg med vit text drar för mycket uppmärksamhet i en tabell (UI-PRD §5.5).

## D-U4 · Mörkt läge byggs inte nu
**2026-08-16.** Beställarbeslut. Alla värden ligger som CSS-variabler, så det kan
slås på utan ombyggnad. Ingen växlare visas i toppraden förrän det finns.

## D-U5 · Sidopanelen visar bara byggda moduler
**2026-08-16.** Alternativet — hela menyn med "kommer snart" — lär användaren att
menyn ljuger, och det är svårt att ta tillbaka. Menyn växer per levererad modul.

---

## D-T1 · Skrivningar går via service role, inte via RLS
**2026-08-16.** Läsning sker alltid med den inloggades rättigheter, så RLS är det
som avgör vad som syns. Skrivning sker i server actions med service role, efter
en explicit behörighetskontroll.

**Skäl:** varje skrivning ska loggas i `audit_log` i samma svep, och
behörighetsregeln för "får lägga upp anställda" är mer än en radnivåkontroll.

**Konsekvens:** en glömd kontroll i en server action är allvarligare än en glömd
RLS-policy. Varje ny action ska börja med `kravChef()` eller motsvarande.

## D-T2 · Hjälpfunktioner i Postgres är `security definer` med låst `search_path`
**2026-08-16.** Utan `set search_path = public, pg_temp` kan en användare skapa en
egen `employee`-tabell i sitt eget schema och få funktionen att läsa den.

## D-T3 · Offboarding stänger sessioner på två sätt
**2026-08-16.** AC-1.4 kräver att sessioner invalideras omedelbart. Admin-API:ts
bannlysning kan misslyckas mot ett nätverksfel; middleware som slår tillbaka på
`status = 'offboarded'` kan inte kringgås. Båda finns.

**Bakgrund:** R11 — utan katalogtjänst finns ingen central spärr när någon
slutar, så offboarding är en säkerhetsfunktion, inte en administrativ detalj.

## D-T4 · `payroll_cost_viewer` ligger i egen tabell
**2026-08-16.** PRD §1.4 och Q63: behörigheten ska kunna ges och dras in per
person, oberoende av teknisk roll. Hade den legat som en roll i `employee_role`
hade den som får hjälpa till med IT automatiskt sett allas ersättning.
Tabellen finns redan, modulen (M13) byggs långt senare.

## D-T5 · `/uppstart` finns för att någon måste kunna bli först
**2026-08-16.** Bara en säljchef får lägga upp anställda, så ett nyuppsatt nav har
ingen väg in. Vyn är tillgänglig endast så länge `employee` är tom och stänger
sig själv därefter.

## D-T6 · Migrationer körs med checksumma, aldrig via Supabase-gränssnittet
**2026-08-16.** Definition of Done p. 3. `schema_migrations` har RLS påslagen utan
policy, så tabellen syns inte via REST-API:t.

## D-U9 · Startsidan får ett statusband — avsteg från UI-PRD §7
**2026-08-23.** Beställarbeslut. §7 sa att startsidan inte har någon hero och
ingen illustration: "första skärmen ska ge handling, inte välkomnande". Regeln
var rätt och gäller fortfarande för illustrationer och välkomsttexter.

**Beslut:** ett statusband överst med hälsning, levande stämplingsläge och
arbetad tid som tickar. Skillnaden mot en hero är att bandet **bär
information** — det svarar på "är jag inne och hur länge" utan en sidladdning
till `/tid`. Ett band som bara hälsade hade fallit på samma invändning som förut.

**Konsekvens:** startsidans första skärm är två rader högre, och stämpelknappen
ligger alltså längre ned på en telefon. Det var hela skälet till §7 från början.
**Det här är inte uppmätt i en webbläsare** — bandet är byggt kompakt (två rader,
ingen bild) just för att knappen ska rymmas ovanför vikningen på 375 px, men
någon bör titta på det på en riktig telefon under piloten. Blir det trångt är
åtgärden att flytta snabbvalslänkarna under korten, inte att ta bort bandet.

## D-K13 · K13 omprövas: provision och tid får stå på samma sida
**2026-08-23.** Beställarbeslut efter direkt fråga. K13 sa att provisionsdata och
tiddata inte får samköras i någon vy. Beställaren valde att båda ska stå på
startsidan och att K13 skrivs om.

**Vad beslutet gäller:** att en säljare ser sin egen arbetade tid och sin egen
intjänade provision på samma skärm.

**Vad som står kvar, och varför:**

- **Ingen fråga joinar tabellerna.** `time_event` och `commission_entry` hämtas
  var för sig och möts först i webbläsaren. Det kostar ingenting att hålla, och
  det gör att ingen vy kan börja sortera säljare efter tid mot intjäning.
- **Rastavvikelser och sen ankomst når fortfarande aldrig provisionen.** Den
  delen av K13 är ett uttryckligt löfte till personalen i K12-intresseavvägningen
  §5 ("Data når varken provision eller lönekostnadsvy") och är **inte** omprövad.
  Att ompröva den kräver att K12 skrivs om och beslutas på nytt.

**Konsekvens:** K13 i kravlistan behöver formuleras om till att gälla
avvikelsedata, inte all tiddata. Tills det är gjort står den här posten som den
gällande läsningen.

## D-E13 · Provisionen är en huvudbok, inte en motor
**2026-08-23.** Q78–Q80 är obesvarade och Inkio (A5) finns inte. Navet räknar
därför ingen provision — `commission_entry` tar emot poster som någon annan
bestämt, precis som `salary_basis` gör med månadslönen.

**Beslut:** beloppet är signerat och en rättelse är en **negativ post**, inte en
överskrivning. Skälet är att intjänad provision ackumuleras: `salary_basis`
modell — ny rad med nytt `valid_from` ersätter den gamla — hade dubbelräknats av
varje summering.

**Konsekvens:** när Inkio kopplas in skriver den i samma tabell med
`source = 'inkio'` och sitt eget id i `external_ref`. Det partiella unika
indexet gör importen idempotent. Ingen vy behöver röras den dagen.

**Behörigheten skiljer sig medvetet från K26/lönekostnad:** den anställda ser sin
egen rad. Lönekostnaden är bolagets kalkyl *på* en person; provisionen är
personens egen intjäning. Att dölja den för den som tjänat in den vore inte
sekretess utan hemlighetsmakeri. Andras poster ser bara ekonomi och VD.

## D-K12 · Utebliven instämpling får leda till en konsekvens i provisionen
**2026-08-24.** Beställarbeslut efter att frågan ställts och konsekvensen
beskrivits. K12-utkastets §5 räknade "ingen automatisk konsekvens — data når
varken provision eller lönekostnadsvy" som en byggd skyddsåtgärd. Beställaren
beslutade att konsekvenssystemet ska byggas ändå, och att K12 inte ska hindra
det.

**Vad beslutet gäller:** att **utebliven instämpling** (1.1) får ligga till grund
för en ogiltig frånvaro, som i sin tur kan få månadens bonusar att falla.

**Varför det är billigare än det såg ut:** 1.1 vilar inte på intresseavvägningen
alls. Grunden är rättslig förpliktelse (ATL 11 §) och fullgörande av
anställningsavtalet — det står i K12 1.1 sedan utkastet skrevs. Det som stod i
vägen var alltså ett **löfte i skyddsåtgärdslistan**, inte den rättsliga grunden.
Dokumentet är dessutom fortfarande ett **utkast utan beslutsdatum**, så löftet har
aldrig lämnats till personalen. Att ändra en icke beslutad text är något helt
annat än att ta tillbaka en utfästelse.

**Vad som står kvar, och varför:**

- **Rastavvikelser (1.3) och sen ankomst (1.2) når fortfarande aldrig
  provisionen.** Beställaren har inte bett om det, det kostar ingenting att hålla,
  och det är de två behandlingar som faktiskt kräver avvägningen. Vill någon
  ändra det är det ett eget beslut.
- **Ingen konsekvens utlöses automatiskt.** Navet skapar ett förslag; chefen
  godkänner. Det var beställarens egen formulering och den är nu en byggregel.
- Chefen kan häva en konsekvens, och hävningen loggas.

**Konsekvens:** K12 1.1 och §5 är omskrivna 2026-08-24 så att texten beskriver
det som byggs. **Avsnitt 6 och 7 är fortfarande tomma** — avvägningen och
beslutet är arbetsgivarens och rör 1.2 och 1.3, som är oförändrade. Spärren för
raststämpling hänger fortfarande på att K12 och K14 publiceras.

---

## D-E13.3 · Volymtrappan rättad genom att stänga och ersätta, från 2026-09-01

**2026-08-27.** Beloppen för 15 och 20 var omkastade sedan inmatningen
2026-08-25 — 15 gav 1 200 kr och 20 gav 1 000 kr, alltså mindre bonus för mer
sålt. Beställarens besked: **byt bara plats på de två**, 5 och 10 står orörda.
Nivåerna 25 och 30 lämnas fortsatt tomma.

**De gamla raderna ändrades inte.** De stängdes med `valid_to = 2026-09-01` och
ersattes av nya rader med samma `valid_from`. Frågan "vilken trappa gällde i
augusti" är den som ställs den dag en utbetalning ifrågasätts, och den måste gå
att besvara i november.

**Verkan valdes till nästa månadsskifte, inte innevarande månad.** Augusti räknas
alltså inte om. Det saknar praktisk verkan i dag: `commission_entry` är tom och
augusti bär två testorder.

**Ändringen gjordes med SQL och service role, inte via `/provision/regler`** —
skrivningarna är identiska med vad `sparaNiva()` med verkan `nasta_manad` gör,
inklusive de två raderna i `audit_log`. `note` på de nya raderna säger att de
lagts den vägen. Nästa ändring hör hemma på sidan; den här gjordes så för att
beskedet kom i en session utan inloggad webbläsare.

**Det som upptäcktes på köpet, och som inte är rättat:** hela trappan har
`valid_from` efter den 1 augusti, och uppslaget sker på månadens första dag
(Ö16). **Augusti har därför ingen volymtrappa alls** — den första månad trappan
gäller är september. Det följer av att raderna matades in med "gäller från och
med nu" den 25 augusti, och det var sant redan före rättningen. Ska augusti
omfattas krävs fyra nya rader med `valid_from = 2026-08-01`. Beställaren är
underrättad; ingenting görs förrän det efterfrågas.

---

## D-E13.6 · Ogiltig frånvaro är en dag HELT utan stämpling

**2026-08-26.** Ö15 svarade *hur mycket* (minst 5 minuter) och *vem som avgör*
(chefen), men inte *vad* som mäts. Tre läsningar var möjliga; den snävaste
gäller: **en ogiltig frånvaro är en schemalagd dag utan en enda stämpling.**

Finns det en instämpling räknas dagen aldrig — hur sent den än kom. Detsamma
gäller tidig hemgång och glapp mitt på dagen.

**Varför:** en mätning av "schemalagd tid utan stämpling bakom sig" hade av ren
aritmetik fångat **sen ankomst** — minuterna före dagens första instämpling *är*
förseningen. K12 1.2 säger att sen ankomst inte når provisionen, och det är ett
löfte i en intresseavvägning som beslutades 2026-08-26. Gränsen hade alltså
glidit utan att någon flyttat den med avsikt.

Tidig hemgång och glapp är något annat än "utebliven instämpling" — det ord både
specifikationen, arbetsloggen och beställaren använder — och har inte gått igenom
frågeomgången.

**Följd:** femminutersgränsen biter sällan, eftersom en schemalagd dag är längre
än så. Den står kvar ändå, i `MINSTA_MINUTER` och som check-villkor i `0037`, för
att den är det beställaren svarade.

**Att ändra det här** är en rad i `uteblivenInstampling()`. Men gäller vidgningen
sen ankomst kräver den att K12 avsnitt 6 och 7 skrivs och beslutas på nytt, av
någon med dataskyddskompetens. Att vidga är billigt; att smalna av efter att data
finns är det inte.

---

## D-E13.7 · Provisionsunderlaget är ett eget dokument, inte en kolumn i lönerapporten

**2026-08-26.** Beställaren svarade på fråga 57 att bonusen ska räknas i
lönerapporten. Ö10 avgjorde att det i stället blir ett **separat underlag**, och
det är nu byggt: `/provision/underlag/[manad]`. **`payroll_row` har fortfarande
ingen kronkolumn.**

**Varför de inte är samma papper:** `payroll_row` bär minuter och antal för att
navet inte får gissa vad en minut är värd (K5, AC-2.17). Kronorna i
provisionsunderlaget är inte en beräkning utan en **huvudbokssumma som redan är
bokförd och attesterad** i `commission_entry` — navet räknar inte fram dem, det
listar upp dem.

Läggs de ihop är navet ett lönesystem. Resonemanget står redan i `0025`; det här
beslutet är dess tillämpning på E13.

**Två följdregler:**

- **En stängd månad läses ur huvudboken, aldrig ur motorn.** Körs motorn om kan
  en ändrad inställning ge ett annat tal än det som faktiskt bokfördes.
- **En öppen månad stämplas `Preliminär`.** Ett papper som ser likadant ut i båda
  fallen är ett papper någon betalar ut efter av misstag.

**Utbetalningsmånaden** (fråga 58: månaden efter) är i dag en rad i
`provisionsunderlag.ts` och inte konfiguration, till skillnad från vad avsnitt
8.2 listar. Det finns ingen tabell att lägga den i, och en ny tabell för ett
heltal bär inte sin egen vikt. Kommer frågan upp byts raden mot ett uppslag.

---

## D-E13.9 · Orderbilagan bär inget subjekt, och utläsningen sparar aldrig

**2026-08-26**, migration `0039`.

**Bilagan hör till en kundaffär, inte till en människa.**
`file_object.subject_employee_id` är NULL för `purpose = 'sales_order'`, tvingat
av ett check-villkor och kontrollerat av en självkontroll i migrationen. Sätts
den till säljaren blir kundens avtal en uppgift om den anställda och följer med ut
i hens registerutdrag (artikel 15).

**Filen kan ändå bära ett personnummer** — en enskild firma har personnummer som
organisationsnummer (K27-undantaget, se avsnitt 3.2), och en signerad PDF kan bära
en namnteckning. Den ligger i den stängda `filer`-bucketen med åtkomstlogg, vilket
är rätt skyddsnivå. **P0.6 registerförteckningen måste uppdateras med kunduppgifter
som ny kategori.** Migrationen kan inte göra det åt någon: P0.6 är ett dokument.

**Utläsningen förifyller ett formulär och skriver aldrig något.** Beställarens krav
i avsnitt 3.1, och skälet är pengar: ordern bär ett provisionsbelopp som fryses vid
godkännandet. En maskinläst löptid som ingen kontrollerat är skillnaden mellan
1 500 och 4 500 kronor, och felet upptäcks först när någon jämför med papperet.

`lasAvtalsforslag()` svarar med ett förslag och sin källa; `rattaFranAvtal()`
skriver bara det som kryssats i, och bara på en order som ännu inte godkänts.
Triggern `sales_order_stegbyte` i `0034` nekar det senare oberoende av koden.

---

## D-E0.7 · Färskhetskontrollen ligger på en mänsklig väg, inte i en andra cron
**2026-08-27.** Nattjobbet skrev redan ett kvitto i `audit_log` vid varje
körning. Det ingen gjorde var att titta på det. E0.7 handlar därför inte om att
producera mer information utan om att någon ska se den som redan finns.

**Det uppenbara valet var en andra cron-post som vaktar den första, och det är
fel.** Det finns en ledig slot — Hobby-planen tar två och `vercel.json`
deklarerar en — men en cron som vaktar cron dör samma död. Det var precis det
som hände en gång: tre cron-poster deklarerades, planen tog två, ingen av dem
kördes, och en instämpling stod öppen i två dygn utan att någon märkte det. En
vaktpost hade varit tyst genom hela det förloppet, eftersom den inte hade kört
heller. **Den enda observatör som är oberoende av att cron fungerar är en
människa som öppnar en sida.**

**Kontrollen syns därför på två ställen:** ett driftkort på `/fel`, som är
larmets naturliga hem eftersom kön redan har status, ansvar och avslut; och en
rad på startsidan som **bara ritas när något är fel**. Startsidan är den sida
som faktiskt öppnas. `vercel.json` är orörd — den bär dessutom
`regions: ["arn1"]`, som aldrig får ändras.

**Larmvägen är `error_report`, inte en ny tabell.** Notisklockan läser den
redan, `/fel` är kön, och `registrera_fel` räknar upp `occurrences` på
`(digest, path)`. Det sista är hela skälet till att `normaliseraFel()` finns:
ett steg som faller varje natt i en månad ska bli **en** rad med siffran 30,
inte trettio rader. Digesten byter därför ut tidsstämplar, uuid:n och
siffergrupper mot platshållare innan den hashas.

**Sökvägen är `/api/jobb/natt/<steg>`, aldrig ett fragment.** `rensaSokvag()`
klipper bort fragment, så `#satser` hade grupperat ihop alla sex stegen till en
rad. Ett fallet `franvaro`-steg är en annan bugg än ett fallet `satser`-steg.

**Gränsen är 26 timmar** — ett dygn mellan körningarna plus två timmars slack.
Siffran är inte gissad: de fem kvittona 2026-08-23 till 2026-08-27 skrevs 02:44,
03:19, 02:30, 02:52 och 02:34, och största uppmätta avstånd mellan två körningar
är 24,6 timmar. Under 24 larmar navet varje natt strax före körningen; med 26
larmar det först vid 04:30 dagen efter en utebliven körning, alltså när man
*vet* i stället för att misstänka.

**Ett delvis fallet jobb ritar ingen rad på startsidan.** Jobbet larmar självt
om varje fallet steg, och det larmet syns redan i notisklockan. Raden är
reserverad för det enda fel jobbet omöjligt kan rapportera om sig självt: att
det inte kört alls.

**Kvittot läses med användarens EGEN token, aldrig service role.**
`audit_log_read` släpper in `sales_manager`, `ceo` och `admin` — exakt kretsen
`hanterar` på `/fel`. Att frågan ändå ställs villkorat är inget andra
rollfilter: kretsen kan inte bli vidare än RLS. Skälet är att noll rader annars
betyder två olika saker — "jobbet har aldrig kört" och "du får inte se
händelseloggen" — och säljaren hade fått ett larm om det första när det andra
var sant.

---

## D-E6.1 · De sju händelsetyperna beskriver VAD som hände, inte vilken modul
**2026-08-27.** AC-12.1 kräver att `audit_log` täcker samtliga sju
händelsetyper. **PRD:n ligger inte i repot**, så enumerationen är härledd här
och inte avläst. Den som har PRD §5.2 framför sig bör stämma av listan; ändras
den är det `TYPER` i `src/lib/handelselogg.ts` och provet som ska ändras, inte
loggen.

**Första försöket delade in loggen efter modul** — tid, frånvaro, lön,
dokument, identitet, utlämnande, drift. Det gav sju och föll direkt: provet
hittade `case.*`, personalärendena, som inte är någon av dem. Felet var inte
ett hål i listan utan i idén. **En modulindelning växer med navet**, så "sju"
hade blivit åtta vid nästa modul och nio vid den därpå. Ett krav som byter
innebörd varje gång något byggs är inget krav.

**Typerna beskriver därför vad som hände:** inloggning, behörighet, nytt
registrerat, ändring, radering, utlämnande, systemhändelse. Den indelningen är
sluten — en ny modul får plats utan att listan växer — och det är den en
granskning faktiskt frågar efter.

**Utlämnande går före modulen.** `payroll.exported` hör sakligt hemma både
under lön och under utlämnande. Den hamnar under utlämnande, för det är den
frågan loggen ska kunna besvara: vem har sett vad. En export begravd bland
trettio andra lönehändelser går inte att svara på artikel 15 med.

**Behörighet går på prefixet, inte på ändelsen.** `role.*` och `permission.*`
är alltid behörighet; `attendance_incident.revoked` är en tillbakadragen
frånvarohändelse och har ingenting med behörighet att göra. En regel på
ändelsen `revoked` hade lagt den i fel hög.

**Typreglerna är avsiktligt totala:** en okänd ändelse i en känd modul blir
`andring` i stället för att falla ur loggvyn. Det som fångar en helt ny modul är
i stället `MODUL`-registret, och `tests/handelselogg.mjs` jämför det mot både
källkoden och produktionens logg. Utan den kontrollen är "täcker samtliga sju"
ett påstående som slutar stämma tyst.

## D-E6.1b · Inloggningen loggas i navet, inte bara hos Supabase
**2026-08-27.** Inloggning var den enda händelsetyp som inte lämnade ett enda
spår i `audit_log`. Supabase för sin egen auth-logg och
`employee.last_sign_in_at` finns, men ingen av dem duger: den förra ligger
utanför navet med en gallringstid navet inte styr och går inte att läsa i samma
vy som allt annat, den senare är **ett värde som skrivs över** och kan varken
svara på "hur ofta" eller visa ett misslyckat försök.

**Misslyckade försök mot en okänd adress sparar inte adressen.** Den som skriver
fel i e-postfältet skriver ibland någon annans adress. Att spara den hade lagt
en utomstående persons uppgift i en logg som bevaras som bevis, utan nytta: det
man vill veta är att någon försökte ta sig in på ett konto **som finns**, och
det svaret kräver inte adressen. Är adressen känd skrivs raden på den
anställdas id i stället — mer användbart och mindre uppgift.

**Raden om inloggning med länk skrivs när länken växlas in**, i
`/auth/bekrafta`, inte när den beställdes. En beställd länk som aldrig öppnades
är ingen inloggning.

**IP:t ligger i `meta` och inte i kolumnen `ip`.** Kolumnen är av typen `inet`,
och en sträng som inte går att tolka som en adress fäller hela insertet — alltså
hade en trasig proxy-rubrik tystat själva inloggningsloggen. Samma val som
`auth.step2_verified` redan gjort.

## D-STAMP · Stämpelfriheten är en rollfråga, och den stänger av bedömning men inte bokföring
**2026-08-28.** Beställarens besked: VD, säljchef, ekonomi och projektledare
stämplar inte in och ut. Tre val gjordes när regeln byggdes, och alla tre går
att göra tvärtom — därför står de här.

**Roll, inte kolumn.** Alternativet var en flagga `time_clock_exempt` per
anställd. Rollen är redan svaret på frågan, och en kolumn hade varit ett andra
ställe att glömma uppdatera vid befordran. Det som glider isär är alltid det som
står på två ställen. Priset är att undantaget inte går att göra för en enskild
person utan att röra rollen — och det är avsiktligt: en engångsdispens från
arbetstidsregistrering ska inte gå att klicka fram.

**Teamledaren står utanför listan.** Hen är chef, men arbetar samma pass som
sitt team och är den enda chefsrollen vars arbetstid faktiskt mäts. `admin` står
också utanför: det är en systemroll som ofta bärs vid sidan av en anställning,
och den som är säljare och admin ska stämpla som säljare.

**Knappen döljs, den stängs inte av.** En avstängd stämpelknapp hade varit ett
påpekande om något man inte ska göra, varje dag. Följden är att den stämpelfria
rollen inte kan stämpla ens frivilligt. Vill man tillbaka räcker det att ta bort
rollen ur `STAMPELFRIA_ROLLER` — allt annat är kvar och provat.

**Nattjobbet slutar BEDÖMA men fortsätter BOKFÖRA.** Sen ankomst och
rastavvikelser gäller den som stämplar. Auto-stängning av en glömd utstämpling
och journalraden gör det inte. Skälet är den som varit säljare och blivit
säljchef: hens gamla stämplingar är lönegrundande, och en dag som aldrig stängs
blockerar löneperioden som "dag utan utstämpling" tills någon rättar den för
hand. **Vänder man på det här paret går löneunderlaget sönder för den som byter
roll mitt i en period, och det syns först vid attesten.**
