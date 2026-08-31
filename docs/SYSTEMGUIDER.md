# Systemguider — interaktiv onboarding i navet

Beslutat 2026-08-31. Det här dokumentet är beställningen: vad som ska byggas och
varför just så. Bygget självt sker i etapper enligt sista avsnittet.

## Vad det handlar om

Ingen ska behöva läsa en kurs om hur navet fungerar. Man ska gå in på
**Utbildning → Systemguider**, starta en guide, och lära sig genom att göra
momentet i det riktiga gränssnittet medan förklaringarna pekar ut var man är.

Guiderna är **färdiga när systemet levereras** — de skrivs av den som bygger
navet, inte av beställaren. Det är hela poängen: den som ändrar en knapp är
också den som ändrar guiden som pekar på knappen.

---

## Besluten

### 1. Turen kräver handling — det finns ingen Nästa-knapp

Overlay på den riktiga sidan, nedtonad, med ett hål över det element steget
handlar om. Bubblan förklarar vad elementet är och vad som ska göras. Turen går
vidare **när användaren gjort det**, inte när hen klickat vidare.

*Varför:* en tur man klickar igenom med Nästa lär ut var saker ligger, ungefär
som en bildvisning. En tur som kräver rätt klick lär ut hur man gör. Skillnaden
märks första gången personen ska göra momentet ensam.

Det finns en **Avbryt**, aldrig en **Hoppa över**. Avbruten tur återupptas på
samma steg.

### 2. Övningsläge — det som skapas i en guide är inte på riktigt

Guider som skapar något (order, avtal, ärende, stämpling) kör mot det riktiga
navet, men raden märks som övning:

```sql
alter table order add column ovning boolean not null default false;
```

Övningsrader:

- syns bara för den som skapade dem,
- filtreras bort ur listor, statistik, provisionsunderlag och nattjobb,
- städas av nattjobbet när guiden är klar, eller senast efter sju dagar.

*Varför inte bara läsa:* då har man inte gjort momentet när man är klar, och
beslut 1 faller. *Varför inte riktig data:* en övningsorder som når leverans och
provisionsunderlaget är ett städjobb för hand och en felkälla i lönen.

**Regeln är enkelriktad och måste hålla i varje fråga:** varje ställe som räknar
eller listar måste fråga efter `ovning = false`. Ett prov ska läsa källkoden och
larma om en tabell med övningsflagga läses någonstans utan filtret — samma grepp
som `test:stampelfri` använder.

### 3. Obligatoriskt via funktionsspärr, inte via låst nav

Navet är öppet. En modul låser sitt **görande** tills modulens guide är klar:
`/order` går att öppna och listan syns, men `[Ny order]` är låst med en ruta som
förklarar varför och startar guiden.

Kroken finns redan: `course.blocks_capability`.

```
course.blocks_capability = 'order.skapa'
```

Undantaget är **startguiden**, som måste göras direkt vid första inloggningen —
det finns ingenting att låsa upp den med.

*Varför inte låst nav:* en ny säljare måste kunna stämpla in dag ett, även om
hen inte hunnit gå igenom ordermodulen.

**En trasig guide låser aldrig ute någon.** Saknas ett ankare markeras guiden
som trasig, larmet går till `/fel`, och spärren släpper. Se punkt 9.

### 4. Guiderna lagras som kurser och speglas i checklistan

Ny modultyp vid sidan av `reading | quiz | roleplay`:

```sql
alter table course_module drop constraint course_module_kind_check;
alter table course_module add constraint course_module_kind_check
  check (kind in ('reading','quiz','roleplay','guidad_tur'));
```

Därmed ärvs allt som redan finns: progress, försök, certifikat, frister,
giltighetstid, målgrupp per roll, och chefsöversikten.

Anställningschecklistan i `src/lib/onboarding.ts` får ett eget avsnitt som
**speglar** kursläget:

```
Checklista, Anna K.                    4 av 14
  ✓ Konto i navet skapat
  ✓ Rutiner tilldelade
  ── Systemguider ────────────────────────
  ✓ Kom igång i navet          klar 2/9
  ▸ Registrera en order        3 av 8  [Öppna]
  · Rapportera frånvaro        ej påbörjad
  ────────────────────────────────────
  · Dator utlämnad
  · Passerkort utlämnat
```

Guiderader **går inte att bocka av för hand.** De följer kursen. En chef ska
inte kunna kryssa bort en guide någon inte gjort — då är spärren i punkt 3
meningslös.

