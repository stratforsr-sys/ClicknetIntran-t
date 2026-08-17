# Backlog — allt som återstår innan navet är driftklart

Härlett ur PRD v1.0 (funktion) och UI/UX-PRD v1.0. Ordningen följer den
**omprioritering i §1.6** som ersätter den ursprungliga leveransplanen i §11.2,
eftersom organisationen sexdubblas innan systemet finns.

Status: `KLAR` · `PÅGÅR` · `EJ PÅBÖRJAD` · `BLOCKERAD`

Veckoestimaten är PRD:ns egna och räknar med 15 h/vecka, varav cirka 60 % går
till granskning, innehåll och beslut — inte till att generera kod.

---

## Prio 0 — Innehåll och juridik. Ingen kod, men blockerar drift

Detta är arbete som inte kan delegeras till kod och som redan är försenat i
förhållande till tillväxten.

| # | Vad | Status | Blockerar |
|---|---|---|---|
| P0.1 | **Skriftlig arbetsmiljöpolicy** (AFS 2023:1, krav från 10 anställda) | EJ PÅBÖRJAD | K32, deadline ~4 v |
| P0.2 | **Skriftlig uppgiftsfördelning** i arbetsmiljöarbetet | EJ PÅBÖRJAD | K32, samma deadline |
| P0.3 | **Intresseavvägning för raststämpling**, daterad | EJ PÅBÖRJAD | K12 — spärrar hela M2 |
| P0.4 | **Förhandsinformation om stämpling**, kvitterad av 100 % | EJ PÅBÖRJAD | K14 |
| P0.5 | **Dokumenterat rastschema** enligt ATL 15 § | EJ PÅBÖRJAD | K29 — spärrar avvikelsefunktionen |
| P0.6 | **Registerförteckning** över samtliga behandlingar | EJ PÅBÖRJAD | K1 |
| P0.7 | **PUB-avtal** med Supabase, Vercel, e-postleverantör | EJ PÅBÖRJAD | K22 |
| P0.8 | **Riskbedömningar** dokumenterade skriftligt | EJ PÅBÖRJAD | K24 |
| P0.9 | **Rutininventering** enligt Bilaga A — vad finns, var, vem äger, är det aktuellt | EJ PÅBÖRJAD | E2 |
| P0.10 | **Mät baslinjer** före lansering: krediteringar 12 mån, ramp-tid | EJ PÅBÖRJAD | Effektbevis mot VD |
| P0.11 | **Onboarding-checklista** i pappersform, användbar nu | EJ PÅBÖRJAD | Rekryteringsvågen |
| P0.12 | Svar på **Q78, Q79, Q80** — provision vid avslut, garantilönens karaktär, betalningskälla | EJ PÅBÖRJAD | E13 |
| P0.13 | Svar på **A2** kollektivavtal och **A3** lönesystem | EJ PÅBÖRJAD | M2, M3, lönerapport |

---

## E0 — Fundament · KLAR

| # | Vad | Status |
|---|---|---|
| E0.1 | Repo, Next.js App Router, TypeScript, Tailwind v4 | KLAR |
| E0.2 | Designtokens enligt UI-PRD §4, kontrastverifierade | KLAR |
| E0.3 | Supabase eu-north-1, migrationsflöde med checksumma | KLAR |
| E0.4 | RLS-mönster etablerat och verifierat mot anonym anslutning | KLAR |
| E0.5 | Deploy från main till Vercel | KLAR |
| E0.6 | **Sentry eller motsvarande felrapportering** | EJ PÅBÖRJAD |
| E0.7 | **Strukturerad loggning och larm vid integrationsfel** | EJ PÅBÖRJAD |
| E0.8 | **Transaktionell e-post** från hej@clicknet.se med SPF, DKIM, DMARC (R13) | EJ PÅBÖRJAD |
| E0.9 | **Testuppsättning**: minst ett test per modul som verifierar att fel roll får 0 rader (DoD p. 4) | EJ PÅBÖRJAD |
| E0.10 | **Backup verifierad** genom testad återläsning, kvartalsvis rutin | EJ PÅBÖRJAD |
| E0.11 | Eget domännamn, t.ex. nav.clicknet.se | EJ PÅBÖRJAD |

