# Byggprompt: Leveranskalendern i Nav

> Klistra in allt under strecket i Claude Code, i VS Code med repot `ClicknetIntran-t` öppet.
> Paketet ska ligga i repot som `docs/leveranskalender/` innan du börjar (se LASMIG.md).

---

Du ska bygga Leveranskalendern i Nav: en kalender som fungerar som Outlook, med möten och deltagare, 1:1:or med säljarna, uppgifter och leveransposter för den nya leveransavdelningen. Allt ska kopplas till Navs riktiga backend. Det viktigaste kravet av alla: **kalendern ska se ut och bete sig exakt som prototypen.** Du porterar en färdig design. Du designar inte om den.

## 1. Läs innan du skriver en rad kod

Läs i den här ordningen och läs hela filerna:

1. `CLAUDE.md`, `docs/NASTA_SESSION.md` (lägesbilden överst), `DECISIONS.md`. Reglerna där gäller hela tiden.
2. `docs/leveranskalender/SPEC.md`: skärmkarta, tokens, acceptanskriterier, notismatris, server actions, jobb, behörighet och texter.
3. `docs/leveranskalender/prototyp.html`. Läs CSS:en och kommentarerna överst i `<style>` och `<script>`. Be mig öppna den med `#bara-kalender` om du vill veta hur något beter sig. `prototyp-flodesprov.cjs` beskriver klicken i 35 flöden.
4. `docs/leveranskalender/referens/*.png` och `referens/stilmatt.json`: uppmätta bredder, höjder, typsnitt, grader, färger, luft och radier för varje del.
5. `docs/leveranskalender/datamodell.sql`: tabellskissen. Den är en skiss. Kontrollera varje referens mot det faktiska schemat.
6. Befintlig kod du ska återanvända eller utöka, inte skriva om:
   - `src/lib/kalender.ts`: `laggUt`, `dagssumma`, `veckonummer`, `DAG_START`, `DAG_SLUT`, `RUTA`, `DAGSTAK`, delningsnivåerna.
   - `src/lib/kalender-server.ts` och migration 0057: `kalender_poster()`, `kalender_niva()`, `calendar_share`.
   - `src/lib/upprepning.ts`.
   - `src/lib/notishandelse-server.ts` (`notifiera`, `notifieraFlera`), `src/lib/notiser.ts` (`HANDELSEKALLOR`), `src/lib/epost-notis.ts` (`MEJLKALLOR`), `src/lib/epost.ts` (`Brev`).
   - `src/lib/toast.ts` (`ANGRABARA`, `Kvitto`) och `src/app/(app)/angra/actions.ts` (`angra`).
   - `src/components/shell/Notisklocka.tsx`, `src/lib/jobb/dagtid.ts` med migration 0059, `src/lib/ical.ts`, `src/lib/auth.ts` (`initials`).
   - Migrationerna 0034 (order, `approved_at`), 0043 (coachning och dess läskrets), 0047 (notiser) och 0068 (avtal).
   - `tests/notiser-tackning.mjs` och `tests/rls.mjs`.

Skriv sedan en plan i högst 30 rader: vilka filer du skapar och ändrar, vilka migrationer och vilka server actions. Vänta på mitt ok innan pass 1.

## 2. Tre saker jag bekräftar innan pass 1

Fråga mig om dessa, med din rekommendation, och bygg inte förbi dem:

1. **Beslutet från 11 september** ("Kalendern visar det navet redan vet. Den bokar inga möten.") ersätts av ett nytt beslut i `DECISIONS.md`: Nav bokar möten med deltagare. Uppgifter och coachning stannar i sina moduler.
2. **Vilket CRM leveransen använder och om det har ett API.** Tills jag svarat byggs bara den manuella adaptern (kund-ID klistras in), bakom ett gränssnitt som en API-adapter kan ta över.
3. **Planeringsvyn.** Min rekommendation: den nuvarande Planeringsvyn behålls oförändrad under `/kalender?vy=planera` med en länk i sidolistan, och den nya kalendern blir huvudvyn.

## 3. Så håller du utseendet exakt

Det här är reglerna som oftast bryts när en prototyp porteras. Bryt ingen av dem.

