# Möten: vem som höll mötet, utfallet och nästa steg

Beställt 2026-11-16 (Zen): "när en annan säljare Fredrik på Make your dream la steget offert skickad, så kunde jag
inte lägga ett utfall så det möte har nu inget utfall ifall det var kvalificerat, så jag måste typ kunna ändra vem det
är som faktiskt ska hålla i mötet och den ska kunna sätta utfallet och sen sätta nästa steg. Gå över detta för det
känns lite luddigt, se hur alla populära CRM system gör och gör det ordentligt." Och: "det ska då inte räknas som ett
nytt bokat möte när man bokar efter första mötet."

## 1. Läget, med belägg

**Fallet.** Make your dream AB: Mick bokade, Zen står som hållare, Fredrik (med på kortet) satte Hållet + Offert
skickad 2026-11-16 14:58. Kvalificeringen (`niva`) är tom, och mötet "väntar på bedömning".

**Varför det låste sig** (kartlagt i koden):

- Utfallet sätts en gång. Ett andra försök ger 409 "Mötet har redan fått ett utfall." (`moten/route.ts:1029`).
- Kvalificeringen (frågorna) får bara den som STÅR som hållare, eller en admin, göra (`farBedoma`,
  `motenforma.ts:293`). Sätter någon annan Hållet sparas mötet utan nivå och väntar (`route.ts:1038-1047`).
- Hållaren går inte att byta efter bokningen. `halls_av` skrivs bara när mötet läggs (`route.ts:628`); Ändra har
  inget sådant fält (`route.ts:1548-1565`).
- Ingen notis går när någon annan sätter utfallet, så hållaren får aldrig veta att något väntar på hen.

Den som faktiskt höll mötet (Fredrik) får alltså inte bedöma det, och den som står som hållare (Zen) höll det inte.

**Hur vanligt.** I produktionen: på 7 av 16 möten med utfall satte någon annan än hållaren utfallet. 5 hållna möten
väntar på bedömning, alla med Zen som hållare. Fältet "hållare" stämmer ofta inte med vem som höll mötet.

**Uppföljningar räknas redan rätt i de flesta fall.** Ett möte bokat där kunden redan träffats får arten
`uppfoljning` (`motesArt`, `mote_kunden_traffad` i 0296), och säljtavlan, statistiken och mötesprovisionen räknar bara
`ny` (ombokningar till den ursprungliga bokaren). I produktionen: 32 `ny`, 3 `uppfoljning`, och inget `ny` med ett
tidigare möte på samma kort. Men det finns luckor där ett möte som inte är nytt ändå blir `ny`:

- **(a)** Kunden har bara haft Uteblev eller Avbokat och någon trycker "Boka nytt möte" på kortet: klienten skickar
  aldrig vilket möte det följer på (`foregaende`), så det blir `ny`, inte `ombokning`, och räknas som en ny bokning.
- **(c)** Ett nytt kort för samma kund som bara uteblivit på ett annat kort: `ny` igen.
- **(e)** Hållet sätts först efter att nästa möte bokats på ett nytt kort: jobbet `mote_art_ratta` rättar bara
  framtida möten utan utfall.

## 2. Hur andra gör det (undersökningen, källorna sist)

- **Tre fält, inte ett:** bokaren (krediten), den planerade hållaren och den som faktiskt höll mötet. Att byta hållare
  skriver aldrig över bokaren (RevenueHero/Salesforce `Booked_By` + `Assignee`; HubSpot "created by" + "assigned to").
- **Den som höll mötet sätter utfallet**, och vem som satte det sparas. Kontrollen är att bokaren aldrig ensam äger
  ett steg som ger hen pengar (Pulse RevOps: "SDR får inte ensam äga något betalbart steg").
- **Kvalificerad är ett eget steg ovanpå Hållet**, och det är säljarens (AE:ns) bedömning. Nav gör redan så.
- **Krediten följer bokaren**, inte den som tog över mötet.
- **Uppföljning markeras i datan när mötet bokas**, inte i statistiken i efterhand: "samma kund har redan ett räknat
  första möte". Ett återvinningsfönster (30–90 dagar hos Pulse RevOps, ett exempel, inte en norm) avgör när en kund
  räknas som ny igen.

## 3. Målet

1. Den som höll mötet går att sätta, före och efter mötet, av dem som är med på kortet.
2. Den som höll mötet sätter utfallet, svarar på frågorna (kvalificerat eller inte) och väljer nästa steg i **ett**
   flöde.
