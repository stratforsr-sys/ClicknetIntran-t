# Läs detta först

Kort överlämning mellan sessioner. `docs/ARBETSLOGG.md` har hela historiken och
varför-resonemangen; det här är bara läget just nu och vad som står på tur.

**Senast uppdaterad:** 2026-08-26 (genomgang infor pilot)

---

## Läget efter genomgången 2026-08-26

**Provsviten är grön: 31 sviter, ~1 700 kontroller.** Två av dem föll på riktig
data och inte på kod, och båda är lagade — se arbetsloggen.

### Tre saker som ändrades och som du behöver veta om

1. **`0037_konsekvenser` var körd mot produktionen men aldrig committad.** Filen
   är återskapad ur databasen, är idempotent, och bokföringen är omgjord så att
   checksumman beskriver filen som ligger här. **Schemat finns, koden gör det
   inte** — E13 steg 6 är fortfarande obyggd, och `attendance_incident` är tom.
   Notisavfärdningen fick därför nummer **0038**.

2. **En klickad notis försvinner ur klockan** (`notification_dismissed`, 0038).
   Alla notis-id:n går genom `notisId()` — skriv aldrig ett id som en hopskriven
   sträng, då slutar avfärdningen tyst fungera för just den sorten.

3. **Sessionen verifieras en gång per anrop i stället för två.** Mellanvaran
   skickar identiteten vidare i en request-rubrik.
   **`rensaIdentitet(headers)` på första raden i `updateSession()` är hela
   säkerheten** — faller den raden bort kan vem som helst skicka en egen
   identitetsrubrik och bli den personen, utan att något annat slutar fungera.
   `tests/identitet.mjs` skickar en riktig förfalskning mot produktionen.

### Två saker du själv måste göra för att slå på rasterna

Spärren har **exakt ett villkor kvar**. `sparr_saknas('raststampling')` svarar
*"K14: 1 anställda har inte kvitterat informationen."*

1. **Sätt rastschemat** under `/tid/schema`. Du sa att du vill göra det själv.
   Det som ligger där nu — 10 minuter, fönster 10:50–13:00 — ger **var och en som
   äter lunch en avvikelse varje dag**, mätt mot den riktiga motorn. Ett schema
   ändras aldrig: en ny längd är en ny rad med nytt `valid_from`. Sidan visar nu
   vilket schema som gäller nu och vilka som är historik.
2. **Kvittera K14** på `/rutiner/k14-information-arbetstid`, och kvittera de nya
   rastschemaraderna. Ingenting bedöms mot ett schema som inte kvitterats.

Sedan slås spärren på under `/tid/sparrar`. **K12 är beslutad och publicerad**
(beslutsdatum 2026-08-26, "Beslutad av: Zen, VD"). Avsnitt 6 och 7 skrevs i det
här passet och bär ditt namn — **läs dem.**

### Prestanda, mätt mot produktionen 2026-08-26

| Sida | Median | Krav |
|---|---|---|
| Startsidan | ~482 ms | 1 500 |
| Stämplingsvyn | ~530 ms | 2 000 |
| **Sökningen** | **~429 ms** | **500** |
| Rutinerna | ~446 ms | 1 500 |

Sökningens marginal gick från 4 ms till ~71 ms. Den är fortfarande den minsta i
navet. **Läs medianen av flera körningar** — en kall funktion gav 586 ms i en
enstaka avläsning, vilket ensamt hade sett ut som en regression.

---

## Pågående uppdrag: E13 provisions-, bonus- och konsekvensmotor

**Läs `docs/PROVISION_SPEC.md` innan du rör provisionen.** Beställaren besvarade
59 frågor 2026-08-24 och specifikationen bär hela regelverket: paketmatrisen,
volymbonusens trappa, K&V-protokollet, konsekvenstrappan och byggordningen i
nio steg.

