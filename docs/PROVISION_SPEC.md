# E13 — Provisions-, bonus- och konsekvensmotor

**Regelspecifikation.** Skriven 2026-08-24 efter en fullständig frågeomgång med
beställaren. **Steg 1–4 är byggda 2026-08-25**; byggordningen i avsnitt 11 säger
vad som är klart och vad som återstår.

Dokumentet är avsiktligt uttömmande. Skälet: beställaren clearar chatten när
den blir dyr, och den här specifikationen är då det enda som bär besluten.
Läs den före `docs/ARBETSLOGG.md` när arbetet med E13 återupptas.

**Status 2026-08-25:** steg 1–4 är byggda och i produktion. Ö1 avgjordes
2026-08-24 (se D-K12 i `DECISIONS.md`), Ö2–Ö7, Ö10 och Ö14 besvarades samma dag,
och **Ö4, Ö8, Ö12 och Ö15 besvarades 2026-08-25**. Kvar öppna är **Ö9, Ö11, Ö13
och Ö16**, som alla har ett förslag som gäller tills någon säger annat.

---

## 1. Vad som beslutades, och vad som fortfarande är öppet

Beställaren besvarade 59 frågor 2026-08-24. Svaren står inarbetade i reglerna
nedan. **Öppna punkter** ligger samlade i avsnitt 10 och är numrerade Ö1–Ö16.
Ingen siffra i det här dokumentet är påhittad — det som inte är beslutat står
som `EJ SATT` och ska läsas ur konfigurationen, aldrig gissas.

---

## 2. Omfattning

| Fråga | Beslut |
|---|---|
| Vem omfattas | Endast rollen **säljare**. Teamledare omfattas inte |
| Från när | **Period 2026-08-01.** Tidigare `commission_entry`-poster är historik och rörs aldrig |
| Vem ser andras provision | Säljchef, VD, ekonomi. **Inte teamledare** |
| Vem ser sin egen | Alla, som i dag (D-E13) |
| Vem ändrar konfigurationen | **Säljchef och VD.** Ekonomi ser men ändrar inte |

**Följd i koden:** `far_hantera_provision()` i `0031` utvidgas med
`sales_manager`. Det är en rad, precis som migrationen förutsåg.

---

## 3. Order — det som hette "avtal"

Beställaren kallar det **order**, inte avtal. Det är viktigt: `/avtal` och
tabellen `contract` är **anställningsavtal** (E9.1, migration `0028`) och har
ingenting med kundaffärer att göra. Nytt begrepp, ny tabell, ny sida.

- Tabell: `sales_order`
- Sida: `/order`

### 3.1 Fält

| Fält | Krav | Anmärkning |
|---|---|---|
| Bolagsnamn | Obligatoriskt | |
| Organisationsnummer | Obligatoriskt | Se K27-varningen nedan |
| Kontaktperson | Obligatoriskt | Namn |
| Telefon | Obligatoriskt | |
| Paket | Obligatoriskt | 1, 2 eller 3 |
| Avtalstid | Obligatoriskt | 12, 24 eller 36 månader |
| Säljare | Obligatoriskt | |
| Signeringsdatum | Obligatoriskt | **Styr vilken period ordern hör till** |
| Avtalsfil | **Frivillig** | PDF. **Byggd inte i steg 1** — se nedan |
| Manuell provision | Endast när ordern faller utanför paketmatrisen | Sätts av godkännaren |
| Anteckning | Frivillig | |

Inget mer. Beställaren var uttrycklig: "behövs ej mer".

**Filuppladdningen är skjuten till en egen leverans.** `file_object` i `0022`
har ett stängt `purpose`-villkor och ett "exakt en koppling"-villkor, och den
tabellen bär **läkarintyg**. Att vidga den kräver en egen migration, egna
RLS-policyer och en egen provkörning — inte ett påhäng på ordermigrationen.
Uppladdningen är dessutom frivillig, så ordern fungerar utan den.

Den automatiska avläsningen (Ö14: PDF med text) hör till samma leverans.
`src/lib/pdftext.ts` finns redan och används av bilagorna. Utläsningen ska
**förifylla formuläret, aldrig spara direkt** — ett fält som fyllts i av en
maskin och godkänts av en människa är något annat än ett fält ingen läst.

### 3.2 K27 — orgnummer och personnummer