3. Ingen kan ändra sin egen mötesprovision genom att byta hållare.
4. Ett möte efter det första räknas aldrig som ett nytt bokat möte, och bladet säger det när man bokar.
5. Det som väntar på någon syns för den personen (notis + kortet), så att inget blir hängande som Make your dream.

**Icke-mål nu:** att flytta kundens kalenderinbjudan till en ny organisatör (se 5.2), att ändra
provisionsreglerna, att ändra vem som får se kortet.

**Anti-mål:** att en bokare kan ge sig själv provision genom att byta hållare; att ett byte syns för kunden; att
utfallet går att sätta två gånger med olika svar.

## 4. Upplevelsen

### 4.1 Utfallet, för den som höll mötet

Utfallsdialogen börjar med frågan **"Vem höll mötet?"**, förvald på den som står som hållare, med de andra på kortet
som val. Väljer Fredrik sig själv:

1. **Vem höll mötet?** Fredrik. (Raden under: "Zen står som hållare. Du blir hållare för det här mötet.")
2. **Hur gick det?** Hållet / Uteblev.
3. **Hållet:** frågorna (kvalificeringen) direkt, för det är hans bedömning.
4. **Nästa steg:** Offert skickad / Uppföljning / Nytt möte / Nej, som i dag.

Ett tryck sparar allt. Mötet står som hållet av Fredrik, bedömt av Fredrik, och bokarens provision låses som i dag.

Väljer man någon annan än sig själv som hållare sparas Hållet och nästa steg, mötet väntar på bedömning, och **den
valda personen får en notis**: "Fredrik satte Hållet på Make your dream. Svara på frågorna." Kortet säger "Väntar på
Zens bedömning" som i dag.

### 4.2 Ett möte som redan väntar på bedömning

Kortet i "Väntar på bedömning" får, för den som är med på kortet, knappen **"Det var jag som höll mötet"** bredvid
"Bedöm". Den gör personen till hållare och öppnar frågorna direkt. Det löser Make your dream och de fyra andra.

### 4.3 Byta hållare före mötet

I Ändra blir **"Vem håller"** ett fält, som i Boka. Den nya hållaren får mötet i sin kalender (som organisatör), den
gamla tas bort ur den om hen inte är kollega på mötet, och båda får en notis. Påminnelser, "Att bekräfta" och
uppgifterna följer den nya hållaren. **Kundens inbjudan rörs inte** (se 5.2).

### 4.4 Boka efter första mötet

Bokas ett möte på ett kort där kunden redan träffats, eller som följer på ett uteblivet möte, säger bladet det
under rubriken: **"Uppföljning: räknas inte som ett nytt bokat möte"** respektive **"Nytt försök efter Uteblev:
räknas som Micks bokning, inte som en ny"**. Det är regeln som står där, inte en gissning: samma kontroll som
servern gör.

## 5. Reglerna

### 5.1 Vem får byta hållare

- Samma krets som får sätta utfallet: de som är med på kortet, och säljchef/VD/admin (`farSattaUtfall`).
- Den nya hållaren måste kunna hålla möten (`arHallare`) och vara aktiv.
- **Pengaspärren:** servern räknar mötesprovisionens mottagare före och efter bytet (`provisionsmottagare`). Ändras
  mottagarna, och aktören är en av dem före eller efter, nekas bytet: "Bytet ändrar din mötesprovision. Den som
  höll mötet eller en annan admin byter." Exempel: Mick bokar och håller sitt eget möte (ingen provision, för
  hållaren får aldrig bokarprovision, `fordela`), och byter sedan hållare till Fredrik: då hade Mick fått provision.
  Det nekas.
- **Låst provision:** är mötet bedömt (`niva`/`provision_last_nar`) byts hållaren bara av admin, via Rätta, och
  provisionen räknas om med `andraProvision` som i dag.
- Allt loggas i händelseloggen (före, efter, vem), och notis går till gamla och nya hållaren och bokaren.

### 5.2 Kalendern och kunden

- **Efter mötets tid:** bara mötesraden ändras. Kalendern rörs inte, mötet har redan hänt.
- **Före mötet:** kalenderhändelsen får ny organisatör genom en ny databasfunktion (`lk_byt_organisator`, samma
  mönster som `lk_spara_mote`: rätten prövas i funktionen, `p_utfort_av`). Kundens inbjudan har organisatörens namn
  och e-post som ORGANIZER (`utkorg-server.ts:603-609`, `organizer_id`). **Mitt förslag:** ingen ny inbjudan till
  kunden vid själva bytet, för det vore en händelse kunden inte bett om. Flyttas mötet senare får kunden den vanliga
  uppdateringen, och den bär då den nya hållaren som organisatör. Vill du att kunden får en uppdaterad inbjudan direkt
  vid bytet är det ett eget beslut (se frågorna).