**Ingenting blockerar längre.** Q78–Q80 är besvarade (paketmatrisen), och
K12-frågan avgjordes 2026-08-24 — se **D-K12**. Rast och sen ankomst når
fortfarande aldrig provisionen; utebliven instämpling gör det, men bara via ett
förslag som chefen måste godkänna.

**Steg 1–5 är klara 2026-08-25** (migrationerna `0034`, `0035` och `0036`).
Grundprovisionen, räknemotorn, volymtrappan, periodstängningen, säljarens
progressvy och K&V-protokollet finns. **Steg 6–9 återstår.**

### Nästa steg, i den ordning de går att ta

| Steg | Vad | Blockerat av |
|---|---|---|
| **6** | Konsekvenssystemet | Ingenting. D-K12, Ö8 och Ö15 är alla besvarade |
| 7 | Export och separat provisionsunderlag | Ingenting |
| 8 | Dialer-API för K&V-urvalet | A6 |
| 9 | Orderbilagan: PDF-uppladdning | Ingenting, men egen migration som vidgar `file_object` |

**Steg 6 är det största som återstår.** Steg 7 är det minsta.

### Vad beställaren svarade 2026-08-25, och vad steg 6 måste följa

**Ö8: övrig bonus faller INTE vid en konsekvens.** Specifikationens förslag var
tvärtom. Volymbonus och K&V-bonus faller som förut; grundprovisionen är orörd.

**Ö15: ogiltig frånvaro kräver minst 5 minuter OCH att personen faktiskt inte
var på plats.** Den som stämplar in för sent men varit här räknas **aldrig** —
beställarens egna ord. Chefen godkänner varje fall.

Det sista är viktigare än det ser ut: **det håller D-K12:s linje.** K12 1.2 sen
ankomst når fortfarande inte provisionen, och intresseavvägningen behöver därför
inte omprövas. En 5-minutersgräns som även gällt sen ankomst hade krävt att
avsnitt 6 och 7 i K12 skrevs och beslutades först — av någon med
dataskyddskompetens. Bygg inte steg 6 så att den gränsen glider.

**Ö4 är besvarad: 200 poäng totalt för båda samtalen**, alltså tröskeln 160 =
80 %. Steg 5 är byggt.

### Beställaren måste fylla i K&V-maxpoängen innan något går att bedöma

`/kv/regler`, säljchef och VD. De sex områdena finns med beställarens egna
namn, men **maxpoängen är NULL för samtliga** — Ö4 säger att 200 är maxpoängen
totalt för båda samtalen, inte hur de 200 fördelas på sex områden.

Migrationen `0036` har en självkontroll som **fäller sig själv om någon seedar
ett värde där**. Sidan räknar ut vad tröskeln motsvarar i procent medan du
skriver.

### Sex saker att inte riva

1. **En makulering är TVÅ händelser.** Ordern ger provision i sin
   signeringsmånad och drar tillbaka den i sin makuleringsmånad. Använd
   `harGodkants()` och aldrig `raknas()` när det handlar om pengar — se
   arbetsloggen 2026-08-25 (kväll) för de två felen som uppstod när de blandades
   ihop. Nettoantalet kan bli negativt, och det är avsiktligt.
2. **Provisionen är frusen på ordern.** Satsen slås upp på signeringsdatumet och
   kopieras in vid godkännande. Läs aldrig `commission_rate` för att räkna om en
   gammal order.
3. **Volymtrappan slås upp på MÅNADENS första dag**, inte på orderns datum. De
   två uppslagen är olika med flit — se Ö16 i specifikationen. Blandas de ihop
   blir "från och med nu" och "allt intjänat denna månad" samma sak.
4. **En öppen period räknas live, en stängd är bokförd.** Och "öppen" är
   frånvaron av en rad i `commission_period`. Attesten bokför posterna FÖRST och
   stänger perioden SEDAN; den ordningen är det som gör ett halvfärdigt försök
   möjligt att köra om.