Användaren har dessutom en egen ingång, **Utbildning → Systemguider**, där hen
ser sina guider, vad som är låst, och kan göra om en guide frivilligt.

### 5. Startguiden först, resten i fri ordning

Ingen konstgjord kedja. Spärrarna sköter ordningen ändå: man lär sig ordern när
man ska ta en order. Det gör att en säljare och en ekonom kan gå helt olika
vägar utan att något behöver konfigureras.

### 6. Första inloggningen

`Logga in → byt lösenord → /uppstart`. Startguiden (~4 min, 9 steg) startar och
navet öppnas när den är klar. Ingen skipp-knapp. Avbryter man kommer man tillbaka
till samma steg vid nästa inloggning.

Startguiden ska täcka: var menyn ligger, dagslinjen på startsidan, stämpling
(för den som stämplar), notiser, sök, profilen, var rutiner finns, var guiderna
finns, och vad som är låst just nu och varför.

### 7. Handlingen är beviset — ingen kontrollfråga

Eftersom turen kräver att momenten faktiskt utförs är genomförandet
dokumentationen. Certifikat utfärdas när sista steget är gjort, och spärren
släpper i samma stund.

*Konsekvens:* det som INTE syns i klicken — när man inte ska göra något, vad en
avvikelse betyder — hör hemma i en skriven rutin med kvittens, inte i en
quizfråga på slutet. Se punkt 11.

### 8. Guiderna definieras i kod, texterna går att skriva om i navet

```
src/guider/order-skapa.ts

  version: 1,
  ankare: 'order.ny-knapp',
  ankare_mobil: 'order.ny-fab',
  kravd_handling: 'klick',
  text: 'Klicka "Ny order" för att börja.',
```

Gränssnittet märker upp sina element:

```tsx
<button data-guide="order.ny-knapp">Ny order</button>
```

**Koden äger** vilka steg som finns, vilket ankare de pekar på och vilken
handling som krävs. **Beställaren äger orden i bubblan** — en overridetabell
låter säljchef skriva om texten i navet:

```sql
create table guide_text (
  guide_slug text not null,
  steg       int  not null,
  text       text not null,
  updated_by uuid references employee(id),
  updated_at timestamptz not null default now(),
  primary key (guide_slug, steg)
);
```

Saknas en override används kodens text, och en kodändring når då fram
automatiskt. En övertagen text står kvar tills någon ändrar den — vyn ska visa
vilka texter som är övertagna, så att de går att släppa tillbaka.

### 9. Ankarprov i bygget

```
npm run test:guider
  ✗ order-skapa steg 3: ankaret 'order.ny-knapp' finns inte längre
```

Provet läser guidedefinitionerna och söker efter varje `data-guide`-värde i
källkoden, i både dator- och mobilläge. Saknas ett ankare failar bygget — guiden
kan inte tyst ruttna. Skulle något ändå slinka igenom i drift: guiden markeras
trasig i runtime, larm till `/fel`, spärren släpper.

### 10. Mobil ingår

Varje guide byggs för båda skärmstorlekarna, med `ankare_mobil` där layouten
skiljer sig, och provas i båda lägena. Första inloggningen sker ofta med
telefonen i handen, och bottennavet är där stämplingen bor.

### 11. Rutin med kvittens där det behövs bevis

Guiden lär ut handgreppet. En **skriven rutin med kvittens** finns där någon i
efterhand ska kunna visa att personen tagit del av vad som gäller:

| Guide | Rutin med kvittens |
|---|---|
| Stämpla in/ut | Ja — arbetstidsregler, sen ankomst, rättelser |
| Rapportera frånvaro | Ja — sjukanmälan, läkarintyg, konsekvenstrappan |
| Kom igång i navet | Ja — personuppgifter och loggning (K12/K14) |
| Registrera order | Nej |
| Läs provision | Nej |
| Ärenden, lönerapport, lönekostnad | Nej |

Rutinen länkas från guidens sista steg. Ingen dubblering för rena handgrepp —
ett certifikat visar att någon **kan** stämpla, inte att hen tagit del av vad som
**gäller** vid sen ankomst. Det är därför båda finns, och bara där.

### 12. Onboardad sätts automatiskt

Onboardad i systemet = **varje obligatorisk guide för personens roll är klar**.
`employee.status` går då `onboarding → active` av sig självt, chefen får en notis,
och händelsen bokförs i händelseloggen.

Utrustning, avtal och passerkort räknas separat i checklistan och håller inte
tillbaka statusen. *Varför:* en glömd kryssruta ska inte kunna hålla kvar någon i
onboarding-status i veckor, när systemet självt vet att personen kan navet.

