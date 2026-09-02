# Coachningsmodulen — utredning och förslag

**Status:** BESLUTAD OMFATTNING 2026-09-01. Se avsnitt 0. Frågorna i avsnitt 9
står kvar som underlag; de besvarade är markerade där.

**Skriven:** 2026-09-01, på branchen `coachning`.

---

## 0. Beställarens beslut 2026-09-01

Elva frågor är besvarade, resten är antaganden som redovisas här och går att
riva innan bygget börjar.

### Besvarat

| Fråga | Beslut |
|---|---|
| Fas 1 | Kärnan **plus** U1 (mallar/rampplan), U3 (30-dagarslarmet) och U4 (1:1 med GROW) |
| Kvittering (9) | Per uppgift, fyra lägen, **förval `sjalv`** |
| Vem skapar (5, 7) | Teamledare, säljchef och VD skapar. Teamledaren ser sitt team, ledningen alla. **Säljare ser aldrig varandras** |
| Krets (2) | **Alla anställda**, inte bara säljare |
| Manusuppgift (13) | **Teamledarens bock efter att ha hört det live.** Ingen inspelning, inget quiz i fas 1 |
| Live-rollspel (14, 15) | Bedöms mot **samma rubriker** som de inspelade (`roleplay_criterion`). **Ingen kalenderbokning** — förfallodag räcker |
| Försening (18) | **Samma trappa som systemguiderna**: 3 dygn till personen, 7 till chefen, 14 dagar över frist ger ett ärende |
| Testdata (25, 26) | Testkonto i produktionsdatan, städas efteråt. **0043 körs mot produktionen före merge** — den är additiv och main-koden rör aldrig de nya tabellerna |

### Följdbeslut som kretsen "alla anställda" tvingar fram

**Fokusområdena får en egen tabell.** Ursprungsförslaget var att peka rakt på
`kv_criterion`. Det går inte längre: K&V-poängen kräver `max_points` på varje
**aktiv** rad (0036), så ett fokusområde "Projektledning" inlagt där hade tyst
brutit bonusberäkningen för samtliga säljare.

Lösningen är `coaching_focus` med en valfri `kv_criterion_id`:

```sql
coaching_focus
  id, label, sort, active
  kv_criterion_id  -- null för områden som inte mäts i K&V
```

Seedas med beställarens sex ord — Intro, Behovsanalys, ROI, Avslut, Kvalitet på
samtalet, Korrekt avtalshantering — var och en länkad till sin `kv_criterion`.
Där länken finns visar personkortet K&V-trenden för området, och slingan i
avsnitt 4 går ihop. Där den saknas är fokusområdet bara en etikett, vilket är
precis vad en projektledare behöver. Ett sjunde område blir en inmatning, inte
en migration — samma linje som 0036 drog.

### Antaganden (ej ställda frågor, rivbara)

| # | Antagande |
|---|---|
| A1 | Egen menypost **Coachning**, inte en flik under Utbildning (fråga 1) |
| A2 | Säljaren ser **alltid vem som beställt** uppgiften (fråga 8) |
| A3 | Ingen konsekvens vid försening utöver påminnelsetrappan. **Ingen koppling till konsekvenstrappan eller provisionen** (fråga 11) |
| A4 | Ingen manusbank i fas 1. En manusuppgift pekar på en befintlig **rutin** eller står på egen text (fråga 12). U5 väntar |
| A5 | Uppgiftstypen `medlyssning` byggs, men utan dialerkoppling — den bockas för hand tills E12 finns (fråga 16) |
| A6 | Bevis är **valfritt per uppgift**: ingetdera, en kommentar, eller en fil. Rollspel kräver alltid ljudfilen (0024) |
| A7 | Allt som skrivs om en person är läsbart för personen, och följer med i **registerutdraget** (fråga 20, 22) |
| A8 | Gallring: coachningsdata följer personaldatans allmänna regel tills annat beslutas. **Öppen fråga** (fråga 21) |
| A9 | Ingen peer-coachning i fas 1 (fråga 6) |
| A10 | Ingen rangordning, ingen topplista, inget sammanvägt betyg (avsnitt 7) |

---

## 1. Vad som redan finns — och varför det avgör designen