- **Facit är `#proto` i prototyp.html.** Allt utanför (rapporten runt omkring) är dokumentation och byggs inte.
- **Porta CSS:en, översätt den inte.** Lägg prototypens regler i en egen fil, `src/app/(app)/kalender/leveranskalender.css`, med alla selektorer under rotklassen `.lk`, och importera den från kalendersidan. Behåll prototypens klassnamn (`.ev`, `.dh`, `.gut`, `.rail`, `.drawer`, `.dp` …) så att DOM:en går att jämföra rad för rad. Gör inte om reglerna till ungefärliga Tailwind-klasser: `px-2` är inte `padding:4px 7px 4px 9px`.
- **Ta med prototypens grundregler för element.** Prototypen har regler för `body`, `h3`, `h4`, `p`, `button`, `input`, `select` och fokusring som styr utseendet. Tailwinds preflight och Navs `:focus-visible` i globals.css (radie 8 px) nollställer dem. Porta dem under `.lk` så att de vinner inuti kalendern.
- **Färger bara som tokens.** Hexvärden får bara stå i `src/app/globals.css`. Prototypens `var(--ink-900)` blir `var(--color-ink-900)` och så vidare. Lägg till tokens som saknas i `@theme`, med värdena i SPEC.md avsnitt 3, och ersätt prototypens få literaler (avatarfärger, `#fff`, skuggor) med dem.
- **Bara ljust läge.** Hoppa över prototypens `@media (prefers-color-scheme:dark)` och `[data-theme="dark"]`.
- **Navs skal står kvar.** Sidopanelen, topbaren och Notisklockan är Navs. Kalendern fyller hela innehållsytan, utan `max-width`. Prototypens egen klocka (`#bBell`, `#npanel`), Som-väljaren och ⚙ byggs inte. Svarsknapparna i prototypens klocka (Ja, Kanske, Nej) läggs i Navs Notisklocka för kalendernotiser.
- **Rätta inte designen mot Navs komponenter.** Inuti kalendern har knapparna radie 10 px och inte Navs rundade `Button`, rutnätet har 1 px linjer trots att UI-PRD säger "ingen ram", veckan är ett timrutnät trots att `Veckovy.tsx` valde listor, och kvittot med Ångra ligger nere i mitten. Allt det är medvetna avsteg. Skriv in dem som ett beslut i `DECISIONS.md` (texten står i SPEC.md avsnitt 3) i stället för att "fixa" dem.
- **Prototypens regler vinner över befintliga hjälpfunktioner när de skiljer sig.** Dagsumman räknar alla ogjorda bokningar (möten, 1:1, leveransposter, uppgifter), inte bara uppgifter och coachning som `dagssumma()` gör i dag. Poster ritas på exakt minut; `slut()` avrundar till 30 min. Lägg till varianter eller parametrar i stället för att ändra beteendet för Planeringsvyn.
- **Typsnitten** är Navs (Plus Jakarta Sans och JetBrains Mono via `next/font`): `var(--font-sans)` och `var(--font-mono)`.
- **Ikoner** i posterna (☎ ⚿ ▶ ◆ ✓ ↻) är textglyfer i prototypen och ska vara det här också.
- **Kortkommandon läser `event.code`** (`Digit1`, `ArrowLeft`), inte `event.key`. På svenskt tangentbord i Windows är Ctrl+Alt samma sak som AltGr och ger `@ £ $ €` för 2–5.
- **Så jämförs utseendet.** Du har ingen webbläsare mot previewen, så jag jämför. Referensbilderna är tagna med kalendern 1200 px bred. Allt med fast bredd (sidolistan, panelen, formuläret) och alla höjder, luft, grader, färger och radier ska stämma med `stilmatt.json` på pixeln. Dagkolumnerna är flytande och får vara bredare eller smalare. Jämför själv koden mot `stilmatt.json` och prototypens CSS innan du säger att ett pass är klart. Tala om vilka delar av varje bild som hör till passet, eftersom bilderna visar allt från alla pass.

## 4. Testdata, varsamt