5. **En vecka räknas först när ALLA dess samtal är bedömda.** Tröskeln är
   summan av båda samtalen, så en halvbedömd vecka hade underkänts av ett skäl
   som är chefens och inte säljarens. Och periodstängningen hämtar samtal en
   vecka före och efter månaden — torsdagsregeln gör randveckorna halva annars.
6. **`revoke ... from public` räcker inte för en ny funktion.** Supabase har en
   egen default-ACL som ger `anon` en explicit grant. Skriv
   `revoke all ... from public, anon`. Migrationen 0034 föll på sin egen
   självkontroll första gången just där — behåll kontrollen i nya migrationer.

### Beställaren måste fylla i volymtrappan innan bonusen gör något

`/provision/regler`, säljchef och VD. **Tabellen är tom med flit** — nivåerna
5/10/15/20/25/30 är beställarens, men beloppen är inte satta (fråga 18). Tills
någon fyller i dem räknar motorn noll bonus, aldrig en gissad. Samma linje som
täckningsgraden i `0025`.

Det är den enda av de nya funktionerna som inte gör något förrän du matat in
innehåll.

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

Tjugonio sviter. `tests/rls.mjs` går mot den **riktiga**
databasen och skapar och städar sina egna användare (prefix `rlstest+`).
Även `tests/provision-period-db.mjs` går mot den riktiga databasen — den kör allt
i en transaktion som rullas tillbaka, och kontrollerar till sist att ingenting
blev kvar.

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
| Raststämpling | Avstängd. **Ett villkor kvar: K14 okvitterad av 1 person.** K12 och K14 är publicerade |
| Sen ankomst | Påslagen, tolerans 1 minut, larm samma dag till chef |
| Nattjobb | Ett jobb, `/api/jobb/natt`, 02:30. Hämtar igen 14 dygn bakåt |
| Lönerapport | Klar, med attest och oföränderlig period |
| Personalärenden | Klara, med SLA och konfidentialitet |
| Tvingat lösenordsbyte | Spärr i databasen sedan 2026-08-20 |
| Startsida | **Ombyggd 2026-08-23.** Statusband, snabbval, dagens tidslinje, ärende- och provisionskort |
| Bottennavigering | Under 768 px: Hem, Sök, Stämpla, Mer |
| Sidopanelen | **Menyn scrollar sedan 2026-08-24.** Låst botten: profil och utloggning rullar aldrig bort |
| **Inställningar** | **I drift sedan 2026-08-24.** Ruta över fönstret från profilbilden. Konto, Säkerhet, Utseende, Administration. `/profil` visar samma sektioner som egen sida |
| Registerutdrag | Klart, **inklusive filer och vem som öppnat dem** |
| Nyheter | `/nyheter`. Målgrupp per roll och team, fäst överst, utkast |
| Notisklockan | Ärenden, nyheter, rutiner, kurser, frånvaro, rollspel. **En klickad notis försvinner (0038)** |
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
| **Anställningsflöde** | **I drift sedan 2026-08-24.** `/rekrytering/[id]/anstall`. Konto, roll, rutiner, kurser, avtalsutkast och onboarding-checklista i ett steg |
| **Provision** | **I drift sedan 2026-08-23.** `/provision`. Manuell inmatning av ekonomi/VD. Alla ser sin egen. Inkio-sömmen lagd, inte kopplad |
| **Kundorder** | **I drift sedan 2026-08-25.** `/order`. Paketmatrisen i `commission_rate`, provisionen fryses vid godkännande |
| **Volymtrappan** | **I drift sedan 2026-08-25.** `/provision/regler`. **Ifylld 2026-08-25:** 5/10/15/20 → 200/500/1000/1200 kr |
| **Periodstängning** | **I drift sedan 2026-08-25.** Kort på `/provision`. Öppen månad räknas live, fastställd är bokförd |
| **Progressvy** | **I drift sedan 2026-08-25.** `/provision`. "3 order kvar till nästa bonus" med prognosens antagande utskrivet |
| **K&V** | **I drift sedan 2026-08-25.** `/kv`. Rutnät säljare × vecka, bedömning, utvecklingskurva. **Maxpoängen måste fyllas i** |