Navet har redan tre fjärdedelar av en coachningsmodul. Det som saknas är
**personperspektivet och uppföljningen**, inte innehållet.

| Finns | Var | Vad det betyder för coachningen |
|---|---|---|
| Kurser med moduler, quiz och godkäntgräns | `course`, `course_module`, `quiz_*` (0007) | Utbildningsinnehållet ska INTE byggas om. Coachningen ska kunna **peka på** en kurs, inte äga en egen kopia |
| Försök som logg, aldrig överskrivning | `course_attempt` (0007) | Samma princip måste gälla coachningsuppgifter. Ett avbrutet försök är lika mycket bevis som ett klart |
| Certifikat med utgångsdatum | `certification` (0007) | "Klar" för en kurs finns redan som begrepp. Coachningen får inte uppfinna ett andra |
| Rollspel med rubrik, ljuduppladdning och bedömning | `roleplay_criterion`, 0024 | Rollspelet är byggt. Det som saknas är att kunna **beställa** ett rollspel av en enskild person vid ett givet datum |
| Rubriken syns FÖRE inspelningen | 0024, rubriken i filen | Samma linje ska gälla varje coachningsuppgift: den som ska göra något ska kunna läsa vad som krävs innan |
| K&V — sex bedömningsområden, poäng per samtal | `kv_criterion`, `kv_call` (0036) | **Företaget har redan ett kompetensspråk.** Se avsnitt 4 |
| Progressvy per person och team | `/utbildning/oversikt` | Halva coachningsvyn finns. Den visar kurser, inte personer |
| Påminnelsetrappa 3 / 7 / 14 dygn → ärende | systemguiderna, 2026-08-31 | Trappan är beprövad i drift. Coachningen ska återanvända den, inte hitta på en egen |
| Notiser med `notisId()` | 0018, 0038 | Uppgifter ska in i klockan via samma väg |
| Team och `leds_av` | `employee.team_id`, `leads_employee()` | Teamledarens krets är redan definierad i databasen |
| Kvittens på rutin | `/rutiner/[slug]/kvittenser` | "Läs och kvittera" finns. En coachningsuppgift av läs-typ ska stödja sig på den |

**Slutsatsen av tabellen:** coachningsmodulen är ett **tunt lager** —
en vy, en uppgiftstabell och en kvitteringsregel. Den ska inte innehålla
lagring av kursinnehåll, en egen bedömningsrubrik eller ett andra
"klart"-begrepp. Varje gång sanningen redan finns någon annanstans ska
coachningen **räkna fram** läget därifrån och inte spara en egen kopia.

Det är samma val som onboardingstatusen gjorde 2026-08-31: `employee.status`
sätts av systemet när guiderna är genomgångna och går inte att kvittera för
hand. En bock som säger "klar" bredvid ett certifikat som säger "utgången" är
värre än ingen bock alls.

---

## 2. Vad marknaden gör (research)

Fyra kategorier av verktyg, och de löser olika problem:

1. **Readiness-plattformar** (Mindtickle, Highspot) — kompetensprofil per roll,
   mät varje säljare mot den, tilldela riktad coachning där gapet är.
   Mindtickle bygger på en *Ideal Rep Profile*: kompetenser med vikt, och ett
   readiness-index som jämför person mot profil.
2. **Samtalsintelligens** (Gong, Chorus) — spelar in och analyserar riktiga
   samtal, plockar ut coachningstillfällen automatiskt.
3. **AI-rollspel** (Hyperbound, Second Nature) — bot som spelar kund, säljaren
   övar invändningar utan att en teamledare behöver sitta med.
4. **Coachnings-OS** (MySalesCoach m.fl.) — cadence, 1:1-struktur, åtaganden
   som följs upp.

Fyra saker återkommer i allt underlag och är värda att ta med:

- **Frekvens slår format.** Veckovis coachning kopplas till 76 % kvotuppfyllnad
  mot 47 % vid kvartalsvis. Det viktigaste modulen kan göra är att synliggöra
  *hur länge sedan* någon coachades — inte att producera fina rapporter.
- **GROW som samtalsstruktur** (Goal, Reality, Options, Will). Poängen är sista
  bokstaven: samtalet ska sluta i ett **åtagande med ägare och datum**.
  "När åtaganden inte följs upp lär sig säljarna att coachning är frivillig."