Nav lagrar i dag **inga personnummer** (K27). `contract.variables` har ett
check-villkor som nekar personnummerformade strängar.

**En enskild firma har personnummer som organisationsnummer.** Fältet
`org_number` kan därför inte få samma villkor som `contract.variables` utan att
neka en fullt laglig kund. Beslutet blir:

- `org_number` tillåts bära ett tiosiffrigt nummer, alltså även en enskild
  firmas personnummer. Det är ett medvetet undantag från K27 och ska stå i
  DECISIONS.md när modulen byggs.
- Fältet är **inte** sökbart i den globala sökningen och exponeras inte i någon
  lista som fler än provisionsbehöriga ser.
- Den uppladdade avtals-PDF:en kan bära kontaktpersonens namnteckning och i
  värsta fall personnummer. Filen ligger i den stängda `filer`-bucketen med
  åtkomstlogg (`0022`), vilket är rätt skyddsnivå, men **P0.6
  registerförteckningen måste uppdateras** med kunduppgifter som ny kategori.

### 3.3 Livscykel

```
utkast -> inskickad -> signerad -> (betald)
                          |
                          +-> makulerad
```

| Status | Räknas mot provision och volymtrappa? | Vem sätter |
|---|---|---|
| `utkast` | Nej | Säljaren |
| `inskickad` | **Nej** — väntar på godkännande | Säljaren |
| `signerad` | **Ja** | Säljchef, ekonomi eller VD |
| `betald` | Ja (oförändrad) — ren information | Ekonomi |
| `makulerad` | Nej, och ger avdrag — se 4.4 | Säljchef, ekonomi eller VD |

**En order som säljchef, ekonomi eller VD lägger upp går direkt till
`signerad`.** En order som säljaren lägger upp hamnar på `inskickad` och måste
godkännas. Beställarens svar på fråga 12.

**Provisionen utgår från signering, inte från betalning** (fråga 10). Statusen
`betald` finns för att ROADMAP AC-10.8 en dag kan komma tillbaka, men den
påverkar ingenting i dag. Se Ö13.

### 3.4 Perioden bestäms av signeringsdatum

`period_month = date_trunc('month', signed_on)`. Inte av när ordern lades in,
inte av när den godkändes. Räknat i **svensk tid** — `manadsnyckel()` i
`src/lib/provision.ts` gör redan det rätt, och skälet står där.

---

## 4. Grundprovision

### 4.1 Paketmatrisen

Beställarens svar på fråga 8 och 9. **Engångsbelopp per order**, inte löpande.

| Paket | Pris till kund | 12 mån | 24 mån | 36 mån |
|---|---|---|---|---|
| Paket 1 | 995 kr | **1 500 kr** | **3 000 kr** | **4 500 kr** |
| Paket 2 | 1 495 kr | **2 500 kr** | **4 000 kr** | **5 500 kr** |
| Paket 3 | 1 995 kr | **3 500 kr** | **5 000 kr** | **6 500 kr** |

Nio rader i en konfigurationstabell, `commission_rate`, versionerad med
`valid_from`/`valid_to` precis som `cost_rate` i `0025`. **Ingen av de nio
siffrorna får stå i en `.ts`-fil.**

**Paketen heter "Paket 1/2/3"** — beställarens svar på Ö12, 2026-08-25. Priset
visas bredvid namnet vid inmatning, så säljaren ser ändå vilken rad hen valt.
Etiketten är en kolumn och går att byta utan migration.

### 4.2 Order utanför matrisen

Faller ordern utanför paketreglerna sätter godkännaren provisionsbeloppet för
hand (fråga 21). Beloppet lagras på ordern och en anteckning är då
**obligatorisk** — en avvikande provision utan skäl är det första någon
ifrågasätter i efterhand.

### 4.3 Delad order

**Byggs inte nu.** Beställaren valde 2026-08-24 att skjuta på delade order (Ö5).
**En order har en säljare.** Ingen andelskolumn läggs in — en kolumn som alltid
är 100 lär folk att den inte betyder något, och den dagen den ska betyda något
går den inte att lita på bakåt.

Förslaget nedan står kvar för den dagen frågan tas upp:

- Varje säljare på ordern får en **andel i procent**, summan alltid 100.
- Både provisionsbeloppet och **orderräknaren** delas efter andelen. En order
  delad 50/50 räknas som 0,5 order för var och en.
- Skälet till att räknaren delas: annars kan två säljare dela tio order och
  båda nå nivå 10, alltså tjugo nivåer på tio affärer.