### Raststämplingen: två steg kvar, och båda är dina

Rastschemat finns redan (K29 uppfylld), K12 och K14 ligger som **utkast** i
rutinbiblioteket och är kopplade till spärren. Det som återstår:

1. **Publicera K12 och sätt beslutsdatum.** `/rutiner` → "Intresseavvägning —
   registrering av arbetstid" → redigera → fyll i avsnitt 6 och 7, som är
   avsiktligt tomma, sätt beslutsdatum och publicera.
2. **Publicera K14** ("Så registreras din arbetstid"). Därefter måste **varje
   aktiv anställd kvittera den** — i dag är det en person (Zen), så det är ett
   klick.

Sedan slås spärren på under `/tid/sparrar`. Triggern i databasen kontrollerar
villkoren, inte koden.

**Jag publicerade dem inte åt dig med flit.** En intresseavvägning med
beslutsdatum är ett arbetsgivarbeslut enligt art. 6.1.f, och dokumentets egen
ingress säger att det ska läsas av någon med dataskyddskompetens innan det
beslutas. Avsnitt 6 och 7 — själva avvägningen och beslutet — är tomma.

### Kontrollera rastlängden INNAN du slår på

Rastschemat säger **10 minuter**, fönster 10:50–13:00, tolerans 5 min. Det ser
ut som ett testvärde. Konsekvensen är uppmätt mot avvikelsemotorn:

| Vad någon gör | Vad som registreras |
|---|---|
| 10 min rast 11:00 | inga avvikelser |
| **30 min lunch 12:00** | **overrun, 20 min** |
| **60 min lunch 12:00** | **overrun, 50 min** |
| lunch + kaffepaus | overrun 20 min + unscheduled |
| ingen rast alls | missing, 180 min |

Med den här längden får alltså **var och en som äter lunch en avvikelse varje
dag**. Det gör avvikelsevyn oläslig från dag ett, och det är den vy K12 lovar
personalen ska vara sparsam.

Ett schema ändras aldrig (AC-2.35) — en ny längd är en **ny rad med nytt
`valid_from`**, upplagd under `/tid/schema`. Gamla rader är historik och ska
ligga kvar.

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

## Vad som byggdes 2026-08-24 (kväll) — skalet

Ingen migration. Två saker, och den första var ett verkligt fel i produktion.

**Sidopanelens meny scrollar.** Panelen är `inset-y-4` och alltid exakt så hög
som fönstret, men listan saknade egen scroll. På en 690 px hög vy föll fem av
sjutton poster utanför — och under dem **hela bottenraden med profilen och
utloggningen.** Bara listan scrollar nu; logotyp, hopfällning och profilrad är
`shrink-0`.

Fällan att komma ihåg: `scrollbar-width`/`scrollbar-color` slår sedan Chrome
121 av hela `::-webkit-scrollbar`-blocket, och då ritar macOS en overlay-list
med bredd noll. Listan scrollade men såg fortfarande avklippt ut. Det står
utskrivet i `.nav-scroll` i `globals.css` att de två inte får läggas tillbaka.

**Inställningarna är en ruta över fönstret**, öppnad från profilbilden.
`<dialog>` + `showModal()`. Sektionerna ligger i `src/app/(app)/profil/
Sektioner.tsx` och används av både rutan och `/profil` — rör du den ena ändras
båda, vilket är meningen. Administration-fliken finns bara för den som ställer
in något, och varje post har samma villkor som sidan den pekar på.

Sidopanelens hopfällning delas via `shell/panellage.tsx` i stället för att
kopieras. Lägeshållaren är `Skal`.

---

## Vad som byggdes 2026-08-24 — E10.9 anställningsflödet