- **Spridd repetition.** 30–55 % bättre återgivning när samma innehåll återkommer
  med växande mellanrum i stället för en gång. Direkt relevant för
  "memorera manuset" — en engångsbock ger ingenting om tre veckor.
- **Ändamålsbegränsning (GDPR).** Data som samlas för coachning får inte utan
  vidare återanvändas till lönesättning eller konsekvenser. Det är exakt den
  gräns K12-underlaget i repot redan resonerar om.

Källor längst ned.

---

## 3. Förslag i korthet

En ny modul **`/coachning`** med tre vyer:

### 3.1 Laget (`/coachning`)
En rad per säljare. Kolumner som är valda för att de leder till en **handling**,
inte för att de är mätbara:

| Kolumn | Varför just den |
|---|---|
| Namn, team, veckor anställd | Ramp-fasen avgör vad som är rimligt att förvänta |
| **Dagar sedan senaste coachning** | Den enda siffran som faktiskt får chefer att coacha. Sorteras fallande som förval |
| Öppna uppgifter (varav försenade) | Kön framåt |
| Utbildningsläge | Redan uträknat av `kursLage()` — klar / pågår / försenad / utgången |
| Senaste K&V | Företagets egen kvalitetsmätning, redan i databasen |
| Fokusområde | Vad personen tränar på just nu |

Plus en knapp **"Ny uppgift"** per rad och en **"Tilldela kurs"**.

Teamledaren ser sitt team, säljchef och VD ser alla — samma RLS-modell som
`/utbildning/oversikt` redan använder, inte ett filter i koden.

### 3.2 Personkortet (`/coachning/[id]`)
En **tidslinje** som är den enda platsen där hela bilden av en person finns:
coachningsuppgifter, rollspelsbedömningar, K&V-samtal, klarade kurser och
certifikat i kronologisk ordning. Under den: öppna uppgifter, fokusområden och
historiken.

### 3.3 Min coachning (samma adress, säljarens vy)
Säljaren som öppnar `/coachning` ser **sig själv**: sina uppgifter, vad var och
en bedöms på (rubriken före, inte efter), och sin egen historik. Ingen ser
någon annans.

---

## 4. Det bärande valet: återanvänd K&V-områdena som kompetensspråk

Marknadens verktyg börjar med att bygga ett kompetensramverk — 200 kompetenser
med vikter. **Ni har redan ett, och det är beställarens egna ord:**

> Intro · Behovsanalys · ROI · Avslut · Kvalitet på samtalet · Korrekt avtalshantering

Förslaget är att en coachningsuppgift kan taggas med ett eller flera av
`kv_criterion`. Då — och bara då — går slingan ihop:

```
K&V-samtal visar svag Behovsanalys
        ↓
Coachningsuppgift med fokus "Behovsanalys"
        ↓
Nästa K&V-samtal mäter samma sak
        ↓
Kortet visar om coachningen faktiskt flyttade något
```

Det är Mindtickles readiness-idé, byggd av det som redan finns, utan ett enda
påhittat tal. **Ett separat kompetensramverk ska inte byggas.**

**Vad som INTE föreslås:** ett sammanvägt "readiness-index" per person. Det
kräver vikter som ingen har beslutat, och repots egen linje är entydig —
`kv_criterion.max_points` står som NULL just för att en gissad siffra ser rätt
ut och blir tyst sanning. Samma sak gäller här.

---

## 5. Datamodellen

### 5.1 En uppgift, inte fem tabeller

```sql
coaching_task
  id
  title, description_md
  kind            -- kurs | rollspel_inspelat | rollspel_live | manus
                  -- | medlyssning | lasning | uppgift
  assignee_id     -- DEN SOM SKA GÖRA DET
  partner_id      -- MED VEM. null = på egen hand
  created_by      -- VEM SOM BESTÄLLDE DET
  verify_by       -- vem som får kvittera: sjalv | motpart | skapare | chef
  course_id, module_id, document_slug   -- källa, beroende på kind
  focus_criteria  -- kv_criterion[]
  starts_at, due_date
  cancelled_at, cancelled_by, cancel_reason
  template_id, series_id
```

