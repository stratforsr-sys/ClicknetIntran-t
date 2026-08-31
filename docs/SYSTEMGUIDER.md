# Systemguider — interaktiv onboarding i navet

Beslutat 2026-08-31, reviderat samma dag: **funktionsspärrarna ströks**, och de
återstående öppna frågorna avgjordes. Det här dokumentet är beställningen: vad
som ska byggas och varför just så. Bygget sker i etapper enligt sista avsnittet;
G1 och G2 är levererade.

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

### 3. Obligatoriskt utan spärrar

**Ingen knapp låser sig, ingen modul stänger.** Beställarens besked 2026-08-31:
inga spärrar. `course.blocks_capability` lämnas orörd och används inte.

Det enda tvingande är **startguiden**, som startar av sig själv vid första
inloggningen och kommer tillbaka vid varje sidladdning tills den är genomgången.
Den går att **pausa** — rutan försvinner för den sidvisningen — men inte att
bocka bort.

Skälet att det ändå håller: guiden ligger OVANPÅ navet, inte i vägen för det. En
ny säljare som måste stämpla in kan pausa, stämpla och fortsätta. Det som gör
den obligatorisk är att den inte glömmer bort sig, inte att den låser något.

Resten drivs av att guiderna är lätta att nå (Utbildning → Systemguider), att
chefen ser läget, och att nattjobbet säger till när någon står still. Vad som
händer med den som ändå aldrig gör dem är en fråga för en människa, inte för en
låst knapp.

**En trasig guide står aldrig i vägen.** Saknas ett ankare markeras guiden som
trasig, larmet går till `/fel`, och rutan visar en väg vidare i stället för att
peka på tom luft. Se punkt 9.

### 4. Guiderna lagras som kurser och speglas i checklistan

Ny modultyp vid sidan av `reading | quiz | roleplay`:

```sql
alter table course_module drop constraint course_module_kind_check;
alter table course_module add constraint course_module_kind_check
  check (kind in ('reading','quiz','roleplay','guidad_tur'));
```

Därmed ärvs allt som redan finns: progress, försök, certifikat, frister,
giltighetstid, målgrupp per roll, och chefsöversikten.

**Inte gjort ännu.** En `course`-rad kräver en `owner_id` som pekar på en
anställd, och guiderna föds i koden innan det finns någon att peka på — en
seedad kursrad i en migration hade krävt en gissning. Fram till G5 bor
progressen därför i sin egen tabell (`guide_progress`, 0040) och listan står för
sig på `/utbildning/systemguider`. Bytet ändrar ingenting av det användaren ser.

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

Guiderader **går inte att bocka av för hand.** De följer kursen. Utan spärrar är
guidens egen bokföring det enda som säger att någon faktiskt gått igenom den, och
en chef som kan kryssa bort den har tagit bort det sista beviset.

Användaren har dessutom en egen ingång, **Utbildning → Systemguider**, där hen
ser sina guider, vad som är låst, och kan göra om en guide frivilligt.

### 5. Startguiden först, resten i fri ordning

Ingen konstgjord kedja. Man gör modulens guide när man ska använda modulen, och
en säljare och en ekonom kan därför gå helt olika vägar utan att något behöver
konfigureras.

### 6. Första inloggningen

`Logga in → byt lösenord → startsidan`. Där startar orienteringen av sig själv:
tio steg, ungefär fyra minuter. Ingen skipp-knapp, bara **Pausa** — och pausad
kommer den tillbaka vid nästa sidladdning, på samma steg.

**Inte `/uppstart`.** Den adressen är upptagen av något annat: vyn som låter den
första användaren skapa sitt konto i ett tomt register. Guiden behöver ändå ingen
egen sida — den måste kunna peka på menyn och toppraden, och de finns bara inuti
navet. Den bor därför i (app)-layouten och lägger sig över den sida användaren
står på.