Migration `0033`. Hela resonemanget står i arbetsloggen; det här är vad du
behöver veta för att inte riva något.

### Kopplingen och steget skrivs i SAMMA update

`hired_employee_id` och `stage = 'hired'` går i en enda skrivning.
`candidate_stegbyte` i 0030 nekar `hired` utan koppling, så delar du upp dem
måste kopplingen sättas först — och en kandidat som pekar på en anställd utan
att stå på `hired` är precis det motsägelsefulla läget ordningen finns för att
undvika.

Ordningen i övrigt: **auth-konto och employee-rad först, kopplingen sedan, allt
annat sist.** Faller det mitt i står kandidaten kvar på `offer` med en anställd
som redan finns — ett läge någon kan se och rätta.

### `revoke`-fällans motsvarighet här: undantaget för null

Triggern `candidate_anstallning_star_fast` nekar att kopplingen pekas om, **men
bara till ett annat värde.** `on delete set null` kör en UPDATE, så en trigger
som nekade all ändring hade fällt `delete from employee`. Samma fälla som
`file_object` gick i 0023. Rör du triggern: provet raderar en person och
kontrollerar att kandidatraden står kvar.

### Uppläggning och avtalsrendering ligger i lib, inte i actions

`src/lib/anstallning-server.ts` och `skapaAvtalsutkast()` i
`src/lib/avtal-server.ts`. Två vägar leder till båda, och ingen av filerna bär
`"use server"`.

**Behörigheten kontrolleras aldrig där** utan av anroparen — kretsarna är olika,
och det är avsiktligt. Lägger du till en tredje väg in: kontrollera behörigheten
i din egen kod, inte i biblioteket.

### Avtalsdelen är valfri, och tre saker styr det

Kretsen som får skapa avtal (`sales_manager`, `ceo`, `admin`) är **smalare** än
rekryterarkretsen, som också släpper in `recruiter`. Det finns **ingen
publicerad mall** än. Utan mall skapas inget utkast och checklistan får punkten
i stället — åtgärden flyttar, den försvinner inte.

Skriv den första mallen så börjar flödet skapa utkast av sig självt.

### Tre av tolv checklistepunkter föds avbockade

Konto, rutiner och kurser är redan gjorda av flödet. De står kvar som bevis men
markerade `done` — en lista med utförda punkter som ser öppna ut lär användaren
att bocka av utan att läsa. Lägger du till en punkt som flödet utför: sätt
`automatisk: true` i `src/lib/onboarding.ts`.

**Den nyanställda ser inte sin egen lista.** Samma behörighet som offboardingens.
Punkterna är chefens arbetsredskap; det den anställda ska se ligger på `/rutiner`
och `/utbildning`. Raden står ändå i registerutdraget (artikel 15).

---

## Vad som ändrades natten till 2026-08-24 — tre säkerhetspunkter

Migration `0032`. Hela resonemanget står i arbetsloggen; det här är de tre
reglerna som är värda att ha med sig.

**En `"use server"`-fil exporterar handlingar och ingenting annat.** `sattKvitto`
låg i `angra/actions.ts` och var därmed en publik ändpunkt — allt som exporteras
ur en sådan fil får ett id och tar emot anrop från webbläsaren. Den ligger nu i
`src/lib/toast-server.ts`, och `angra()` är det enda som exporteras därifrån.
Samma sak hände `skrivFel` 22 augusti. Det är alltså andra gången.

**Jobbrutternas hemlighet jämförs i konstant tid**, i `src/lib/jobb/behorighet.ts`
i stället för i fyra kopior. Båda sidorna hashas först — `timingSafeEqual` kräver
lika längd och en längdkontroll före hade läckt längden.