---

## E1 — M1 Identitet, organisation, behörighet · PÅGÅR

| # | AC | Vad | Status |
|---|---|---|---|
| E1.1 | AC-1.1 | Inloggning med magisk länk och lösenord | KLAR |
| E1.2 | AC-1.1, K33 | **MFA obligatoriskt** för sales_manager, ceo, finance, admin och alla med payroll_cost_viewer: engångskod via e-post, spärr i middleware, enheten ihågkommen 30 dagar | BYGGD MEN AVSTÄNGD — `MFA_REQUIRED_ROLES` är tom tills mejlmallen bär koden, se DRIFTSATTNING punkt 0. **K33 är inte uppfylld så länge.** |
| E1.3 | AC-1.2 | Väntar på aktivering | KLAR |
| E1.4 | AC-1.3 | Upplägg skapar konto och roll | KLAR |
| E1.5 | AC-1.3 | **Automatisk tilldelning** av rutiner, kurser, schema och team vid upplägg | DELVIS — rutiner och team klara, kurser väntar på E8 och schema på E4 |
| E1.6 | AC-1.4 | Offboarding: roller, sessioner, status, historik | KLAR |
| E1.7 | AC-1.4 | **Offboarding stänger dialer-kö och spärrar iCal-flöde** | BLOCKERAD av E7, E12 |
| E1.8 | AC-1.4 | **Öppna ärenden avslutas med notis vid offboarding** | EJ PÅBÖRJAD — E3 finns nu, spärren är borta |
| E1.9 | AC-1.5 | Rollbyte loggas med vem som beviljade | KLAR |
| E1.10 | AC-1.6 | RLS på alla persondatatabeller, verifierat | KLAR |
| E1.11 | AC-1.7 | Offboarding-checklista med kvittens och motiveringstvång | KLAR |
| E1.12 | AC-1.8 | **Konton utan inloggning på 45 dagar flaggas** — kräver schemalagt jobb (R11) | KLAR |
| E1.13 | — | **Teamhantering i UI**: skapa team, sätt teamledare, koppla anställd till team och chef | KLAR |
| E1.14 | — | **Egen profilsida**: se sina uppgifter, byta lösenord, aktivera MFA | KLAR |
| E1.15 | §1.4 | **Admin-vy för `payroll_cost_viewer`** — tilldelas per person, varje ändring loggad (AC-13.13) | KLAR |

---

## E2 — M5 Rutiner och dokument · I DRIFT (kvar: E2.5, E2.12 bilagor, E2.13) · ~3 veckor

Modulen som skalar dig som chef. Måste finnas före onboardingvågen.

| # | AC | Vad | Status |
|---|---|---|---|
| E2.1 | AC-5.1 | Tabeller `document`, `document_version`, `document_ack` med `owner_id` och `review_due` som NOT NULL på databasnivå | KLAR |
| E2.2 | — | Redigering i markdown med förhandsgranskning | KLAR |
| E2.3 | AC-5.4 | Varje sparning skapar ny version, tidigare versioner läsbara | KLAR |
| E2.4 | AC-5.2 | Förfallen granskning märks "EJ GRANSKAD SEDAN {datum}" för alla läsare | KLAR |
| E2.5 | AC-5.3 | Notiser till ägaren 30, 7 och 0 dagar före. Efter 30 dagars försening till sales_manager | EJ PÅBÖRJAD — kräver E0 transaktionell e-post |
| E2.6 | AC-5.5 | Kvittens kopplad till **versionen** — ny version kräver ny kvittens | KLAR |
| E2.7 | AC-5.6 | Kvittensrapport: vilka som kvitterat, vilka som inte | KLAR |
| E2.8 | AC-5.7 | Fritextsök över `body_md`, titel och kategori (svensk tsvector, GIN) | DELVIS — PDF-text kvar, se E2.12 |
| E2.9 | AC-5.8 | Målgruppsstyrning per roll och team. Ej behörig får 404, inte "åtkomst nekad" | KLAR |
| E2.10 | AC-5.9 | Dokumenttyperna `work_env_policy`, `risk_assessment`, `task_allocation` med årlig `review_due` | KLAR |
| E2.11 | AC-5.10 | Läsvy fullt användbar på 375 px, radlängd max 70 tecken | KLAR |
| E2.12 | — | Mappträd och filterchips | KLAR. Bilagor via Storage + PDF-textextraktion | EJ PÅBÖRJAD |
| E2.13 | — | Global sökning i toppraden aktiveras (kortkommando `/`) | EJ PÅBÖRJAD |