- Volymtrappan jämför då mot ett decimaltal. 4,5 order är inte nivå 5.

### 4.4 Makulering

Beställarens svar på fråga 24 och 25: **avdraget sker i den månad makuleringen
sker**, inte i månaden ordern tecknades.

Konkret, med beställarens eget exempel: en order från mars som makuleras i
augusti river **augusti**, inte mars.

Vid makulering, i augusti:

1. En **negativ provisionspost** bokförs i augusti på orderns provisionsbelopp.
2. Augusti månads **orderräknare minskar med ett** (eller med andelen vid delad
   order).
3. Sjunker räknaren under en tröskel faller augusti ned till den lägre nivån.
   Volymbonusen räknas om på den nya nivån, retroaktivt som vanligt.

**Edge case:** räknaren kan bli **negativ** om fler order makuleras än som
tecknats i månaden. Bonusnivån är då noll — den blir aldrig negativ — men det
negativa provisionsavdraget sker ändå. Det syns i vyn som ett minusbelopp, och
det är rätt: pengarna ska tillbaka.

**Mars rörs aldrig.** Marsperioden är stängd och attesterad, och en stängd
period skrivs inte om (avsnitt 8).

---

## 5. Volymbonus

### 5.1 Trappan

Nivåer: **5, 10, 15, 20, 25, 30 order** per **kalendermånad**. Räknaren
nollställs den 1:a.

**Beloppen är EJ SATTA.** Beställaren sätter dem själv i inställningarna
(fråga 18). Ingenting seedas — samma linje som täckningsgraden i `0025`, och av
samma skäl: en gissad siffra ser rätt ut och blir tyst sanning.

**Formen är fast belopp** (Ö2), men procent ska gå att välja i inställningarna.
Konfigurationen bär därför en `unit`-kolumn, precis som `cost_rate`:

| Enhet | Betyder | |
|---|---|---|
| `amount_fixed` | Ett fast kronbelopp när nivån nås | **Används** |
| `percent` | Procent på månadens grundprovision | Valbar |
| `amount_per_order` | Kronor per order, gäller **samtliga** order i perioden | Valbar |

Den tredje formen är den enda där ordet "retroaktiv" har en synlig innebörd i
själva beloppet. Med `amount_fixed` ligger retroaktiviteten i stället i att
nivån bestäms av **hela** periodens ordervolym — se 5.2.

### 5.2 Retroaktiviteten

**Bonusen på en uppnådd nivå gäller samtliga order i perioden, inte bara de
över tröskeln.** Med `amount_per_order` betyder det: nås nivå 10 får alla tio
orderna nivå 10:s belopp.

Nivån är alltså **den högsta tröskel räknaren nått eller passerat**, och
bonusen räknas på hela periodens ordervolym.

### 5.3 Över trettio

Trappan står still över 30 (fråga 19). Utöver den kan chefen bokföra en **övrig
bonus** — ett fritt kronbelopp med obligatorisk anteckning, bokfört som en egen
post i huvudboken. Den är helt manuell och räknas inte fram av någon regel.

### 5.4 Avrundning

Allt avrundas till **hela kronor** (fråga 26), matematiskt, och **en gång** —
på den färdiga bonusraden, aldrig per order på vägen. Avrundas varje order för
sig blir trettio örebelopp till trettio kronors avvikelse.

### 5.5 Så här bokförs bonusen — svaret på fråga 22 och 23

Beställaren förstod inte frågan, vilket är rimligt: den är teknisk. Här är
valet, och det som gäller.

Problemet: huvudboken `commission_entry` är **append-only**. En bokförd post
skrivs aldrig om. Men volymbonusen ändrar sig hela månaden — order elva höjer
bonusen på order ett till tio. Två sätt att hantera det:

- **Räkna om varje gång någon tittar.** Alltid rätt, men då ändrar en ändrad
  inställning även historiska månader. Det är precis det beställaren sagt att
  hen inte vill.
- **Bokföra bonusen som en post.** Historiken står fast, men varje ny order
  kräver en tilläggspost.

**Beslut: båda, uppdelat på öppen och stängd period.**

| Perioden är | Bonusen är | Innebörd |
|---|---|---|
| **Öppen** (månaden pågår) | **Beräknad live** ur orderna | Vyn visar alltid rätt siffra, ingen bokföring sker |
| **Stängd** (attesterad) | **Bokförd som poster** i `commission_entry` | Siffran fryses och kan aldrig ändras av en inställning |

