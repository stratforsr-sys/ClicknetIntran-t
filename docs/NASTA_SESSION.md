# Läs detta först

Kort överlämning mellan sessioner. `docs/ARBETSLOGG.md` har hela historiken och
varför-resonemangen; det här är bara läget just nu och vad som står på tur.

**Senast uppdaterad:** 2026-08-21 (storage-passet och E15)

---

## Arbetsregler i det här repot

- **Inga lokala byggen eller kloner** — allt ska gå direkt mot GitHub-repot.
  Verifieringen är Vercels egen build: en trasig build ersätter aldrig den
  version som körs.
  *Avvikelser som är kända av användaren:* migrationer och tester körs från en
  scratchpad-klon, eftersom de behöver `pg` och `DATABASE_URL`.
- Committa som `stratforsr-sys <stratforsr@gmail.com>`.
- Pusha rakt till `main`. Inga feature-branches. `main` deployar automatiskt
  till Vercel.
- Migrationer är handskriven SQL i `supabase/migrations/`, körs med
  `node --env-file=$HOME/.clicknet/nav.env scripts/apply-sql.mjs`. Aldrig
  `prisma migrate` eller motsvarande.
- Nycklar ligger i `~/.clicknet/nav.env`.
- ASCII i kodkommentarer och commit-meddelanden. Svenska i allt som en
  människa läser i produkten.
- Läs `docs/ARBETSLOGG.md` före arbete, uppdatera den efteråt.

## Kör testerna

```
set -a && . $HOME/.clicknet/nav.env && set +a && npm test
```

Arton sviter, 831 kontroller. `tests/rls.mjs` går mot den **riktiga**
databasen och skapar och städar sina egna användare (prefix `rlstest+`).

**Kör sviten före push.** Den var röd på main när det här passet började — för
andra gången i rad. Båda gångerna av samma sort: ett prov som räknade rader i
en tabell som bär driftdata. `calendar_feed` krävde exakt en rad för säljchefen,
och Zens riktiga flöde gjorde att han såg två.

**Lärdomen är värd att skriva ut:** en kontroll som lyder
`(await las(tD, "tabell")).length === 1` för en roll som ser ALLA rader blir
röd i samma stund någon använder funktionen på riktigt. Fråga på provradens id
i stället. Tre sådana rättades 2026-08-21; leta efter fler om en ny modul
skriver liknande kontroller.

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

Q71 besvarades 2026-08-21: **flera personer rekryterar**, så E10 är inte akut.
Det gör E15 till nästa stora epic.

1. **Supabase-panelen och Zens stämpling** — användarens eget arbete, men
   påminn.
2. **E8.9 kursinnehåll** — åtta kurser ska skrivas. Ingen kod, men det är det
   som gör att 25 säljare kan lära sig samma sak utan att du upprepar dig. Nu
   går det dessutom att lägga ett rollspel sist i varje kurs.
3. **X7 pilot** med tre personer i två veckor innan bredd.
4. **E9.1 avtalsmallar** — går att bygga utan A14. E9.2 e-signering är fortsatt
   blockerad.
5. **E0.6 felrapportering** bör ligga före piloten. Tre personer som hittar
   buggar utan att de når dig är en pilot som inte mäter något.
6. **E5.3 / X3** — startsidan under 1,5 s på 4G, aldrig mätt.
7. **E5.7 resten**: toast nere till höger med ångra efter en åtgärd.
8. **E10 M7 rekrytering**, ~4 veckor, när ovanstående är gjort.

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

- **A14** e-signeringsleverantör. Blockerar E9.2, men inte E9.1.
- **E15:** vem äger arbetsgivaravgift, pension och försäkringssatser.
- **Q78–Q80** provision. Blockerar E13.
- **A5** Inkio, **A6** dialer. Blockerar E11 och E12.
