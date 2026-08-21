# Läs detta först

Kort överlämning mellan sessioner. `docs/ARBETSLOGG.md` har hela historiken och
varför-resonemangen; det här är bara läget just nu och vad som står på tur.

**Senast uppdaterad:** 2026-08-21 (storage-passet)

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

Sjutton sviter, 753 kontroller. `tests/rls.mjs` går mot den **riktiga**
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

### Tre saker användaren själv måste göra

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

## Vad som står på tur

Q71 besvarades 2026-08-21: **flera personer rekryterar**, så E10 är inte akut.
Det gör E15 till nästa stora epic.

1. **Supabase-panelen och Zens stämpling** — användarens eget arbete, men
   påminn.
2. **E8.9 kursinnehåll** — åtta kurser ska skrivas. Ingen kod, men det är det
   som gör att 25 säljare kan lära sig samma sak utan att du upprepar dig. Nu
   går det dessutom att lägga ett rollspel sist i varje kurs.
3. **X7 pilot** med tre personer i två veckor innan bredd.
4. **E15 M13 lönekostnadsvy**, ~2 veckor. Inte blockerad utom E15.7.
   Innan den byggs behövs svar på: **vem äger arbetsgivaravgift, pension och
   försäkringssatser, och var står de idag?** `cost_rate` ska seedas ur den
   källan och ingen annan.
5. **E9.1 avtalsmallar** — går att bygga utan A14. E9.2 e-signering är fortsatt
   blockerad.
6. **E0.6 felrapportering** bör ligga före piloten. Tre personer som hittar
   buggar utan att de når dig är en pilot som inte mäter något.
7. **E5.3 / X3** — startsidan under 1,5 s på 4G, aldrig mätt.
8. **E5.7 resten**: toast nere till höger med ångra efter en åtgärd.
9. **E10 M7 rekrytering**, ~4 veckor, när ovanstående är gjort.

### Villkor som styr E15 när den byggs

- **AC-3.26 / E7.14:** hämta frånvaro via `payroll_row.absence_minutes`. Aldrig
  genom att joina `sick_report` — RLS ger noll rader för `finance` och
  `payroll_cost_viewer`, så en vy som försöker får tyst fel data i stället för
  ett felmeddelande. Verifiera i `tests/rls.mjs`.
- **K27 / E15.6:** endast födelseår. Inga personnummer någonstans.
- **E15.2 / §13.2:** alla satser i `cost_rate`, ingen procentsats som literal i
  kod. Samma linje som E7.15 drog för frånvaroreglerna.
- **AC-13.8 / E15.5:** varje beräkning sparas med `rates_used`, så att en
  historisk siffra går att förklara när satserna ändrats.
- **K5 / AC-2.17** gäller fortfarande i lönerapporten: den räknar ingen lön.
  Lönekostnadsvyn är något annat och får räkna — håll isär dem, och skriv ut
  varför i migrationen.

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
