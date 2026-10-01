# Leveranskalendern · specifikation för bygget

Prototypen (`prototyp.html`, öppna med `#bara-kalender`) är facit för utseende och beteende. Den här filen säger hur varje del blir kod i Nav, vad som måste stämma för att ett pass räknas som klart, och vilka regler backend följer. Står prototypen och den här filen i konflikt vinner prototypen för utseende och den här filen för backend. Fråga vid tvekan.

Innehåll: 1 Ordlista · 2 Skärmkarta · 3 Visuella regler och tokens · 4 Interaktioner och acceptanskriterier · 5 Notismatris · 6 Server actions · 7 Jobb och integrationer · 8 Behörighet · 9 Texter · 10 Byggs inte

---

## 1. Ordlista

En term per begrepp, i kod, gränssnitt och commits.

| Term | Betyder | I koden |
|---|---|---|
| Händelse | Allt med en tid i kalendern | `calendar_event` |
| Möte | Händelse med deltagare | `kind = 'mote'` |
| 1:1 | Återkommande samtal chef och säljare | `kind = 'enskilt'`, alltid i en serie |
| Leveranspost | Händelse i leveransens arbetsgång, alltid kopplad till en order | `kind = 'leverans'`, `step` |
| Uppgift | Navs befintliga uppgift, visas i kalendern | `task`, oförändrad modul |
| Serie | Regel som skapar förekomster | `calendar_series` |
| Förekomst | En gång i en serie | `calendar_event.series_id` + `occurrence_of` |
| Svar | Ja, Kanske, Nej eller Inte svarat | `calendar_attendee.response` (`ja`, `kanske`, `nej`, `vantar`) |
| Förslag | Deltagarens förslag på ny tid | `proposed_dag`, `proposed_tid`, `proposed_minuter` |
| Leveranskön | Godkända order som saknar välkomstsamtal | `delivery.owner_id is null` |
| Överlämning | Säljarens sex fält till leveransen | `delivery_handoff` + ordern |
| Utfall | Nådd eller Ej svar, satt av en människa | `outcome`, `outcome_by` |
| Utkorgen | Allt som lämnar Nav, med 10 s ångerfönster | `outbox` |

## 2. Skärmkarta

Förslag på filer. Byt namn om repots mönster säger annat, men behåll uppdelningen och klassnamnen.

Allt under `src/app/(app)/kalender/`. `LK/` är en ny mapp för kalenderns klientkomponenter. CSS i `leveranskalender.css` under rotklassen `.lk`.

