# Säljtavlan på /salesboard — design

Beställaren 2026-10-23: "Jag vill sätta upp en säljtavla för nav 2.0. Super viktigt.
Det ska vara på samma domän men /salesboard." Visuellt fin, minimalistisk, som om en
ingenjör byggt den, rolig och häftig men proffsig. Inställningar för just tavlan. När
någon säljer ska det "poppa upp på tavlan skit snyggt", först över hela tavlan, sedan
mindre, så att man ser vem det är och ordern. Ett eget ögonblick när målet nås. Ljud.
Frågorna hoppades över ("kör bara"), så besluten nedan är mina där inget annat står.

Underlaget är marknadsundersökningen i `~/reports/Bästa säljtavlorna på marknaden.md`
(fem delar: produkterna, firandet, psykologin, TV-designen och tekniken) och datan i
produktionen 2026-10-23.

## 0. Beslut efter den godkända prototypen (2026-10-25)

Beställaren godkände prototypen v5 ("Super snyggt, fantastiskt jobbat",
artifact CZoPErevWPgCQWRRxWurvA, källan `~/saljtavlan-overlamning/forhand/tavla2/mall.html`).
Den är facit för utseende, rörelse och ljud, och de här besluten går före allt
nedan där de säger emot det. Loggboken har samma beslut som R35–R43.

- **R35 Månadsmålet är i ordervärde (kr).** Ett mål per månad, satt av admin i
  inställningarna (`nav_setting.salesboard.mal`, "2026-10" → kronor). En månad utan
  eget mål ärver det senaste målet före (`malFor`). Halvvägs och målet nått räknas på
  ordervärdet. Antal order visas som statistik utan eget mål. Upphäver §2 "inga
  kronmål" och säljmålen (0049) som källa.
- **R36 Ordervärdet visas på TV:n:** i firandet, i flödet och per säljare i
  topplistan. Provision visas aldrig. Inga id, e-postadresser eller telefonnummer, och
  ingen kund (prototypen visar ingen): `company_name` läses inte längre. Brytarna
  `visaKund` och `visaVarde` är borta, eftersom tavlan mäter i ordervärde.
- **R37 Topplistan** (upphäver icke-målet "ingen topplista"): nio rader med #,
  säljare, streck per veckodag mån–fre, i dag, order och ordervärde. Den rangordnas
  efter ordervärde, eller efter antal med inställningen `ordning` eller tangenten V
  (som sparas per skärm). Raderna byter plats med FLIP och en raduppgång visar ↑N.
  Den som är dold står inte i listan men räknas i lagets tal.
- **R38 Ljudet är inspelningar,** inte syntes: tio filer i `public/salesboard/ljud`
  (Mixkit Sound Effects Free License, kassaapparaten från Wikimedia Commons, public
  domain), ett AudioContext per sida som aldrig stängs, normalisering efter topp och
  en kompressor. Ljudmotiven, motivvalet per säljare och kolumnen `motif` försvinner.
  Hornet har spärrtiden 20 s (förr motivet).
- **R39 Skärmen fylls** med `--u = min(100vw/1920, 100vh/1080)` i stället för en
  skalad duk. Under 900 px staplas allt, veckodagarna göms och tavlan är 760 u bred.
- **R40 Stor affär** är som standard ett fast belopp, 40 000 kr. "Auto (topp 10 %)"
  står kvar som val.
- **R41 Serien** (tre eller fler order på en gång) står kvar, i prototypens formspråk:
  mint svep, raderna en i taget med en kassa per rad, summan, lagets mätare och
  krympning in i flödets översta rader.
- **R42 Halvvägs** är inget helskärmsögonblick: målkortet säger "Halvvägs" över
  stapelns mitt i sex sekunder och lämnar ett litet märke. Inget ljud.
- **R43 Det som utgår ur §4–§6:** segmentstapeln, tidslinjen, remsan "Sålt i dag",
  monogrammen i flödet, mintkanten i 60 s (en order som kommer in tyst lyser i stället
  till en gång), statusraden med sekunder och de procedurella ljuden.

Tavlan och kompositionerna (vanlig order, stor affär, utgången, målet, serien) är
bildruta för bildruta prototypens: `motion/tider.ts` har tiderna och ljudspåret,
`motion/kurvor.ts` kurvorna, och `tests/salesboard-tavla.mjs` spikar dem.

## 1. Avsikt

Tavlan ska få laget att känna att det händer saker, och få den som säljer att synas
i det ögonblick det händer. Den ska vara ett instrument, inte en spelautomat: lugn
när inget händer och tydlig på fem meters håll. När en order kommer in ska den
slå ut ordentligt.

Livet kommer ur datan (formspråket): siffror som rullar när de ändras, en tidslinje
som visar dagens rytm och ett takt-streck som flyttar sig. Det kommer aldrig ur
dekor. Det finns inga gradienter, inget glöd, inga emojis och ingen konfetti.