Previewen använder produktionsdatabasen, och inbjudningar ger riktiga notiser och mejl till kollegor. Skapa ingen testdata själv. När något behöver provas: föreslå vilka poster och vilka testkonton (inga riktiga kollegor som deltagare), och vänta på mitt ok. Utkorgen ska inte skicka något till testkonton utanför Nav.

## 5. Vad som byggs och vad som inte byggs

**Byggs, med riktig data:** vyerna Dag, Arbetsvecka, Vecka, Månad, Teamet och Agenda, verktygsraden, sidolistan (ny händelse, sök, minikalender, leveranskön, kalendrar, förklaring), sammanfattningsraden, rutnätet med nu-linje och dagsumma, formuläret med typflikar, datumväljaren med veckonummer, start och slut med snabbval (15 min, 30 min, 1 timme), deltagare och schemaläggningsassistent, krockvarning, förinställningarna för leverans, svar och förslag på ny tid, flytt som kräver nytt svar, serier med valet "bara den här gången" eller "hela serien", dra för att skapa och dra i nederkanten för att ändra längd, Ångra, 1:1-panelen, leveranspanelen, kökortet, sök, tangentbordet.

**Byggs inte:** Som-väljaren (`#viewas`), panelen Bakom kulisserna (⚙, `effect()`, `LOG`) som i stället blir riktiga rader i utkorgen, knapparna Visa mig (`demo()`), exempeldatat (`PEOPLE`, `CUST`, `EV`, `SERIES`, `NOTES`), prototypens notisklocka, rapportsidorna runt `#proto` och mörkt läge.

**Automatisk avbockning är förbjuden.** Nav får aldrig markera ett välkomstsamtal som genomfört utifrån växeln (Lynes) eller något annat. Utfallet sätts bara av en människa med knapparna Nådd och Ej svar.

## 6. Backend: allt ska gå ihop med Nav

- **Additivt mot produktionen.** `main` får aldrig se de nya tabellerna. Ändra därför inte `kalender_poster()`: den mappar i dag allt som inte är frånvaro till en uppgift med länk till `/uppgifter/`, så nya rader där hade dykt upp som trasiga uppgifter i produktionen innan merge. Skriv en ny funktion (till exempel `kalender_handelser()`) och läs den bara från den nya koden.
- **En tid att räkna på.** `starts_at` sätts av en trigger från `dag` och `tid` i Europe/Stockholm. Ingen kod räknar sommartid själv.
- **Utkorgen för allt som lämnar ändringen.** Skrivs i samma transaktion som ändringen, med `not_before = now() + 10 s` och en unik `idempotency_key`. Sorterna är `notis` (töms genom att anropa `notifiera()`, som sköter klocka och mejl enligt `MEJLKALLOR`), `ics` (inbjudan till kunden), `resend_schedule`, `resend_patch`, `resend_cancel` och `crm`. Notiser får aldrig gå både via utkorgen och direkt. Utkorgen töms av `after()` i den action som skrev raderna och, som reserv, av en ny route `/api/jobb/utkorg` som `pg_cron` ringer varje minut via `pg_net`, som dagtidsjobbet i 0059. Rör inte `vercel.json`: Hobby-planens två cron-poster är slut, och en tredje stoppar alla tre.
- **Ångra.** Varje ångrabar action sparar läget före ändringen i `calendar_undo` tillsammans med utkorgens rad-id:n. Kalenderns eget kvitto anropar `angra()` med den radens id, handlingen läggs i `ANGRABARA`, och `angra()` återställer läget och raderar de rader i utkorgen som inte skickats. Kalendern använder inte kakkvittot i `Toast.tsx`, så det blir aldrig två kvitton.
- **Notiser och mejl.** Nya källor läggs i `HANDELSEKALLOR` och de som ska mejlas i `MEJLKALLOR`. Regeln "mejl bara inom 7 dagar" för flytt kräver två källor (en med mejl, en utan), eftersom mejl bestäms per källa. `Brev` saknar bilagor; lägg till stöd för en `.ics`-bilaga i pass 4.
- **Ny tid betyder nytt svar.** Flyttas en post eller ändras längden nollställs alla deltagares svar till `vantar`, utom organisatörens och förslagsställarens. För en enskild gång i en serie gäller det bara den gången.
- **Leveransen startar när ordern godkänns** (`approved_at` sätts): samma action skapar raden i `delivery`. En makulerad order tas bort ur kön, och är välkomstsamtalet redan bokat får den ansvariga en notis.
- **Leveranskön** hämtas med `select … for update skip locked`.
- **CRM bakom ett adaptergränssnitt**, pass 3 bygger den manuella adaptern.
- **Behörighet** enligt SPEC.md avsnitt 8. Kontrollera med `node tests/rls.mjs`, och utöka provet med fallen där.
- **Varje server action** validerar på servern, kontrollerar behörigheten själv och bokförs i `tests/notiser-tackning.mjs`. Actions som notifierar via utkorgen bokförs som `"notifierar via utkorgen (<fil>)"`, eftersom provet bara godtar `"notifierar"` när `notifiera(` står i actionens egen kropp.

