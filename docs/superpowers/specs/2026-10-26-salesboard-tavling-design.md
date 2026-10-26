# Säljtavlan: månadens tävling — design

2026-10-26. Grenen `salesboard` i ClicknetIntran-t. Bygger på säljtavlan (spec
`2026-10-23-salesboard-design.md`, prototyp v5) och på flytten av inställningarna till
Nav 2.0 (`~/saljtavlan-overlamning/PROMPT-installningar.md`).

## Varför

Säljtävlingar har fungerat när ledningen har motiverat mot dem hela månaden. Nu ska
tavlan göra det jobbet: visa priset, visa loppet och knuffa den som är nära. Tavlan ska
inte bara visa ställningen i slutet.

Designen bygger på tre fynd ur forskningen. Varje fynd styr ett beslut:

1. **Målgradienten** (Kivetz, Urminsky & Zheng 2006). Insatsen ökar ju närmare
   belöningen *känns*.
   → Avstånd sägs i order ("en order bakom"), inte i kronor.
2. **Rivalitet är starkast nära toppen och mellan grannar** (Garcia, Tor & Gonzalez).
   → Tvåan ställs mot ettan. Hela listan ställs aldrig mot alla.
3. **Rankning kan slå fel** (Barankay, fältexperiment med 1 754 säljare). De som ligger
   långt efter ger upp och ledarna slår sig till ro. Rankning fungerar bäst med ett pris.
   → Tävlingen visar bara dem som kan vinna. Ledaren ser vem som flåsar i nacken.

## Mål

- Superadmin lägger upp månadens tävling i Nav 2.0: pris, bild och kvalgräns.
- Tavlan visar tävlingen som ett **mellanspel** var tionde minut.
- Tavlan spelar en **knuff** direkt efter ordern som tar någon inom en order från ledningen.
- Tavlan spelar en **gränsscen** direkt efter ordern som tar någon över kvalgränsen.

## Inte mål

- Lagtävlingar och flera vinnare.
- Andra mått än ordervärde.
- Tävlingar som är kortare eller längre än en kalendermånad.

## Anti-mål: misslyckat även om det fungerar

- Någon som ligger långt efter, eller sist, visas i tävlingen.
- En dold säljare syns eller räknas.
- Samma knuff spelas om och om igen, så att den blir tjat.
- Dekor som inte bär information: konfetti, glöd, emojis, gradienter som pynt.
- Mellanspelet avbryter ett firande eller lyser upp ett tomt kontor.

## Reglerna (beställarens)

- **Tävlingen och vinnaren.** Tävlingen pågår en kalendermånad. En enskild säljare vinner: den med **högst
  ordervärde** i månaden.
- **Kvalgränsen.** Den som vinner måste ha nått **kvalgränsen**, ett minsta ordervärde. Når ingen
  gränsen vinner ingen.
- **Dolda säljare.** En säljare som valt att döljas på tavlan är **inte med** i tävlingen, varken i
  loppet, i knuffen eller som vinnare.
- **Visning.**
  - Mellanspelet visas **var tionde minut**.
  - Knuffen spelas **direkt efter** ordern som tog någon inom en order från ledningen.
  - Gränsscenen spelas **direkt efter** ordern som tog någon över gränsen.

## Inställningarna

Inställningarna ligger i Nav 2.0 → Inställningar → Säljtavlan. Bara superadmin ser och ändrar
dem, och samma behörighet gäller i varje skrivväg på servern (se PROMPT-installningar.md).

Ett nytt kort, **Tävling**, med en rad per månad (den här och nästa, som Månadsmål):

| Fält | Regel |
|---|---|
| På | Brytare. Av betyder att tavlan inte visar något om tävlingen. |
| Pris | Text, högst 60 tecken, till exempel "Spa för två". Krävs för På. |
| Bild | En uppladdad bild, JPEG, PNG eller WebP, högst 5 MB. Visas beskuren (`object-fit: cover`) i ett porträttformat runt 4:5. Kortet visar en förhandsvisning i just det formatet. Utan bild visas mellanspelet utan bildytan. |
| Kvalgräns | Belopp i kronor, samma fält som målet (`Belopp`). Tomt betyder ingen gräns. |