| Del | Prototyp (selektor) | Komponent | Data |
|---|---|---|---|
| Rot | `#proto.proto` | `page.tsx` renderar `<div className="lk proto">` | Server: hämtar vecka, delningar, kö |
| Verktygsrad | `.bar`: `#bToday`, `#bPrev`, `#bNext`, `#range`, `.seg` | `LK/Verktygsrad.tsx` | URL-parametrar `vy`, `dag` |
| Ny händelse (mobil) | `#bNew2.mnew` | i `Verktygsrad.tsx` | – |
| Sidolista | `aside.rail` | `LK/Sidolista.tsx` | – |
| Ny händelse | `#bNew.newbtn` med `kbd` N | i `Sidolista.tsx` | – |
| Sök | `.search #q`, `.qhits` | `LK/Sok.tsx` | Klientfilter över hämtade poster, `.dim` på icke-träffar |
| Minikalender | `.mmhead`, `.mm` | `LK/Minikalender.tsx` | Prickar på dagar med egna poster, inte vardagsserier |
| Leveranskön | `#qwrap`, `.queue .qitem`, `.sla`, `.slabar` | `LK/Leveransko.tsx` | `delivery` + `sales_order`, bara för leverans och säljchef |
| Kalendrar | `.cals` | `LK/Kalenderlista.tsx` | `calendar_share`, delningsnivå per person |
| Förklaring | `.legend` | `LK/Forklaring.tsx` | Statisk |
| Sammanfattning | `.strip` | `LK/Sammanfattning.tsx` | `dagssumma()`, obesvarade inbjudningar, kön |
| Seriebanner | `.selbanner`, `#smOne`, `#smAll`, `#smNo` | `LK/Seriebanner.tsx` | – |
| Rutnät (Dag, Arbetsvecka, Vecka) | `.stage` med `.grid`, `.dh`, `.gut`, `.col`, `.hit`, `.ev`, `.evmore`, `.nowline` | `LK/Rutnat.tsx`, `LK/Post.tsx` | `laggUt()` för kolumner |
| Månad | `.month` | `LK/Manad.tsx` | – |
| Teamet | `.tl` | `LK/Teamet.tsx` | Pass 4 |
| Agenda | `.agenda`, `.agday`, `.agitem` | `LK/Agenda.tsx` | 7 dagar från vald dag |
| Panel | `aside.drawer` med `.dhd`, `.dbody` | `LK/Panel.tsx` | – |
| Mötespanel | `renderMeeting()` | `LK/Motespanel.tsx` | Händelse + deltagare |
| 1:1-panel | `renderOneOnOne()`, `.stat`, `.alist` | `LK/Enskildpanel.tsx` | Serie, `one_on_one_item`, säljarens siffror |
| Leveranspanel | `renderCustomerEvent()`, `.crm`, `.box`, `.plan` | `LK/Leveranspanel.tsx` | Order, `delivery`, `delivery_handoff`, `calendar_reminder` |
| Kökort | `renderQueueCard()` | `LK/Kokort.tsx` | – |
| Formulär | `renderForm()`, `.tabs`, `.presets`, `.field`, `.chipbtn`, `.durs` | `LK/Formular.tsx` | – |
| Datumväljare | `.dfield`, `.dp` | `LK/Datumvaljare.tsx` | `veckonummer()` |
| Tider | `timeHTML()`, `#fStart`, `#fEnd`, `.durs` | `LK/Tidsval.tsx` | – |
| Schemaläggningsassistent | `.sa`, `.sar`, `.sat`, `.blk`, `.band` | `LK/Assistent.tsx` | Upptagen tid för deltagarna enligt delningsnivå |
| Krockvarning | `#fClash`, `.clashbox` | i `Formular.tsx` | – |
| Föreslå ny tid | `renderProposal()` | `LK/Forslag.tsx` | – |
| Svarsknappar | `.rsvp`, `[data-rsvp]` | `LK/Svar.tsx` | – |
| Kvitto med Ångra | `#toast` | `LK/Kvitto.tsx` (eget, inte kakkvittot i `Toast.tsx`) | `angra()` med id på raden i `calendar_undo` |
| Snabbsvar i klockan | `[data-nq]` i `#npanel` | Utöka `components/shell/Notisklocka.tsx` | `notification_event` med referens till händelsen |

Varje komponent renderar samma element och klasser som prototypen, i samma ordning. `aria-*`, `role` och `title` följer med.

## 3. Visuella regler och tokens

### Nya tokens i `src/app/globals.css`

Lägg till i `@theme`. Värdena är prototypens ljusa läge.

```css
/* Leveranskalendern (DECISIONS: D-xx) */
--color-line:        #E3E8E8;  /* 1 px linjer i rutnät och formulär */
--color-line-strong: #CBD4D3;
--color-lev:         #9A3412;  /* leveranspost, fylld */
--color-lev-ink:     #FFFFFF;
--color-lev-soft:    #FFF4EB;
--color-lev-line:    #F3C9A8;
--color-slate-ink:   #2F3F5C;  /* 1:1 */
--color-slate-tint:  #E6EAF3;
--color-plum-ink:    #5B2E6E;
--color-plum-tint:   #F1E6F5;
--color-now:         #D2544B;  /* nu-linjen */
--color-hatch:       rgba(30, 158, 122, .14);
--color-pend:        rgba(14, 26, 25, .06);
--color-av-1: #0E1A19; --color-av-2: #C2410C; --color-av-3: #3E86C9;
--color-av-4: #8E54A8; --color-av-5: #0B7F6E; --color-av-6: #6B7A79;
--shadow-seg: 0 1px 2px rgba(0, 0, 0, .08);
--color-hatch-on-lev: rgba(255, 255, 255, .14);
```

Befintliga tokens används som de är: prototypens `--canvas`, `--surface`, `--surface-alt`, `--ink-*`, `--brand-*`, `--ok*`, `--warn*`, `--danger*`, `--info*`, `--accent-*`, `--shadow-1`, `--shadow-3` motsvaras av `--color-*` och `--shadow-elev-1`, `--shadow-elev-3`. `#fff` i prototypens regler blir `var(--color-ink-inv)`.