**`revoke ... from anon` gör oftast ingenting, och det är fortfarande den fällan
som biter.** Tretton av femton funktioner hade ingen explicit anon-grant utan den
PUBLIC-grant Postgres ger varje ny funktion. Rätt form är `revoke från public` +
explicit `grant` tillbaka till `authenticated` och `service_role`. Regeln stod
redan i 0027 och räckte inte — det som fångade felet var **självkontrollen längst
ned i `0032`**, som frågar databasen och river transaktionen om något står kvar.
Den ligger kvar. Skriver du en ny funktion och den syns där: det är meningen.

Triggerfunktioner rörs aldrig — de exponeras inte som RPC av PostgREST.

---

## Vad som byggdes 2026-08-23 (sent) — startsidan och E13

Migration `0031_provision`. Hela resonemanget står i arbetsloggen; det här är
vad du behöver veta för att inte riva något.

### Provisionen är en huvudbok utan motor

`commission_entry` tar emot poster som någon annan bestämt. **Navet räknar ingen
provision** — Q78–Q80 är obesvarade, och AC-10.1 kräver konfiguration, inte kod.
Lägger du till satser: gör dem till data, inte till ett `if`.

**En rättelse är en NEGATIV post.** Tabellen är append-only och triggern nekar
både update och delete. Skillnaden mot `salary_basis` är avsiktlig: intjäning
ackumuleras, så "ny rad med nytt värde" hade dubbelräknats av varje summering.

**Inkio-sömmen är `source` + `external_ref`** med ett partiellt unikt index.
Importen blir idempotent, och ingen vy behöver röras när A5 besvaras.

**Den anställda ser sin egen rad** — till skillnad från K26/lönekostnad. Andras
ser bara ekonomi och VD. Säljchefen står utanför; en roll till är en rad i
`far_hantera_provision()`.

### K13 är omprövad, men bara till hälften

Provision och tid får stå på samma sida (beställarbeslut, se D-K13). Det som
står kvar: **ingen fråga joinar tabellerna**, och **rastavvikelser når
fortfarande aldrig provisionen**. Det senare är ett löfte till personalen i
K12-intresseavvägningen §5 och kräver att K12 beslutas om på nytt för att ändras.

Rör du startsidan: håll de två hämtningarna åtskilda. De ligger i samma våg men
är två frågor, och det är hela skyddet som är kvar.

### Tidslinjen bedömer ingenting

`src/lib/dagslinje.ts` ritar dagens stämplingar. **Inget färgas rött, och det är
avsiktligt.** Bedömningar hör hemma i avvikelsemotorn, som har toleranser,
kvittenskrav (AC-2.36) och loggad chefsöppning (K19) omkring sig.

Rastnedräkningen syns **bara i personens egen vy**. Den som avslutar i tid får
ingen avvikelse alls — det är hela poängen med att räkna ner i stället för att
räkna efteråt.

### Startsidan hämtar nu tre frågor till, i samma våg

Schemat, rastschemat och provisionen lades i den befintliga `Promise.all`.
Vågantalet är oförändrat. **X3-mätningen är inte omkörd efter ombyggnaden** —
`npm run mat:inloggad` när du vill ha en färsk siffra. Kravet är 1 500 ms och
marginalen var ~850 ms före.

### Två fällor som redan trampats i

**`kronor()` skriver U+2212 MINUS SIGN**, inte ASCII-bindestreck — det är vad
sv-SE använder. `tolkaBelopp` känner igen båda, och provet kör hela vändan
display → inmatning. Tar du bort raden går ett kopierat belopp inte att klistra
tillbaka i rättelseformuläret.

**Exportera ingenting mer ur `provision/actions.ts`.** Allt som exporteras ur en
`"use server"`-fil blir en publik ändpunkt. En hjälpare låg där och togs bort —
samma brist som säkerhetsgenomgången hittade i `sattKvitto`.

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

### Säkerhetsgenomgången: en punkt kvar, och den är din

