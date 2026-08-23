# Läs detta först

Kort överlämning mellan sessioner. `docs/ARBETSLOGG.md` har hela historiken och
varför-resonemangen; det här är bara läget just nu och vad som står på tur.

**Senast uppdaterad:** 2026-08-23 (testhardning, E6.5, X3 klart, E10 paborjad)

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

Tjugotvå sviter, 998 kontroller. `tests/rls.mjs` går mot den **riktiga**
databasen och skapar och städar sina egna användare (prefix `rlstest+`).

Sviten var **grön** när passet 2026-08-23 började, och när det slutade.

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
| Raststämpling | Avstängd. Kräver K12 + K14 + rastschema |
| Sen ankomst | Påslagen, tolerans 1 minut, larm samma dag till chef |
| Nattjobb | Ett jobb, `/api/jobb/natt`, 02:30. Hämtar igen 14 dygn bakåt |
| Lönerapport | Klar, med attest och oföränderlig period |
| Personalärenden | Klara, med SLA och konfidentialitet |
| Tvingat lösenordsbyte | Spärr i databasen sedan 2026-08-20 |
| Startsida | Rollstyrd. Chefens kö, säljarens stämpelknapp |
| Bottennavigering | Under 768 px: Hem, Sök, Stämpla, Mer |
| Registerutdrag | Klart, **inklusive filer och vem som öppnat dem** |
| Nyheter | `/nyheter`. Målgrupp per roll och team, fäst överst, utkast |
| Notisklockan | Ärenden, nyheter, rutiner, kurser, frånvaro, rollspel |
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

### Fyra saker användaren själv måste göra

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
4. **Lönekostnaden saknar tre saker innan den visar något:** ingen har
   `payroll_cost_viewer` (tilldelas per person under Personal), inga
   månadslöner är inmatade, och täckningsgraden är inte satt. Allt tre görs
   under `/lonekostnad/satser`. **Kontrollera också åldersgränsen för den äldre
   nedsättningen** — den är seedad till 66, följer pensionsåldern och har
   flyttats flera gånger. Den berör ingen i bolaget i dag.

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

### Fyra säkerhetspunkter från genomgången 2026-08-23 kväll

Grunden är stark — RLS på samtliga 68 tabeller, ingen skrivrätt för klienten,
behörighetskontroll först i varje server action. Ingen av punkterna nedan är en
öppen dörr. Fullständig genomgång i arbetsloggen.

1. **Sätt `STEG2_SECRET` i Vercel.** Utan den signeras steg två-kvittot med
   `SUPABASE_SERVICE_ROLE_KEY` — samma hemlighet ger full förbigång av RLS.
   Fallbacken är medveten, men de två bör inte vara samma nyckel.
   *Följd:* alla chefer måste bekräfta sin enhet en gång till.
2. **`sattKvitto` är exporterad ur en `"use server"`-fil** och är därmed en
   publik ändpunkt. Ingen XSS (React escapar), men en hjälpare ska inte
   publiceras som handling.
3. **`CRON_SECRET` jämförs med `!==`** — byt till konstanttidsjämförelse.
4. **`anon` har `execute` på tretton RLS-predikat.** Avsiktligt enligt 0027/0028
   och läcker ingenting, men granten behövs inte.

### Prestanda: det som är kvar

- **Sessionen valideras två gånger per anrop** — `auth.getUser()` i mellanvaran
  och igen i `getCurrentUser()`. Att skicka vidare den verifierade identiteten i
  en request-header sparar en tur (~30–50 ms). *Gjordes inte:* `setAll` byter ut
  hela `response` när tokenen förnyas, så headern måste sättas efter det, och en
  miss där tappar den förnyade sessionskakan tyst. Värt att göra, men med prov.
- **`hamtaNotiser()` ställer fortfarande sexton frågor per sidvisning**, varav
  två utan filter (`employee`, `course_module`). De ligger numera utanför den
  blockerande vägen, så de syns inte i laddtiden — men de kostar kapacitet.
- **Sökningens marginal är fortfarande den minsta i navet.**


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
   matat in innehåll.
5. **Personnumret i anställningsavtalet — ett beslut som är ditt.** Navet lagrar
   inga personnummer (K27), så det utskrivna avtalet har en rad som fylls i för
   hand. Det går att ändra, men då är det K27-linjen som ska omprövas medvetet.
   Jag har byggt så att den inte går att kringgå av misstag.
6. **E10 resten**, ~2 veckor. Kvar utan blockering: **E10.9 anställningsflödet**
   (avtal, konto, onboarding, kurser i ett steg — spärren finns redan, `hired`
   nekas utan `hired_employee_id`) och **E10.2 den publika ansökningssidan**.
   E10.8:s nattjobb väntar på fristen, E10.1/4/7 på mejlspåret.

### Mindre saker som ligger och väntar

- **Inloggad TTFB från produktionen** saknas fortfarande i 4G-mätningen. Kräver
  en riktig session i en webbläsare; tills dess är 20 ms per våga uppskattat.
  Det är den enda kvarvarande uppskattningen i X3.
- **E0.7** är delvis gjord: serverfel skrivs nu strukturerat. Nattjobben larmar
  fortfarande inte av sig själva.
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

### Villkoren som styrde E15 gäller nu E13 provision

E15 följer dem sedan 2026-08-21. **E13 måste följa samma:**

- **AC-3.26 / E7.14:** hämta frånvaro via `payroll_row.absence_minutes`. Aldrig
  genom att joina `sick_report` — RLS ger noll rader för `finance` och
  `payroll_cost_viewer`, så en vy som försöker får tyst fel data i stället för
  ett felmeddelande.
- **E13.1 / AC-10.1:** provisionsregler som konfiguration, inte kod. Samma linje
  som `absence_policy` och `cost_rate` redan drog. Lägg dem gärna i `cost_rate`
  om de är satser, annars i en egen tabell — men inte i ett `if`.
- **K13 / E13.9:** provisionsdata och tiddata får inte kunna samköras i någon vy.

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
- **Q78–Q80** provision. Blockerar E13.
- **A5** Inkio, **A6** dialer. Blockerar E11 och E12.
- **Personnumret i anställningsavtalet.** Navet lagrar inget (K27), så
  utskriften har en rad som fylls i för hand. Vill du ändra det är det
  K27-linjen som ska omprövas, inte avtalsmodulen.