Avatarer: initialer från `initials()` i `lib/auth.ts`, färg `--color-av-N` där N väljs stabilt från personens id (samma person har alltid samma färg).

### Medvetna avsteg från UI-PRD, som beslut i DECISIONS.md

Skriv in som ett nytt beslut, ungefär så här:

> **D-xx · Kalendern följer prototypen, inte kortreglerna.** Inuti `/kalender` har rutnätet och formuläret 1 px linjer (`--color-line`), knapparna radie 10 px, veckan är ett timrutnät som i Outlook och kvittot ligger nere i mitten. Skälet: kalendern ska kännas som Outlook, och prototypen `docs/leveranskalender/prototyp.html` är godkänd som facit. Navs skal, sidopanel och klocka är oförändrade. Ersätter valet av listvecka i `Veckovy.tsx`.

### Mått

Alla mått står i `referens/stilmatt.json`, uppmätta i ljust läge vid 1320 × 1000. Några som styr helheten:

| Del | Värde |
|---|---|
| Halvtimmesrad i rutnätet | 26 px (`SH`), 06:00–20:00 |
| Arbetstid (tonad bakgrund utanför) | 08:00–17:00 |
| Post | radie 8 px, luft 4 px 7 px 4 px 9 px, 12 px text, rubrik 700 |
| Leveranspost | fylld `--color-lev`, vit text, radie 8 px |
| Dagrubrik | veckodag 11 px 700 versaler, datum 22 px 700, dagsumma JetBrains Mono 10,5 px |
| Samtidiga poster | högst 2 kolumner i veckovyer, 6 i dagvyn, resten som `+N fler` |

### Lägen för en post

| Läge | Klass | Utseende |
|---|---|---|
| Inte svarat | `.pending` | streckad ram, snedrandig bakgrund (`--color-pend`) |
| Kanske | `.maybe` | prickad ram |
| Nej (visas bara med "Visa möten jag avböjt") | `.declined` | genomstruken, nedtonad |
| Klar | `.done` | genomstruken rubrik, blekt |
| Ej svar | `.missed` | som i prototypen |
| Upptagen (bara delningsnivå upptagen) | `.busyonly` | rubriken "Upptagen" |
| Sökträff saknas | `.dim` | nedtonad |
| Återkommande | `.rep` | ↻ efter rubriken |

## 4. Interaktioner och acceptanskriterier

Varje punkt ska gå att visa i previewen. `prototyp-flodesprov.cjs` klickar igenom samma flöden i prototypen och kan läsas som en exakt beskrivning av dem.

### Pass 1 · Möten

**Navigering och vyer**
1. Vyerna Dag, Arbetsvecka, Vecka, Månad och Agenda. `Ctrl+Alt+1–4` och `6` byter vy, `Ctrl+Alt+←/→` byter period (läs `event.code`), `Idag` går till i dag. Vald vy och dag står i URL:en och överlever omladdning.
2. Dagrubriken visar veckodag, datum, dagsumma "X av 6 h" (alla ogjorda bokningar den dagen, som prototypens `daySum`, mot `DAGSTAK`), `+` som öppnar formuläret på första lediga tid den dagen, och heldagsposter som chip.
3. Nu-linjen och nu-etiketten står på rätt minut i dagens kolumn och flyttar sig utan omladdning.
4. Fler samtidiga poster än kolumngränsen ger `+N fler`. Klick öppnar dagvyn.
5. Klick på en dag i minikalendern eller Månad öppnar den dagen.

**Skapa**
6. `+ Ny händelse`, tangenten `N` (när ingen skriver i ett fält) och `+` i dagrubriken öppnar formuläret. Utan vald tid föreslås första lediga tid för alla deltagare.
7. Dra nedåt i tomt rutnät: en markering med tider följer pekaren och formuläret öppnas med start och slut. Helg är inte valbar för möten.
8. Typflikarna Möte, 1:1 och Uppgift. Under dem, bara för leverans och säljchef, raden Leverans med de sex förinställningarna (pass 3). Standardfliken är Möte, för leveransen förinställningen Kickoff.