---

## E8 — M6 Utbildning och certifiering · I DRIFT (kvar: E8.5, E8.7, E8.8, E8.9)

Flyttad fram från Fas 2 enligt §1.6. Det är denna modul som gör att 25 nya
säljare kan lära sig samma sak utan att du upprepar introduktionen trettio gånger.

| # | AC | Vad | Status |
|---|---|---|---|
| E8.1 | AC-6.1 | Kurs med moduler i ordning, progression sparad per modul | KLAR |
| E8.2 | AC-6.2 | Quiz med konfigurerbar godkäntgräns och spärrtid vid omtag | KLAR |
| E8.3 | AC-6.3 | Godkänd kurs skapar certifikat med utgångsdatum | KLAR |
| E8.4 | AC-6.4 | Kurser tilldelas automatiskt utifrån roll vid anställning | KLAR |
| E8.5 | AC-6.5 | `blocks_capability` styr dialer-kö: utan giltig certifiering endast begränsat segment | BLOCKERAD av E12 |
| E8.6 | AC-6.6 | Progressvy per person och team: klara, pågående, försenade, utgångna | KLAR |
| E8.7 | AC-6.7 | Rollspelscertifiering: uppladdat testsamtal bedöms mot rubrik | EJ PÅBÖRJAD — kräver Storage, samma beroende som E2.12 |
| E8.8 | AC-6.8 | Utgående certifikat notifierar 30 dagar i förväg | EJ PÅBÖRJAD — kräver transaktionell e-post (E0), som E2.5 |
| E8.9 | Bilaga B | **Kursinnehåll skrivet** — 8 kurser. Se U11: tjänsteutbudet är bredare än SEO | EJ PÅBÖRJAD |

---

## E3 — M4 Personalärenden · KLAR (2026-08-17), utom AC-4.6

| # | AC | Vad | Status |
|---|---|---|---|
| E3.1 | AC-4.1 | Kategorier: lön/provision, utrustning, schema, arbetsmiljö, konflikt, utveckling, övrigt | KLAR |
| E3.2 | AC-4.2 | Konfigurerbar SLA per kategori med automatisk eskalering | KLAR — nattjobb 07:00, markering tills notiser finns |
| E3.3 | AC-4.3 | Konfidentiellt ärende synligt endast för sales_manager och ceo, verifierat på RLS-nivå | KLAR — verifierat mot API:t |
| E3.4 | AC-4.4 | Anställd ser sina egna ärenden och hela dialogen | KLAR — ingen intern anteckning finns |
| E3.5 | AC-4.5 | Statistikvy: antal per kategori, team och månad samt median lösningstid | KLAR |
| E3.6 | AC-4.6 | Datamodellen stödjer anonymt ärende, avstängt via feature flag (visselblåsning vid 50 anställda) | DELVIS — kolumnen finns, flaggan står på false |
| E3.7 | AC-4.7 | Vid ≥3 liknande frågor föreslår systemet att skapa ett dokument i M5 | KLAR — 3 per kategori på 90 dagar |
| E3.8 | — | Inkorgsmönster: lista vänster, tråd höger, SLA-status som färgad kant | KLAR — lista och tråd på egna sidor |

---

## E10 — M7 Rekrytering · ~4 veckor

Q71 avgör om denna är akut: rekryteras 25 personer av en person är den det.