Det ger säljaren en progressvy som svarar direkt, och beställaren en historik
som står stilla. Att stänga en period är en åtgärd någon utför, inte något som
sker av sig självt.

### 5.6 Periodens livscykel

```
oppen -> faststalld (attesterad) -> utbetald
```

**Öppen är frånvaron av en rad.** `commission_period` (0035) bär bara stängda
perioder. En månad utan rad är öppen; en månad med rad är bokförd. En rad med
status `oppen` hade varit ett tillstånd utan innebörd som någon förr eller senare
hade glömt att skapa — och då hade en månad utan rad blivit tvetydig i stället
för öppen.

- **Öppen:** månaden pågår eller väntar på attest. Allt räknas live.
- **Fastställd:** säljchef, ekonomi eller VD attesterar. Kan inte ske före
  månadens sista dag. Vid attesten bokförs grundprovision, volymbonus, K&V-bonus
  och eventuella avdrag som poster.
- **Utbetald:** markeras när lönekörningen är gjord. **Utbetalning sker
  månaden efter intjänandemånaden** (fråga 58).

**Edge case:** en order signerad 31 augusti men godkänd efter att augusti
stängts. Se Ö11 — förslaget är att den bokförs i den öppna perioden med en
anteckning om att den hör till augusti, eftersom en stängd period aldrig öppnas.

---

## 6. K&V-protokollet

### 6.1 Grunden

- **Två samtal per säljare och vecka**, samtal som lett till sälj.
- Bedöms av säljchefen på **sex områden**: intro, behovsanalys, ROI, avslut,
  kvalitet på samtalet, korrekt avtalshantering.
- **Poängskalan: 200 totalt för båda samtalen.** Beställarens svar på Ö4,
  bekräftat 2026-08-25. Tröskeln 160 är alltså **80 %** — den enda läsningen där
  160 fungerar som ett godkäntbetyg.
- **Tröskel: 160 poäng**, räknat som **summan av båda samtalen** (fråga 29).
  Konfigurerbar.
- Godkänd vecka ger **1,25 %** — konfigurerbart — beräknat på **månadens
  provision inklusive volymbonus** (fråga 30, Ö3). Alltså hela månadens
  intjäning före K&V-bonusen. K&V räknas aldrig på K&V.

> **Ö4 är besvarad 2026-08-25: 200 är maxpoängen TOTALT för båda samtalen.**
>
> | Läsning | Maxpoäng totalt | 160 poäng motsvarar | |
> |---|---|---|---|
> | 200 per område | 6 × 200 × 2 samtal = 2 400 | 6,7 % — nås alltid | |
> | 200 totalt per samtal | 2 × 200 = 400 | 40 % | |
> | **200 totalt för båda samtalen** | **200** | **80 %** | **← gäller** |
>
> **Följden: de sex områdena delar på 100 poäng per samtal.** Maxpoängen per
> område är konfiguration (avsnitt 8.2) och behöver inte vara lika stor för alla
> — "korrekt avtalshantering" och "behovsanalys" väger rimligen olika. Det som
> måste stämma är summan.
>
> **Inställningssidan ska räkna ut och visa vad tröskeln motsvarar i procent**
> medan man skriver, och neka en skala där tröskeln är omöjlig att nå. Med max 5
> poäng per område blir taket 60 poäng, och 160 går då inte att uppnå — den
> sortens tyst omöjliga konfiguration ska formuläret stoppa direkt.
- **Tak 5 %** per månad. Alltså **högst fyra godkända veckor** räknas.
- **Ordningen spelar ingen roll** (fråga 31). Veckorna behöver inte vara i rad.
- **Taket är 5 % även i en månad med fem veckor** (fråga 32).

**Inställningarna måste validera att tröskeln är nåbar:** sex områden gånger
maxpoäng gånger två samtal måste vara minst tröskeln. Med max 5 per område blir
taket 60 poäng och 160 är omöjligt — den sortens tyst omöjlig konfiguration ska
formuläret neka direkt.

### 6.2 Vecka utan bedömning

**Veckan hoppas över** (frågorna 34, 39). Den räknas varken för eller emot.
Gäller oavsett skäl: sjukdom, semester, nollvecka, eller att chefen inte hann.