Grunden är stark — RLS på samtliga 68 tabeller, ingen skrivrätt för klienten,
behörighetskontroll först i varje server action. **Punkt 2, 3 och 4 är gjorda
natten till 2026-08-24** (migration `0032`). Kvar:

1. **Sätt `STEG2_SECRET` i Vercel.** Utan den signeras steg två-kvittot med
   `SUPABASE_SERVICE_ROLE_KEY` — samma hemlighet ger full förbigång av RLS.
   Fallbacken är medveten, men de två bör inte vara samma nyckel.
   *Följd:* alla chefer måste bekräfta sin enhet en gång till. Det är därför den
   inte gjordes åt dig — bytet avbryter för den som använder navet, och när det
   sker är ditt val.

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
   matat in innehåll — och sedan 2026-08-24 hänger **anställningsflödet** på
   den: utan mall skapar det inget avtalsutkast, utan lägger punkten i
   onboarding-checklistan i stället.
5. **Personnumret i anställningsavtalet — ett beslut som är ditt.** Navet lagrar
   inga personnummer (K27), så det utskrivna avtalet har en rad som fylls i för
   hand. Det går att ändra, men då är det K27-linjen som ska omprövas medvetet.
   Jag har byggt så att den inte går att kringgå av misstag.
6. **E10 resten**, ~1 vecka. **E10.9 anställningsflödet är klart 2026-08-24.**
   Kvar utan blockering: **E10.2 den publika ansökningssidan** med
   screeningfrågor — uppläggning för hand finns redan, och källattributionen är
   obligatorisk. Den rör den utloggade ytan, så CSP och spamskydd hör till
   arbetet. E10.8:s nattjobb väntar på fristen, E10.1/4/7 på mejlspåret.

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

### E13 provision: skivan som är byggd, och resten

**Byggt 2026-08-23:** `commission_entry`, `/provision`, kortet på startsidan.
Manuell inmatning av ekonomi och VD.

**Byggt 2026-08-25:** steg 1–3. Kundordern, räknemotorn, volymtrappan och
periodstängningen. **Q78–Q80 är besvarade och E13 är inte blockerad längre** —
paketmatrisen ligger i `commission_rate`.

**Kvar och blockerat:** bara Inkio-importen (A5). Sömmen finns —
`source = 'inkio'` och `external_ref` — så integrationen kan skrivas utan
schemaändring. Huvudboken har sedan `0035` en tredje källa, `motor`, som
periodstängningen använder.

**Villkoren som styrde E15 gäller fortfarande E13:**

- **AC-3.26 / E7.14:** hämta frånvaro via `payroll_row.absence_minutes`. Aldrig
  genom att joina `sick_report` — RLS ger noll rader för `finance` och
  `payroll_cost_viewer`, så en vy som försöker får tyst fel data i stället för
  ett felmeddelande.
- **E13.1 / AC-10.1:** provisionsregler som konfiguration, inte kod. Samma linje
  som `absence_policy` och `cost_rate` redan drog. Lägg dem gärna i `cost_rate`
  om de är satser, annars i en egen tabell — men inte i ett `if`.
- **K13 / E13.9:** **omprövad 2026-08-23, se D-K13.** Provision och tid får stå
  på samma sida. Det som står kvar: ingen fråga joinar tabellerna, och
  rastavvikelser når fortfarande aldrig provisionen — det senare är ett löfte i
  K12 §5 och är inte omprövat.

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
- **Ö9, Ö11, Ö13** i `docs/PROVISION_SPEC.md`. Alla har ett förslag som gäller.
- **Ö16** vilken volymtrappa som gäller för en månad en ändring skär igenom.
  Byggd med ett förslag som gäller tills annat sägs.
- **A5** Inkio, **A6** dialer. Blockerar E11, E12 och E13 steg 8.
- **Personnumret i anställningsavtalet.** Navet lagrar inget (K27), så
  utskriften har en rad som fylls i för hand. Vill du ändra det är det
  K27-linjen som ska omprövas, inte avtalsmodulen.