Startguiden täcker: statusbandet, dagskortet, söket, notisklockan, menyn (på
telefonen bakom "Mer"), rutinerna, var guiderna bor, och profilen. Tio steg i
båda lägena — se `src/guider/kom-igang.ts`.

### 7. Handlingen är beviset — ingen kontrollfråga

Eftersom turen kräver att momenten faktiskt utförs är genomförandet
dokumentationen. Certifikat utfärdas när sista steget är gjort.

**Med ett undantag som är värt att vara ärlig om:** orienteringen har inga
moment att utföra. Den pekar ut var saker ligger, och de flesta av dess steg går
vidare med en knapp. De tre som HAR något att göra — söket, klockan, menyn på
telefonen — kräver att man gör det, och saknar då knappen helt. Regeln står i
`src/guider/typer.ts`: bär steget en instruktion i imperativ ska det kräva
handlingen; beskriver det något är det en knapp. Modulguiderna, som lär ut
moment, är den andra sorten rakt igenom.

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
kan inte tyst ruttna. Skulle något ändå slinka igenom i drift ger overlayen upp
efter två sekunder och visar rutan mitt på skärmen med ett besked och en väg
vidare, i stället för att peka på tom luft.

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
| Kom igång i navet | Ja — vad navet loggar och hur uppgifterna används |
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
med `omtag: true`: guiden slår om till "Gör om" i listan, och den som var klar är
det inte längre.

Beslutet ligger hos den som ändrar koden. Ingen årlig utgång — omtag av skäl
ingen förstår lär bara ut att klicka igenom utan att läsa.

---

## Guidepaketet

Startguiden och rutinguiden gäller alla. Resten följer `audience_roles`, precis
som kurser gör idag.

| Guide | Gäller | Läge |
|---|---|---|
| Kom igång i navet | Alla | **Byggd** |
| Rutiner och kvittenser | Alla | **Byggd** |
| Ärenden | Alla | **Byggd** |
| Frånvaro och ledighet | Alla | **Byggd** |
| Stämpla in och ut | Den som stämplar | **Byggd** |
| Order | Säljare, säljchef, VD, ekonomi | **Byggd** |
| Din provision | Säljare, säljchef, VD, ekonomi | **Byggd** |
| Lönerapport · Lönekostnad | Ekonomi | Kvar |
| Godkänna tid · Konsekvenstrappan | Teamledare, säljchef, VD | Kvar |
| Personal och anställning | Säljchef, VD, admin | Kvar |
| Leveransflödet | Leverans, projektledare | Kvar |

**Stämplingsguiden styrs inte av en rollista.** Vem som stämplar är
`sparr.stampling && !stampelfri(user.roles)`, och `src/lib/stampelfri.ts` är
enda stället där den listan får bo. Guiden bär i stället `krav: "stamplar"`, och
anroparen räknar ut svaret — se `krav` i `src/guider/typer.ts`.

**En modulguide startar första gången modulen öppnas.** Sidan monterar den själv
(`<GuideVard slug="…" />`), och den tystnar när turen är genomgången. Aldrig
samtidigt som orienteringen: `modulstart()` håller tillbaka modulguiderna tills
startguiden är klar, så det står aldrig två rutor på skärmen.

**Modulguiderna pekar ut och förklarar — de skapar ingenting.** Löftet i punkt 1,
att turen ska kräva att momentet utförs, går inte att hålla förrän övningsläget
(G3) finns: en guide som ber någon lägga en order på riktigt lägger en riktig
order. Tills dess lär de ut det som inte syns i gränssnittet — att en makulering
dras i makuleringsmånaden, att en rättelse blir en ny rad, att sjukanmälan rings
in först. När G3 finns byggs momenten in i samma filer och versionen höjs med
`omtag`.

Stämpelfria roller får ingen stämplingsguide — `src/lib/stampelfri.ts` avgör,
inte en lista till.

