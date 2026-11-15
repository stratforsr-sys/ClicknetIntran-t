# Hemvyn: kort, chatt och förslag som följs till dom

Designdokument, 2026-11-15, tredje versionen. Inget är byggt. Bygget börjar
först när beställaren har godkänt det här dokumentet.

Skrivet för två läsare: beställaren, som ska kunna säga ja eller nej, och den
som ska planera bygget utan att ha varit med i samtalet. Det beställaren har
sagt står under "Beslutat". Det jag har valt själv står under "Mina val" sist,
så att det går att säga nej till ett val i taget.

Dokumentet är granskat två gånger innan beställaren läser det: av en byggare
som letade efter ställen där hen skulle behöva gissa, och av en rådgivare som
utmanade valen. Den första versionen föll på en punkt: den första kedjan
krävde tio veckors historik, och Möten har funnits i tio dagar. Den här
versionen utgår från den data som finns. Den tredje versionen har
beställarens svar på frågorna efter den andra.

Formen finns i en klickbar skiss, skiss 9
(`~/nav-produkt/kundpresentation/skiss-9-hemvyn.html`, vyerna `#chef`,
`#saljare` och `#forst`). Den är skiss 8 rättad efter det här dokumentet, med
första kedjan ritad. Knappen "Visa ändringarna" i menyradens skissruta visar
de åtta ställen som skiljer den från skiss 8. Skissen bestämmer utseendet. Det
här dokumentet bestämmer innehållet, datan och reglerna. Skissen visar bilden
när datan finns, och alla tal i den är exempel.

## Varför

Nav ska säljas till andra företag. En chattruta ovanpå en databas kan vem som
helst bygga. Det som är svårt att kopiera är det som ligger under: datan,
reglerna, behörigheterna och att varje förslag följs tills man vet vad det
ledde till.

Tre idéer bär bygget. Beställaren har sagt ja till alla tre.

1. **Förslag som följs till dom, inte insikter.** Nav stannar inte vid "mötet
   är obekräftat". Den lägger fram valen, en människa väljer, och dagen efter
   står det vad som hände.
2. **Nav håller poäng på sig själv.** Det Nav trodde sparas före beslutet och
   stäms av mot utfallet. Förslag som ingen följde följs upp likadant.
3. **Säljarens hem i egna pengar.** Säljaren ser sin provision, hur långt det
   är till nästa steg och vad som ligger närmast.

## Vad det är

Hemvyn i Nav 2.0 görs om. Menyraden rörs inte. Allt till höger om den blir ett
enda glasfönster med högst fyra kort överst och en skrivruta under.

- **I korten talar Nav först.** Korten visar det som behöver en människa nu.
- **I skrivrutan talar personen först.** Skriver man något viker korten undan
  och ytan blir en chatt.
- **Svaret slutar i en handling** som personen godkänner. Nav gör inget på egen
  hand.

Under ytan byggs ett underlag: ett register över mått, en logg över förslag,
ändringar och utfall, och jobb som dömer.

## Vad datan bär i dag

Räknat i produktionens databas 2026-11-15, bara läsning och utan namn. Det här
avgör vad Nav kan säga ärligt, och samma läge möter varje ny kund dag ett.

| Data | Läget | Följd |
|---|---|---|
| Möten | Första mötet 5 nov. 29 första möten, 11 avgjorda, 5 uteblev. 3 personer bokar, 3 håller. | För lite för att jämföra en person eller ett lag med sig självt. Tidigast i slutet av december för laget. |
| Bekräftelser | 6 av 11 möten var obekräftade när mötesdagen kom. Av bekräftade uteblev 2 av 7, av obekräftade 3 av 4. | Skillnaden kan vara slump en gång av fem. Nav får inte säga att bekräftelse hjälper än. |
| Bokare och hållare | Olika personer i 28 av 29 möten. | Den som håller mötet får i dag inget veta om att det är obekräftat. Där finns första kedjan. |
| Offerter | 2 stycken, båda öppna. | Beloppet kan börja samlas nu. Summor säger något först om några månader. |
| Order | Utan tillägg och utkast: 3 i augusti (från 26 aug), 24 i september, 3 i oktober, 2 hittills i november. 2 makulerade. Beställaren: alla order ligger i Nav. | Takten går att räkna. Ett spann går inte: orderna kommer i klumpar, och ett 80 %-spann prövat varje morgon träffade 11 av 22 morgnar i september. |
| Säljmål | Bara för september (29 order, 5 personer). Inget för oktober och november. | Teamet i månaden kan inte visa avståndet till målet förrän ett mål är satt. |
| Samtal | 12 238 sedan 10 sep, 11 personer. Utfallet är "okänt" på alla. | Nav kan läsa längd men inte om någon svarade. Kedjor som bygger på svar får vänta. |

## Mål

- En chef ser på några sekunder vad som väntar, vad Nav föreslår, hur månaden
  står och vad som har ändrats.
- En säljare ser samma sak om sig själv, med sin godkända provision i kronor.
- Ett helt varv fungerar på riktigt hos Clicknet från första veckan: ett möte
  är obekräftat sista dagen, den som håller mötet får välja vad som ska hända,
  och dagen efter mötet står utfallet där.
- Varje tal på hemvyn går att klicka ner till raderna det bygger på.
- När datan inte räcker säger Nav det, och hur mycket som saknas.
- Det fungerar för ett annat företag utan specialbygge: gränser, fönster och
  texter är data med standardvärden.

## Inte mål i det här bygget

- Att Nav gör något själv. Loggen byggs så att en sorts åtgärd senare kan bli
  självgående, men ingen blir det nu.
- Påståenden om en enskild persons utveckling. Trendregeln räknar i det tysta
  tills datan finns, och börjar med laget (se 1.7).
- Ett spann med en chans i procent för var månaden landar. Det kommer när det
  i efterhand har träffat ungefär så ofta som det lovar, i ungefär åtta
  avslutade månader. Takten visas från dag ett (steg 2).
- Kunskapsbasen via intervju och säljcoachen. De får egna dokument.
- Att chefen ser Navs tolkning senare än säljaren. Beställaren har valt
  "samtidigt". Loggen byggs så att en fördröjning kan läggas till utan att
  flytta data.
- Notiser och push om förslag. Förslagen bor i korten.
- Historik över gamla chattsamtal i gränssnittet.
- Telefonens egen form. Korten staplas och chatten tar hela bredden. Mer än så
  kräver en egen skiss.

## Det som aldrig får hända

Bygget är misslyckat om något av detta inträffar, även om allt annat fungerar.

- Ett tal på skärmen som inte går att belägga, eller en orsak Nav inte kan visa.
- En krona på säljarens hem som inte stämmer med provisionsunderlaget.
- Något som når en kund, rör pengar, raderar eller ändrar behörighet utan att
  en människa har godkänt just det.
- En dom "ser bra ut" när motvikten blev sämre, eller på för få möten.
- Ett facit där Nav nästan alltid får rätt för att gissningen var bred.
- Exempeldata eller påhittade tal i en preview eller i produktionen, eller
  rader som läggs in för hand för att ett kort ska ha något att visa.
- En topplista i kronor eller en jämförelse mellan personer på säljarens hem.
- Tolkning av tonläge eller känslor i samtal.

De tolv skydden i `~/CLAUDE.md` ("Nav och AI: aldrig ett löfte utan belägg")
gäller hela bygget. Sist i dokumentet står hur vart och ett uppfylls.

## Beslutat av beställaren

- Utseendet är skiss 4, förfinat till skiss 8: "exakt det jag föreställer mig".
  Menyraden rörs aldrig och står som standard i läget Hovra. Hela hemvyn är ett
  glasfönster kant i kant, utan ram och rundade hörn. Få saker och stora tal.