## 7. Fyra pass

Följ `CLAUDE.md`: gren först (`leveranskalender`), en commit och en push per pass (varje push är en Vercel-deploy, och kvoten är 100 per dygn), rättningar efter min granskning samlas i en commit per runda, inga lokala `npm run build` eller `npm run dev`, handskrivna och additiva migrationer som körs med `scripts/apply-sql.mjs` och numreras efter `schema_migrations`, en ny rad överst i `src/navnyheter/poster.ts` skriven för mottagaren (den gamla posten om att kalendern inte bokar möten ändras inte, den nya säger vad som ändrats), `docs/NASTA_SESSION.md` och `docs/ARBETSLOGG.md` uppdaterade efter passet, och `npm test` plus `node tests/rls.mjs` som Definition of Done. Paketet i `docs/leveranskalender/` följer med i pass 1:s commit.

Migrationer: pass 1 skapar alla kalendertabeller i datamodell.sql (`calendar_series` till och med `calendar_undo`), så att pass 2 inte behöver ändra en körd migration. Pass 3 skapar `delivery` och `delivery_handoff`.

| Pass | Innehåll | Referensbilder |
|---|---|---|
| 1 Möten | Beslutet och avstegen i DECISIONS.md, tokens och `leveranskalender.css`, skalet med Dag, Arbetsvecka, Vecka, Månad och Agenda, migrationen, utkorgen med jobbet, Ångra, RLS och `kalender_handelser()`, formuläret med datumväljare och tider, deltagare, assistent, krock, svar i panel och klocka, förslag, flytt med nytt svar, ändrad längd, inställt, kopiera, sök och tangentbord | 01–04, 06–08, 15–18, 20. Bortse från leveranskön, 1:1-serier och leveransposter i bilderna |
| 2 1:1 | Serier på `upprepning.ts` (utöka regeln med intervall, veckovis och varannan vecka), valet vid flytt av serie, agenda och åtgärder, åtgärd till uppgift, anteckningar till coachningssamtal, säljarens siffror, förberedelsenotisen | 09, 11, 19 |
| 3 Leverans | `delivery`, `delivery_handoff`, kön och överlämningen, förinställningarna i leveransfärg, utfall och försöksstegen, `calendar_reminder` med Resend och webhooks, CRM-adaptern | 12–14, samt leveranskön i 01 |
| 4 Team och omvärld | Teamet med kapacitet, `.ics`-bilaga i `Brev`, kickoffinbjudan till kunden, ny iCal-källa för händelserna bredvid den befintliga frånvarofeeden | 05 |

Varje pass är klart när acceptanskriterierna för passet i SPEC.md avsnitt 4 är uppfyllda.

## 8. Efter varje pass

Skicka mig:

1. Previewadressen, vilka referensbilder jag ska jämföra och vilka delar av dem som hör till passet.
2. En tabell: acceptanskriterium → uppfyllt eller inte → hur du kontrollerade det.
3. Varje avvikelse från prototypen eller SPEC.md, med skälet. Inga tysta avsteg.
4. Vad `npm test` och `node tests/rls.mjs` gav.
5. Vilka testposter och testkonton du vill att jag lägger upp för att prova passet.

Om något i prototypen inte går att bygga som det ser ut: stanna, beskriv problemet, föreslå två vägar och fråga. Gissa aldrig bort ett utseende.