### 13. Chefsvyn

**Utbildning → Översikt → Systemguider.** Teamledare ser sitt team, säljchef, VD
och admin ser alla.

```
Person       Klara  Pågår          Senast   Låst
Anna K.      2/6    Order 3 av 8    idag     —
Erik S.      1/6    Frånvaro 1/5    5 dgr ⚠  order
Maja L.      6/6    —               ✓ klar   —
```

`⚠` = stått still i tre dagar eller mer. `[Knuffa]` skickar en notis.

### 14. Påminnelser från nattjobbet

| När | Vad |
|---|---|
| 3 dagar stilla | Notis till användaren, `⚠` i chefens översikt |
| 7 dagar stilla | Notis till chefen |
| 14 dagar totalt | Fristen för hela paketet passerad — larm |

Bygger på befintliga notiser och nattjobb. Stämpelfria roller och pågående
frånvaro ska räknas bort innan något larmar — samma fälla som
`jobb/konsekvenser.ts` gick i.

### 15. Omtag bara vid stor ändring

```
src/guider/order-skapa.ts
  version: 2,
  omtag: true,
```

Textputs och flyttade ankare rör ingen. Har **momentet** ändrats höjs versionen
med `omtag: true`: certifikat utfärdade före v2 blir utgångna, spärren återgår,
och en banner förklarar varför.

> "Order har ändrats. Gör om guiden (2 min) för att behålla åtkomsten."

Beslutet ligger hos den som ändrar koden. Ingen årlig utgång — omtag av skäl
ingen förstår lär bara ut att klicka igenom utan att läsa.

---

## Guidepaketet

Startguiden och rutinguiden gäller alla. Resten följer `audience_roles`, precis
som kurser gör idag.

| Roll | Obligatoriska guider |
|---|---|
| Alla | Kom igång i navet · Rutiner och kvittens |
| Säljare | + Stämpla in/ut · Rapportera frånvaro · Registrera order · Läs din provision |
| Teamledare | + Godkänna tid och rättelser · Ärenden |
| Ekonomi | + Lönerapport · Lönekostnad |
| Projektledare | + Order · Leverans · Ärenden |
| Säljchef / VD | + Översikter · Konsekvenstrappan · Personal och anställning |
| Leverans | + Order och leveransflödet · Ärenden |
| Admin | + Personal och behörigheter · Fel och drift |

Stämpelfria roller får ingen stämplingsguide — `src/lib/stampelfri.ts` avgör,
inte en lista till.

Resten av navet — filer, nyheter, sök, rekrytering, profil — täcks inte av
obligatoriska guider utan av små hjälpbubblor på plats. De kan bli guider senare
om det visar sig behövas.

---

## Öppna frågor inför bygget

1. **Namnrymd för spärrar.** `order.skapa`, `tid.stampla`, `franvaro.anmal` … —
   listan ska vara uttömmande och bo på ett ställe, som `roles.ts` gör.
2. **Vilka tabeller får övningsflagga.** Order säkert. Avtal, ärende och
   stämpling beror på hur guiderna skrivs — bestäms guide för guide, och varje
   ny flagga kräver att provet i punkt 2 utökas.
3. **Fristen 14 dagar** är satt som utgångspunkt, inte bekräftad mot hur en
   introduktion faktiskt ser ut hos er.
4. **K12/K14.** Stegprogress per person är en ny personuppgift. Chefsvyn är
   begränsad till chefer, vilket ryms i nuvarande avvägning, men
   `docs/K12_INTRESSEAVVAGNING_UTKAST.md` behöver en rad om att guideprogress
   behandlas och hur länge den sparas.
5. **Vem får redigera guidetexter.** Förslag: säljchef, VD och admin. Loggas i
   händelseloggen.

---

## Byggordning

| Etapp | Innehåll |
|---|---|
| **G1** | Motorn: overlay, ankare, kravd_handling, progress per steg, mobil, `test:guider` |
| **G2** | Startguiden + `/uppstart`-flödet. Första guiden som är i drift |
| **G3** | Övningsläget: flagga, filter i alla frågor, städjobb, källkodsprov |
| **G4** | Spärrarna: `blocks_capability`, låsta knappar med förklaring, trasig-guide-släpper |
| **G5** | Chefsvyn, speglingen i checklistan, onboardad-statusen |
| **G6** | Nattjobbet: stillestånd, frist, knuffar |
| **G7** | Guidepaketet per roll, rutinerna i punkt 11, textredigeringen |
