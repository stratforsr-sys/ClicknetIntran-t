# Säljbarhet: det som ännu är låst till ett företag

Nav ska kunna säljas till fler företag än Clicknet. Det här registret listar det i koden som bara stämmer för ett
företag, ett land eller en leverantör, och vad som krävs för att släppa det. Regeln vid nytt bygge: ett värde som kan
skilja mellan två kunder är en inställning eller data, aldrig en konstant. Går det inte att göra till en inställning
i samma ändring får det en rad här.

Lägena: **öppen** (låst i koden), **en plats** (fortfarande en konstant, men på ett ställe som en inställning kan
ersätta utan att anropen ändras), **löst** (data eller inställning).

Uppdaterad 2026-11-13 (bokningsbladet). Raderna S1–S30 gäller Möten; andra vyer är inte genomgångna.

## Möten

| Id | Vad som är låst | Var | Läge | Nästa steg |
|---|---|---|---|---|
| S1 | Nuläget inför mötet: "Ingen SEO / Gör själv / Har byrå" (Clicknets bransch) | `MOTES_NULAGE` i `src/lib/nav2/motesflode.ts`, skickas i `ND.moten.inst.val` | en plats | Inställning `moten.nulage` (lista med etiketter; tom lista döljer fältet). Nycklarna ligger sparade i `mote.nulage`. |
| S2 | Skälen till ett nej, bland dem "Har redan en byrå" | `MOTES_NEJ_SKAL` i `motesflode.ts` (samma lista som Leads, `SKAL` i `leadsforma.ts`) | en plats | Inställning delad med Leads. Texten ligger sparad i `mote_kedja.nej_skal` och `lead_skal`. |
| S3 | Förslagen i fältet Källa | `MOTES_KALLOR` i `motesflode.ts` | en plats | Inställning `moten.kallor`. Källan är fri text, förslagen sparas inte. |
| S4 | Statistikens text om "vilken sajt det lönar sig att prospektera på" | `utkast.html` | löst | Texten är neutral. |
| S5 | "Ombokning inom 48 timmar räddar en del av dessa möten" | `utkast.html` | löst | Raden är borttagen. |
| S6 | Klockslagens tidszon är Europe/Stockholm. Inställningen `moten.tidszon` styr bara dagarna (bekräftelsefönstret, provisionens månad, påminnelsen om utfall) | `motesTz()` i `motesflode.ts`, `moTz()` i `utkast.html` | en plats | Låt de två funktionerna läsa inställningen. Kvar att flytta dit: `lokal()` i `leads.ts` och de ställen i rutten som räknar svensk tid utan att gå genom funktionen. |
| S7 | Språk och datumformat: `sv-SE`, svenska dag- och månadsnamn, all text i koden | `utkast.html`, rutten, `motesflode.ts` | öppen | Texterna i en katalog per språk. Stort arbete, eget varv. |
| S8 | Valutan "kr" och tusentalsavskiljningen | `utkast.html` (`moKr`) | öppen | En funktion `pengar(n)` och valutan som inställning. |
| S9 | Telefonnummer: `0…` blir `+46…` när numret sparas | `normaliseraTelefon` i `src/lib/leads.ts` | öppen | Landskod som inställning. Sökningen på tavlan jämför nummer utan landskod och är inte låst. |
| S10 | Mötets längder (15, 30, 45, 60, förval 30) och arbetstiden 08–17 | `MOLANGDER`, `MOARBTID` i `utkast.html`; `MOTE_MINUTER`, `DAG_START_MIN`, `DAG_SLUT_MIN` i `motenforma.ts` | öppen | Inställningar `moten.langder` och `moten.arbetstid`; servern skickar dem med svaret från `lediga`, så att klienten slutar spegla. |
| S11 | Kalenderfönstret 14 dagar | rutten | öppen | Uttalat förval, en konstant med namn. |
| S12 | Dagvyns tidslista 06–20 | `utkast.html` | öppen | Följer arbetstiden (S10). |
| S13 | Tyst efter 3 obesvarade eller 21 dagar | `motenforma.ts` | öppen | Inställning. |
| S14 | Ett samtal räknas från 300 sekunder; texten "minst 5 minuter" | `motesstatforma.ts`, `utkast.html` | öppen | Inställning; texten byggs av värdet. |
| S15 | Uppföljning tre arbetsdagar fram, påminnelse 09:00 nästa arbetsdag | `utkast.html` | öppen | Uttalade förval. |
| S16 | Rollnamnen som regler (`sales_manager`, `ceo`, `admin`, `team_lead`, …) | `motenforma.ts`, `moten.ts`, `motesstat.ts`; klientens `MOADMIN` | öppen | Hör till behörighet per modul (superadmin ställer in). Klienten ska läsa flaggor, inte rollnamn. |
| S17 | Videomöten: ett videomöte utan länk sparas med platsen "Microsoft Teams" (`videoNamn(null)`), länken "Skapa mötet i Teams", och listan över tjänster som känns igen när en länk klistras in (Teams, Google Meet, Zoom, Whereby, Webex) | `VIDEONAMN`, `videoNamn` i `motenforma.ts`; `MOMOTESLANK`, `MOPLATS` i `utkast.html` | öppen | Inställning `moten.video` (tjänstens namn och länken för att skapa ett möte). Valet i bladet heter redan "Video" och serverns varningar säger "Möteslänken". Platsnamnet ligger sparat på befintliga möten och jämförs i rutten, så bytet kräver en genomgång av de raderna. |
| S18 | Google Maps för en adress | `utkast.html` | öppen | Uttalat förval. |
| S19 | Samtalen läses ur `phone_call` (Lynes) med `direction = "ut"` | rutten, `motesstat.ts` | öppen | Leverantörsberoende. Statistiken tål att tabellen är tom. |
| S20 | Statistikens kolumnnamn var fasta | `utkast.html` | löst | Läser `moKolNamn`, alltså företagets egna namn på kolumnerna. |
| S21 | Kalenderrubriken slutar på ": Möte"; platsen heter "Telefon" | `motenforma.ts` | öppen | Inställning eller uttalat förval. |
| S22 | Frågornas förval | `motesflode.ts` | löst | Neutralt förval, redan en inställning. |
| S23 | Belopp, mottagare, ombokningsregeln, bekräftelsedagarna, rubrikens prefix | `motesflode.ts` | löst | Inställningar, inga företagsvärden i koden. |
| S24 | Tavlan läste högst 1000 kort utan ordning | `moten.ts` | löst | Läsningen är sorterad, och `ND.moten.kapad` säger när taket nåtts. Paginering i databasen återstår om en kund når taket. |
| S25 | Serverns fel placeras vid fält genom att leta svenska ord i texten | `utkast.html` | öppen | Rutten skickar `falt` med felet. |
| S26 | Notisernas texter är hela svenska meningar i jobbet, också bekräftelsens notis och uppgift ("Bekräfta mötet med …", 2026-11-13) | `moten-jobb.ts` | öppen | Hör till S7. |
| S27 | Företagsnamn i produktkoden | bara i kommentarer | löst | Prefixet är en inställning med tomt förval. |
| S28 | Svenska helgdagar 2026–2027 som konstant i klienten; servern har sin egen arbetsdagsräkning, som sedan 2026-11-13 också styr Mötens bekräftelse (arbetsdagar före mötet) | `FRROD` i `utkast.html`, `arArbetsdag` i `src/lib/saljtakt.ts` (via `bekraftelseFonster` i `motesflode.ts`) | öppen | En källa på servern, per land. Skiljer de sig i dag svarar rutten med sitt fel vid tidsfältet. |
| S29 | Källan föreslås ur uppslaget med två fasta namn: Kallsamtal (numret har ringts upp) och Tidigare kund (bolaget är kund). Finns namnen inte i företagets källor föreslås inget | `MOKALLAUR` i `utkast.html` | en plats | Två nycklar i `moten.kallor` (vilken källa som betyder uppringd och vilken som betyder kund), eller en inställning per signal. |
| S30 | Frimejlsdomänerna (gmail.com, telia.com …) står två gånger: på servern och i klienten för e-postens domänförslag | `FRIMEJL_DOMANER` i `motenforma.ts`, `MOFRIMEJL` i `utkast.html` | öppen | Listan med i `ND.moten.inst`, en källa. Listan är svensk och internationell; ett annat land behöver sina egna. |

## Kan kund nummer två använda Möten i morgon?

Ja, om kunden är svensk, räknar i kronor, arbetar 08–17 och accepterar tre värden som ännu bär Clicknets bransch:
nulägets tre val (S1) och ett av nej-skälen (S2). Belopp, mottagare, frågor, kolumnnamn, bekräftelsedagar och
rubrikens prefix ställs in per företag i Möten → Inställningar. För en kund i ett annat land krävs S6–S9 och S28.