**Ärvs inte.** En månad utan egen tävling har ingen tävling, eftersom priset byts.
*Det är mitt val.*

**Lagringen.**
- Nyckeln `tavling` läggs i `nav_setting.salesboard`, som `{"YYYY-MM": {pa, pris, bild, grans}}`.
- Värdena läses och normaliseras som resten i `installningar.ts`: en läsare som aldrig kastar,
  gränser och en provsvit.
- `bild` är en nyckel till filen, aldrig en extern adress.

**Bilden** lagras där repot redan lagrar filer: R2 när den finns, annars Supabase (se `csp.ts`).
- Tavlan, också en parad skärm utan inloggning, hämtar den genom en egen rutt under `/salesboard`.
  Rutten ger samma åtkomst som tavlans data.
- En gammal bild tas bort när den byts.

**Testkortet** får tre nya provhändelser: Mellanspelet, Knuffen och Gränsen.

## Ögonblicksbilden

`Ogonblick` får fältet `tavling: { pris, bild (adress via tavlans rutt), grans | null,
dagarKvar } | null`. Fältet är null när månaden inte har någon påslagen tävling.

**Loppet** räknas på tavlans egna rader (`saljare`), utan dolda säljare och med samma
ordervärde som topplistan. Det räknas på klienten ur `Siffror`, så att det följer landningar
och kön exakt som topplistan.

**Snittordern** är lagets snitt i månaden (`snitt` i `vy.ts`). En "order" i texterna betyder
avståndet delat med snittordern, avrundat uppåt.

## Scenerna

Alla tre är kompositioner i tavlans befintliga bildrutemotor (`motion/`, 60 fps), i samma
formspråk som Ordern och Målet. Rörelsen drivs helt av bildrutan, utan CSS-övergångar, som i
Remotion: `useCurrentFrame` i minsta möjliga komponent, och `scale` och `translate` i stället för
`transform`.

Rörelsepersonligheten är tavlans: bestämd, utan studs i texten. Fjädern används bara där
Ordern redan använder den.

`rorelse: "lugn"` och `prefers-reduced-motion` ger den stillastående bilden med en toning, som
i de andra scenerna.

### 1. Mellanspelet "Tävlingen" (cirka 12 s)

**Bild.**
- Prisbilden fyller vänstra 44 % i full höjd.
- Till höger står etiketten "● MÅNADENS TÄVLING · 5 ARBETSDAGAR KVAR" i bärnsten och monospace.
- Under den står priset som rubrik, "Spa för två.", och raden "Högst ordervärde vinner,
  från 120 000 kr" (utan gräns: "Högst ordervärde i oktober vinner.").
- Sist kommer loppet.

**Loppet.**
- Ledaren och de som är **inom räckhåll** visas, högst två till. Inom räckhåll betyder högst tre
  snittorder bakom ledaren.
- Staplarna är skalade mot ledarens värde. Ledaren är bärnsten och de andra mint.
- Texterna till höger är "leder", "en order bakom" och "två order bakom".
- Med gräns finns en streckad linje vid gränsen. Har ledaren inte nått gränsen står det
  "leder · 1 order till gränsen".
- Är ingen inom räckhåll står bara ledaren, med "leder med 3 order".
- Har ingen sålt något i månaden visas inte mellanspelet.

**Rörelse.**
- Samma svep in som Ordern.
- Bilden glider från skala 1,06 till 1,0 över hela scenen, som långsam bakgrundsrörelse.
- Etiketten och rubriken stiger fram.
- Staplarna växer en i taget, med cirka 130 ms mellan dem och under 500 ms totalt. Kronorna
  och orderorden tonar in när stapeln landat.
- Ut sluter sig ytan tillbaka över tavlan.

**Tyst.** Ett ljud var tionde minut vore tjat.

**När.**
- Var tionde minut, räknat från förra mellanspelet.
- Bara inom arbetsdagen (`inomArbetsdag`), bara när en tävling är på, och aldrig medan ett
  firande spelas eller köar. Då skjuts det upp tills tavlan är lugn.
- Har en knuff eller gränsscen spelats de senaste två minuterna väntar mellanspelet till
  nästa tiominutersslag.