## 2. Mål, icke-mål och antimål

**Mål**
- Visa lagets månad mot målet, med takten och prognosen, så att den syns från andra
  sidan rummet.
- Fira varje ny order med en helskärm som krymper in på sin plats i flödet och visar
  vem som sålt, paketet, kunden och ordervärdet.
- Ha särskilda ögonblick för stor affär, första ordern någonsin, dagens första order,
  personbästa, dagsrekord, halvvägs och målet nått.
- Ha ljud som hör ihop med rörelsen, är syntetiserat i kod (ingen musiklicens) och
  ger varje säljare ett eget motiv.
- Hålla sig själv vid liv på en TV ingen rör: parning med kod, återanslutning,
  synliga varningar när den är offline, omladdning vid ny version och skydd mot
  inbränning.
- Ha en inställningssida för admin, med skärmar, visning, firande, ljud, säljarna och
  ett testläge.
- Visa samma tal som Nav. Månadens antal är `nettoAntal`, målet är summan av
  säljmålen (0049) och arbetsdagarna och takten är `saljtakt.ts`.

**Icke-mål (v1)**
- Ingen topplista och inga placeringssiffror. Det följer utkastets beslut (n:6 "utan
  topplistan", n:102, n:119, n:323, n:366) och psykologidelen av undersökningen.
  Mittenfältet tappar fart, de sista skäms, och laget är litet: 5 aktiva och 6 nya.
  En "pall" (topp tre per dag eller vecka) kan bli ett frivilligt val senare.
- Ingen provision, inga kronmål och ingen aktivitet per person (samtal, status,
  raster). IMY räknar realtidsövervakning av hur arbetet utförs som regel otillåten.
- Ingen koppling till dialerns SOLD (E12 är blockerad). Tavlan läser Navs order.
- Inga foton i v1. `employee_photo` har 0 rader, och monogrammen bär identiteten.
  Foton blir ett frivilligt val per säljare när profilbilderna används.
- Inget läge där tavlan firar redan vid "inskickad". Order läggs i dag oftast in
  direkt som signerade (27 av 29), så godkännandet är händelsen, precis som på
  Golvet.

**Antimål** (sådant som gör tavlan till ett misslyckande även om den fungerar)
- Den känns som övervakning: röda personer, nollor, "efter målet" per namn.
- Den låter för mycket. Ett ljud vid varje litet event gör att någon klagar och att
  ljudet stängs av för gott.
- Den visar fel siffror eller firar en order som sedan försvinner.
- Den står tyst och gammal utan att säga det.
- Den låser Nav 2.0-mergen. Tavlan byggs på en egen gren och rör inga delade filer i
  utkastet.

## 3. Ramar

- Next.js 15 App Router på Vercel Hobby (arn1, två cron-platser, båda tagna, 100
  deployer per dygn). Supabase Postgres (Micro), service role för tavlans läsningar.
- Grenen `salesboard` från `nav2-utkast` (7b8cf98). Lokala stegcommits slås ihop till
  en innan push (CLAUDE.md). Mergen till `nav2-utkast` görs efter beställarens ja,
  och regeln B11 ("inga nya funktioner före Nav 2.0-mergen") respekteras genom att
  inget delat i utkastet rörs.
- CSP: nonce plus `strict-dynamic`, `connect-src` släpper redan in Supabase och
  `wss://`. `style-src` tillåter inline-stilar, och CSSOM-skrivningar påverkas inte.
- Typsnitten är Nav 2.0:s egna (`public/nav2/fonts`): Bricolage Grotesque, Geist och
  Geist Mono, laddade via `next/font/local` som i `logga-in/Skal.tsx`, eftersom
  `/nav2/fonts` kräver inloggning.
- Mellanvaran: `/salesboard` läggs till i `PUBLIC`. Sessionen förnyas fortfarande för
  inloggade, och steg två och lösenordsbyte gäller som förut. Varje rutt under
  `/salesboard` avgör själv vem som släpps in (§9).

### Remotion

Beställaren bad om Remotion. Remotions licens kräver en företagslicens för ett bolag
med fler än tre anställda. Player i en webbapp räknas som "Automators", 100 USD i
månaden som lägst, och Remotion 5 gör telemetri obligatorisk där. Undersökningen
visar också att en React-omritning per bildruta är det tyngsta alternativet på en
svag TV-dator.

**Beslut:** rörelsen skrivs i Remotions modell och med Remotions API-namn
(`useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring`, `Easing`, `Sequence`,
`AbsoluteFill`), men körs av en egen liten motor, `motion/motor.tsx`, utan beroende.
Allt som rör sig är en ren funktion av bildrutan. Köper bolaget licensen byts
importen mot `remotion`, och kompositionerna kan öppnas i Remotion Studio och
renderas till video (till exempel en månadsfilm). Förhandsvisningen kör samma motor
som tavlan.

## 4. Vad tavlan visar

Duken är 1920×1080 och skalas till skärmen med svarta kanter. Det gör att den ser
likadan ut på en 1080p-TV, en 4K-TV och en laptop. Paletten är utkastets mörka hub:
`--hub #0F2A22`, `--hub-2 #153A2F`, `--hub-line`, `--hub-ink #EAF4EE`, `--hub-ink-2`,
`--hub-ink-3`, `--hub-brand #4FD1A5` (mint) och `--hub-signal #F2B24C` (bärnsten).
Färg används bara där den betyder något: mint för det som räknas och för det som är
nytt, bärnsten för stor affär och för det som ligger över målet. "Efter takten" visas
aldrig i rött. Det visas med bärnsten plus text, och fungerar därmed också för den
som är färgblind.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ● LIVE  Säljtavlan · Team Mikro       Fredag 23 oktober · v. 43     14:32:07 🔈 │ statusrad 72 px
├────────────────────────────────────────────────┬──────────────────────────────┤
│ OKTOBER · ARBETSDAG 17 AV 21                     │ SENASTE ORDER                │
│                                                  │ (AH) Amira H.          14:21 │
│ 18  av 29 order                                  │      Paket 2 · 24 mån        │
│ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮│▯▯▯▯▯▯▯▯▯▯▯                    │      Bergs Bygg AB 17 940 kr │
│                 TAKT 23                          │ ───────────────────────────  │
│ 5 efter takten · 2,0 order per dag räcker        │ (EB) Elin B.           11:02 │
│ Prognos 22                                       │ …                            │
│                                                  │                              │
│ I DAG  3 order · 47 820 kr                       │                              │
│ 08 ─(EB)──────(AH)(JK)───│──────────────── 18    │                              │
├────────────────────────────────────────────────┴──────────────────────────────┤
│ SÅLT I DAG  (EB) Elin •   (AH) Amira ••   (JK) Jonas •                          │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Statusraden** ligger fast även under firandet (en "stationär ram"). Den visar en
  levande prick med "LIVE", tavlans namn och laget, datum och vecka, en klocka med
  sekunder i Geist Mono och ljudets läge. Offline står det med bärnsten: "Offline
  sedan 14:21".
- **Månaden** är hjälten:
  - Antalet står i Bricolage, cirka 300 px, med siffror som rullar som en vägmätare
    när de ändras. Bredvid står "av 29 order".
  - Under antalet ligger en segmentstapel med ett segment per order i målet. Är målet
    större än 60 blir det en hel stapel med tioskalor. Segment över målet är
    bärnstensfärgade.
  - Takt-strecket står där laget borde vara i dag (`motMal().forvantat`).
  - Raden under ger läget och vad som räcker per dag (`kravPerDag`), med prognosen
    till höger (`takta`). Prognosen visas inte före arbetsdag tre
    (`MINSTA_DAGAR_FOR_PROGNOS`).
  - Från 90 % står det "2 order kvar", stilla och utan blinkande.
  - När målet är nått står det "Målet nått 21 okt · +2 över".
  - **Utan säljmål** används förra månadens nettoantal som referens, märkt "förra
    månaden". Saknas båda visas bara antalet.
- **I dag** visar antalet och ordervärdet.
  - En tidslinje går över arbetsdagen (inställning, 08–18). Varje order är ett
    monogram på sitt klockslag och staplas om de ligger nära varandra.
  - Ett nu-streck glider fram, och den gångna delen av dagen är en aning ljusare.
  - Före dagens första order står det "Dagens första order firas extra." Det är en
    inbjudan, inte en nolla.
- **Senaste order** är sex rader, med den nyaste överst:
  - Varje rad har monogram, namn, klockslag, paket och bindningstid, kund och
    ordervärde.
  - Äldre dagar får en avdelare ("I går", "Tisdag").
  - Den nyaste raden har en mintfärgad kant i 60 sekunder (ett tillstånd, ingen
    rörelse).
  - En efterregistrerad order märks "efterregistrerad".
- **Sålt i dag** är en remsa med de som sålt i dag:
  - Den är i tidsordning efter dagens första order, med en prick per order.
  - Den som inte sålt syns inte. Det finns inga nollor.
- **Monogram**: en cirkel med initialer, enfärgad (hub-2, en hårlinje och hub-ink).
  Identiteten bärs av initialerna och ljudmotivet, inte av elva färger som ingen kan
  skilja åt.
- **Vila och natt**: utanför arbetsdagen (inställning) dämpas tavlan till 55 %.
- **Inbränning**: hela duken flyttas 0–2 px var fjärde minut.
- **Storlekar** (TV-delen, 55" på 4–6 m): hjälten är 300 px, flödets namn 38 px och
  inget som ska läsas är under 22 px. Siffror har tabulära siffror, och inga tunna
  vikter används.
- **Svenskt format**: "17 940 kr" med hårt mellanrum, "14:21" som i resten av Nav,
  "2,0 order per dag" och "v. 43".

## 5. Firandet

Varje ögonblick är en komposition, en ren funktion av bildrutan vid 60 bilder per
sekund. Kompositionen äger både bilden och ljudspåret (en lista med bildruta och
ljud), så att ljud och rörelse inte kan glida isär. Bildrutan räknas från
ljudklockan (`AudioContext.currentTime`) när ljudet går, annars från
`performance.now()`. En långsam TV tappar alltså bildrutor men spelar aldrig i
slowmotion.

### 5.1 Ordern (det vanliga)

Hela förloppet tar cirka 7,4 s. Panelen täcker allt under statusraden.

| Takt | Tid | Rörelse | Ljud |
|---|---|---|---|
| Samla | 0–1,0 s | Inget syns. Händelser som kommer inom en sekund samlas. | – |
| Täck | 1,0–1,55 s | En mint panel växer ur flödets översta plats till hela ytan, med `clip-path: inset(… round 18px)` och easing (0.05, 0.7, 0.1, 1). Tavlan bakom dämpas till 25 % och skalas till 0,985. Under täckningen byts tavlans tillstånd till det nya, som en stinger. | ett svep uppåt (filtrerat brus) |
| Avslöja | 1,55–2,6 s | "NY ORDER" och klockslaget glider in 12 px. Monogrammet (200 px) kommer med en mjuk fjäder. Namnet lyfts ur en mask ord för ord (Bricolage cirka 200 px, krymps för att passa). En hårlinje ritas, och därefter kommer paket, kund och värde med 120 ms mellanrum. | säljarens motiv på namnet |
| Räkna | 2,6–3,6 s | Värdet rullar upp som en vägmätare (Geist Mono 88 px), med ease-out. | svaga tickar som saktar in |
| Laget | 3,6–4,0 s | "LAGET 18 av 29" visas med en minisegmentstapel där det nya segmentet fylls och studsar 6 %. | en klar ton när segmentet fylls |
| Håll | 4,0–6,0 s | Helt stilla. Texten hinner läsas två gånger. | – |
| Krymp | 6,0–6,75 s | Innehållet tonas bort på 200 ms. Panelen krymper till flödets översta plats och byter färg från mint till hub-2. De gamla raderna har flyttat ner ett steg. | ett svep nedåt, svagare |
| Landa | 6,75–7,4 s | Den riktiga raden tonas in där panelen var. Hjältens antal rullar 17→18, segmentet fylls, och tidslinjen får sitt monogram med en ring som vidgas och tonar bort. | en mjuk duns |

Fjädrarna är mjuka (styvhet 120–200, dämpning 0,85–1,0) och studsar högst 2 % på
stora ytor. Inga linjära rörelser används och inget blinkar. Den enda medvetna
ljusändringen är täckningen, i mint med mellanhög ljushet.

### 5.2 Nivåer och taggar

Varje nivå bygger på samma språk med ett extra lager ovanpå, så att rummet bara
behöver lära sig ett ordförråd.

| Fall | Villkor | Skillnad |
|---|---|---|
| Stor affär | ordervärdet ≥ tröskeln. "Auto" är 90:e percentilen av de senaste 90 dagarnas godkända ordervärden, när det finns minst 20, annars 30 000 kr. Ett fast belopp kan väljas. | bärnstensfärgad panel, "STOR AFFÄR", värdet 140 px, hållet 1,5 s längre, ljudet får ett mässingslager |
| Första ordern | säljarens första godkända order någonsin | "FÖRSTA ORDERN", raden "Välkommen till tavlan, Amira.", en fanfar i stället för motivet, hållet 1 s längre |
| Dagens första | lagets första godkända order i dag | taggen "DAGENS FÖRSTA" |
| Personbästa | säljarens antal i dag > hens bästa tidigare dag och ≥ 2 | taggen "PERSONBÄSTA · 3 I DAG" och ett glittrande lager på motivet |
| Dagsrekord | lagets antal i dag > månadens bästa tidigare dag och ≥ 3, en gång per dag | taggen "DAGSREKORD · 6 (FÖRRA 5)" och glitterlagret |

Taggar visas som konturpiller till höger om "NY ORDER". Är flera sanna visas de i
ordningen dagsrekord, personbästa, dagens första, och högst två åt gången.

### 5.3 Flera order samtidigt

Om två order kommer inom samlingsfönstret spelas båda som 5.1, en i taget. Är
de tre eller fler blir det en **serie**:

1. Panelen täcker skärmen.
2. Raderna byggs upp en i taget med 0,9 s mellanrum, med monogram, namn, paket och
   värde. Varje rad får en kort variant av motivet.
3. Efter raderna kommer summeringen, till exempel "3 nya order på 2 minuter".
4. Panelen krymper in i flödet.

Är kön längre än åtta visas de åtta första och "+N till". En säljare står aldrig i
kö i mer än cirka 20 sekunder.

### 5.4 Halvvägs och målet nått

- **Halvvägs**: när antalet passerar halva målet.
  - Det är inget helskärmsögonblick. En våg av ljus går genom segmenten upp till
    hälften.
  - En etikett, "HALVVÄGS", står över 50 % i 6 s och lämnar sedan ett litet ½-märke.
  - Ljudet är två toner.
- **Målet nått**: när antalet passerar målet. Det spelas en gång per månad och skärm.
  1. Först spelar ordern som tog laget över gränsen sin vanliga 5.1, så att
     säljaren får sitt ögonblick.
  2. I stället för flödet krymper panelen in i hjältens stapel. Det sista segmentet
     fylls.
  3. Stapeln blir den delade formen och växer till hela ytan.
  4. Segmenten fylls i en våg från vänster med en stigande ton per segment, så att
     datan bokstavligen spelar melodin.
  5. "Målet nått." visas i Bricolage cirka 240 px, med raden "Oktober · 29 order ·
     4 arbetsdagar kvar · 14:21".
  6. Alla som bidragit i månaden visas i tidsordning efter sin första order, utan
     antal. Den som tog laget över gränsen är markerad.
  7. Hållet är 7 s, och sedan krymper allt tillbaka in i stapeln.
  8. Stapeln står kvar som klar (bock och datum) resten av månaden.

  Ljudet är en hjältesignal på cirka 6 s (klockor, en matta och ett bas-ackord) som
  bara spelas här. Hela förloppet tar cirka 14 s.

### 5.5 Regler

- Bara godkända order (signerad eller betald) firas. Makulerade, ändrade och
  raderade order tas bort i tysthet och dras av. Tavlan tar aldrig något tillbaka
  med en animation.
- **Efterregistrerad**: en order som signerades mer än *N* dagar (inställning,
  standard 2) före godkännandet räknas men firas inte. Datan visar att order ofta
  läggs in en vecka i efterhand, och tavlan ska inte fira i klump när någon tar
  igen pappersarbetet. (SalesScreen gör samma sak.)
- **Färskhet**: en order som godkändes för mer än 10 minuter sedan när tavlan såg
  den, till exempel efter ett avbrott, läggs in tyst med mintkant. Den firas inte i
  efterhand.
- **Vid start** räknas allt som redan finns som sett. Ingenting firas. Seriens och
  målets "redan firat" sparas i `localStorage` (inom try/catch) per månad.
- **Ljudets spärrtid**: motivet spelas högst en gång per 20 s. Inom spärren spelas
  bara en kort tick, och bilden spelas ändå.
- **Testhändelser** från inställningarna spelas på alla skärmar med märket "TEST" i
  hörnet. De har påhittad data och räknas aldrig.
- **Lugn rörelse** gäller vid `prefers-reduced-motion` eller inställningen "Lugn":
  - Panelen tonas in och ut på 250 ms i stället för att växa och krympa.
  - Det finns ingen mask, ingen räkning och ingen våg.
  - Hållet och ljudet är desamma, och raden markeras med färg.

## 6. Ljudet

Ljudet är Web Audio, syntetiserat i kod. Det behövs inga filer och ingen
STIM- eller SAMI-repertoar.

- **Kedjan**: källa → nivåns gain → master-gain (volymen) → en mjuk kompressor →
  högtalaren. Topparna hålls under −1 dBFS. Nivåerna ligger fast i koden:
  vanlig order −6 dB, stor affär −3 dB och målet 0 dB.
- **Klangen** är en FM-klocka (bärare plus modulator 3,5:1 och ett avtagande
  modulationsindex) med en mjuk sinus en oktav under, alltså glas och metall,
  inte jingel.
- **Motiv**: tolv kurerade fyrtonsfraser i C-dur-pentatonik. Varje säljare får ett
  stabilt motiv: en hash av id:t, eller ett val i inställningarna. Rummet lär sig
  vems ljud det är.
- **Ljuden**:
  - svep upp och svep ner: brus genom bandpass, 400→2400 Hz
  - tick: 5 ms filtrerat brus
  - lagets ton: E6
  - duns: sinus 110→55 Hz på 120 ms
  - mässing: två detunade sågtandsvågor genom lågpass 300→2000 Hz i dur
  - glitter: ett snabbt arpeggio högt upp
  - fanfar: C–E–G–C'–E' och ett ackord
  - hjältesignalen: målet
  - halvvägs: två toner
- **Tyst läge**:
  - Ljudet spelas bara inom ljudtiden (inställning, vardagar 08:00–18:00).
  - Ljudet kan stängas av helt, och volymen kan sättas från 0 till 100.
  - Allt gäller direkt på alla skärmar via ringklockan (§8).
- **En skärm låter**: varje skärm har "Spela ljud" (inställning per skärm), så att
  två TV-apparater i samma rum inte ekar.
- **Upplåsning**: blockerar webbläsaren ljudet visas "Starta tavlan" stort i mitten.
  Ett klick räcker, och det finns också "Fortsätt utan ljud". I statusraden visas
  "Ljud blockerat" med en överstruken högtalare. I kioskläge med
  `--autoplay-policy=no-user-gesture-required` syns inget av detta.

## 7. Inställningar (`/salesboard/installningar`, admin och superadmin)

Säljare får 403 med en rad om vem som får ändra. Den som inte är inloggad skickas
till `/logga-in?nasta=…`. Sidan har Nav 2.0:s ljusa form (följer
`prefers-color-scheme`) och är en kolumn med kort.

1. **Skärmar**:
   - **Para ny skärm** (skriv koden från TV:n och ge skärmen ett namn).
   - En lista med namn, senast sedd ("för 12 s sedan", grön prick under 2 min) och
     webbläsare.
   - Ett val per skärm: "Spela ljud på den här skärmen".
   - **Byt namn** och **Koppla bort**.
   - Hjälpen "Sätta upp en TV":
     - Dator: en mini-PC eller Raspberry Pi 5 med Chromium i kioskläge, med
       flaggorna.
     - Undvik TV:ns egen webbläsare om det ska låta.
     - Adressen: clicknet-nav.vercel.app/salesboard.
2. **Visning**:
   - Laget: alla eller ett lag.
   - Namn: "Förnamn", "Förnamn E." (standard) eller "Förnamn Efternamn".
   - Visa kundens namn (på) och visa ordervärdet (på).
   - Arbetsdagen för tidslinjen och vilan (08:00–18:00).
   - Rörelse: full eller lugn.
3. **Firande**:
   - Stor affär: "Auto (topp 10 %)" eller ett fast belopp. Tröskeln som gäller just nu
     står bredvid.
   - Brytare för första ordern, dagens första, personbästa, dagsrekord, halvvägs och
     målet nått.
   - Efterregistrerad efter N dagar.
4. **Ljud**:
   - På eller av, och volymen.
   - Ljudtid från–till och tyst på helger.
   - "Lyssna" på den egna datorn.
5. **Säljarna**: aktiva säljare i laget, för var och en:
   - Visning: "Namn", "Initialer" eller "Dold". Dold visas som "En säljare" med ett
     neutralt monogram.
   - Ljudmotiv: Auto eller 1–12, med en lyssna-knapp.

   En rad förklarar att valet görs på säljarens begäran.
6. **Testa tavlan**:
   - Knappar för "Ny order", "Stor affär", "Första ordern", "Tre order" och "Målet
     nått". De skickar en testhändelse till alla skärmar.
   - "Öppna tavlan" öppnar `/salesboard` i en ny flik.

Varje ändring sparas direkt (ingen spara-knapp att glömma), med en kvittens. Den
skrivs till händelseloggen (`salesboard.*`, modulen "Säljtavlan" i `MODUL`).

## 8. Data och realtid

**Inställningarna** ligger i `nav_setting`, nyckeln `salesboard` (jsonb, version 1).
Den läses av alla inloggade, men den innehåller inga hemligheter. Den skrivs med
service role. Den tolkas av en ren funktion, `normalisera()`, som fyller i standarder
och klipper bort okända fält.

**Migration `0250_saljtavlan.sql`** (spannet 0250–0254 registreras i PARALLELLT.md).
Alla tabeller har RLS påslaget och inga policyer, så bara service role når dem.
- `salesboard_screen`:
  - id, name, token_hash (unik, sha256 i hex), sound, created_by, created_at och
    claimed_at
  - last_seen_at, last_ip och user_agent
  - revoked_at och revoked_by
- `salesboard_pairing`: code_hash (pk), nonce_hash (unik), created_at, expires_at
  och screen_id (sätts vid godkännandet), samt ip och user_agent.
- `salesboard_person`:
  - employee_id (pk, raderas med den anställda)
  - display ('namn' | 'initialer' | 'dold') och motif (0–11 eller null)
  - updated_by och updated_at
- `salesboard_event`: id (identity), kind ('test'), payload, created_by och
  created_at. Rader äldre än ett dygn städas vid nästa insättning.
- **Ringklockan**:
  - Funktionen `salesboard_ringklocka()` är SECURITY DEFINER med
    `search_path = ''`.
  - Den skickar `realtime.send('{}', 'ping', 'salesboard', false)` inuti ett eget
    begin/exception, som `crm_order_till_utkorg`. Den kan aldrig fälla en order.
  - Triggers per sats: `sales_order` (insert, update eller delete),
    `salesboard_event`, `salesboard_person` och `salesboard_screen`.
  - `nav_setting` får en radtrigger med `when (new.key = 'salesboard')`.
  - Signalen bär ingen data. En fejkad signal ger bara en extra hämtning.

**Ögonblicksbilden** `GET /salesboard/data` byggs av `byggTavlan()` (server-only,
service role). Den följer Golvets definitioner: samma lag, `nettoAntal`, säljmålen
och `harGodkants`.
- Den är display-säker: inga employee-id (personer och order får stabila,
  hashade nycklar), ingen provision och inga kontaktuppgifter.
- Kunden och värdet följer inställningarna.
- Innehållet:
  - servertiden och bygget (commit-sha)
  - lagets namn och inställningarna för visning
  - månaden: antal, mål och dess källa, förväntat, läge, krav per dag, prognos,
    arbetsdagar och bidragsgivare
  - dagen: datum, antal, summa och bästa tidigare dag i månaden
  - order: alla i dag och de åtta senaste, med person, klockslag, vad, kund, belopp
    och nivå, samt flaggorna efterregistrerad och första någonsin, säljarens antal i
    dag och säljarens bästa tidigare dag
  - personer: visningsnamn, initialer och motiv
  - testhändelser från de senaste tio minuterna
- Svaret har `Cache-Control: private, no-store` och en ETag (304 när inget ändrats).
- En processcache på 2 s per instans samlar ihop många skärmar som ringer samtidigt.

**Klienten** (`kalla.ts`):
- Den prenumererar på den publika broadcast-kanalen `salesboard` med supabase-js och
  anonnyckeln, utan auth-session.
- Vid en signal hämtar den ögonblicksbilden. Hämtningarna slås ihop, så att det blir
  högst en per 1,5 s.
- När kanalen är uppe hämtar den ändå var 60:e sekund. När kanalen är nere hämtar
  den var 8:e sekund under arbetsdagen och var 60:e annars.
- Vid varje svar räknas en klockförskjutning ut mot servertiden. Klockan, "i dag" och
  färskheten räknas på servertid.
- Utan lyckad hämtning på 2 minuter står det offline. Fyra misslyckanden i rad ger
  en omladdning, men inte under ett firande.
- Ett nytt bygge ger en omladdning vid nästa lugna stund. Det gäller bara om ljudet
  startade utan klick eller om det är utanför arbetsdagen; annars väntar
  omladdningen till 04:00. Varje natt kl. 04:00 laddas tavlan om.
- Wake Lock begärs och tas tillbaka när fliken blir synlig igen.
- Helskärm finns på F eller med en knapp som döljs efter tre sekunder utan mus.

**Skillnaden mellan två ögonblicksbilder** (ren funktion i `regler.ts`, provad)
avgör vad som firas:
- nya order-nycklar som inte är efterregistrerade eller för gamla
- målet, halvvägs och dagsrekordet, när de passeras
- nya testhändelser

Resultatet är en kö av kompositioner. Kön har samlingsfönstret, serien från tre
order och spärrtiden för ljudet.

## 9. Skärmar och åtkomst

**Vem får se tavlan**:
- En inloggad anställd (alla roller, "alla ser alla").
- En parad skärm med kakan `nav_tavla`, som innehåller en token på 32 slumpbyte i
  base64url. Den är HttpOnly, Secure, SameSite=Lax, gäller för `/salesboard` och
  lever i 400 dagar. Den förnyas en gång per dygn.
- Ingen annan. `/salesboard` visar då parningen.

**Parningen** (som RFC 8628):
1. TV:n gör `POST /salesboard/par` och får en kod på åtta tecken ("K7M4-QX9P").
   Alfabetet har 32 tecken, utan I, O, 0 och 1, vilket ger 40 bitar. Kakan
   `nav_tavla_par` får en nonce på 32 byte. Koden gäller i 10 minuter, och högst 50
   aktiva koder får finnas (5 per IP). De som gått ut städas bort.
2. En admin skriver koden i inställningarna och ger skärmen ett namn. Då skapas
   skärmraden, och parningsraden pekar på den.
3. TV:n frågar var tredje sekund med `GET /salesboard/par`, med sin nonce. När raden
   är godkänd skapas token, hashen sparas, kakan `nav_tavla` sätts, parningsraden tas
   bort och TV:n laddar om till tavlan. Koden går aldrig att lösa in utan TV:ns nonce.
4. **Koppla bort** sätter `revoked_at` och ringer på klockan. TV:ns nästa hämtning får
   401 och visar parningen igen.

`tavlansAtkomst()` (server-only) avgör åtkomsten för varje rutt:
- Skärmkakan räknas till en hash och slås upp på en rad som inte är bortkopplad.
- `last_seen_at`, IP och webbläsare uppdateras högst en gång per minut.
- Annars gäller `getCurrentUser()` med en aktiv anställd. Annars ges ingen åtkomst.

Skrivningar (`POST /salesboard/skriv`, `{handling}`):
- De kräver `getCurrentUser`, nivån admin eller superadmin (`nivaFor`) och
  `sammaUrsprung`.
- De går via `medNyckel`, så att ett dubbelklick blir en skrivning.
- Handlingarna:
  - `spara` (delar av inställningarna)
  - `para`, `byt_namn`, `ljud_skarm` och `koppla_bort`
  - `person` (visning och motiv)
  - `testa` (typ)

## 10. Filer

```
supabase/migrations/0250_saljtavlan.sql
src/lib/salesboard/installningar.ts   ren: typ, standarder, normalisera, klipp
src/lib/salesboard/regler.ts          ren: namn, nivåer, P90, tysta tider, efterregistrerad, skillnad → kö
src/lib/salesboard/parning.ts         ren: kod, normalisering, format, token, sha256
src/lib/salesboard/typer.ts           ögonblicksbildens typer (klient + server)
src/lib/salesboard/tavlan.ts          server-only: byggTavlan()
src/lib/salesboard/atkomst.ts         server-only: tavlansAtkomst(), kakor, skärmar
src/app/salesboard/layout.tsx         typsnitten, ingen Nav-ram
src/app/salesboard/page.tsx           åtkomst → Tavla eller Parning
src/app/salesboard/Tavla.tsx          klient: tavlan
src/app/salesboard/Parning.tsx        klient: koden
src/app/salesboard/kalla.ts           klient: hämtning, ringklocka, klocka, version
src/app/salesboard/ljud.ts            klient: ljudmotorn
src/app/salesboard/tavla.css
src/app/salesboard/motion/motor.tsx   motorn (Remotion-API:t)
src/app/salesboard/motion/Ordern.tsx  5.1 + 5.2
src/app/salesboard/motion/Serie.tsx   5.3
src/app/salesboard/motion/Malet.tsx   5.4
src/app/salesboard/motion/delar.tsx   monogram, vägmätare, maskat namn, segment
src/app/salesboard/data/route.ts
src/app/salesboard/par/route.ts
src/app/salesboard/skriv/route.ts
src/app/salesboard/installningar/page.tsx
src/app/salesboard/installningar/Installningar.tsx
src/app/salesboard/installningar/installningar.css
tests/salesboard.mjs                  regler, installningar, parning
tests/salesboard-motor.mjs            interpolate, spring, Easing, Sequence
```

Ändrade: `src/lib/supabase/middleware.ts` (PUBLIC), `src/lib/handelselogg.ts` (MODUL),
`package.json` (proven in i `test`), `src/navnyheter/poster.ts`, `docs/NASTA_SESSION.md`,
`docs/ARBETSLOGG.md`, `~/nav2-utkast/PARALLELLT.md` (spannet).

## 11. Prov och verifiering

- **Rena prov** (`node --experimental-strip-types`, `TZ=UTC`):
  - namnformat och initialer
  - nivåer och P90 med få värden
  - efterregistrerad
  - tyst tid över midnatt och helg
  - skillnaden mellan ögonblicksbilder: start, ny order, flera, makulering, målet,
    halvvägs, dagsrekord, personbästa, test och månadsskifte
  - kön: samlingsfönstret, serien och spärrtiden
  - inställningarnas normalisering: skräp, saknade fält och gränser
  - parningskoderna
  - motorns matematik: gränser, extrapolering, fjäderns sluttillstånd och
    `durationInFrames`, och Sequence-förskjutning
- **Databasen** efter migrationen:
  - Objekten finns, och vakten `tests/rattigheter-db.mjs` är grön.
  - `update public.sales_order set status = status where false` ger en signal på
    kanalen, eftersom triggern per sats går även utan rader. Det ändrar ingen data
    och provas med en node-prenumerant.
- **Bygget**: `tsparse.mjs` och `node --check` lokalt. Vercels bygge på grenen är
  domaren.
- **Förhandsvisning**:
  - en artifact med påhittad data
  - samma motor och samma ljud
  - en regipanel som avfyrar varje ögonblick

## 12. Kvar till senare

- Pallen (topp tre) som frivilligt val.
- Foton per säljare (opt-in).
- Fira vid "inskickad", när säljarna själva lägger order i Nav 2.0.
- Dialerns SOLD som källa (E12).
- Svitar (dagar i rad).
- Säsongsvarianter av ljud och rörelse var 4–6 vecka mot nyhetens avtagande.
- En månadsfilm renderad med Remotion (kräver licens).
- En länk till tavlan i Nav 2.0:s meny och palett, efter mergen.
- Intresseavvägningen och informationen till personalen (IMY, MBL §11 om
  kollektivavtal finns) innan tavlan sätts på. Det är bolagets beslut, inte kodens.