- Högst fyra kort. Chefen: Väntar på dig, Nav föreslår, Teamet i månaden, Det
  som ändrats. Säljaren: Väntar på dig, Nav föreslår, Din månad, Det som
  ändrats hos dig.
- Golvet just nu bor på Säljtavlan, inte på hemvyn.
- Första riktiga kedjan handlar om uteblivna möten.
- Chefen och säljaren ser Navs tolkning om säljaren samma dag ("Samtidigt").
- De fyra underlagen ska byggas så att Nav alltid har det den behöver: logg
  över förslag och utfall, ändringslogg, offerter med belopp och samtalens
  innehåll (sist, smalt och på begäran).
- Samtalslängd ensam är en svag signal. Genomgångar leder med antal.
- Ingen notis när en order kommer in. Talen räknar bara upp.
- Byggordningen i stort: hemvyn med kort, chatt och en hel kedja, sedan fler
  kedjor, sedan kunskapsbasen, sedan säljcoachen.
- Svaren efter version två (2026-11-15):
  - Alla order ligger i Nav.
  - Beställaren berättar själv för personalen vad Nav räknar och vem som ser
    vad, innan det nya hemmet slås på för alla.
  - Teamet i månaden ska ha en prognos från dag ett, "100 %, inte fluff". Det
    är tolkat så här: varje tal på kortet är sant, prognosen säger att den är
    en uträkning på takten, och den visar själv hur den har träffat (steg 2).
  - Navs facit ska räkna ordentligt också med färre än 20 möten (1.4).
  - Chatten börjar på Claude Sonnet 5.5 i stället för Opus 5.5 (steg 3).

## Läget före (ur koden, `main` vid `d4a026d`)

**Hemvyn i dag.** Nav 2.0 är en enda fil, `src/nav2/utkast.html` (cirka 42 600
rader). Hemmet har två lägen, `S.role` = chef eller saljare. Listan "Beslut och
att göra" (chef) eller "Kräver dig" (övriga) är `renderInbox()` med grupperna
Nu, Senare i dag och Kan vänta. Säljaren har kortet "Din provision" med en
prognos i kronor. Serverdelen är `src/lib/nav2/hem.ts` (`byggHem`,
`byggGolvet`) och rutten `src/app/nav2/hem/route.ts`.

**Möten.** `mote`, `mote_kedja` och `mote_bolag` (0260). Ett möte har
`bokat_av`, `halls_av`, `mote_tid`, `art` (ny, ombokning, uppfoljning),
`bekraftat_nar`, `forsok`, `utfall` (hallet, uteblev, avbokat) och `resultat`
(affar, nej, offert, uppfoljning). Talen på Mötessidan räknas av rena
funktioner i `src/lib/nav2/motesstatforma.ts`: `veckotal`,
`bekraftelsePerBokare`, `dagarTillMote`, `offerter` och `bakom` (raderna bakom
ett tal). Mötesstatistiken laddar bara den här veckan och förra. Vem som får se
vems tal avgörs av `mote_statkrets()` (0264).

**Bekräftelser.** Den som bokat ett första möte får en uppgift och en notis
från två arbetsdagar före (`moten.bekrafta-dagar`), och sedan varje arbetsdag
till och med mötesdagen (`vemBekraftar` och `bekraftelseFonster` i
`src/lib/nav2/motesflode.ts`, uppgiften i 0291). Påminnelsen går till den som
har uppgiften, annars bokaren. **Den som håller mötet får den bara om bokaren
inte är aktiv.** Efter "Fick inte tag" kommer "Ring igen" fyra timmar senare.
Uppföljningsmöten bekräftas inte (`skaBekraftas`). `mote_uppgift_skapa` ger
ingenting om mötet redan har en uppgift.

**Offerter finns redan, utan belopp.** När ett hållet möte får resultatet
"Offert skickad" sätts `mote_kedja.offert_nar` och ett datum för "Ring kunden"
(`uppfoljning_datum`, förvalt tre arbetsdagar fram). Kedjan ligger i kolumnen
Följ upp och blir "tyst" efter tre obesvarade försök eller 21 dagar
(`mote_kolumn`, 0261). Den stängs av en affär (`avslut = 'affar'`, `order_id`)
eller ett nej med skäl. Det som saknas är beloppet.