| # | AC | Vad | Status |
|---|---|---|---|
| E10.1 | AC-7.1 | IMAP-parser mot jobb@clicknet.se. Misslyckad parsning skapar ärende, aldrig tyst bortfall | EJ PÅBÖRJAD |
| E10.2 | AC-7.2 | Egen ansökningssida på clicknet.se med screeningfrågor och källattribution | EJ PÅBÖRJAD |
| E10.3 | AC-7.3 | Stegflöde ny → screening → intervju 1 → intervju 2 → erbjudande → anställd/avslag, varje byte loggat | EJ PÅBÖRJAD |
| E10.4 | AC-7.4 | Egen tidsluckehantering, .ics-bilaga via e-post, påminnelse 24 h och 2 h före | EJ PÅBÖRJAD |
| E10.5 | AC-7.5 | `no_show` registreras och rapporteras per källa | EJ PÅBÖRJAD |
| E10.6 | AC-7.6 | Scorecard per intervju. Erbjudande omöjligt utan minst en ifylld | EJ PÅBÖRJAD |
| E10.7 | AC-7.7 | Avslagsmail med mall, enskilt eller i grupp | EJ PÅBÖRJAD |
| E10.8 | AC-7.8, K21 | `gdpr_purge_at` sätts automatiskt, nattjobb raderar och kvitterar, talangpool undantas med förnyad förfrågan | EJ PÅBÖRJAD |
| E10.9 | AC-7.9 | Vid "anställd": avtal, onboarding-checklista, konto och kurser i ett flöde | EJ PÅBÖRJAD |
| E10.10 | AC-7.10 | Trattrapport per källa inklusive kvar efter 90 och 180 dagar | EJ PÅBÖRJAD |

---

## E9 — Avtalsgenerator och e-signering · ~2 veckor

| # | Vad | Status |
|---|---|---|
| E9.1 | Avtalsmallar för anställning, kopplade till upplägg av anställd | EJ PÅBÖRJAD |
| E9.2 | E-signering — leverantör ej vald (A14) | BLOCKERAD |
| E9.3 | Anställningsavtalet ska reglera Q78 och Q79 | BLOCKERAD av P0.12 |

---

## E4 — M2 Tid och närvaro · FÄRDIGBYGGD (utom E4.20, E4.22), AVSTÄNGD AV K12

Får inte aktiveras i produktion innan intresseavvägningen är skriven och
daterad. Koden finns och är testad; påslaget sker med `M2_AKTIV` i
`src/lib/tid.ts`. Utkast till K12 och K14 ligger i `docs/`.

| # | AC | Vad | Status |
|---|---|---|---|
| E4.1 | AC-2.1 | Stämpling in/ut/rast på max 2 knapptryck, mobil och kiosk | KLAR — bakom M2_AKTIV |
| E4.2 | AC-2.2 | Fungerar offline, händelsen köas lokalt med **ursprunglig** tidsstämpel | KLAR — bakom M2_AKTIV |
| E4.3 | AC-2.3 | Ingen `time_event` kan raderas eller ändras. Rättelse skapar ny rad | KLAR — trigger i databasen |
| E4.4 | AC-2.4 | Automatisk stängning vid schemaslut med flagga för rättelse | KLAR — stänger vid schemaslut, märks för rättelse |
| E4.5 | AC-2.5 | Rättelseflöde med chefsattest, båda versioner synliga | KLAR — bakom M2_AKTIV |
| E4.6 | AC-2.6, K2 | **Arbetstidsjournal** med jour-, över- och mertid åtskilda, PDF och CSV under 5 sekunder, dold i vardagen under `/admin/arbetstid` | KLAR — /admin/arbetstid med CSV, olänkad |
| E4.7 | AC-2.7, K3 | Journaldata bevaras 3 år, undantagen gallring | KLAR — egen tabell, undantagen gallringen |
| E4.8 | AC-2.8 | Live-vy "på plats nu" med namn och in-tid, aldrig rastlängd | KLAR — bakom M2_AKTIV |
| E4.9 | AC-2.9, K4 | Ingen platsdata samlas in — verifieras med kodgranskning | KLAR — ingen kolumn finns |
| E4.10 | AC-2.23–2.26 | Rastschema per anställd och veckodag, avvikelsetyperna early_start, overrun, missing, unscheduled, konfigurerbar tolerans | KLAR — bakom RAST_AKTIV (K29) |
| E4.11 | AC-2.34 | Inställningsvy för raster: mall per bolag, team eller person | KLAR — /tid/schema, mall per bolag, team eller person |
| E4.12 | AC-2.35 | Schemaändring skapar ny rad. **Historiska avvikelser omvärderas aldrig** | KLAR — nytt valid_from, historik omvärderas aldrig |
| E4.13 | AC-2.36 | Anställda notifieras och kvitterar innan avvikelser genereras mot nytt schema | KLAR — utan kvittens genereras inga avvikelser |
| E4.14 | AC-2.10, AC-2.27, K16 | Chefsvy visar endast avvikelser. Verifieras mot **API**, inte UI | KLAR — vyn rör aldrig time_event |
| E4.15 | AC-2.28 | Anställd ser egna avvikelser i sin helhet och kan kommentera | KLAR — egna avvikelser med svarsfält |
| E4.16 | AC-2.29, K31 | `missing` lyfts som arbetsmiljösignal, inte disciplinärt | KLAR — missing märks som arbetsmiljösignal |
| E4.17 | AC-2.30, K13, K17 | Ingen automatisk konsekvens. Avvikelsedata oåtkomlig för provision och lönekostnad | KLAR — ingen automatisk konsekvens byggd |
| E4.18 | AC-2.31, AC-2.11, K18 | Gallring efter 90 dagar, månadsaggregat kvar 12 månader | KLAR — 90 dagar, aggregat 12 månader |
| E4.19 | AC-2.12, AC-2.32, K19 | Varje chefsöppning av avvikelsevyn loggas | KLAR — deviation.viewed i loggen |
| E4.20 | AC-2.22 | Tyst 48-timmarsnotis till sales_manager | BLOCKERAD |
| E4.21 | AC-2.19, AC-2.20 | Orden övertid, mertid och jourtid får inte förekomma i något vardagsgränssnitt | KLAR — orden finns bara i arbetstidsjournalen |
| E4.22 | K20 | Omprövning av raststämpling efter 6 månader — kalenderpost | BLOCKERAD |