**Tre personer på varje uppgift, och de är olika saker.** Det är den enskilt
viktigaste detaljen i beställningen: "tilldela en teamledare, eller att säljaren
själv gör det, eller med den som satt upp tasken" beskriver inte tre sorters
uppgifter — det beskriver **motparten**. Ansvarig är alltid den som ska lära
sig något. Motparten är den som spelar kund, lyssnar eller bedömer. Skaparen är
den som beställde. Ofta men inte alltid samma person som motparten.

### 5.2 Läget räknas fram, det lagras inte

```sql
coaching_task_event            -- logg, aldrig överskrivning
  task_id, at, by, type        -- tilldelad | paborjad | inlamnad
                               -- | kvitterad | underkand | avbruten
  note, file_id
```

Och för de uppgiftstyper där sanningen bor någon annanstans hämtas den därifrån:

| kind | "Klar" betyder |
|---|---|
| `kurs` | `certification` finns och är giltig — **går inte att bocka för hand** |
| `rollspel_inspelat` | `course_attempt` med `passed = true` för modulen |
| `lasning` | Kvittens på rutinen finns |
| `rollspel_live`, `manus`, `medlyssning`, `uppgift` | En `kvitterad`-händelse från den som `verify_by` pekar ut |

Det är hela poängen med indelningen: **fyra av sju typer kan aldrig ljuga**,
eftersom ingen kan kvittera dem för hand.

### 5.3 Mallar

```sql
coaching_template          -- "Ny säljare vecka 1–4", "Efter svag K&V på Avslut"
coaching_template_item     -- kind, titel, fokus, förfallodag RELATIVT starten
```

En mall skapar tolv uppgifter på en knapptryckning med datum räknade från
startdatum. Det är skillnaden mellan en modul som används och en som inte gör
det — samma erfarenhet som `course.due_days` bygger på.

### 5.4 Behörighet

Skrivningar via server actions med service role (D-T1). Läsning via RLS:

- Egen uppgift: alltid.
- Motpart: uppgifter man är motpart i.
- Skapare: sina egna beställningar.
- `leads_employee()`: teamledaren sitt team.
- `can_read_all_employees()`: säljchef, VD, admin.
- **Säljare ser aldrig varandras.**

Nästa migrationsnummer är **0043**.

---

## 6. Kvitteringen — den regel beställningen faktiskt handlar om

Beställningen: *"Säljaren ska kunna markera detta som klart då eller chefen."*

Förslaget är att det avgörs **per uppgift** av den som skapar den, med fyra
lägen:

| `verify_by` | Vem kvitterar | När det passar |
|---|---|---|
| `sjalv` | Säljaren | "Läs manuset", "gå igenom kursen" — tillit som förval |
| `motpart` | Teamledaren man övade med | Live-rollspel, medlyssning |
| `skapare` | Den som beställde | Uppgifter chefen vill se resultatet av |
| `chef` | Närmaste chef | Formella moment |

**Förval: `sjalv`.** Skälet är inte bekvämlighet. En modul där chefen måste
godkänna varje bock blir en modul där bockar ligger okvitterade i tre veckor och
kön blir en lögn. Det som ska kräva någon annans signatur är just det som
faktiskt bedöms — och då finns en rubrik att bedöma mot.

**Bevis är valfritt per uppgift**: en ruta som kräver en kommentar, en fil eller
ingetdera. Ett rollspel kräver alltid ljudfilen (den regeln finns redan i 0024,
inklusive spärren som vägrar ta emot en bedömning från någon som aldrig öppnat
filen).

---

## 7. Vad modulen medvetet INTE ska göra

Det här avsnittet är lika viktigt som resten, och det följer av beslut som
redan är fattade i repot.

1. **Ingen rangordning, ingen topplista.** Adoptionsmodulen (0029) är
   uttryckligen byggd för att göra per-person-uppföljning omöjlig, och
   `/adoption` stängdes för teamledare med motiveringen att en siffra per team
   var ett steg åt fel håll. En coachningsvy som rankar säljare mot varandra
   drar åt motsatt håll. Vyn ska visa **vem som behöver något**, inte vem som
   är sämst.
2. **Ingen automatisk koppling till konsekvenstrappan eller provisionen.** Data
   som samlas för att någon ska bli bättre får inte utan ett uttryckligt beslut
   återanvändas till att någon ska förlora pengar. Det är ändamålsbegränsningen
   i GDPR och samma resonemang som K12-underlaget för.
