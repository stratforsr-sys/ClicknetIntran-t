# Intresseavvägning — registrering av arbetstid i Clicknet Nav

**UTKAST. Ska läsas av någon med dataskyddskompetens innan det beslutas.**
Texten är skriven utifrån hur navet faktiskt är byggt och utifrån PRD:n — inte
utifrån en juridisk bedömning av er verksamhet. Slutsatsen är avsiktligt tom.

| | |
|---|---|
| Personuppgiftsansvarig | Clicknet AB |
| Behandling | Registrering av arbetstid, sen ankomst och raster |
| Beslutad av | *(namn, roll)* |
| Beslutsdatum | *(fylls i vid beslut — dokumentet gäller inte utan datum)* |
| Omprövas senast | Sex månader efter beslut |

---

## 1. Vad som behandlas

Avvägningen omfattar tre skilda behandlingar. De har olika grund och ska
bedömas var för sig — att bunta ihop dem är det vanligaste felet.

### 1.1 In- och utstämpling

Tidpunkt för arbetspassets början och slut, per anställd. Registreras av den
anställda själv med två knapptryck. Ingen positionsdata samlas in — det finns
ingen kolumn för det i databasen, och det går alltså inte att lägga till i
efterhand utan en dokumenterad ändring.

**Grund:** i första hand rättslig förpliktelse enligt arbetstidslagens krav på
förda anteckningar (ATL 11 §) samt fullgörande av anställningsavtalet. Ingen
intresseavvägning krävs för denna del.

**En utebliven instämpling kan leda till en konsekvens.** Beslut 2026-08-24, se
D-K12 i `DECISIONS.md`. Saknas instämpling en arbetsdag skapar navet ett
**förslag** till närmaste chef. Ingenting sker av sig självt: chefen måste
godkänna att frånvaron var ogiltig, och först då registreras händelsen. Två
ogiltiga frånvarotillfällen inom tre månader medför att månadens bonusar
faller — grundprovisionen berörs inte, eftersom den avser utfört arbete.

Behandlingen är en följd av samma rättsliga grund som registreringen i övrigt:
frånvaro från avtalad arbetstid är ett anställningsförhållande, inte en
beteendemätning. Den anställda ser varje registrerad händelse i sin egen vy och
i registerutdraget, och chefens hävning av en konsekvens loggas.

### 1.2 Sen ankomst mot schema

Dagens första instämpling jämförs mot arbetsschemats starttid. Överskrids
toleransen registreras en rad med antal minuter, tidpunkt och vilket schema
bedömningen gjordes mot. Toleransen sätts per schema och är som lägst en minut.

**Grund:** berättigat intresse (art. 6.1.f). Kräver denna avvägning.

### 1.3 Raststämpling och rastavvikelser

Tidpunkt när rast påbörjas och avslutas, samt avvikelser mot rastschemat i fyra
typer: för tidig start, överskriden längd, utebliven rast och rast utanför
schemat.

**Grund:** berättigat intresse (art. 6.1.f). Kräver denna avvägning, och är den
mest ingripande av de tre.

---

## 2. Berättigat intresse

Arbetsgivaren har ett intresse av att

- kunna visa att arbetstidslagens regler följs, inklusive rätten till rast
  efter fem timmars arbete (ATL 15 §),
- ha ett korrekt underlag för lön,
- upptäcka arbetsbelastning som gör att raster uteblir,
- kunna följa upp att överenskomna arbetstider hålls.

De tre första är svåra att invända emot. Det fjärde — punktligheten — är ett
verkligt men svagare intresse, och det är det som väger lättast i avsnitt 4.

## 3. Nödvändighet

Frågan är inte om registreringen är *nyttig* utan om ändamålet kan nås med
något mindre ingripande.

| Alternativ | Varför det inte räcker |
|---|---|
| Ingen registrering alls | Uppfyller inte ATL 11 § och ger inget löneunderlag |
| Manuell tidrapport i efterhand | Bygger på minnesbild, ger sämre kvalitet i just det underlag lagen kräver |
| Endast in och ut, ingen rast | **Räcker för 1.1 och för lönen.** Det är därför rasten är avstängd tills detta dokument är beslutat |
| Stickprov i stället för heltäckande | Ger inte den fullständiga anteckning ATL kräver |

Slutsatsen för 1.3 är alltså att raststämpling är nödvändig för
rast-uppföljningen specifikt — inte för lönen, och inte för arbetstidslagens
anteckningar i övrigt.

