# Arbetslogg — Clicknet Nav

Läs denna före arbete. Uppdatera efteråt.

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
