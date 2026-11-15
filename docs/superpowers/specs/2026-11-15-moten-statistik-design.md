# Möten: statistiken som instrumentpanel

Datum: 2026-11-15. Beställare: Zen. Förlaga: den klickbara förhandsvisningen
`https://claude.ai/artifact/N7w9iwgvCeCENZuMmt7aaz` (version 9), vars källa och logik
ligger i sessionens scratchpad (`canvas/project/Main.dc.html`, provet `proto/test3.mjs`).
Förhandsvisningen är facit för utseende, texter och beteende. Det här dokumentet säger
vad som byggs i Nav, varför, och vad som är bestämt.

## Varför

Statistiken i Möten (chefens vy, `ndMsChef` i `src/nav2/utkast.html`) är en tabell med
8 personer gånger 7 kolumner, denna vecka mot förra. Beställaren: "svår att läsa, svår att
förstå direkt", och den öppnas inte. Med 10–15 möten i veckan blir veckoprocenten brus.

Beställaren vill se show rate och no-show rate med de namnen, svaren på
bekräftelsesamtalet, kvalificering, closing rate, hur många som går till offert och vad
som händer efter första mötet, mappat mot tavlan, och vad som ska göras nu. Efter tre
varv (en lång sida, en tät panelvy, ett rutnät) blev svaret på rutnätet "wow, nu pratar
vi". Det blev också riktningen för hela Nav (CLAUDE.md, "rymligt, enkelt, lätt att förstå").

**Lyckat** = en chef öppnar Möten → Statistik och ser på några sekunder hur mötena går och
vad som behöver göras, och varje tal leder vidare till mötena bakom och därifrån till kortet.

## Mål, icke-mål och sådant som gör det misslyckat

**Mål**
- Chefens statistik ersätts av panelen i förhandsvisningen: rubrik, Show rate som
  huvudruta, fyra rutor, Efter första mötet, Att göra nu.
- Perioderna Vecka, Månad och 90 dagar (förval), plus ett personfilter. Vyn minns
  period och person per användare.
- Varje tal öppnar listan bakom (bladet). En rad i listan öppnar kortet på tavlan.
- Mål per tal, satta per företag i Mötens inställningar (se nedan).

**Icke-mål (senare steg)**
- Veckans tal i morgonbrevet.
- Säljarens egen rad på startsidan (`ndMsHemRad`) ändras inte.
- Ingen ny statistik för säljare: vyn är för chefer, som i dag.

**Gör det misslyckat även om det fungerar**
- Vyn blir en tät panel med rader, chips och noter igen (v5 underkändes för det).
- Något som finns i dag försvinner. Allt som tas bort från skärmen ska nås under **Mer**.
- Ett tal som inte går att kontrollräkna mot databasen, eller en dom (bra/dåligt) utan
  ett mål som företaget själv har satt.
- Något hårdkodat för Clicknet (namn, personer, mål, gränser).

## Det som är bestämt

### Panelen (som förhandsvisningen version 9)

1. **Rubriken** är en mening om det viktigaste fyndet i perioden (beställaren 2026-11-15),
   inte en fast rad med antal. Meningen väljs av regler, inte av AI, i den här ordningen
   (som `ins1` i förlagan):
   1. Om obekräftade möten finns och inget av dem blev av: "Inget av de N obekräftade mötena blev av."
   2. Om bekräftade möten blev av minst 15 procentenheter oftare än obekräftade:
      "Bekräftade möten blev av X av Y gånger, obekräftade A av B."
   3. Annars: "N av M hållna möten har gått till offert.", "Inget möte har gått till
      offert än.", "Inget möte blev av i perioden.", "Inget av de bokade mötena har
      varit än." eller "Inga möten i perioden."
   Rubrikens andra del (`ins2`) och alla texter i övrigt följer förlagan.
2. **Show rate** är huvudrutan: stort tal, "6 av 11 kom", mötena ett och ett som streck
   i tidsordning (kom/uteblev), jämförelse mot perioden före. När inget möte har varit än
   visar den "Nästa möte <dag tid>" och "N möten bokade framåt", och öppnar de mötena.