## 4. Den anställdas intresse och rimliga förväntningar

En anställd förväntar sig att arbetsgivaren vet när arbetsdagen börjar och
slutar. Det är en del av anställningen.

Rasten ligger närmare privatlivet. Att registrera när någon äter lunch, och hur
länge, är att följa en människas dag på en detaljnivå som går utöver vad de
flesta räknar med. Q67 är besvarad så att säljarna får lämna arbetsplatsen
under rasten — den är alltså fri tid, inte måltidsuppehåll, och registrering av
fri tid väger tyngre på den anställdas sida.

Sen ankomst ligger däremellan. Att arbetsgivaren märker att någon kommer sent
är en normal del av ett anställningsförhållande. Det som väger på den
anställdas sida är precisionen: ett system som larmar på minuten uppfattas
annorlunda än en chef som noterar ett mönster.

## 5. Skyddsåtgärder som faktiskt är byggda

Detta är inte avsiktsförklaringar. Var och en går att kontrollera i koden och i
databasen.

| Åtgärd | Var den sitter |
|---|---|
| Ingen positionsdata kan lagras | Ingen kolumn finns; kontrolleras med kodgranskning (AC-2.9) |
| Chefen ser avvikelser, inte ett flöde av stämplingar | Avvikelsevyn rör aldrig `time_event` (AC-2.10, K16) |
| Rastlängd visas aldrig i "på plats nu" | Frågan hämtar bara in- och utstämpling (AC-2.8) |
| Varje chefsöppning av avvikelsevyn loggas | `deviation.viewed` i händelseloggen (AC-2.12, K19) |
| Detaljer gallras efter 90 dagar | Nattjobb; endast antal per månad står kvar i 12 månader (AC-2.31) |
| **Rast- och sen ankomst-data når aldrig provisionen** | Ingen fråga kopplar dem. Gäller 1.2 och 1.3 (K13, K17, D-K12) |
| **Ingen konsekvens utlöses automatiskt** | Utebliven instämpling ger ett förslag; chefen måste godkänna det innan något sker (D-K12) |
| En registrerad konsekvens kan hävas av chefen | Hävningen loggas i händelseloggen (D-K12) |
| Utebliven rast behandlas som arbetsmiljösignal | Märks som sådan i vyn (AC-2.29, K31) |
| Toleransen läggs till gränsen, aldrig ifrån | Den som arbetat 5 h 3 min utan rast har inte gjort fel |
| Historiska avvikelser omvärderas aldrig | Varje avvikelse bär id på schemat den dömdes mot (AC-2.35) |
| Inget bedöms mot ett schema den anställda inte kvitterat | Utan kvittens genereras ingenting (AC-2.36) |
| Stämplingar kan inte ändras eller raderas | Databastrigger; rättelse skapar ny rad och båda syns (AC-2.3) |
| Den anställda ser allt som registrerats om hen | Egna avvikelser och sena dagar i sin egen vy |

## 6. Avvägning

*(Fylls i av den som beslutar. Nedan är underlaget, inte slutsatsen.)*

För **1.2 sen ankomst** talar att arbetstiden är avtalad och att uppföljningen
är begränsad till en tidpunkt per dag, utan automatiska följder. Emot talar att
minutprecision kan upplevas som kontrollerande. En tolerans satt så snävt som
möjligt bör kunna motiveras med att den ska fånga mönster, inte enskilda
minuter — och det motivet ska stämma med hur uppgifterna faktiskt används.

För **1.3 raststämpling** talar arbetsmiljöskälet: uteblivna raster är en
signal om för hög belastning, och den signalen finns inte utan registrering.
Emot talar att rasten är fri tid. Skyddsåtgärderna i avsnitt 5 är utformade för
att göra ingreppet så litet som möjligt: chefen ser avvikelsen, inte rasten.

## 7. Beslut

*(Fylls i.)*

- [ ] 1.2 Sen ankomst — behandlingen får ske, tolerans: ____ minuter
- [ ] 1.3 Raststämpling — behandlingen får ske

Ort och datum: ______________________

Underskrift: ______________________

## 8. Omprövning

Beslutet omprövas senast sex månader efter beslutsdatum (K20). Vid omprövningen
ska minst följande gås igenom: hur många avvikelser som faktiskt genererats, om
de lett till någon åtgärd, och om ändamålet i avsnitt 2 hade kunnat nås med
mindre registrering.
