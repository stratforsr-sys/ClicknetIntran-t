# Intresseavvägning — raststämpling · UTKAST

**Status:** utkast att granska, datera och underteckna. Det är daterandet som
uppfyller K12, inte att texten finns.

**Innan den undertecknas:** låt någon med dataskyddskompetens läsa den. Jag har
skrivit den utifrån PRD:n och hur navet faktiskt är byggt, inte utifrån en
juridisk bedömning av er verksamhet.

| | |
|---|---|
| Personuppgiftsansvarig | Clicknet |
| Behandling | Registrering av arbetstid, inklusive rasters början och slut |
| Rättslig grund | Art. 6.1 b (fullgörande av anställningsavtal) för in- och utstämpling. Art. 6.1 f (berättigat intresse) för raststämpling — därav denna avvägning |
| Beslutad av | |
| Datum | |
| Omprövas senast | 6 månader efter aktivering (K20) |

---

## 1. Vad som behandlas

Fyra händelsetyper per anställd: instämpling, utstämpling, rastens början och
rastens slut. Varje händelse består av person, typ, tidpunkt och källa
(app eller kiosk).

**Vad som inte behandlas.** Ingen positionsuppgift av något slag — inte GPS,
inte wifi-nätverk, inte IP-baserad geolokalisering. Det finns ingen kolumn för
det i databasen, vilket innebär att uppgiften inte kan uppstå ens av misstag.
Ingen bild, ingen ljudupptagning, ingen skärmövervakning, ingen mätning av
tangenttryck eller aktivitet i andra system.

## 2. Ändamål

**a) Underlag för löneredovisning.** Obetald tid ska inte redovisas som
arbetad. Utan registrerad rast går arbetad tid inte att skilja från
närvarotid, och löneunderlaget blir fel — till den anställdas nackdel lika
ofta som till arbetsgivarens.

**b) Efterlevnad av arbetstidslagen.** Arbetsgivaren är skyldig att föra
anteckningar om arbetstid. Rasten avgör var gränsen för sammanhängande arbete
går.

**c) Arbetsmiljö.** Uteblivna raster efter långa arbetspass är en
arbetsmiljösignal. Navet lyfter dem som just det — inte som ett
disciplinärt underlag. Se avsnitt 5.

## 3. Varför ändamålen inte nås med mindre ingripande medel

| Övervägt alternativ | Varför det inte räcker |
|---|---|
| Schemalagd rast utan stämpling | Antar att rasten togs. Är antagandet fel blir löneunderlaget fel, och arbetsmiljösignalen uteblir helt |
| Självrapportering i efterhand | Bygger på minnet av en tid som passerat. Ger sämre uppgifter och mer administration för den anställda |
| Enbart in- och utstämpling | Ger närvarotid, inte arbetad tid. Ändamål a) nås inte |
| Frivillig raststämpling | Ojämn täckning gör underlaget obrukbart och skapar en skillnad mellan den som stämplar och den som låter bli |

## 4. Den anställdas intresse

Registrering av när en människa äter lunch är en behandling av
integritetskänslig karaktär, även om varje enskild uppgift är trivial. Det
tyngsta motstående intresset är risken att uppgifterna används för att bedöma
personen i stället för att räkna hennes tid.

Den risken är hanterad så här:

- **Chefen ser avvikelser, inte ett flöde.** Live-vyn "på plats nu" visar namn
  och in-tid. Den visar aldrig rastlängd. Det är byggt så, inte inställt så.
- **Ingen automatisk konsekvens.** En avvikelse utlöser ingenting av sig själv.
  Ingen varning, ingen påminnelse, ingen markering i något annat system.
- **Avstängd från provision och lönekostnad.** Avvikelsedata är oåtkomlig för
  provisionsberäkning och för lönekostnadsvyn.
- **Varje chefsöppning loggas.** Den som tittar syns i händelseloggen.
- **Gallring.** Detaljerade avvikelseposter gallras efter 90 dagar. Endast
  månadsaggregat kvarstår, i 12 månader.
- **Den anställda ser allt om sig själv** och kan kommentera varje avvikelse.
- **Ingen tid kan ändras i tysthet.** En rättelse blir en ny rad; båda
  versionerna syns. Databasen vägrar att skriva över eller radera en
  stämpling — även för den som har fulla rättigheter.

## 5. Avgränsning mot disciplinära åtgärder

Uteblivna raster behandlas som en arbetsmiljösignal och följs upp som en fråga
om arbetsbelastning. Avvikelsedata används inte som grund för varning,
omplacering, lönesättning eller uppsägning. Denna avgränsning är en
förutsättning för avvägningen — ändras den, faller avvägningen och måste göras
om.

## 6. Slutsats

*(Fyll i efter granskning. Formuleringen nedan är ett förslag.)*

Behandlingen bedöms vara nödvändig för de angivna ändamålen. Med de
begränsningar som beskrivs i avsnitt 4 och 5 bedöms arbetsgivarens berättigade
intresse väga tyngre än den anställdas intresse av att uppgifterna inte
behandlas. Behandlingen aktiveras med verkan från **[datum]** och omprövas
senast **[datum + 6 månader]**.

---

**Underskrift:**

Namn: ______________________  Roll: ______________________

Datum: ______________________