### 5.3 Uppföljning och ombokning, regeln i datan

Arten sätts när mötet läggs, i servern, inte i klienten:

1. Kunden träffad (ett hållet möte på kortet, eller före den här tiden hos samma kund, 0296) → `uppfoljning`.
   Räknas aldrig som bokat, ger aldrig mötesprovision. (Som i dag.)
2. **Nytt:** annars, finns ett tidigare möte på samma kort → `ombokning` med `foregaende` = kortets senaste möte,
   **satt av servern** när klienten inte skickar det. Lagar lucka (a). Räknas som den ursprungliga bokarens, inte
   som en ny bokning (som ombokningar redan gör).
3. **Nytt, ditt beslut:** annars, har samma kund (0296:s `mote_kundens_bolag`) ett möte på ett annat kort inom
   **90 dagar** (en inställning, `moten.ny-kund-dagar`) → `ombokning` med det mötet som föregående. Lagar lucka (c).
4. Annars `ny`.
5. Jobbet `mote_art_ratta` rättar som i dag (framtida, utan utfall), nu med regel 2–3.

Säljtavlan, statistiken och provisionen behöver ingen ändring: de räknar redan `ny` och följer ombokningar till den
ursprungliga bokaren.

## 6. Bygget

1. Migration: `lk_byt_organisator` (före mötet), utökad `mote_art_ratta` med regel 2–3, inställningen
   `moten.ny-kund-dagar` (standard 90). Inga nya tabeller; hållarbytet loggas i händelseloggen.
2. Rutten: handlingen `hallare` (byt hållare, med pengaspärren), `utfall` tar `holl` (vem som höll mötet), Ändra tar
   `hallsAv`, `laggMote` sätter `foregaende` själv. Notis `mote-bedom` till den som ska bedöma (klocka + telefon).
3. Klienten: "Vem höll mötet?" först i utfallsdialogen, "Det var jag som höll mötet" på väntande kort, "Vem håller" i
   Ändra, raden om uppföljning/ombokning i Boka.
4. Prov: rena prov för pengaspärren och artregeln (alla fall i 5.3, också gränsen 90 dagar), db-prov i en
   transaktion för `lk_byt_organisator` och artjobbet, klickprov för flödena, och Make your dream-fallet som eget
   prov: Fredrik höll, satte Hållet, svarar på frågorna, Micks provision låses.
5. Navnyheter, NASTA_SESSION, ARBETSLOGG.

## 7. Frågor till beställaren

1. **Kundens inbjudan vid byte före mötet:** rörs inte (mitt förslag), eller ny inbjudan från den nya hållaren?
2. **Samma kund på ett nytt kort:** räknas som ombokning (inte ny bokning) inom 90 dagar (mitt förslag), annan
   gräns, eller bara samma kort?
3. **De fem möten som väntar nu** (Orion Car, DS Transport, Nordic Grön, K2 Syd, Make your dream): rättar ni dem
   själva med "Det var jag som höll mötet" när det finns, eller ska jag lista dem för dig?

## Källor (undersökningen 2026-11-16; praktikerkällor, inte alla produktdokumentation)

- RevenueHero, SDR-attribution: https://www.revenuehero.io/playbooks/sdr-attribution-that-actually-works
- HubSpot, aktivitetsegenskaper (created by, assigned to, `hs_meeting_outcome`): https://knowledge.hubspot.com/properties/hubspots-default-activity-properties
- HubSpot community, kredit för bokade möten: https://community.hubspot.com/t/meetings-booked/129654
- Salesforce Event-objektet (`OwnerId`, `EventRelation`): https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_objects_event.htm
- Pulse RevOps, AE:s accept och återvinningsfönster: https://pulserevops.com/knowledge/q08
- Fullcast, första möte eller uppföljning: https://support.fullcast.com/performance/docs/how-atrium-differentiates-between-initial-and-follow-up-meetings
- Outreach, utfall och no-show: https://support.outreach.io/hc/en-us/articles/360001372194
- Close, utfall: https://help.close.com/docs/outcomes
- Chili Piper, omtilldelning: https://suggest.chilipiper.com/feature-requests/p/keep-sdrs-on-meeting-notifications-and-retain-visibility-after-a-meeting-is-reas

Inte belagt: Salesloft, Pipedrives hjälpcenter och Calendly gav ingen fungerande källa.