## E4b — Lönerapport · KLAR (2026-08-17)

| # | AC | Vad | Status |
|---|---|---|---|
| E4b.1 | AC-2.13 | Lönerapport per period och person: arbetad tid, frånvaro per typ, avvikelser. **Ingen övertid** | KLAR — frånvaro per typ tomt tills E7 finns |
| E4b.2 | AC-2.14 | Kan inte genereras vid oavslutade avvikelser. Systemet listar vad som blockerar | KLAR — rättelser, öppna dagar och avvikelser listas |
| E4b.3 | AC-2.15, K5b | Attesteras av människa, attesten låser perioden | KLAR — ekonomi får inte attestera |
| E4b.4 | AC-2.16 | Attesterad period är oföränderlig, korrigering som justeringspost | KLAR — triggrar, provade mot databasen |
| E4b.5 | AC-2.17, K5 | Ingen beräknad lön, inget belopp, ingen semesterrätt | KLAR — beloppsfält går inte att lägga till |
| E4b.6 | AC-2.18 | Konfigurerbart exportformat mot lönesystemet (A3) | KLAR — kolumnerna ligger i payroll_export_column |

---

## E7 — M3 Frånvaro och ledighet · ~4 veckor

| # | AC | Vad | Status |
|---|---|---|---|
| E7.1 | AC-3.1 | Ansökan för alla typer inklusive del av dag | EJ PÅBÖRJAD |
| E7.2 | AC-3.2 | Bemanningsvy vid ansökan med varning vid överskriden tröskel | EJ PÅBÖRJAD |
| E7.3 | AC-3.3 | **iCal-flöde** med hemlig roterbar URL, enkelriktat | EJ PÅBÖRJAD |
| E7.4 | AC-3.4 | Godkänd frånvaro flödar in i lönerapporten | BLOCKERAD av E4b |
| E7.5 | AC-3.5 | Saldon endast om manuellt inmatade, varning om äldre än 45 dagar | EJ PÅBÖRJAD |
| E7.6 | AC-3.6, AC-3.27 | **Ingen digital sjukanmälningsknapp.** Telefon först, registrering efteråt. Mottagarordning konfigurerbar | EJ PÅBÖRJAD |
| E7.7 | AC-3.16–3.18 | `sick_report` med `first_sick_day` skilt från `registered_at`. Chefsbekräftelse, eskalering efter 48 h, chefsfallback | EJ PÅBÖRJAD |
| E7.8 | AC-3.19 | Oregistrerad frånvaro flaggas som påminnelse, den anställde ser den först | EJ PÅBÖRJAD |
| E7.9 | AC-3.21, K35 | **Ingen orsak, diagnos eller symtombeskrivning** får registreras — inget fritextfält | EJ PÅBÖRJAD |
| E7.10 | AC-3.22, K36 | Läkarintyg åtkomstbegränsat, varje öppning loggad | EJ PÅBÖRJAD |
| E7.11 | AC-3.23, K37 | Automatiska frister: dag 8 intyg, dag 15 Försäkringskassan, dag 30 plan för återgång | EJ PÅBÖRJAD |
| E7.12 | AC-3.24 | Återinsjuknande inom 5 dagar kopplas till föregående period | EJ PÅBÖRJAD |
| E7.13 | AC-3.25 | Upprepad korttidsfrånvaro ger tyst signal om rehabiliteringsansvar | EJ PÅBÖRJAD |
| E7.14 | AC-3.26 | Sjukdata exkluderad från alla prestations-, provisions- och kostnadsvyer | EJ PÅBÖRJAD |
| E7.15 | M3.2 | **Regelmotor**: ansökningsfrist, huvudsemesterfönster, spärrperiod, bemanningstak, maxlängd, karens, attestnivå per typ | EJ PÅBÖRJAD |
| E7.16 | AC-3.7–3.10 | Semesterlagens stöd: beskedsfrist 2 månader, femårsvarning för sparade dagar, uppsägningstid | EJ PÅBÖRJAD |
| E7.17 | AC-3.11–3.13 | Regler konfigureras i UI, överstyrning kräver motivering, den anställde ser reglerna före inskick | EJ PÅBÖRJAD |
| E7.18 | AC-3.14 | Årlig semesterplaneringsvy med luckor och överlapp | EJ PÅBÖRJAD |