3. **Fyra rutor**: No-show rate, Svarade på bekräftelsen ("N svarade inte · N ringdes
   aldrig"), Kvalificerade, Closing rate.
4. **Kvalificerade räknas på alla hållna möten** (beställaren 2026-11-15): "2 av 6 hållna
   möten", 33 %. Ett hållet möte utan bedömning räknas som inte kvalificerat, och raden
   "4 hållna saknar bedömning" står kvar under talet. Talet och mätaren säger samma sak.
   Listan bakom visar alla hållna med Kvalificerat, Inte kvalificerat eller Inte bedömt.
5. **Efter första mötet**: Till offert (störst), Nytt möte, Följs upp, Dog. Nollor dämpade.
6. **Att göra nu**: möten att bekräfta (närmast först), uteblivna utan ny tid,
   uppföljningar att ringa (äldst först), offerter som väntar på svar.
7. **Procent visas först vid minst fem** i nämnaren, annars "N av M". Jämförelse mot
   perioden före bara när båda perioderna har minst fem. Detta är en produktregel, inte
   en inställning.
8. **Bladet** (listan bakom ett tal) är en dialog: rubrik, en mening som förklarar talet,
   fördelningen ("Hållet 6 · Uteblev 5"), raderna. Listorna under Att göra nu börjar med
   det som brådskar, övriga med det senaste. Esc och ✕ stänger och ger fokus tillbaka.
9. **En rad öppnar kortet** på tavlan när betraktaren ser kortet. Det finns redan:
   `msBolag` + `msOppnaKort` (F20.1). Återanvänd dem.
10. **Mer**: allt från dagens vy som inte står i panelen ligger kvar bakom en knapp Mer:
    tabellen per person (samtal, bokade, per 100 samtal, andel hållna, andel affärer,
    affär på första mötet, utan utfall), offerterna, dagar till mötet, bekräftelse per
    bokare och källorna. Inget av det tas bort.
11. **Rörelse**: talen räknar upp och strecken ritas in när vyn öppnas eller perioden
    byts, som i förlagan, avstängt vid `prefers-reduced-motion`.
12. Ljust och mörkt läge, 400 px bredd, tangentbord och skärmläsare som i förlagan
    (rutornas namn för skärmläsare bär talet).

### Definitioner (sagda till beställaren, inte invända mot)

- Talen räknas på **första mötet** i varje kedja. Uppföljningsmöten räknas inte. Avbokade
  möten räknas inte i show rate.
- **Ringdes aldrig** = mötet varken bekräftades eller fick ett "Fick inte tag".
- **Till offert** räknar också affär direkt på mötet.
- **Dog** = kedjan stängdes med nej, eller fick "inget svar" N gånger i rad, eller har
  en uppföljning som är äldre än N dagar, utan nytt möte eller offert. N är inställningar
  (nedan).
- **Personfiltret** visar möten som personen bokade eller höll.
- En teamledare ser bara sitt team (0264), som i dag.

### Mål per tal

- Ny nyckel i Mötens inställningar: `moten.mal`, ett objekt med procent per tal:
  `{ show, noshow, bekr, kval, closing }`, varje värde 0–100 eller saknas.
- **Förval: inga mål.** Utan mål visar rutan inget omdöme, bara talet. Nav hittar inte på
  vad som är bra för ett företag (CLAUDE.md: inget tal utan belägg).
- Med mål visar rutan ett litet märke på mätaren där målet ligger och en kort text,
  "Över målet 70 %" eller "Under målet 70 %". Texten bär omdömet, aldrig bara färg.
  För No-show rate är lägre bättre.
- Målet sätts av den som får ändra Mötens inställningar (`farAndraInstallning`, admin),
  i den befintliga inställningsvyn, och sparas genom den befintliga vägen
  (`installningar()` i `src/app/nav2/moten/route.ts` + `provaInstallning` i
  `motesflode.ts`) med händelsen `mote.settings_changed`.

### Inställningar som var siffror i förlagan

Läses ur `nav_setting` genom `lasInstallningar`, med förval i `INST_FORVAL`:
- `moten.dod-dagar` (förval 21): en uppföljning äldre än så räknas som död.
- `moten.dod-tysta` (förval 3): så många "inget svar" i rad räknas som död.
- Bekräftelsens arbetsdagar (`moten.bekrafta-dagar`) och tidszonen (`moten.tidszon`) finns
  redan och används.

### Data

- `byggMotesstat` (`src/lib/nav2/motesstat.ts`) läser i dag två veckor. Den ska läsa det
  som behövs för den längsta perioden plus perioden före (180 dagar bakåt) och de öppna
  mötena och kedjorna, sidvis som i dag (REST kapar vid 1000 rader).
- Mötena behöver också `forsok`, `niva`, `niva_svar`. Kedjorna behöver också
  `uppfoljning_datum` och `inget_svar_i_rad` (finns på `mote_kedja`, inte i vyn
  `mote_kedja_utfall`; läs dem därifrån eller vidga vyn, byggarens val, helst utan migration).
- Alla tal räknas i rena funktioner i `motesstatforma.ts` (eller en ny `motespanel.ts`
  bredvid), med prov, så att de går att kontrollräkna mot databasen.
- Klienten räknar om för period och person utan ny serverfråga (som förlagan), så att
  byte av period är omedelbart.
- `NdMotesstat` får målen och de två nya inställningarna med sig.
- RLS och kretsen avgör som i dag; inget filter i klienten ersätter dem.

### Minnet

Period och person sparas i `localStorage` under en nyckel per användare
(`nd-ms-val:<employee-id>`). Ett okänt värde (person som slutat, period som inte finns)
ger förvalet. Fungerar utan lagring.

### Leverans

- Gren, preview, beställarens ja, sedan main (CLAUDE.md). En commit vid push.
- En rad i `src/navnyheter/poster.ts`. `docs/NASTA_SESSION.md` och `docs/ARBETSLOGG.md`
  uppdateras.
- Prov: talen mot produktionens data (läs-only) som förlagans prov gjorde; klickprov i
  previewen av varje tal, bladet, raden till kortet, Mer, perioderna, personfiltret, målen.

### Exakta definitioner (ur förlagan version 9, som är facit)

Förlagans fil i scratchpaden är version 9, samma som den publicerade.

- **Perioder.** Vecka = kalenderveckan måndag–söndag, före = veckan innan. Månad =
  kalendermånaden, före = månaden innan. 90 dagar = rullande 90 dagar bakåt från i dag,
  före = de 90 dagarna innan dess. Ett möte hör till perioden genom `mote_tid`, svensk tid
  (`moten.tidszon`).
- **Första mötet** = `art` i (`ny`, `ombokning`), inte `uppfoljning`. Avgjorda =
  `utfall` i (`hallet`, `uteblev`). Show rate = hållna / avgjorda. No-show = uteblivna / avgjorda.
- **Svarade på bekräftelsen** = avgjorda med `bekraftat_nar` / avgjorda. "Svarade inte" =
  avgjorda utan bekräftelse med `forsok > 0`. "Ringdes aldrig" = utan bekräftelse och `forsok = 0`.
- **Kvalificerad** = `mote.niva = 'kvalificerat'`. `niva = 'hallet'` = bedömt, inte
  kvalificerat. `niva is null` = inte bedömt. Nämnaren är hållna första möten.
- **Closing rate** = kedjor med offert (eller affär direkt) vars avslut är `affar` /
  (`affar` + `nej`). Offerter utan avslut räknas som "inte avgjorda än".
- **Efter första mötet** räknar kedjor vars första hållna möte ligger i perioden, med
  läget i dag. De fyra hinkarna jämförs inte mot perioden före. Jämförelse finns bara för
  Show rate, Svarade, Kvalificerade, Till offert och Closing rate, och bara i navet
  respektive i bladet, som i förlagan.
- **Personfiltret.** Ett möte hör till personen om hen bokade eller höll det. En kedja hör
  till personen genom sitt första möte. **Att göra nu följer filtret.** Teamledarens
  personlista är kretsen (0264).

### Var talen räknas (byggarens fråga 1, mitt beslut)

TypeScript är auktoriteten. Servern räknar panelen i rena funktioner (`motespanel.ts`) för
varje kombination av period (3) och person (alla + varje person i kretsen). Den skickar
de färdiga talen och id:na bakom varje tal till klienten, som bara ritar. Bytet av period
eller person blir då omedelbart utan att logiken finns i två kopior. Proven körs på
TS-funktionerna, och samma funktioner kontrollräknas mot databasen. Blir svaret för stort
med många personer (över ungefär 30) räknas personerna i stället när de väljs, genom en
POST till `/nav2/moten`. Det är byggarens sak att mäta.

### Mer (byggarens fråga 3, mitt beslut)

Det som flyttas under Mer behåller dagens innehåll och beräkning, "denna vecka mot förra",
och rubriken säger det ("Vecka för vecka"). Det följer inte panelens period eller person.
Så tappas inget bort, och inget behöver räknas om. Om det ska följa perioden blir det ett
eget, senare steg.

### Inställningarnas gränser

`moten.dod-dagar` är ett heltal 1–365, `moten.dod-tysta` ett heltal 1–20. Varje mål i
`moten.mal` är ett heltal 0–100 eller saknas. Andra värden avvisas med 400 i
`provaInstallning`.

## Lämnat åt byggaren

- Hur panelen delas upp i funktioner i utkastet, och om beräkningen ligger i
  `motesstatforma.ts` eller en ny fil.
- Om de två kedjekolumnerna läses ur `mote_kedja` eller vyn vidgas.
- Hur inställningsvyn visar målen, inom Navs befintliga formspråk.
- Exakt hur dagens vy flyttas in under Mer.

## Mina beslut (beställaren har inte tagit ställning)

- Förvalet för mål är "inga mål", inte branschsiffror.
- Döds-gränserna blir inställningar med förvalen 21 dagar och 3 tysta.
- Minnet är per användare i webbläsaren, inte i databasen.
- Panelen ersätter tabellen som det man ser först; tabellen flyttas under Mer.
- Mer stannar på "denna vecka mot förra" och följer inte period eller person.
- Talen räknas på servern för alla perioder och personer, inte i klienten.
- Efter första mötets fyra hinkar visas utan jämförelse mot perioden före.