**Datum och tid**
9. Datumfältet visar "Onsdag 30 september 2026" och "v. 40". Klick öppnar en minikalender med veckonummer i vänsterkolumnen. Pilar flyttar, Enter väljer, Esc stänger och fokus går tillbaka till fältet.
10. Start och slut i steg om 15 min. Slutlistan visar längden i parentes. Snabbvalen 15 min, 30 min och 1 timme sätter slutet.

**Deltagare, assistent och krock**
11. Deltagare väljs som chip. Assistenten visar en rad per person med upptagen tid 08–17 och den valda tiden som band. Klick i en rad väljer tid. `Föreslå tid` hittar första gemensamma lucka 08–17 inom två veckor, i steg om 15 min, aldrig över lunch 12–13, aldrig närmare än 15 min från nu, aldrig på helg.
12. Krockar tiden visas krockrutan före sparandet med valen att boka ändå eller låta Nav föreslå.
13. Hur mycket assistenten visar om en kollega styrs av delningsnivån (`kalender_niva()`): upptagen tid alltid, rubriker först från nivå rubriker.

**Svar och förslag**
14. Inbjudna får notis och mejl (`.ics`-bilagan kommer i pass 4). De svarar Ja, Kanske eller Nej från panelen eller direkt i Navs klocka. Organisatören får en notis om svaret. Ingen får en notis om något hen själv gjort.
15. `Föreslå ny tid` öppnar ett eget formulär med datumväljare, start, slut och meddelande. Organisatören ser förslaget i panelen och kan godkänna eller behålla tiden. Godkänt förslag flyttar händelsen, och den som föreslog räknas som Ja.
16. Förslag går att göra för en enskild förekomst i en serie.

**Flytta, ändra längd och Ångra**
17. Organisatören flyttar genom att dra posten eller med `Flytta` (nästa gemensamma lediga tid inom 7 dagar). Andra som drar får beskedet att de kan föreslå en ny tid.
18. Dra i nederkanten av en egen post ändrar längden i steg om 15 min, 15 min till 8 h.
19. Ny tid eller längd nollställer alla deltagares svar till Inte svarat, utom organisatörens och förslagsställarens. Kvittot säger vilka som behöver bekräfta.
20. Varje ändring ger ett kvitto med `Ångra` i minst 8 s. Ångra inom 10 s tar bort utkorgens rader och ingenting skickas.
21. `Ställ in` sätter `cancelled_at` och notifierar deltagarna med mejl. Från pass 3 avbokas även Resend-påminnelsen.
22. `Kopiera till nästa vecka` skapar en ny händelse 7 dagar senare med nollställda svar och ny inbjudan.

**Sök, agenda, tillgänglighet**
23. Sökfältet filtrerar på person, kund och rubrik. Träffar listas under fältet och övriga poster tonas ned.
24. Agendan visar 7 dagar från vald dag, grupperad per dag med veckonummer, med tid, rubrik och status. Lördagar och söndagar utan poster hoppas över.
25. Allt går med tangentbord, fokus syns, varje knapp har en etikett för skärmläsare. Under 700 px bredd är Agenda standardvyn när URL:en inte anger någon vy (bestäms i klienten), och vid 400 px finns ingen vågrät rullning.

### Pass 2 · 1:1

26. 1:1 skapas som serie, varje vecka eller varannan vecka, med en säljare. Förekomster materialiseras 56 dagar framåt med logiken i `upprepning.ts`, utökad med intervall (en ändring som inte påverkar uppgiftsserierna).
27. Flytt av en förekomst visar seriebannern: `Bara den här gången`, `Hela serien`, `Avbryt`. Bara den här gången påverkar svaren bara för den gången. Hela serien nollställer svaren för serien.
28. 1:1-panelen visar säljarens siffror (order mot mål, K&V-snitt, provision), gemensam agenda och åtgärder. Ogjorda åtgärder följer med till nästa gång. En åtgärd blir en uppgift med ett klick.
29. `Be om förberedelse` ger den andra en notis. Vardagen före kl 15 får båda en förberedelsenotis (dagtidsjobbet kör bara vardagar, så en 1:1 på måndag förbereds fredag kl 15).
30. Anteckningarna kan sparas som coachningssamtal (`coaching_session_id`). Innehållet ses av samma krets som coachningssamtalet (avsnitt 8).

### Pass 3 · Leverans