**Skälet får aldrig synas.** Att skriva "ej bedömd — sjukfrånvaro" i en
prestationsvy är sjukdata i en provisionsvy, vilket AC-3.26 och E7.14 förbjuder.
Vyn säger **"Ej bedömd"** och ingenting mer. Frånvaro får bara hämtas via
`payroll_row.absence_minutes`, aldrig genom att joina `sick_report`.

### 6.3 Vilken månad hör veckan till

En ISO-vecka kan spänna över ett månadsskifte. **Förslag, ej beslutat (Ö9):**
veckan hör till den månad där dess **torsdag** ligger. Det är ISO-standardens
egen regel, den är deterministisk, och den ger alltid fyra eller fem veckor per
månad utan överlapp.

### 6.4 Fritext och insyn

- **Fritext per område** och en helhetskommentar (fråga 37).
- **Säljaren ser sin egen bedömning**, inklusive fritexten (fråga 38).
- **Cheferna ser alla** (fråga 35). Teamledaren gör det inte — samma linje som
  provisionen.
- **Bedömningen får ändras i efterhand** (fråga 35). Ändringen loggas i
  `audit_log`. Är perioden stängd blir ändringen en **rättelsepost**, inte en
  överskrivning — samma modell som resten av huvudboken.

### 6.5 Var samtalen kommer ifrån

Beställaren vill hämta samtalen via **API från den egna dialern**, men har
uttryckligen lagt det **sist** i ordningen (fråga 27).

**Tills dess:** säljchefen registrerar samtalet för hand med datum, kund och
säljare, och bedömer det. Urvalet sker alltså utanför Nav.

Sömmen läggs redan nu, samma modell som Inkio fick i `0031`: kolumnerna
`source` (`manual` / `dialer`) och `external_ref` med ett partiellt unikt index.
Den dagen dialern kopplas in behöver ingen vy röras.

### 6.6 Sidan — beslut

Beställaren valde att **skilja K&V från rollspelsmodulen** (fråga 33). Egen
tabell, eget flöde, men samma beprövade mönster som `0024_rollspel`:

- Kriterier med poängtak i en konfigurationstabell.
- Bedömningsformulär med ett fält per område.
- Rollspelens trigger "den som inte öppnat inspelningen får inte bedöma den" är
  värd att ta med när dialer-API:t finns. Med manuellt registrerade samtal
  finns ingen inspelning att öppna.

**Huvudvy: rutnät säljare × vecka.** Chefen ser direkt vilka rutor som är tomma.
Klick öppnar bedömningsformuläret.
**Säljarens flik: utvecklingskurva** per område över tid.
**Det är också här K&V-bonusen visas** — inte i volymbonusens progressvy.

---

## 7. Konsekvenssystemet

### 7.1 Hur en ogiltig frånvaro uppstår

1. **Utebliven instämpling** ger ett **förslag** till säljchefen.
2. **Säljchefen godkänner** att säljaren faktiskt inte var på plats.
3. Först då registreras händelsen.

Ingenting sker automatiskt utan chefens godkännande (fråga 40). Ö1 är avgjord
genom D-K12 och blockerar inte längre.

**Ö15 är besvarad 2026-08-25, och svaret är snävare än frågan:**

- **Minst 5 minuter.** En kortare lucka ger ingen händelse.
- **Personen ska faktiskt inte ha varit på plats.** Den som stämplar in för sent
  men varit här räknas **aldrig** — beställarens egna ord. Det är också det som
  håller D-K12:s linje: K12 1.2 sen ankomst når fortfarande inte provisionen,
  och intresseavvägningen behöver därför inte omprövas.
- **Chefen avgör.** Förslaget säger bara att stämplingen saknas; det är chefen
  som vet om personen var inne.

Att navet inte kan se skillnad på "kom sent" och "var inte här" är precis skälet
till att steg 2 finns. Systemet får aldrig dra slutsatsen själv.

### 7.2 Det är en egen händelse, inte en frånvaroansökan

Beställaren bekräftade resonemanget (fråga 41). En ogiltig frånvaro är en
**disciplinär händelse** och ska inte ärva ansökningsflödets attestlogik.

Praktiskt betyder det också att `absence_type` inte behöver ändras. Dess
check-villkor är en stängd lista på tio värden, och att öppna den hade gjort
"ogiltig frånvaro" till något man kan ansöka om.

Ny tabell: `attendance_incident`.