- *Mitt val:* sista arbetsveckan var femte minut, och sista arbetsdagen står det
  "AVGÖRS I DAG" i etiketten.

### 2. Knuffen (cirka 5,5 s)

**Bild.**
- En mint linje överst.
- Etiketten "● TÄVLINGEN · 14:32".
- Säljarens namn stort.
- Sedan "är **en order** från spa för två." Har säljaren inte nått gränsen står det i stället
  "från ledningen".
- En liten prisbild och raden "Anna Lindqvist leder med 8 200 kr. 5 arbetsdagar kvar."

**När.**
- Direkt efter ordern där säljaren, som inte leder, gick från mer än en snittorder bakom
  ledaren till högst en.
- Samma säljare knuffas högst en gång per dag. Det sparas i tavlans minne (`Minne`, per dag),
  som de andra firandena.
- Tar ordern säljaren förbi ledaren spelas ingen knuff. Säljaren leder då, och Ordern säger
  redan "Leder".
- *Mitt val:* en egen scen "Ny ledare i tävlingen" läggs inte till. Ordern säger redan det.

**Ljud.** Ett kort, lätt ljud ur de tio befintliga inspelningarna, svagare än Ordern.
*Byggarens val* av fil och styrka.

### 3. Gränsscenen (cirka 5,5 s)

**Bild.**
- Som knuffen, men med en bärnstensfärgad linje.
- "**Anna Lindqvist** är över gränsen. **Med och tävlar** om spa för två."
- Raden "121 300 kr i oktober · leder · 5 arbetsdagar kvar". Om säljaren inte leder står
  platsen i stället: "2:a".

**När.**
- Direkt efter ordern som tog säljaren från under gränsen till gränsen eller över.
- En gång per säljare och månad, sparat i minnet.
- Bara när tävlingen har en gräns.

**Ljud.** Som knuffen, ett snäpp starkare. *Byggarens val.*

### Ordningen i kön

Kön går **ordern, gränsen, knuffen, målet**. Kommer flera i samma bild gäller
följande:
- En serie följs av gränsscenen och knuffen för dem i serien.
- Gränsscenen och knuffen gäller högst en säljare var per bild: den vars order kom sist.

Planeringen följer de befintliga reglerna i `regler.ts`. Det som passerats är firat. Vid
start, ny månad eller ett minne som inte går att läsa räknas allt som sett. En
efterregistrerad order knuffar inte.

## Slutet av månaden

*Mitt val, bekräftas av beställaren:* första arbetsdagen i nästa månad spelas vinnaren upp
en gång, när arbetsdagen börjar, i samma formspråk som Målet:
- med vinnare: "Anna Lindqvist vann spa för två." och "182 400 kr i oktober."
- utan vinnare: "Ingen nådde gränsen i oktober."

## Lika

- Är två lika i ledningen står båda som "delar ledningen".
- Vid lika i slutet delar de priset i texten.

*Mitt val.*

## Det som lämnas åt byggaren

- **Bildrutornas exakta tider**, inom ramarna ovan, i `tider.ts` med prov som de befintliga.
- **Ljudfiler och styrkor**, ur de befintliga tio.
- **Hur prisbilden förladdas.** Mellanspelet startar inte förrän bilden är laddad och avkodad
  (`img.decode()`), annars visas det utan bildytan.
- **Rutten för bilden** och dess cachning.
- **Filnamn och komponentstruktur.**

## Beroenden och ordning

1. Inställningarna flyttas till Nav 2.0, bara superadmin (PROMPT-installningar.md). Det görs
   först eller i samma pass.
2. Migration 0250 behövs inte för tävlingen i sig. Allt ligger i `nav_setting` och i fillagringen.
   Testkortet kräver dock 0250, som i dag.

## Verifiering

- Rena prov för:
  - loppet: räckhåll, order bakom, gränsen, dolda och lika
  - när knuffen och gränsscenen planeras: korsningen, en gång per dag eller månad, efterregistrerad
  - när mellanspelet visas: arbetsdag, kö, vila, sista veckan
  - läsaren för inställningarna
- Selen i `~/sb-sele` får fallen `tavling`, `knuff` och `grans`, och knappen "Spela igen".
- Varje scen ses på skärm innan något sägs vara klart.