31. När en order godkänns (`approved_at` sätts) skapar samma action en rad i `delivery`. `welcome_due_at` är godkänd + 24 h räknat i vardagstimmar: godkänd fredag 14:00 ger måndag 14:00. Kunden hamnar i kön och leveransen får en notis. Makuleras ordern tas den bort ur kön, och är välkomstsamtalet bokat får den ansvariga en notis.
32. Kökortet visar kund, paket, säljare, nedräkning (grön över 8 h, gul under 8 h, röd när försenad) och överlämningen `X/6`. Dra kortet till en tid, välj `Välj tid i kalendern`, eller boka med `Föreslå tid och boka` och Vem: `Först lediga i leverans`, `Jämn fördelning i leverans` (den med minst leveransposter i veckan) eller en namngiven person. Två projektledare kan aldrig ta samma kund.
33. Saknas fält i överlämningen visas vilka. `Be säljaren komplettera` ger säljaren notis och mejl.
34. Förinställningarna Välkomstsamtal 30 min, Tillgångar 30 min, Kickoff 60 min (kunden bjuds in), Leveransstart 90 min, 30-dagarsavstämning 30 min och 90-dagarsgenomgång 60 min. Posterna är fyllda i leveransfärg (`--color-lev`), och ingen annan sorts post har den färgen.
35. Mejlpåminnelse 30 min före till den ansvariga, och till kunden om det är valt. Påminnelseraden i formuläret visar den exakta tiden. Flytt flyttar mejlet, inställt eller klar avbokar det.
36. Utfallet sätts bara med `Nådd, markera genomfört` eller `Ej svar`. Ingen automatik. Ej svar bokar nästa försök på första lediga 30 minuter minst 3 h efter det missade, inom 5 dagar. Efter tredje försöket föreslås sms och mejl. Nådd går att ångra, Ej svar inte (som i prototypen).
37. Nådd skickar status "välkomnad" till CRM:et via adaptern och föreslår kickoff.
38. CRM-rutan visar kopplingen. Med den manuella adaptern klistras kund-ID:t in. Misslyckad synk försöker igen och ger efter tre försök en notis till admin.

### Pass 4 · Team och omvärld

39. Teamet (`Ctrl+Alt+5`): personer som rader, grupperade i Säljteamet och Leverans, kapacitet per dag, innehåll enligt delningsnivå.
40. `Brev` får stöd för en `.ics`-bilaga. Inbjudningar till kollegor får bilagan, och kickoffinbjudan går till kunden som mejl med `.ics`. Ombokning skickar en ny version med samma UID och högre SEQUENCE, inställt skickar CANCEL.
41. Var och en kan prenumerera på sina händelser i Outlook via iCal: en ny källa bredvid den befintliga frånvarofeeden (`calendar_feed` och `lib/ical.ts` tar i dag bara frånvaro).

## 5. Notismatris

Allt via `notifiera()`, anropad när utkorgen töms. Nya källor i `HANDELSEKALLOR`, de som mejlas även i `MEJLKALLOR`. Mejl bara när mottagaren behöver agera före nästa inloggning.

| Händelse | Till | Klocka | Mejl | Pling | Anmärkning |
|---|---|:-:|:-:|:-:|---|
| Inbjudan | Deltagarna | ✓ | ✓ | – | Mejlet bär `.ics`. Svara direkt i klockan. |
| Flyttad eller ändrad längd | Deltagarna | ✓ | ✓ | – | "Svara igen". Mejl bara inom 7 dagar, alltså två källor: en med mejl, en utan. |
| Inställd | Deltagarna | ✓ | ✓ | – | Kunden får CANCEL om den var inbjuden. |
| Påminnelse | Alla som tackat ja | – | – | ✓ | 10 min före (`PLING_VARSEL_MINUTER`), kan ändras per händelse. |
| Dagens möten | Alla med möten | – | ✓ | – | Rader i morgonbrevet, inget eget mejl. |
| 1:1 förberedelse | Båda | ✓ | – | – | Vardagen före kl 15. |
| Ny punkt på 1:1-agendan | Den andra | ✓ | – | – | Samlas till en notis per dag. |
| Svar | Organisatören | ✓ | – | – | Nej med meddelande i klartext. |
| Förslag på ny tid | Organisatören | ✓ | ✓ | – | Gäller en förekomst om det är en serie. |
| Leveranspåminnelse | Ansvarig, kund om valt | – | ✓ | ✓ | Resend 30 min före. Studs ger notis. |
| Ny kund i kön | Leverans | ✓ | – | – | |
| 4 h kvar av 24-timmarsfristen | Leverans och säljchef | ✓ | ✓ | – | Det enda mejlet från kön. |
| Komplettera överlämningen | Säljaren | ✓ | ✓ | – | |
| Välkomstsamtal bokat | Ansvarig och säljaren | ✓ | – | – | |
| CRM-synk misslyckades | Admin | ✓ | – | – | Efter tre försök. |