### 7.3 Trappan

| Gång | Följd |
|---|---|
| **Första** | **Varning.** Notis till säljaren |
| **Andra**, inom rullande 3 månader från den första | **Samtliga bonusar för innevarande månad faller** |
| **Tredje** | **Personalärende: "Ser över anställningen"** |

- **Perioden är rullande**, räknad från den första ogiltiga frånvaron (fråga 42).
- Bonusförlusten gäller **endast innevarande månad** (fråga 43).
- Den gäller **både volymbonus och K&V-bonus** (fråga 44), men **inte övrig
  bonus** (Ö8, besvarad 2026-08-25). Övrig bonus är chefens egen bedömning av
  något utöver trappan — vill chefen inte ge den kan hen låta bli att bokföra
  den, och då behöver systemet inte ta tillbaka den åt hen.
- **Grundprovisionen är orörd.** Intjänade pengar för utfört arbete faller inte
  bort. Beställaren bekräftade.
- **Efter bonusförlusten börjar orderräknaren om från noll** (fråga 45). Nya
  order i samma månad bygger en ny trappa från nivå 5. En säljare som stod på 20
  när konsekvensen slog in och sedan säljer fem till får nivå 5:s bonus på de
  fem — inte nivå 25 på alla tjugofem.
- **Tredje gången** skapas ett ärende i den befintliga personalärendemodulen
  (`0013`). Chefen sätter sig med säljaren, skriver svaret i ärendet, och
  **säljaren ska godkänna svaret** (fråga 49).
- **Varningen nollställs** tre månader efter den senaste ogiltiga frånvaron
  (fråga 47).
- **Chefen kan häva en konsekvens** utan att ange skäl, men **skälfältet finns**
  och hävningen loggas (fråga 46).
- Den ogiltiga frånvaron **står i registerutdraget** (fråga 51, artikel 15).

### 7.4 Konfigurerbara konsekvenstyper

Beställaren vill kunna uttrycka fler typer (fråga 50): varning, skriftlig
erinran, bonusförlust, ärende. Modellen blir en regeltabell:

```
consequence_rule
  ordning        (1, 2, 3, ...)
  antal_handelser  (vid vilken händelse i följd regeln slår)
  periodlangd_manader
  atgard         ('varning' | 'skriftlig_erinran' | 'bonusforlust' | 'arende')
  omfattning     (vid bonusforlust: 'innevarande_manad' | ...)
  notifiera      (boolean)
```

Trösklar, periodlängd och åtgärd är alltså data. Det som **inte** är data är
vad varje åtgärd faktiskt gör — det är kod, och det ska det vara.

### 7.5 Notifiering

Notis i Nav via den befintliga notisklockan (fråga 48). **Mejl är pausat på
beställarens egen tidigare begäran** (E0.8) — säljaren får alltså en notis, och
mejlet kommer den dagen mejlspåret tas upp. Sömmen läggs, utskicket byggs inte.

---

## 8. Konfiguration och versionering

### 8.1 Tre val vid varje ändring

Beställaren vill välja verkan när en inställning sparas (fråga 55):

| Val | `valid_from` blir | Verkan |
|---|---|---|
| Gäller allt intjänat denna månad | Månadens första dag | Räknar om hela innevarande **öppna** månad |
| Gäller från och med nu | Dagens datum | Order före i dag behåller gamla satsen |
| Gäller från och med nästa månad | Nästa månadsskifte | Innevarande månad rörs inte |

**Stängda perioder rörs aldrig, oavsett val.** Det är hela poängen med att
stänga en period, och det är inte konfigurerbart.

Versioneringen följer `cost_rate` i `0025`: `valid_from` / `valid_to`, aldrig en
uppdatering på plats. Historiken går att läsa bakåt: vilken sats som gällde när.

### 8.2 Vad som är konfiguration

Allt nedan är data, inget av det är kod:

- Paketmatrisen, nio belopp
- Bonusnivåerna, deras belopp och enhet
- K&V: antal samtal per vecka, områdena, maxpoäng per område, tröskeln,
  procentsatsen per godkänd vecka, taket
- Konsekvenser: trösklar, periodlängd, åtgärd, omfattning
- Utbetalningsmånad

---

## 9. Vyer

### 9.1 Säljarens provisionsvy