3. **Inga privata chefsanteckningar.** Allt som skrivs om en person ska
   personen kunna läsa. Det är samma linje som rubriken-före-inspelningen i
   0024 och som AC-3.13 drog för frånvaroreglerna. Det gör också
   registerutdraget (`/personal/[id]/registerutdrag`) sant utan extra arbete.
4. **Ingen spärr.** Beslutet 2026-08-31 gäller: `blocks_capability` används
   inte, funktionsspärrar byggs inte. En ogjord coachningsuppgift stänger inte
   av någonting.
5. **Inget påhittat sammanvägt betyg.** Se avsnitt 4.

---

## 8. Utökningar värda att överväga

Numrerade så de går att svara på var för sig. **Fas 1** = det som gör modulen
användbar dag ett. **Senare** = bra, men bär sig inte utan fas 1.

| # | Idé | Vad den ger | Kostnad |
|---|---|---|---|
| U1 | **Mallar / rampplan** — "Ny säljare vecka 1–4" | Skillnaden mellan en modul som används och en som inte gör det | Låg. Rekommenderas till fas 1 |
| U2 | **Återkommande uppgifter** — manuskoll efter 7 / 30 / 90 dagar | Den spridda repetitionen från avsnitt 2. 30–55 % bättre återgivning | Medel |
| U3 | **"Ingen coachad på 30 dagar"-larm** till säljchefen | Den mätning som faktiskt ändrar beteende — hos cheferna | Låg. Rekommenderas |
| U4 | **1:1-protokoll med GROW** — mål, läge, alternativ, åtagande → uppgifter | Gör samtalet till åtaganden i stället för minnesanteckningar | Medel |
| U5 | **Manusbank** — manus och invändningsbibliotek som versionerat innehåll | "Memorera manuset" behöver ett manus som har en adress | Medel. Se fråga 12 |
| U6 | **Scenariobibliotek för rollspel** — kundpersonor och invändningar | Samma rollspel går att beställa av tio personer utan omskrivning | Låg |
| U7 | **Kompetensmatris per team** — K&V-områden × person som värmekarta | Visar när hela teamet är svagt på något → en utbildning i stället för sex samtal | Låg, bygger på U-4-taggningen |
| U8 | **Automatiska förslag** — svag K&V två veckor i rad ger ett *förslag* på uppgift | Samma modell som konsekvenstrappans förslagssteg: systemet föreslår, en människa beslutar | Medel |
| U9 | **Coachning i kalendern** — bokade pass via befintlig `/api/ical/[token]` | Ett pass som inte står i kalendern blir inte av | Låg |
| U10 | **Kvitto som PDF** — signerat coachningsprotokoll via `src/lib/pdf.ts` | Behövs om coachning någon gång ska kunna åberopas formellt | Låg |
| U11 | **Medlyssning på riktiga samtal från dialern** | Marknadens starkaste coachningssignal | **Blockerad av E12** |
| U12 | **AI-rollspel** — bot som spelar kund på svenska | Säljaren kan öva utan att en teamledare sitter med. Marknadsstandard 2026 | Hög. Egen utredning: kostnad, språkkvalitet, integritet |
| U13 | **Övningsläge** — coachningsuppgift "lägg en order" utan att en riktig order skapas | Gör praktiska uppgifter möjliga | **Beroende av G3**, redan planerad |

---

## 9. Frågor som måste besvaras innan kod skrivs

### Omfattning och placering
1. Egen menypost **Coachning**, eller en flik under Utbildning? *(förslag: egen modul — utbildning är innehåll, coachning är uppföljning av personer)*
2. Ska modulen gälla **bara säljare**, eller alla anställda? *(K&V och provision gäller rollen säljare; coachning behöver inte göra det)*
3. Hur många personer ska rymmas i vyn? Tio, tjugofem, hundra? Det avgör om det blir en tabell eller kort, och om filter behövs.
4. Coachar teamledaren från **telefon**? Det avgör hur mycket som får ligga bakom en tabell.

### Vem får vad
5. Vem får **skapa** uppgifter — teamledare, säljchef, VD? Får en säljare skapa en åt sig själv?
6. Får en säljare skapa en uppgift åt en **kollega** (peer-coachning)?
7. Ser teamledaren bara sitt eget team, eller alla säljare?
8. Ska säljaren kunna se **vem som beställt** uppgiften? *(förslag: ja, alltid)*