## 6. Server actions

I `src/app/(app)/kalender/actions.ts` eller en ny `leverans/actions.ts`. Varje action: validera indata på servern, kontrollera behörigheten själv, skriv utkorgens rader och `calendar_undo` i samma transaktion, lägg de ångrabara i `ANGRABARA`. I `tests/notiser-tackning.mjs` bokförs de som notifierar som `"notifierar via utkorgen (<fil>)"`, eftersom `"notifierar"` kräver ett `notifiera(`-anrop i actionens egen kropp. Kolumnen Notifierar nedan säger vem, inte exakt bokföringstext.

| Action | Gör | Notifierar | Ångrabar |
|---|---|---|---|
| `skapaHandelse` | Möte, uppgift eller leveranspost, med deltagare och påminnelser | notifierar | ja |
| `skapaSerie` | 1:1 eller återkommande möte | notifierar | ja |
| `svara` | Ja, Kanske, Nej, för serien eller en förekomst | notifierar | ja |
| `foreslaTid` | Förslag med tid och meddelande | notifierar | ja |
| `godkannForslag` / `behallTid` | Organisatörens beslut | notifierar | ja |
| `flytta` | Ny dag och tid, nollställer svar, flyttar Resend-mejl | notifierar | ja |
| `flyttaSerie` | Ny veckodag och tid för serien | notifierar | ja |
| `andraLangd` | Nytt slut, nollställer svar | notifierar | ja |
| `stallIn` | `cancelled_at`, avbokar påminnelser | notifierar | ja |
| `kopiera` | Kopia en vecka senare | notifierar | ja |
| `sattUtfall` | Nådd eller Ej svar, nästa försök | notifierar inte: utfallet syns i kalendern. CRM-status via utkorgen | Nådd ja, Ej svar nej |
| `taKund` | Kund ur kön till en tid, `for update skip locked` | notifierar | ja |
| `begarKomplettering` | Notis och mejl till säljaren | notifierar | nej |
| `kopplaCrm` | Manuellt kund-ID | notifierar inte: bara den som gör det berörs | ja |
| `laggTillPunkt` / `bockaAv` / `punktTillUppgift` | 1:1-agenda och åtgärder | notifierar, samlat till en notis per dag | ja |
| `beOmForberedelse` | Notis till den andra | notifierar | nej |

## 7. Jobb och integrationer

- **Utkorgen.** Sorterna `notis` (töms genom `notifiera()`, aldrig både via utkorgen och direkt), `ics`, `resend_schedule`, `resend_patch`, `resend_cancel` och `crm`. Rader med `not_before = now() + 10 s`. Töms av `after()` i den action som skrev dem (vänta ut fönstret, skicka, sätt `sent_at`) och av en ny route `/api/jobb/utkorg` som `pg_cron` ringer varje minut via `pg_net`, precis som 0059 gör med dagtidsjobbet. Samma `idempotency_key` skickas aldrig två gånger. Tre misslyckade försök ger `error` och en notis till admin. `vercel.json` rörs inte.
- **Resend.** `Brev` i `lib/epost.ts` får `scheduledAt`. Påminnelser: `POST /emails` med `scheduledAt`, `PATCH /emails/{id}` vid flytt, `POST /emails/{id}/cancel` vid inställt eller klar. Ett avbokat mejl kan inte schemaläggas igen, så en senare ombokning skapar ett nytt. Mer än 30 dagar bort schemaläggs av nattjobbet. Ny källa `leverans-paminnelse` i `MEJLKALLOR`.
- **Resend-webhooks.** Ny route som verifierar signaturen, sparar kroppen rå i `integration_log` och uppdaterar `calendar_reminder.status` (`skickad`, `fel`). `bounced` eller `failed` ger notis till den ansvariga.
- **Dagtidsjobbet** (var kvart, vardagar 05–19 UTC) får: kön 4 h kvar, 1:1-förberedelsen kl 15 vardagen före, materialisering av serier inom 56 dagar.
- **Ångra.** `calendar_undo` håller läget före ändringen och utkorgens rad-id:n. `angra()` får en gren för kalendern som gör om behörighetskontrollen, återställer läget, raderar oskickade rader och loggar ångringen som en egen rad, som de andra grenarna.
- **CRM-adaptern.** Gränssnittet har `skapaKund(order, overlamning)`, `sattStatus(externtId, status)` och `hamta(externtId)`. Den manuella adaptern sparar bara det inklistrade ID:t. Allt som går ut loggas råt i `integration_log`.
- **iCal.** Kickoff till kunden som `.ics` med stabilt UID per händelse, SEQUENCE som ökar vid varje ändring och METHOD REQUEST eller CANCEL.