- Nuvarande provision och nuvarande bonusnivå.
- **Kvar till nästa nivå:** "Du har 7 order. 3 order kvar till nästa bonus."
- **Vad nästa nivå ger** och **vad totalen blir** när den nås.
- Prognosen räknas på **nuvarande snittprovision per order** (fråga 52).
  Antagandet skrivs ut i vyn — en prognos utan sina förutsättningar är en siffra
  folk bråkar om.
- **K&V-bonusen visas inte här.** Den ligger på K&V-sidan.
- **Vid en ogiltig frånvaro:** varning om att ytterligare en innebär att alla
  bonusar för månaden faller, med **återstående tid av perioden** ("2 månader
  kvar").
- **Historik per månad** (fråga 53).
- **Underlaget i enklare version** än chefens (fråga 54): vilka order, vilken
  nivå, vilka K&V-veckor, eventuella avdrag — men inte hela beräkningskedjan.

### 9.2 Chefens vy

Fullt underlag rad för rad. Attest av period. Export till CSV och PDF (fråga 59).

### 9.3 Lönerapporten

Beställaren svarade att bonusen ska räknas där (fråga 57), vilket krockar med
K5 och AC-2.17: **Nav räknar ingen lön**, och lönerapporten är ett underlag som
lämnar huset. Se Ö10 — förslaget är ett **separat provisionsunderlag** som
följer med lönekörningen i stället för en kronkolumn i `payroll_row`.

---

## 10. Öppna punkter

| Nr | Fråga | Läge |
|---|---|---|
| **Ö1** | K12 §5 mot konsekvenssystemet | **AVGJORD 2026-08-24.** Beställaren beslutade att K12 inte ska hindra bygget. Se D-K12. Rast och sen ankomst når fortfarande aldrig provisionen; utebliven instämpling gör det, men bara via ett förslag chefen godkänner |
| Ö2 | Bonusform per nivå | **BESVARAD: fast belopp.** Procent ska ändå gå att välja i inställningarna |
| Ö3 | K&V-basen | **BESVARAD: grundprovision + volymbonus.** Alltså hela månadens intjäning före K&V |
| Ö4 | Maxpoäng per K&V-område | **BESVARAD 2026-08-25: 200 är maxpoängen TOTALT för båda samtalen.** Tröskeln 160 är alltså 80 %. De sex områdena delar på 200, och maxpoängen per område är därmed konfiguration som måste summera rätt — se 6.1 |
| Ö5 | Delad order | **BESVARAD: byggs inte nu.** En order har en säljare. Andelsmodellen i 4.3 står kvar som förslag den dag det behövs |
| Ö6 | Tilläggsavtal i volymtrappan | **BESVARAD: ja, det räknas** |
| Ö7 | Order med manuell provision i volymtrappan | **BESVARAD: ja, det räknas** |
| Ö8 | Faller **övrig bonus** (5.3) vid en konsekvens? | **BESVARAD 2026-08-25: nej, den står kvar.** Övrig bonus är chefens egen bedömning av något utöver trappan; vill chefen inte ge den kan hen låta bli att bokföra den. Volymbonus och K&V-bonus faller som förut |
| Ö9 | Veckans månadstillhörighet: ISO-torsdagen (6.3) | Förslag gäller tills annat sägs |
| Ö10 | Lönerapporten eller separat underlag | **BESVARAD: separat underlag.** `payroll_row` får ingen kronkolumn, K5 och AC-2.17 står kvar |
| Ö11 | Order signerad i en period som hunnit stängas (5.6) | Förslag gäller tills annat sägs |
| Ö12 | Paketens namn | **BESVARAD 2026-08-25: behåll "Paket 1/2/3".** Priset visas bredvid vid inmatning. Etiketten är en kolumn och går att byta utan migration |
| Ö13 | Behövs statusen `betald` alls i dag, och vem sätter den? | Öppen — byggs, men påverkar ingenting |
| Ö14 | Uppladdat avtal | **BESVARAD: PDF.** Textextraktion via `pdftext.ts` går att använda; ingen OCR behövs |
| Ö15 | Vad räknas som ogiltig frånvaro? | **BESVARAD 2026-08-25: minst 5 minuter, och personen ska faktiskt inte ha varit på plats.** Den som stämplar in för sent men varit här räknas ALDRIG. Varje fall går som förslag till chefen, som godkänner att säljaren inte var inne — först då är det en ogiltig frånvaro. D-K12:s linje står därmed orörd: K12 1.2 sen ankomst når fortfarande inte provisionen |
| Ö16 | **Vilken volymtrappa gäller för en månad som en ändring skär igenom?** Frågan var aldrig ställd. Byggd 2026-08-25 med regeln **trappan som gällde på månadens första dag** | Förslag gäller tills annat sägs — se rutan nedan |

> **Ö16: varför trappan slås upp på månadens första dag och inte på ordern.**
>
> Provisionssatsen är en egenskap hos **en order** och slås därför upp på den
> orderns signeringsdatum. Volymbonusen är en egenskap hos **hela månaden** —
> nivån bestäms av månadens samlade ordervolym — och en trappa som byter form
> mitt i månaden går därför inte att tillämpa "per order" utan att bli
> obegriplig: order ett till tio skulle höra till en trappa och elva till trettio
> till en annan, medan nivån räknas på alla trettio.
>
> Uppslaget på månadens första dag gör dessutom de tre valen i avsnitt 8.1
> entydiga:
>
> | Val | `valid_from` blir | Slår igenom |
> |---|---|---|
> | Gäller allt intjänat denna månad | månadens 1:a | **innevarande månad** |
> | Gäller från och med nu | dagens datum | nästa månad |
> | Gäller från och med nästa månad | nästa 1:a | nästa månad |
>
> De två sista sammanfaller mitt i en månad och skiljer sig den 1:a, vilket är
> rätt: den som ändrar trappan på första dagen menar den månaden.
>
> **Vill du i stället att en ändring mitt i månaden ska slå igenom direkt** är
> det en rad i `gallandeNivaer` i `src/lib/provision-motor.ts` — men då gäller
> "från och med nu" och "allt intjänat denna månad" samma sak, och det ena av
> de två valen blir överflödigt.

---

## 11. Byggordning

Varje steg är en egen leverans med prov på räknemotorn innan nästa börjar.

| Steg | Innehåll | Beroende |
|---|---|---|
| 1 | **KLART 2026-08-25** (migration `0034`): `sales_order`, `commission_rate`, `/order`, grundprovision ur paketmatrisen | — |
| 2 | **KLART 2026-08-25**: räknemotorn i `src/lib/provision-motor.ts`, ren logik, `tests/provision-motor.mjs`. Rättade samtidigt ett räknefel i steg 1 — se arbetsloggen | Steg 1 |
| 3 | **KLART 2026-08-25** (migration `0035`): volymtrappan som konfiguration på `/provision/regler`, retroaktivitet, periodstängning med bokföring i `commission_entry` | Steg 2 |
| 4 | **KLART 2026-08-25**: säljarens progressvy på `/provision`. "3 order kvar till nästa bonus", prognosen med sitt antagande utskrivet, och underlaget rad för rad | Steg 3 |
| 5 | K&V: tabeller, rutnät, bedömningsformulär, utvecklingskurva, bonus | Steg 2 |
| 6 | Konsekvenssystemet | Steg 3 |
| 7 | Export, separat provisionsunderlag | Steg 3 |
| 8 | Dialer-API för K&V-urvalet | A6 |
| 9 | **Orderbilagan:** PDF-uppladdning och förifyllning ur avtalet. Egen migration som vidgar `file_object` (0022) — den tabellen bär läkarintyg, så det stänger inte på ordermigrationen. Utläsningen ska **förifylla formuläret, aldrig spara direkt** | Steg 1 |

**Steg 2 och 3 är inte blockerade av något.** Steg 5 väntar på Ö4, steg 8 på A6.
Steg 6 kräver ingenting mer sedan D-K12.

**Räknemotorn ligger i ett enda bibliotek utan importer av Supabase**, precis
som `raster.ts`, `lonekostnad.ts` och `franvaro.ts`. Reglerna skickas in som
argument. Provet kör motorn utan att starta Next.

---

## 12. Spårbarhet

Beställarens krav: både säljaren och chefen ska kunna se **varför** en summa
blev som den blev.

Motorn returnerar därför inte ett tal utan ett **underlag**: vilka order som
räknats, vilken nivå de gett, vilka K&V-veckor som godkänts, vilka avdrag som
gjorts och vilken konfigurationsversion som användes. Vyn visar underlaget, den
räknar inte om något själv.

Det är samma linje som `lonekostnad.ts` följer, och skälet är detsamma: en
siffra utan sitt underlag är en siffra folk slutar lita på.