---

## E5 — M11 Startsida och kommunikation · ~1 vecka

| # | AC | Vad | Status |
|---|---|---|---|
| E5.1 | AC-11.1 | Startsidan visar stämpling, mina uppgifter, nya rutiner, obesvarade kvittenser, pågående kurser | PÅGÅR — skalet finns, källorna saknas |
| E5.2 | AC-11.2 | Nyhetsinlägg med målgruppsstyrning | EJ PÅBÖRJAD |
| E5.3 | AC-11.3 | Sidan laddar under 1,5 s på 4G | EJ PÅBÖRJAD |
| E5.4 | §12 Q9 | Rollstyrd startsida: säljaren ser stämpling, chefen ser köer och avvikelser | EJ PÅBÖRJAD |
| E5.5 | §6 | **Bottennavigering under 768 px**: Hem, Sök, Stämpla, Mer | EJ PÅBÖRJAD |
| E5.6 | §5.1 | Hopfällbar sidopanel med sparat läge per användare | EJ PÅBÖRJAD |
| E5.7 | §5.7 | Notissystem nere till höger med ångra-möjlighet | EJ PÅBÖRJAD |

---

## E6 — M12 Styrning, loggning, gallring · ~1 vecka

| # | AC | Vad | Status |
|---|---|---|---|
| E6.1 | AC-12.1 | `audit_log` täcker samtliga sju händelsetyper | PÅGÅR — M1:s händelser klara |
| E6.2 | AC-12.2, K10 | **Nattligt gallringsjobb** som verkställer `retention_until` och skriver kvittens | EJ PÅBÖRJAD |
| E6.3 | AC-12.3 | Objekt i låst dossier undantas från gallring | BLOCKERAD av E11 |
| E6.4 | AC-12.4, K25 | **Registerutdrag**: all data om en person som JSON plus filer | EJ PÅBÖRJAD |
| E6.5 | AC-12.5 | Adoptionsstatistik: DAU/WAU, sökningar utan träff, dokument utan visningar 90 dagar | EJ PÅBÖRJAD |

---

## E11 — M8 Inkio och affärsdossier · ~4 veckor · BLOCKERAD av A5