## 8. Behörighet

- En ny funktion, till exempel `kalender_handelser()`, levererar händelserna. `kalender_poster()` ändras inte, eftersom `main` i produktionen läser den. `kalender_niva()` används som den är. Deltagare och organisatör ser allt. Andra ser enligt `calendar_share`: upptagen (grundläge), rubriker eller detaljer.
- En 1:1:s agenda, åtgärder och anteckningar ses av exakt samma krets som `coaching_session` i 0043: säljaren, den som håller samtalet, säljarens chef (`leads_employee`) och de som får läsa alla anställda (`can_read_all_employees`). Andra ser bara tiden enligt delningsnivån.
- Organisatören flyttar, ändrar längd och ställer in. Den som har nivån `redigera` eller `delegat` i organisatörens kalender får göra detsamma för organisatörens räkning, som `farPlaneraOm()` redan säger. Alla andra kan bara svara och föreslå ny tid.
- Leveranskön och leveransposterna syns för roller `project_manager`, `delivery` och säljchefen. Säljaren ser sina egna kunders överlämning.
- `node tests/rls.mjs` utökas med: säljare A ser inte säljare B:s 1:1-innehåll, kollega på nivå upptagen ser bara "Upptagen", en extern mottagare (kunden) kan aldrig läsa något.

## 9. Texter

Använd prototypens texter ordagrant. De viktigaste kvittona:

- `Flyttad till {dag} {tid}[, bara den här gången]. {namn} behöver bekräfta den nya tiden.[ Kunden får en uppdaterad inbjudan.][ Mejlpåminnelsen flyttas till kl {tid}.]`
- `Hela serien flyttad till {veckodag}ar {tid}. {namn} behöver bekräfta den nya tiden.`
- `Nu {start}–{slut}. {namn} behöver bekräfta den nya tiden.`
- `Svar skickat: {svar}. {organisatör} ser det i sin klocka.` · för en förekomst: `Svar skickat för {dag}: {svar}. …`
- `Förslaget skickat till {organisatör}: {när}.`
- `Bara organisatören kan flytta. Du kan föreslå en ny tid.`
- `Inställt. {namn} får en notis och ett mejl.[ Mejlpåminnelsen avbokas hos Resend.]`
- `Välkomstsamtal med {kund} bokat {dag} {tid} hos {person}. {säljare} får en notis.`
- `Försök {n} bokat {dag} {tid}, på en annan tid på dagen.` · `Tredje försöket utan svar. Skicka sms och mejl med en bokningslänk.`
- `Kickoff {dag} {tid}. {kontakt} får inbjudan via mejl.`
- `Kopierad till {dag} {tid}. Inbjudan skickad igen.`
- `Ångrat. Inget skickades.`
- `Ingen gemensam tid de närmaste 7 dagarna.` (Flytta) · `Ingen gemensam tid de närmaste två veckorna.` (Föreslå tid) · `Ingen ledig tid de närmaste fem dagarna.` (kön) · `Välj en vardag.` · `Skriv en rubrik först.`

Förnamn i kvitton, fullt namn i paneler. Datum som `ons 30 sep`, tider som `09:00`.

## 10. Byggs inte

"Som"-väljaren, panelen Bakom kulisserna, knapparna Visa mig, exempeldatat, prototypens egen notisklocka, rapportsidorna runt `#proto`, mörkt läge. Kvitton som slutar med "I prototypen …" ersätts av det riktiga beteendet.