**Provision.** `raknaUnderlag()` i `src/lib/provision-motor.ts`. Fast belopp
per paket och bindningstid (`commission_rate`), en trappa i antal order som
gäller bakåt på månadens alla order (`commission_bonus_level`), intjänad vid
signering, makulering dras den månad den sker. Motorn räknar bara godkända
order. Ordervyn visar ett ungefärligt belopp för order som väntar ("≈ … fryses
vid godkännandet"). Mötesbokare får betalt per kvalificerat eller hållet möte
(`nav_setting` `moten.provision`). Klienten har redan `ND.provision.underlag`
med `rader`, `niva`, `nasta{kvar}`, `summa` och `bokfort`.

**Loggar.** `audit_log` (0001) har aktör, handling, objekt, skäl och `meta`.
Rutiner har versionshistorik. `nav_setting` (0095) har `updated_by` och
`updated_at`, men gamla värden sparas inte.

**Samtal.** Varje samtal är en rad i `phone_call`. Mötessidan räknar bara
samtal på minst fem minuter (`SAMTAL_MIN_SEK`). Alla inspelningar hämtas. De
som inte hör till en order gallras efter 30 dagar (`GALLRINGSFRIST_DYGN` i
`src/lib/samtal-order.ts`). Tabellen `call_transcript` (0083) finns men fylls
aldrig, och en utskrift raderas när inspelningen gallras (0236).

**Frågor utan AI.** Paletten svarar redan på frågor ur Navs data med
användarens egen behörighet (`src/lib/nav2/palettsvar.ts`). Den bygger bara de
vyer frågan behöver, med samma funktioner som vyerna.

**Jobb.** Vercel kör `/api/jobb/natt` 02.30 UTC och `/api/jobb/morgon` 05.30
UTC. Båda platserna på planen är tagna. Nattjobbet kör sina steg var för sig
och sparar ett kvitto. Mötesjobbet (`src/lib/nav2/moten-jobb.ts`) körs tätare
under dagen via `pg_cron` och `kalla_jobb()`.

**AI.** Ingen AI-integration finns i repot. Inget SDK är installerat.

**Ett företag i taget.** Det finns ingen företagsnyckel i databasen. Ett
företag är en egen installation. Det här bygget ändrar inte det.

## Byggordning: fem steg, en preview per steg

Varje steg går till en egen gren och en egen preview och godkänns för sig.
Steg 1 till 3 är specificerade här. Steg 4 och 5 är beskrivna så att
underlaget byggs rätt från början, och får var sitt korta tillägg till det här
dokumentet innan de byggs.

| Steg | Vad | Syns för användaren |
|---|---|---|
| 1 | Underlaget: mått, logg, ändringslogg, offertbelopp, jobb i torrkörning | Ett nytt fält i rutan Offert skickad |
| 2 | Nya hemvyn och kedjan för obekräftade möten | Hela nya hemmet |
| 3 | Chatten med Claude | Fria frågor i skrivrutan |
| 4 | Trendregler när datan finns, månadens spann, fler kedjor | Fler förslag |
| 5 | Samtalens innehåll på begäran | "Gå igenom samtalen" i ett förslag |

I steg 1 skapas inga förslag som någon kan se. Jobben torrkör och skriver i
sitt kvitto vad de skulle ha skapat. Riktiga rader börjar skrivas när steg 2
slås på (`forslag.pa`). Annars skulle loggen fyllas med förslag som ingen fick
chansen att svara på, och de skulle räknas som "ingen valde".

---

## Steg 1: Underlaget

### 1.1 Måtten: ett register

Alla tal som Nav visar, dömer eller låter AI:n läsa går genom ett register över
mått. Ingen annan kod räknar. Det är så "AI:n räknar aldrig själv" blir sant i
tekniken.

Ett mått har:

- en nyckel, till exempel `moten.uteblivna`
- en sort: **andel** (n av ett antal) eller **antal**
- en ren funktion som ger `{ n, av }` för en person eller en krets och en period
- vilket håll som är bättre
- en **motvikt**: nyckeln till det mått som inte får bli sämre
- raderna bakom talet (id:n), som `bakom()` gör i dag
- en kort text på svenska för vad måttet räknar och vad det inte ser

Registret ska återanvända funktionerna i `motesstatforma.ts` och inte räkna om
samma sak på ett nytt sätt.

**Ett underlag för alla mötesmått på hemvyn.** Mötessidan har i dag två
underlag: `bekraftelsePerBokare` räknar möten av arten ny och ombokning
(`skaBekraftas`) och lämnar avbokade utanför, medan `veckotal` och
`dagarTillMote` bara räknar arten ny och tar med avbokade. Hemvyns mått
använder det första, eftersom kedjan handlar om bekräftelse och delningen i
bekräftade och obekräftade ska gå jämnt upp:

- möten av arten ny eller ombokning (det som `skaBekraftas` ger)
- med mötestid i perioden
- ett möte utan utfall räknas inte i något mått förrän utfallet är satt

Ett ombokat möte efter ett uteblivet är ett nytt möte och räknas för sig.
Måttets text säger vilket underlag det har. Löftet är alltså: ett mått med
samma definition ger samma tal på Mötessidan och på hemvyn. Talet "hållna" i
Mötessidans veckotal har en annan definition och är ett annat mått.

Mått i steg 1 och 2:

| Nyckel | n | av | Motvikt |
|---|---|---|---|
| `moten.uteblivna` | Uteblivna | Hållna och uteblivna | `moten.hallna-av-alla` |
| `moten.hallna-av-alla` | Hållna | Hållna, uteblivna och avbokade | `moten.uteblivna` |
| `moten.bekraftade` | Bekräftade före mötestiden | Hållna, uteblivna och avbokade | `moten.hallna-av-alla` |
| `order.netto` | Nettoorder (antal, som `nettoAntal`) | | Makulerade i perioden |

Perioder räknas i svenska dagar, som i `motesstatforma.ts`.

**En andel visas aldrig utan sitt antal.** Bredvid "2 av 20 uteblev" står hur
många möten som bokades per vecka, före och efter. Annars går det att få en
bättre andel genom att boka färre möten.

**Vilka som är "laget".** En och samma funktion avgör vilka personer ett tal
gäller: kretsen som `mote_statkrets()` ger den inloggade. En teamledare får
sitt eget lag. Säljchef, vd och administratör får alla. Det gäller både kortets
summa och raderna bakom, så att de alltid handlar om samma personer.

### 1.2 Förslagsloggen

En logg över allt Nav har lagt fram och allt som har ändrats, från upptäckt
till dom. Den är grunden för korten Nav föreslår och Det som ändrats, för Navs
eget facit och för att en åtgärd senare ska kunna göras självgående.

Namnet "ärende" används inte, eftersom Ärenden redan är en del av Nav
(`hr_case`).

**Två tabeller som bara tar emot nya rader.** Ingen rad ändras eller tas bort i
efterhand. Det nuvarande läget läses ur en vy.

`nav_forslag`, en rad när något upptäcks eller berättas:

| Fält | Innehåll |
|---|---|
| `sort` | `forslag` eller `andring` |
| `regel` | Regelns eller måttets nyckel, till exempel `moten.obekraftat` |
| `nyckel` | Det raden gäller, till exempel mötets id. Regel och nyckel tillsammans är unika, så att ett jobb kan köras om utan dubbletter. |
| `kalla` | `regel` (Nav såg det), `person` (någon berättade), `installning` (en inställning ändrades) |
| `om` | Personen det gäller, eller tomt |
| `lag` | Laget det gäller när `om` är tomt. Är båda tomma gäller raden hela företaget. |
| `skapad`, `skapad_av` | När, och vem (tomt när Nav skapade raden) |
| `belagg` | Talen när raden skapades, och id:n på raderna bakom |
| `trodde` | Vad Nav trodde när raden skapades: hur det brukar gå i samma läge, som `{ n, av }`. Tomt när underlaget är för litet. |
| `val` | Valen som läggs fram, till exempel `ringer-sjalv`, `flytta`, `lat-sta` |
| `foljer` | Vad som följs: måttet, motvikten, och antingen en lista möten eller en period |
| `doms_dag` | Dagen då utfallet döms |
| `utgar` | Tidpunkten då ett obesvarat förslag räknas som "ingen valde" |
| `text` | För en ändring från en person: vad som ändrades, med personens ord |
| `prov` | Sant för provdata, så att den går att hålla utanför alla tal |

`nav_forslag_handelse`, en rad per sak som händer med ett förslag:

| `sort` | Betyder | `data` |
|---|---|---|
| `beslut` | Ett val, eller "ingen valde" | Vem, vilket val, och ett skäl om någon skrev ett |
| `atgard` | Vad valet skapade | Till exempel id:t på uppgiften |
| `angrad` | Valet ångrades | Vad som togs bort |
| `kommentar` | Personens egen rad om sina tal | Texten, högst 200 tecken |
| `matning` | Utfallet en viss dag | Måttet, motvikten, genomförandet |
| `dom` | Domen | Se 1.4 och 1.5 |

Vyn `nav_forslag_lage` ger en rad per förslag med senaste beslut, åtgärd,
kommentar, mätning och dom.

**Vem som får läsa.** Personen raden handlar om, och de som får se den
personens tal enligt `mote_statkrets()`. En rad för ett lag läses av lagets
teamledare och av säljchef, vd och administratör. En rad för hela företaget
läses bara av säljchef, vd och administratör. `mote_ar_chef()` räcker alltså
inte som villkor, eftersom den släpper in varje teamledare. Det avgörs i
databasen (RLS), inte i gränssnittet. Skrivning sker bara från servern efter
kontroll, som i resten av Nav 2.0.

När en teamledare berättar om en ändring för "laget" gäller den teamledarens
eget lag.

**Personuppgifter.** Båda tabellerna ska in i registerutdraget
(`src/lib/registerutdrag.ts`) och i raderingens lista
(`src/lib/personal-radering.ts`), annars faller proven. Tabeller som inte får
ändras behöver en egen väg för radering, enligt mönstret som redan finns i
repot. En rad om en person avidentifieras 24 månader efter domsdagen: personen
och id:n på raderna tas bort, talen blir kvar så att Navs facit finns kvar.

### 1.3 Första kedjan: ett möte som inte är bekräftat

Kedjan gäller ett möte i taget och behöver ingen historik. Den fungerar första
dagen hos en ny kund.

**När.** Ett första möte (`skaBekraftas`) är fortfarande obekräftat på sin
sista bekräftelsedag (`senast` ur `bekraftelseFonster`) när klockan når ett
inställt klockslag (`forslag.obekraftat-tid`, förvalt 14.00). Är sista dagen
mötesdagen gäller det tidigaste av klockslaget och två timmar före mötet. Är
det mindre än en timme kvar skapas inget. Mötesjobbet gör kontrollen, eftersom
det redan läser de här mötena under dagen.

**Till vem.** Den som ska hålla mötet (`halls_av`). I dag får den personen
inget veta, eftersom påminnelserna går till den som bokade. Är det samma
person får den raden ändå.

**Vad Nav säger.** Antal, aldrig en orsak:

> Mötet med Tallmo Mark i morgon 10.30 är inte bekräftat. Mick har ringt två
> gånger utan svar.
> Hittills har 1 av 4 obekräftade möten hållits. Det är för få för att säga
> något.
> Det här ser jag inte: om kunden har hört av sig på annat sätt.

Antalet försök är `mote.forsok`. Raden "hittills" är Navs `trodde`: hur det har
gått för tidigare möten som stod obekräftade sista dagen. Om den säger "för få"
avgörs av samma regel som facit (1.4).

**Tre val.** Den som håller mötet bestämmer.

| Val | Vad som händer |
|---|---|
| Jag ringer själv | Bekräftelsen hamnar i personens lista i dag. Finns bokarens uppgift lämnas den över, så att bokaren ser vem som tog den. Finns ingen öppen uppgift skapas en. |
| Flytta mötet | Det vanliga flödet för att flytta mötet öppnas. Valet sparas när flytten är gjord. |
| Låt stå | Inget ändras. Valet sparas. |

Har ingen valt när mötet börjar sparas "ingen valde". Nav kontaktar aldrig
kunden.

Att lämna över en uppgift som redan finns kräver en ny databasfunktion,
eftersom `mote_uppgift_skapa` inte gör något då. Har bokaren redan bockat av
sin uppgift utan att mötet blev bekräftat skapas en ny till den som håller
mötet.

**Kvittot** säger vad som gjordes och när domen kommer: "Klart. Bekräftelsen
ligger i din lista i dag. I morgon efter mötet säger jag hur det gick." Ångra
står i ytans fot.

**Flera samma dag** läggs ihop i kortet ("3 möten i morgon är obekräftade") men
är var sin rad i loggen, med var sitt val.

**Chefen** ser lagets öppna rader i genomgången av Teamet i månaden:
"Obekräftade möten i morgon: 3, varav 1 utan val." Chefen får inget eget
förslag i det här steget.

### 1.4 Domen och Navs facit

**Domsdagen** är arbetsdagen efter mötet.

**Utfallet** för ett möte är ett av: hållet, uteblev, avbokat, flyttat eller
okänt. Bredvid står genomförandet: blev mötet bekräftat före mötestiden?

**Saknas utfallet** på domsdagen säger Nav det: "Utfallet är inte satt. Jag
dömer när det är det." Efter fem arbetsdagar stängs raden som okänd. Löftet i
kvittot hålls alltså: på utsatt dag säger Nav vad den vet, också när det är
att något saknas.

**Ingen gissning per möte.** Ett enda möte går inte att gissa utan att nästan
alltid få rätt. Därför sägs aldrig "jag hade rätt" om ett enskilt möte. Det
Nav trodde sparas på raden, och stäms av i klump.

**Navs facit räknas per val, över alla möten i laget:**

> När någon har ringt själv har 5 av 7 möten hållits. Låt stå: 1 av 4. Ingen
> valde: 0 av 2. För få för att skilja från slump, tidigast vid runt 40 möten
> om skillnaden håller.

- Det räknas aldrig per person. Står en person för mer än hälften av mötena i
  ett val visas antalen men ingen dom, och texten säger varför: då vore facit i
  praktiken ett facit om den personen.
- Jämförelsen är bestämd i förväg: ringde själv mot lät stå. Flyttade möten
  har inget utfall samma dag och räknas för sig. "Ingen valde" står bredvid
  men ingår inte i domen.
- **Ingen fast gräns på 20.** Talen visas från första mötet. Domen ges av
  Fishers exakta prov, ensidigt, med gränsen 0,01 som i trendregeln
  (`forslag.grans-facit`). Provet gäller vid vilket antal som helst, men med få
  möten krävs en stor skillnad: 5 av 5 mot 0 av 5 räcker (p 0,004), 4 av 5
  mot 1 av 4 räcker inte (p 0,17).
- Domen räknas om vid vart tionde nytt avgjort möte per val, inte varje natt,
  så att upprepade prov på samma möten inte ger falsklarm.
- Utan utslag står: "För få för att skilja från slump. Tidigast vid runt N
  möten, om skillnaden håller." N räknas ur dagens andelar, och ordet är
  alltid "tidigast": skillnader i små tal krymper oftast.
- Med utslag står urvalet i samma mening: "Skillnaden är för stor för att vara
  slump. Den som håller mötet väljer vilka möten hen ringer om, så den visar
  inte att samtalet gjorde den." Valen är inte lottade, och texten säger aldrig
  att valet orsakade utfallet.
- "Ingen valde" och "låt stå" följs och räknas på samma sätt som de andra.
  Utan dem ser allt Nav lägger fram ut att hjälpa.
- När minst 20 dömda rader har ett `trodde` stäms det av: "Jag räknade med att
  9 av 20 skulle hållas. Det blev 11."

**Två facit hålls isär.** *Var valet rätt förberett?* Valdes något av det Nav
lade fram, och ångrades det inte. Det avgör senare om Nav får göra en sorts
åtgärd själv. *Hjälpte det?* Utfallen per val. Det avgör om regeln förtjänar
sin plats i kortet. Inget av dem ger Nav nya rättigheter i det här bygget.

**Gissning som spann** används bara när en rad följer minst 20 möten, som i
trendregeln (1.7). Då går ett spann att få fel på.

### 1.5 Ändringsloggen: tre ingångar

En ändring är en rad i samma logg med `sort = 'andring'`. Den följs och döms av
samma jobb.

1. **Någon berättar.** Knappen "Berätta om en ändring" i Det som ändrats. Fyra
   fält: vad som ändrades (fri text), vem det gäller (jag själv, en person i
   min krets, laget), från vilken dag, och vilket mått som ska följas. Alla får
   berätta om sig själva. Chefer får berätta om sin krets.
2. **Ett val i ett förslag är en ändring.** Det behövs ingen ny rad. Kortet Det
   som ändrats visar både ändringar och dömda förslag.
3. **En inställning ändras.** En trigger på `nav_setting` skriver gammalt och
   nytt värde i `audit_log` för varje ändring. För de nycklar som står i en
   lista (`forslag.foljda-installningar`, från början `moten.bekrafta-dagar`,
   `moten.bekrafta-tid` och `moten.bekrafta-paminn`, alla med måttet
   `moten.uteblivna`) skapas också en ändring i loggen.

**Domen för en ändring.** Måttet efter jämförs med måttet före, med Fishers
exakta prov, ensidigt. Före är de 40 senaste avgjorda mötena före ändringen.
Efter är mötena sedan ändringen. Gränsen för en dom över en ändring är 0,05
(`forslag.grans-dom`). Det är en svagare utsaga än ett påstående om en person,
och formuleringen är därefter: "ser bra ut", aldrig "fungerar".

| Dom | När |
|---|---|
| Inget före att jämföra med | Färre än 20 avgjorda möten före ändringen. Nav visar antal per vecka och dömer aldrig. |
| För tidigt att säga | Färre än 20 avgjorda möten efter, eller inget utslag än. Ny avstämning varje vecka. |
| Ser bra ut | Bättre, slumpen osannolik, och motvikten har inte blivit sämre. |
| Bättre, men … | Bättre, men motvikten har blivit sämre: "Bättre, men färre möten hålls." |
| Ser sämre ut | Sämre, slumpen osannolik. |
| Ingen skillnad som går att se | Tolv veckor och minst 40 avgjorda möten efter, utan utslag. Raden stängs. |
| För få för att säga | Tolv veckor och färre än 40 avgjorda möten efter. Raden stängs. |

Varje rad får alltså ett slut, och slutet skiljer på "vi såg efter och det
syntes inget" och "det blev aldrig tillräckligt många".

**Motvikten räknas som sämre** när den har gått åt fel håll och samma prov ger
högst 0,20. Gränsen är generös med flit: motvikten är en broms, inte ett
påstående.

**Resten av laget samma veckor står bredvid.** En ändring anmäls ofta när talen
är dåliga, och dåliga tal rättar ofta till sig av sig själva. Har resten av
laget rört sig åt samma håll minst hälften så mycket säger domen det: "Bättre.
Resten av laget blev också bättre." Gäller ändringen hela laget står det:
"Hela laget ändrade sig samtidigt, så jag har inget att jämföra med."

**Den första raden finns redan i verkligheten.** Bekräftelserutinen slogs på
13 november, samma vecka som Möten började mätas. Den får domen "inget före att
jämföra med", och Nav visar antal per vecka. Den läggs in av beställaren själv
genom "Berätta om en ändring" när steg 2 är på, inte för hand i databasen.

I steg 1 och 2 går det bara att följa mått av sorten andel. Mått av sorten
antal påverkas av semester och sjukdom, och kommer i steg 4 tillsammans med en
regel för frånvaro.

### 1.6 Offertens belopp

Rutan "Offert skickad" i mötets utfall får ett fält till: **Belopp**. Datumet
för "Ring kunden" finns redan.

- Två nya fält på `mote_kedja`: `offert_belopp` (hela kronor) och `offert_paket`.
- Väljer säljaren ett paket och en bindningstid fylls beloppet i med samma
  uträkning som ordervärdet (`ordervardeFor`: månadspris gånger löptid).
  Beloppet går att ändra.
- Beloppet är obligatoriskt. En offert har ett pris.
- Offerten stängs som i dag: av en order på kunden, av ett nej, eller genom att
  kedjan blir tyst.
- Äldre offerter saknar belopp. Därför leder varje tal med antalet: "5 offerter
  väntar, 3 med belopp: 212 000 kr." Summan står aldrig ensam.

Senare, om en kund har ett eget offertsystem: en enda allmän ingång som tar
emot offerter utifrån. Den ingår inte här.

### 1.7 Trendregeln: tyst tills datan finns

Det här är regeln bakom "Edvins möten uteblir oftare". Den byggs i steg 1 men
säger ingenting förrän den har underlag, och den slås på för användare först i
steg 4.

- **Laget först.** Regeln prövar lagets tal, inte en persons.
- **Fönster räknade i möten, inte i veckor.** De 20 senaste avgjorda mötena mot
  de 40 före. Måttet är `moten.uteblivna`.
- **Gränsen är 0,01** (`forslag.grans-person`), Fishers exakta prov, ensidigt.
- Prövas en gång i veckan, natten mot måndag.
- Tills 60 avgjorda möten finns säger Nav hur långt det är kvar: "För att
  jämföra laget med sig självt behöver jag 60 avgjorda möten. Jag har 11."
- **En person** prövas först när personen själv har 60 avgjorda möten, och
  först när personalen har fått veta vad Nav räknar (se "Före påslagning").

**Vad regeln klarar, sagt rakt.** Räknat på att 15 procent av mötena uteblev
före: med 20 mot 40 möten och gränsen 0,01 slår regeln falskt till ungefär 4
gånger på 1 000 prövningar. Har andelen uteblivna fördubblats upptäcker den det
1 gång av 10. Har den tredubblats, knappt varannan gång. Den fångar alltså bara
det som sticker ut rejält. Det är priset för att nästan aldrig peka ut något
som inte finns.

Clicknet hade nio avgjorda möten förra veckan och har elva totalt. I den takten
når laget 60 tidigast i slutet av december.

**Åtgärden** för ett trendförslag bestäms i tillägget till steg 4. Den får
inte vara en påminnelse som redan finns.

### 1.8 Jobben

**Mötesjobbet** (under dagen) får ett steg till: se efter vilka möten som har
nått sin sista dag obekräftade, och skapa raderna i 1.3.

**Nattjobbet** får ett steg till, med eget kvitto:

1. Döm de rader vars domsdag har kommit.
2. Märk obesvarade förslag som "ingen valde" när `utgar` har passerats.
3. Stäm av ändringarna i 1.5.
4. Natten mot måndag: räkna trendregeln i 1.7 och skriv resultatet i kvittot.

Jobben använder registret i 1.1 och inga egna uträkningar. De ska gå att köra
om utan dubbletter. Så länge `forslag.pa` är av skriver de bara i kvittot.

---

## Steg 2: Nya hemvyn och kedjan för obekräftade möten

### Formen

Skiss 9 är facit för utseendet. Det viktigaste:

- Menyraden är Nav som i dag. Standardläget blir Hovra (`PRFRAIL`) för den som
  har det nya hemmet påslaget och inte har valt något annat. För alla andra är
  standarden utfälld, som i dag.
- Resten är ett glasfönster kant i kant. Mörkt och ljust läge.
- Överst en lugn rad: hur många som är på plats (klick visar laget), datum och
  Stämpla in.
- En hälsning och en enda rad om läget.
- Fyra kort i en rad. Ett stort tal, saken på raden under, en rad text, en knapp.
- Genvägar i glas ovanför skrivrutan: Min dag och Veckan.
- Ett kort öppnas i samma yta. Korten och överraden viker undan, och Nav talar
  först. Kvitto och Ångra står i ytans fot, inte som en avisering.

### Korten, ett i taget

| Kort | Vem | Källa | När det är tomt |
|---|---|---|---|
| Väntar på dig | Alla | Dagens lista (`renderInbox`), en rad per sak, det som brinner först | "Inget väntar på dig." |
| Nav föreslår | Alla | Öppna förslag i loggen som är ställda till personen | "Inget att föreslå just nu." och hur långt trendregeln har kvar |
| Teamet i månaden | Chef | Nettoorder, väntande, makulerade, mål och takten | "Inget mål satt för november." med en väg dit |
| Din månad | Säljare | Provisionsunderlaget | Egna utfall utan kronor |
| Det som ändrats | Alla | Ändringar och dömda förslag i loggen | "Inget har ändrats än. Berätta om en ändring." |

**Väntar på dig.** Samma lista som i dag, inte en ny. Löst på ett ställe är
löst överallt. "N till" öppnar hela listan i grupperna Nu, Senare i dag och Kan
vänta.

**Nav föreslår.** Det äldsta öppna förslaget först. "N till" bläddrar. Ett
förslag där ett val är gjort lämnar kortet. Chefens kort kommer ofta att vara
tomt i det här steget, och säger då varför.

**Teamet i månaden.** Nettoorder hittills mot målet, och makulerade bredvid.

- Talen är nettoorder (`nettoAntal`) för personerna i kretsen, och målet är
  summan av de personernas månadsmål (`sales_target`). Saknar någon ett mål
  säger kortet det: "Mål saknas för 2 personer."
- **Det stora talet är det säkra:** order hittills av målet. Väntande order
  står som antal, makulerade bredvid.
- **Prognosen, från dag ett:** "I samma takt blir det ungefär 40." Talet är
  nettoorder hittills delat med arbetsdagar som gått, gånger månadens
  arbetsdagar, avrundat. Det står som en uträkning på takten, inget löfte, och
  "Visa uträkningen" visar talen det bygger på.
- **Taktens facit står bredvid, inte bakom ett klick:** "I oktober sa takten
  38 efter 10 dagar. Det blev 44." Genomgången visar varje avslutad månad: vad
  takten sa efter 5, 10 och 15 arbetsdagar och vad det blev. Nattjobbet sparar
  vad takten sa varje morgon, så att facit räknas ur det som faktiskt visades.
  Månader före bygget räknas i efterhand ur signeringsdatumen och märks så.
- **Inget mål satt:** kortet säger det och visar takten utan avstånd. I dag
  finns mål bara för september.
- **Inget spann med en chans i procent** förrän det i efterhand har träffat
  ungefär så ofta som det lovar, i ungefär åtta avslutade månader. Prövat i
  Clicknets data 2026-11-15: ett 80 %-spann träffade 11 av 22 morgnar i
  september och 21 av 22 i oktober. Två månader är två prov, inte 44. Takten
  efter 10 arbetsdagar sa 11 i september (det blev 24) och 2 i oktober (det
  blev 3), så takten kan missa stort när orderna kommer i klumpar. Därför står
  dess facit bredvid.
- Kortet öppnar en rad per person i bokstavsordning med det som finns: bokade
  möten, hållna, uteblivna, order. Antal, utan färg och utan dom. Överst står
  lagets öppna rader om obekräftade möten.

**Din månad.** Säljarens provision.

- Kronor visas bara för det provisionsmotorn redan har räknat. Kortets tal är
  `summa` i provisionsunderlaget. Motorn räknar bara godkända order, så talet
  är godkänd provision och inget annat.
- Order som väntar på godkännande står som ett antal på kortet ("1 order väntar
  på godkännande"). I uträkningen står varje sådan order med samma ungefärliga
  belopp som Ordervyn redan visar ("≈ … fryses vid godkännandet"). De räknas
  aldrig in i kortets tal.
- Avståndet till nästa steg står i **order**, som trappan räknas, och bygger på
  godkända order. Vad steget ger i kronor räknas av motorn, inte i klienten.
- Inga pengar visas för affärer som inte finns. Dagens "Prognos i din
  nuvarande takt" flyttas från kortet till uträkningen bakom ett klick.
- "Visa uträkningen" visar order för order, med raden "Det här ser jag inte:
  om en order makuleras senare. Då dras provisionen den månaden."
- Varje rad har "Stämmer inte? Fråga om raden", som använder den väg som redan
  finns för att säga att en provisionsrad är fel.
- Mötesbokare ser hållna och kvalificerade möten och vad de ger. Bokade möten
  läggs aldrig ihop med intjänat.
- Den som inte har någon provisionsregel ser sina egna utfall utan kronor. Det
  avgörs av motorn: ger den inget underlag för personen, och gäller ingen
  mötesprovision, visas inga kronor. Inget nytt fält för "fast lön" behövs.
- Aldrig "du förlorar", aldrig en uppmaning att stänga före månadsskiftet,
  ingen jämförelse med kollegor.

**Det som ändrats.** Det senaste som har fått en dom, och i genomgången varje
rad med källa, antal före och efter, motvikt, resten av laget och dom. Säljaren
ser bara sitt eget. Två handlingar finns i det här steget:

- **Berätta om en ändring** (se 1.5).
- **Pröva med laget.** Lägger in en ändring för laget i loggen, från en vald
  dag, som sedan följs och döms. Det är en riktig rad, inte en uppgift.

"Gör till rutin" kommer i steg 4, när den kan öppna ett färdigt utkast i
Rutiner.

### Kedjan, hela varvet

1. Klockan 14 dagen före mötet är det fortfarande obekräftat. Mötesjobbet
   skapar en rad i loggen.
2. Den som håller mötet ser den i Nav föreslår: "1 möte i morgon är
   obekräftat."
3. Hen öppnar den och ser mötet, antalet försök, hur det brukar gå och raden
   "Det här ser jag inte".
4. Hen väljer: Jag ringer själv, Flytta mötet eller Låt stå.
5. Kvittot säger vad som gjordes och när domen kommer.
6. Dagen efter mötet står utfallet i Det som ändrats hos hen, och i lagets
   facit per val hos chefen.

**Personens egen rad.** Den som en rad handlar om kan skriva en rad om sina tal
("Kunden bad om ny tid, bokas om på måndag."). Den står bredvid talen hos
chefen. Det är personens ord, inte Navs tolkning.

### Texterna

Texterna i korten och genomgångarna skrivs av regler och mallar, inte av AI.
Samma data ger samma text, och texten går att prova. Mallarna följer tonen i
skissen: korta meningar, antal före procent, inga orsaker, "Varför vet jag
inte" när det är sant.

**Varje text från Nav säger hur den kom till.** Källraden under en genomgång
säger "Räknat av regler" eller, från steg 3, "Skrivet av AI ur Navs tal". Nav
säger "jag" i båda fallen, och källraden är det som gör det ärligt.

### Skrivrutan före steg 3

Tills chatten med Claude är påslagen svarar skrivrutan som paletten gör i dag:
sökning, kommandon och de frågor paletten redan kan.

### Det gamla hemmet

Regeln i repot gäller: ingen funktion försvinner. Byggaren ska gå igenom allt
dagens hem visar och för varje sak säga var den finns i det nya: i ett kort, i
en genomgång, bakom en genväg eller i en annan vy. Golvet just nu finns på
Säljtavlan.

Det nya hemmet slås på per person med en inställning, så att beställaren kan
köra det själv i produktionen innan alla får det. Det gamla tas bort först när
beställaren säger till.

### Fart

Hemvyn får inte bli långsammare. Startladdningen får en liten läsning till:
öppna förslag med senaste domar. Allt tyngre hämtas först när ett kort öppnas,
genom en egen rutt: raderna per person, lagets facit och det som ligger bakom
ett tal. Mötesstatistiken laddar i dag bara den här veckan och förra, och det
ska inte växa i startladdningen. Mät med `mat:startsidan` före och efter.

### Före påslagning för alla

Personalen ska ha fått veta tre saker innan det nya hemmet slås på för alla:
vad Nav räknar, vem som ser vad, och hur man säger emot ("Stämmer inte?" och
den egna raden). Beställaren berättar det själv. Om det dessutom krävs förhandling
eller en konsekvensbedömning är inte juridiskt kontrollerat, och ska
kontrolleras innan en regel om enskilda personer slås på (steg 4) och innan
Nav säljs.

---

## Steg 3: Chatten med Claude

### Vad den gör

Personen skriver en fråga. Claude svarar med hjälp av verktyg som läser
färdiga mått, och slutar i en handling när det finns en. Claude kan förbereda
uppgifter som personen godkänner. Claude kan inte utföra något.

### Hur den byggs

- En serverrutt, `POST /nav2/chatt`, som strömmar svaret. Nyckeln finns bara
  på servern.
- **Skilda nycklar** för preview och produktion (`ANTHROPIC_API_KEY` satt per
  miljö i Vercel), så att ett prov aldrig äter av produktionens tak.
- Anthropics officiella SDK för TypeScript (`@anthropic-ai/sdk`). Byggaren ska
  läsa färdigheten `claude-api` innan någon kod skrivs: API:et har ändrats på
  flera punkter under 2026.
- Modell: `claude-sonnet-5-5` att börja med (beställarens val). Modellen är en
  inställning (`chatt.modell`), och inställningen tar bara en modell som har
  ett sparat, godkänt prov (se Säkerhet).
- Tänkandet: `effort` är `high` som standard på Sonnet 5.5 och `medium` på
  Opus 5.5. Sätt `output_config.effort` uttryckligen per modell, börja lågt
  och mät.
- Verktygen har `strict: true`. `tool_choice` ska vara `auto`: tvingat
  verktygsval ger fel 400 på Sonnet 5.5 och Opus 5.5.
- Reservmodell vid avböjande: `fallbacks: "default"` med betarubriken
  `server-side-fallback-2026-07-01`. Kontrollera alltid `stop_reason` innan
  innehållet läses. Haiku 5.5 har ingen reservmodell på servern, så väljs den
  behövs en egen väg för avböjanden.
- Systemtexten och verktygslistan hålls oförändrade mellan anrop så att de kan
  cachas. Datum och klockslag läggs i användarens tur, aldrig i systemtexten.
  Kontrollera `usage.cache_read_input_tokens` i loggen.

### Verktygen

Alla verktyg körs med den inloggades behörighet. Claude kan alltså aldrig få
se mer än personen själv får se i Nav. Verktygen återanvänder palettens och
vyernas byggfunktioner.

| Verktyg | Ger |
|---|---|
| `las_matt` | Ett mått för en person eller krets och en period: antal, "data per", antal rader bakom, och om underlaget räcker för en jämförelse |
| `las_forslag` | Öppna förslag, ändringar, domar och lagets facit |
| `las_vantar` | Listan Väntar på dig |
| `las_dag` | Kalender och uppgifter för en dag |
| `las_provision` | Provisionsunderlaget, som motorn räknat det |
| `forbered_uppgifter` | Ett utkast till en eller flera uppgifter med dag. Visas som ett kort med knappen "Lägg i min dag". Inget skapas förrän personen trycker. |

Claude kan inte skapa förslag i förslagsloggen. Ett förslag med dom ska komma
ur en regel med en gräns. Annars går gränsen att kringgå genom att fråga, och
Navs facit blandas med sådant ingen regel har stått för.

Listan över mått och vad de inte ser står i systemtexten.

### Tal i svaret

Claude skriver inte ut tal. Den hänvisar till ett fält i ett verktygssvar, och
servern sätter in talet. Varje tal i svaret blir då klickbart och visar sin
källa: vilket mått, vem, vilken period och vilka rader. Ett tal kan alltså
inte hamna hos fel person utan att det syns.

Servern kontrollerar också efteråt: en siffra i texten som inte är en
hänvisning märks ut ("Det här talet kunde jag inte belägga") och räknas i
loggen. Andelen svar utan obelagda tal är chattens kvalitetsmått.

### Vad som syns

- Medan verktygen körs står det vad som hämtas: "Hämtar hållna möten för laget,
  vecka 45 och 46." Inget döljer väntetiden.
- Källraden säger "Skrivet av AI ur Navs tal".
- Avböjer modellen, eller tar pengarna slut, säger rutan det rakt och svarar
  som paletten.

### Loggen

En rad per fråga: vem, när, miljö, modell, in- och uttoken, cachade token,
vilka verktyg som anropades med vilka argument, `stop_reason`, tid, beräknad
kostnad och antal obelagda tal. Frågans och svarets text sparas i 90 dagar och
kan bara läsas av personen själv. Tabellen ska in i registerutdraget och
raderingen.

### Kostnad

Ett överslag, som ska mätas i provet och inte är ett tak. En fråga med två
verktygsvarv är ungefär 20 000 intoken och 2 500 uttoken, räknat utan cache
och vid 11 kr per dollar. Tio personer med fem frågor om dagen i 21
arbetsdagar blir 1 050 frågor i månaden.

| Modell | Pris per miljon token, in / ut | Per fråga | Per månad |
|---|---|---|---|
| Claude Opus 5.5 | 4 / 20 dollar | 1,43 kr | cirka 1 500 kr |
| Claude Sonnet 5.5 | 2 / 10 dollar | 0,72 kr | cirka 750 kr |
| Claude Haiku 5.5 | 0,10 / 0,50 dollar | 0,04 kr | cirka 40 kr |

Tänkandet räknas som uttoken och skiljer mellan modellerna, så provet mäter
kostnaden per fråga för varje modell.

Två tak, båda inställningar: kronor per månad för företaget och frågor per dag
och person. När ett tak nås svarar rutan som paletten och säger varför.

### Säkerhet

- Kundnamn, anteckningar och utskrifter är text utifrån. De är data, aldrig
  instruktioner. Det enda Claude kan förbereda är uppgifter som en människa
  måste godkänna.
- Verktygen ger antal och de namn personen redan får se. Inga personnummer,
  inga löner utöver personens egen provision.
- Före påslagning för alla: en fast uppsättning om cirka 30 frågor med kända
  svar, där de svåra fallen finns med: data saknas, fel period, en fråga om en
  person man inte får se, och ett kundnamn som ser ut som en instruktion. Varje
  fråga körs flera gånger på varje modell som provas (Sonnet 5.5, Opus 5.5 och
  Haiku 5.5). Kravet: inget svar har ett obelagt tal, varje hänvisning pekar på
  rätt person och period, och svaret säger att datan saknas när den gör det.
  Provet sparar kostnaden per fråga. Den billigaste modellen som klarar provet
  väljs. 30 rätt av 30 visar bara att felen är färre än ungefär en på tio, så
  provet växer med frågor från riktig användning. Körningen kostar pengar och
  ska godkännas av beställaren.

### Före bygget av steg 3

Tre saker ska vara klara, och ingen av dem kan Claude göra åt beställaren:
API-nycklar hos Anthropic, ett personuppgiftsbiträdesavtal, och ett besked om
var uppgifterna behandlas. Det juridiska är inte kontrollerat.

---

## Steg 4: När datan finns (översikt)

Varje ny kedja är en regel, ett eller flera val, och en dom i samma logg.
Ordningen bestäms när steg 2 har gått några veckor.

- **Trendregeln slås på**, först för laget, sedan per person när underlaget och
  informationen till personalen finns. Åtgärden bestäms då.
- **Månadens spann med en chans i procent.** Slås på först när det i
  efterhand har träffat ungefär så ofta som det lovar, i ungefär åtta
  avslutade månader. Månadsslut och frånvaro ska vara med i uträkningen.
  Takten och dess facit finns redan från steg 2.
- **Svar som blir möten** (Micks förslag i skissen). Kräver att samtalens
  utfall går att läsa. I dag står alla som "okänt".
- **Offerter som står still:** antal och summa för öppna offerter där "Ring
  kunden" har passerats.
- **Kunder att ringa:** kedjorna i Följ upp i den ordning de ligger närmast,
  som en färdig lista säljaren godkänner.
- Mått av sorten antal, med en regel för frånvaro.
- Rutinernas versioner som ingång till ändringsloggen, och "Gör till rutin".
- Genvägen som byter fråga efter klockan ("Förbered 11.00 med PEGU").

## Steg 5: Samtalens innehåll på begäran (översikt)

Sist och smalt. Nav skriver inte ut samtal i förväg.

- När ett led brister och samtalens innehåll kan spela roll frågar Nav: "Ska
  jag gå igenom de här 14 samtalen?" Den säger hur många, hur lång tid det tar
  och vad det kostar. En människa godkänner.
- Samtalen skrivs ut och sparas i `call_transcript`, som redan finns och som
  redan följer inspelningens gallring.
- Claude svarar på ett fast antal räknebara frågor per samtal, med citat och
  tidpunkt i inspelningen. Till exempel: "Bokades ett nästa steg?" Svaren läggs
  ihop till antal. Frågorna är data med en standarduppsättning.
- Aldrig tonläge, känsla eller omdöme om personen.
- Bara den som redan får lyssna på inspelningen får be om genomgången.

Två begränsningar som ska sägas rakt. Text ger inte hela bilden: den visar vad
som sades, inte hur det togs emot. Och samtal utan order gallras efter 30
dagar, så en jämförelse bakåt går bara mot samtal som blev order eller mot de
senaste 30 dagarna.

Före bygget behövs ett prov på tio samtal för att se om utskrifterna håller för
svenska säljsamtal. Leverantör för utskriften är inte vald.

## Senare, egna dokument

Kunskapsbasen per företag (byggd genom att Nav intervjuar), larmet när ett möte
lämnas utan nästa steg, säljcoachen, och rätten för Nav att göra en sorts
åtgärd själv.

---

## De tolv skydden, och hur de uppfylls

| Skydd | I det här bygget |
|---|---|
| 1. AI förbereder, en människa godkänner | Enda åtgärderna är uppgifter i Nav efter ett klick. Claude kan bara förbereda. |
| 2. Varje tal har en motvikt | Motvikten är ett fält på måttet. Domen "ser bra ut" kräver den. En andel står aldrig utan sitt antal. |
| 3. Inget tal utan belägg | Registret är enda källan. I chatten sätter servern in talen. "För få för att säga något" under 20. |
| 4. Nav dömer sig själv ärligt | Det Nav trodde sparas före beslutet. "Låt stå" och "ingen valde" följs likadant. Ingen gissning som nästan alltid blir rätt. |
| 5. Skissen och demon är produkten | Inga exempeltal i previewn, inga rader inlagda för hand. Skissens tal rättas innan den visas för en kund. |
| 6. Regel, AI och människa hålls isär | Källraden säger "Räknat av regler" eller "Skrivet av AI". Personens rad är personens. |
| 7. Inga kundnamn eller resultat utan ja | Gäller presentationen. Inget i bygget. |
| 8. Värde räknas i det kunden behöll | Nettoorder, hållna möten och godkänd provision. Aldrig bokat eller prognos som intjänat. |
| 9. Det Nav säger till en kund är företagets löfte | Nav säger inget till en kund i det här bygget. |
| 10. Gränser i teknik | RLS på loggen, verktyg med personens behörighet, tabeller som inte går att ändra, skilda nycklar, tak för kostnad, logg på varje anrop. |
| 11. Vägen till en människa finns kvar | "Fråga om raden", personens egen rad, och paletten när AI:n inte svarar. |
| 12. Det andra företaget är provet | Första kedjan kräver ingen historik. Gränser, fönster, mått och texter är data med standardvärden. |

## Prov och när det är klart

**Rena funktioner med prov** (samma stil som `tests/motesstat.mjs`):
slumpvärdet för andelar, regeln för när ett möte räknas som obekräftat sista
dagen med alla gränsfall, domarna i 1.5 med motvikt och resten av laget,
facit per val, trendregeln med fönster i möten, och mallarnas texter.

**Databasprov:** loggen tar inte emot ändringar eller raderingar, regel och
nyckel är unika, RLS ger personen bara sitt eget och chefen sin krets,
registerutdraget och raderingen är hela. Provdata märks med `prov` och skrivs
aldrig i tabeller med räknare som förbrukas.

**Klickprov** i previewn, i mörkt och ljust, som chef och som säljare.

**Klart är det när:**

- Steg 1: jobben har torrkört en vecka i produktionen utan fel, och kvittots
  antal stämmer med en räkning för hand av veckans obekräftade möten.
  Beställaren ser den listan innan steg 2 slås på.
- Steg 2: tio riktiga möten har gått hela varvet hos Clicknet, talet i Din
  månad är detsamma som i provisionsunderlaget för varje säljare, och takten i
  Teamet i månaden stämmer med en räkning för hand.
- Steg 3: de 30 frågorna ger inga obelagda tal, och en månads användning
  ligger under taket.

## Repots regler som gäller bygget

- Gren, preview, och till `main` först efter uttryckligt ja. En commit per
  ändring. Inga lokala byggen.
- Previewn läser produktionens databas. Migrationerna ska bara lägga till, så
  att koden på `main` aldrig rör det nya.
- Migrationens nummer tas ur `schema_migrations` när den körs.
- En rad i `src/navnyheter/poster.ts` i samma commit som funktionen.
- Varje ny server action bokförs i `tests/notiser-tackning.mjs`.
- Läs `docs/NASTA_SESSION.md` först. Uppdatera den och `docs/ARBETSLOGG.md`
  efteråt.
- Inget som bara gäller Clicknet hårdkodas.
- I `utkast.html`: sök efter funktionsnamnet innan en ny funktion läggs till
  (filen är ett enda namnrum), spara utan omladdning (`ndOmlas`), och läs inte
  ett klickat elements data efter en omritning.

## Mina val (beställaren har inte sagt dem)

1. Första kedjan gäller ett möte i taget och går till den som håller mötet,
   med tre val. Den ersätter "jämför en person med sig själv" som första kedja.
2. Chefen får inget eget förslag om obekräftade möten, bara lagets rader i
   genomgången.
3. Ingen gissning per möte. Navs facit räknas per val över hela laget, aldrig
   per person. Talen visas från första mötet, och domen ges av Fishers exakta
   prov med gränsen 0,01 vid vilket antal som helst, räknad vart tionde möte.
   Står en person för mer än hälften av ett val visas ingen dom.
4. Loggen är två tabeller som bara tar emot nya rader, och läget läses ur en vy.
5. Inga riktiga förslag skapas förrän någon kan se dem. Steg 1 torrkör.
6. Trendregeln börjar med laget, räknar fönster i möten (20 mot 40) och har
   gränsen 0,01. Den säger hur mycket som saknas i stället för att vara tyst.
7. Domen över en ändring har gränsen 0,05, två olika slut, och resten av laget
   bredvid.
8. Offertens belopp är obligatoriskt och räknas som ordervärdet.
9. Kortet Din månad visar bara godkänd provision. Väntande order står som antal.
10. Teamet i månaden visar takten från dag ett, med taktens eget facit
    bredvid. Ett spann med en chans i procent kommer först efter ungefär åtta
    avslutade månader.
11. En rad om en person avidentifieras efter 24 månader.
12. Texterna i korten skrivs av mallar, och varje text säger hur den kom till.
13. Skrivrutan svarar som paletten tills steg 3 är på.
14. Det nya hemmet slås på per person, och det gamla ligger kvar tills
    beställaren säger till.
15. Chatten provas på Sonnet 5.5, Opus 5.5 och Haiku 5.5, och den billigaste
    som klarar provet väljs. Två tak för kostnaden och skilda nycklar för
    preview och produktion.
16. Claude skriver inte ut tal och kan inte skapa förslag i loggen, bara
    förbereda uppgifter.
17. Chattens text sparas i 90 dagar och läses bara av personen själv.
18. Inga notiser om förslag.

## Det beställaren behöver säga

1. **Första kedjan.** Ja eller nej till 1.3, som den ser ut i skiss 9: ett
   obekräftat möte går till den som håller mötet, med tre val och dom dagen
   efter.
2. **Mål för månaden.** Säljmål finns bara för september. Utan mål visar
   Teamet i månaden takten men inget avstånd till målet.
3. **Före steg 3, inte nu:** nycklar hos Anthropic, avtal och ett tak i kronor
   per månad.

## Lämnat åt byggaren

- Namn på filer, funktioner och kolumner, så länge de följer repots mönster.
- Hur vyn över loggens läge skrivs, och index.
- Om "Jag ringer själv" lämnar över bokarens uppgift eller skapar en ny, så
  länge bokaren ser vem som tog den och ingen dubblett uppstår.
- Hur "Fråga om raden" kopplas till den väg som redan finns.
- Genomgången av det gamla hemmet, sak för sak.
- Hur ångra görs, enligt mönstret som finns i Uppgifter.
- Hur hänvisningarna till tal i chattens svar skrivs och sätts in.
- Telefonens uppställning, inom "korten staplas".
- Var taktens morgonvärden sparas, så länge facit räknas ur det som visades.