Kräver Inkios API-dokumentation, autentiseringsmodell och webhook-events.

| # | AC | Vad | Status |
|---|---|---|---|
| E11.1 | AC-8.1 | `deal_link` skapas inom 60 sekunder via webhook, 5 minuter via polling | BLOCKERAD |
| E11.2 | AC-8.2 | Dossiern samlar avtal, inspelning, samtalslogg, kunddata, SEO-diagnos, orderbekräftelse | BLOCKERAD |
| E11.3 | AC-8.3 | `dossier_state` beräknas löpande, säljaren ser checklista över vad som saknas | BLOCKERAD |
| E11.4 | AC-8.4 | **"No doc, no deal"** — provision beräknas inte förrän dossiern är komplett | BLOCKERAD |
| E11.5 | AC-8.5 | Legal hold i ett klick, spärrar gallring, skapar ärende | BLOCKERAD |
| E11.6 | AC-8.6 | Låst dossier exporteras som ZIP med tidslinje i PDF | BLOCKERAD |
| E11.7 | AC-8.7 | Navet skriver tillbaka endast dossierstatus och länk | BLOCKERAD |
| E11.8 | AC-8.8, AC-8.9 | Kö med exponentiell backoff, timeout 10 s, max 5 försök, anrops-ID loggat | BLOCKERAD |
| E11.9 | AC-8.10–8.14 | Godkännandegrind före fakturering, delegering till team_lead, SLA 48 h, avslag med åtgärdspost, KPI på mediantid | BLOCKERAD |

---

## E12 — M9 Dialerintegration · ~4 veckor · BLOCKERAD av A6

| # | AC | Vad | Status |
|---|---|---|---|
| E12.1 | AC-9.1, AC-9.2 | Stämpling styr dialer-kön, rast pausar den | BLOCKERAD |
| E12.2 | AC-9.3 | Avslutat samtal skapar `call` inom 60 sekunder | BLOCKERAD |
| E12.3 | AC-9.4, K8 | `purpose` och `retention_until` sätts vid skapandet | BLOCKERAD |
| E12.4 | AC-9.5, AC-9.12, AC-9.13 | 2 slumpade samtal per säljare och vecka, endast bland sålda, fast slumpfrö | BLOCKERAD |
| E12.5 | AC-9.14, AC-9.15 | Granskningskö med räknare, försenad post eskalerar efter 7 dagar | BLOCKERAD |
| E12.6 | AC-9.16–9.19 | Granskning mot rubrik, allvarlig avvikelse skapar ärende och flaggar dossiern, återkoppling obligatorisk | BLOCKERAD |
| E12.7 | AC-9.6, K11 | Clicknets egen granskningsrubrik inklusive inspelningsinformation | BLOCKERAD |
| E12.8 | AC-9.8, AC-9.9 | Spärrlista synkad från navet, centralt ringtidsfönster | BLOCKERAD |
| E12.9 | AC-9.10 | Aktivitetsvy: samtal per närvarotimme, kontaktgrad, snittlängd | BLOCKERAD |
| E12.10 | AC-9.11, K9 | Uppspelning av inspelning loggas alltid | BLOCKERAD |
| E12.11 | §9.1 Q75 | **Kö B** — coachningsurval bland icke-sålda samtal, tyngdpunkt på ramp-fas | BLOCKERAD |
| E12.12 | §9.2 | Antal granskningar konfigurerbart per team, annars överges kön inom två månader | BLOCKERAD |

---

## E13 — M10 Provision · ~3 veckor · BLOCKERAD av Q78, Q79, Q80