### Kvittering och bevis
9. Är den föreslagna `verify_by`-modellen rätt, eller vill du ha en fast regel för hela företaget?
10. Ska "klar" av säljaren kunna kräva **chefens efterföljande godkännande** (två steg), eller är en kvittering en kvittering?
11. Ska en försenad uppgift få en konsekvens — eller bara en påminnelse? *(förslag: bara påminnelse, se avsnitt 7 punkt 2)*

### Innehållet
12. **Var bor manuset?** Behövs en manusbank (U5), eller pekar en manusuppgift på en befintlig rutin?
13. Hur verifieras "memorerat manuset" i praktiken — quiz, inspelad uppläsning, eller teamledarens bock?
14. Ska **live-rollspel** bokas på en tid (kalender, U9), eller är det "gör det när ni hinner och kvittera"?
15. Ska live-rollspel bedömas mot samma rubriker som de inspelade (`roleplay_criterion`), eller räcker godkänt/underkänt?
16. Ska en coachningsuppgift kunna vara **"lyssna på tio av dina egna samtal"** — alltså medlyssning — redan nu, eller vänta på dialerkopplingen?

### Uppföljning
17. Ska fokusområdena vara **K&V:s sex områden** (förslag: ja), eller en egen lista?
18. Samma påminnelsetrappa som systemguiderna — 3 dygn till personen, 7 till chefen, 14 dagar över frist ger ärende? *(förslag: ja, den är beprövad)*
19. Vill du ha "ingen coachad på 30 dagar"-larmet (U3), och i så fall till vem?

### Integritet
20. Ska coachningsanteckningar vara **synliga för säljaren** (förslag: ja, undantagslöst)?
21. Hur länge ska coachningsdata sparas? Och rollspelsljudet — samma gallringsregel som sjukintyg, eller kortare?
22. Ska coachningsdata följa med i **registerutdraget**? *(förslag: ja, det följer av punkt 20)*

### Prioritering
23. Av U1–U13: vilka ska in i **fas 1**? *(förslag: U1, U3, U6 — låg kostnad, hög effekt)*
24. Är U12 (AI-rollspel) intressant att utreda separat, eller är det utanför bordet?

### Arbetssätt — måste avgöras först
25. **Preview-branchen delar produktionsdatabasen.** Ett test på `coachning`-branchen skriver riktiga rader i Supabase. Tre vägar: (a) testa med ett testkonto och städa efter, (b) egen Supabase-instans för preview, (c) vänta med data tills merge. *(förslag: a — migrationerna är additiva och main-koden rör aldrig de nya tabellerna)*
26. Ska migration 0043 köras mot produktionsdatabasen **innan** merge, så previewen fungerar? *(följer av 25)*

---

## Källor

- [Highspot — Ultimate guide to successful sales coaching](https://www.highspot.com/blog/sales-coaching/)
- [Mindtickle — Sales Readiness Index](https://www.mindtickle.com/platform/analyze-sales-team-performance-sales-readiness-index/)
- [Mindtickle — What is sales readiness](https://www.mindtickle.com/what-is-sales-readiness/)
- [Lattice — GROW Coaching Model: Manager's Guide](https://lattice.com/articles/everything-you-need-to-know-about-the-grow-coaching-model)
- [Allego — Spaced repetition is the key to sales training reinforcement](https://www.allego.com/blog/spaced-repetition-is-the-key-to-sales-training-reinforcement/)
- [Proactive Training Solutions — Why salespeople forget their training](https://proactivetrainingsolutions.com/salespeople-forget-training-spaced-reinforcement/)
- [PitchMonster — Best sales coaching programs for teams](https://www.pitchmonster.io/blog/best-sales-coaching-programs-teams)
- [Deelan — AI sales coaching platforms: roleplay, call intelligence, training](https://deelan.ai/resources/sales-coaching-software-platform)
- [GDPR Local — Employee monitoring: compliance considerations](https://gdprlocal.com/gdpr-employee-monitoring/)
- [Together — How to create an employee coaching plan](https://www.togetherplatform.com/blog/coaching-plan-template)