Resten av navet — filer, nyheter, sök, rekrytering, profil — täcks inte av
obligatoriska guider utan av små hjälpbubblor på plats. De kan bli guider senare
om det visar sig behövas.

---

## De sista besluten, tagna 2026-08-31

1. **Fristen är 14 dagar** för hela rollens paket, räknat från startdatumet.
   Utan spärrar är den ingen gräns utan en signal: den styr när nattjobbet
   larmar chefen (G6). Siffran bor på ett ställe och ändras där.

2. **Övningsflaggan gäller order, avtal och ärende.** Där är en övningsrad lätt
   att känna igen och lätt att städa.

   **Stämplingen får ingen flagga, och det är ett medvetet nej.** En
   övningsstämpling måste filtreras bort i lönerapporten, i nattjobbets
   auto-stängning, i konsekvenstrappan och i provisionsunderlaget — fyra ställen
   där ett bortglömt filter inte ger en krasch utan en felaktig lön eller en
   anklagelse om ogiltig frånvaro. Det är exakt den fällan `jobb/konsekvenser.ts`
   redan gått i en gång. Stämplingsguiden pekar därför ut knapparna och förklarar
   reglerna utan att spara något, och första riktiga stämplingen sker skarpt.

3. **Guidetexter redigeras av säljchef, VD och admin.** Ändringen bokförs i
   händelseloggen med vem och när. Byggs i G7.

4. **K12 utgår.** Beställarens besked: ingen uppdatering av
   intresseavvägningen inom ramen för det här arbetet.

## Byggordning

| Etapp | Innehåll | Läge |
|---|---|---|
| **G1** | Motorn: overlay, ankare, stegprogress, mobil, `test:guider` | **Klar** |
| **G2** | Startguiden och autostarten vid första inloggningen | **Klar** |
| **G3** | Övningsläget: flagga på order/avtal/ärende, filter i alla frågor, städjobb, källkodsprov | Kvar |
| ~~G4~~ | ~~Funktionsspärrar~~ | Struken 2026-08-31 |
| **G5** | Speglingen mot kurser och anställningschecklistan, chefsöversikten, onboardad-statusen | Kvar |
| **G6** | Nattjobbet: stillestånd, frist, knuffar | Kvar |
| **G7** | Guidepaketet per roll, rutinerna i punkt 11, textredigeringen | **Delvis** — sju guider byggda, chefs- och ekonomiguiderna kvar |

### Vad G1 och G2 lämnade efter sig

- `supabase/migrations/0040_systemguider.sql` — `guide_progress`, RLS med bara
  läsning av sina egna rader.
- `src/guider/` — typerna, registret, ankarhjälpen och `kom-igang.ts`.
- `src/lib/guider.ts` — reglerna, utan databas och utan React.
- `src/lib/guider-server.ts` — läsning och bokföring via service role.
- `src/components/guide/` — overlayen, värden i layouten, server actions.
- `src/app/(app)/utbildning/systemguider/` — listan, med "Gör om".
- `tests/guider.mjs` — ankarprovet och reglerna. Ingår i `npm test`.
- Ankare i Sidebar, Topbar, Bottennav, Notisklocka och startsidan.

### Vad som lades till samma dag

Startguidens sista steg lovade guider som inte fanns. Sex modulguider byggdes
därför direkt: rutiner, ärenden, frånvaro, stämpling, order och provision.

- `src/guider/moduler.ts` — de sex definitionerna.
- `modul` och `krav` i `typer.ts`; `guideForModul()` i registret.
- `modulstart()` i `guider-server.ts` — startar modulens guide, men aldrig medan
  orienteringen pågår.
- `<GuideVard slug="…" />` monterad på de sex modulsidorna.
- `Card` tar en namngiven `guide`-prop och sätter `data-guide` själv. Flera av
  korten sitter i rutnät där ett omslag hade brutit spaltbredden.
- Provet kontrollerar nu också att varje guide har en väg in, att sidan faktiskt
  monterar den, och att `Card` skickar vidare propen.