| # | AC | Vad | Status |
|---|---|---|---|
| E13.1 | AC-10.1 | Provisionsregler som konfiguration, inte kod | BLOCKERAD |
| E13.2 | AC-10.7 | Livscykel intjänad → väntar på betalning → betalbar → utbetald, varje övergång tidsstämplad | BLOCKERAD |
| E13.3 | AC-10.8 | Betalbar först när kundens första faktura är betald — kräver källa (Q80) | BLOCKERAD |
| E13.4 | AC-10.9, R14 | **Säljaren ser väntande provision** med belopp och förväntat datum. Åtgärdar den enskilt största avhoppsrisken | BLOCKERAD |
| E13.5 | AC-10.10 | Garantilön i samma vy med avräkning tydligt redovisad | BLOCKERAD |
| E13.6 | AC-10.11 | KPI: median dagar från vunnen affär till utbetald provision | BLOCKERAD |
| E13.7 | AC-10.12 | Regel vid avslutad anställning synlig för säljaren | BLOCKERAD |
| E13.8 | AC-10.2–10.5 | Underlag rad för rad, clawback, attestflöde, oföränderlig efter godkännande | BLOCKERAD |
| E13.9 | AC-10.6, K13 | Provisionsdata och tiddata kan inte samköras i någon vy | BLOCKERAD |

---

## E15 — M13 Lönekostnadsvy · ~2 veckor

| # | AC | Vad | Status |
|---|---|---|---|
| E15.1 | AC-13.1, K26 | Kräver `payroll_cost_viewer`, 0 rader utan — verifierat på API-nivå | EJ PÅBÖRJAD |
| E15.2 | AC-13.3, §13.2 | Alla satser i `cost_rate`, ingen procentsats som literal i kod | EJ PÅBÖRJAD |
| E15.3 | AC-13.4, AC-13.5 | Beräkningsordningen i §13.1. Åldersvillkor per kalendermånad inklusive 25 000-taket | EJ PÅBÖRJAD |
| E15.4 | AC-13.6, AC-13.7 | Per säljare, team och bolag. **Täckningsbidrag och break-even i kronor sålt** | EJ PÅBÖRJAD |
| E15.5 | AC-13.8 | Varje beräkning sparad med `rates_used` så historiska siffror kan förklaras | EJ PÅBÖRJAD |
| E15.6 | AC-13.10, K27 | **Endast födelseår.** Inga personnummer någonstans i systemet | EJ PÅBÖRJAD |
| E15.7 | AC-13.11 | Prognosläge mot pipeline | BLOCKERAD av E11 |
| E15.8 | §13.3, K28 | Årlig påminnelse om satsunderhåll med dokumenterad ägare | EJ PÅBÖRJAD |

---

## Tvärgående kvalitetskrav

| # | Vad | Status |
|---|---|---|
| X1 | **WCAG 2.1 AA**: kontrast, tangentbord, fokus, `aria-describedby` på formulärfel | PÅGÅR |
| X2 | **375 px** fungerar för stämpling, ledighet, rutiner, kurser, ärenden | PÅGÅR |
| X3 | Startsida under 1,5 s, sök under 500 ms, stämpling under 2 s | EJ PÅBÖRJAD |
| X4 | 99,5 % drift 07–19 vardagar, stämpling med offline-fallback | EJ PÅBÖRJAD |
| X5 | Signerade tidsbegränsade URL:er för alla filer | EJ PÅBÖRJAD |
| X6 | Test som verifierar att fel roll får 0 rader — per modul | EJ PÅBÖRJAD |
| X7 | **Pilot med 3 personer i två veckor** före bredd (§11.4) | EJ PÅBÖRJAD |
| X8 | Mörkt läge — beslutat att skjutas upp, tokens förberedda | UPPSKJUTET |
| X9 | Logotyp B1 (ljus bakgrund) och B3 (symbolmärke) som SVG | BLOCKERAD |

---

## Sammanräkning

| Fas | Epics | Veckor enligt PRD |
|---|---|---|
| Klart | E0 delvis, E1 delvis | — |
| Fas 1 kvar | E1 rest, E2, E3, E8, E5, E6 | ~12 |
| Fas 2 | E7, E9, E10 | ~10 |
| Fas 3 | E11, E12, E13, E15 | ~13 |
| **Totalt till fullt system** | | **10–12 månader vid 15 h/vecka** |

Den siffran är PRD:ns egen och tar redan hänsyn till att ungefär 60 % av tiden
går till granskning, innehåll och beslut. Den tar däremot **inte** hänsyn till
att du samtidigt ska driva säljresultat och rekrytera 25 personer — se §1.6:s
egen invändning om att köpa in extern utvecklingshjälp för Fas 3 och 4.
