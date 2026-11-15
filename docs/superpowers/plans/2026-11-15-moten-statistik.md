# Möten: statistiken som instrumentpanel — byggplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chefens statistik i Möten blir panelen från förlagan (rubrik, Show rate som huvudruta, fyra rutor, Efter första mötet, Att göra nu, mål per tal), med dagens vy kvar under Mer.

**Architecture:** Alla tal räknas i en ny ren TS-modul (`motespanel.ts`) som servern kör för varje period (vecka, manad, d90) och varje person i kretsen plus "alla". Svaret följer med i `ND.motesstat.panel`. Utkastet (`utkast.html`) ritar bara, så att period och person byts direkt utan serverfråga. Målen och dödsgränserna är nya nycklar i Mötens befintliga inställningar (`nav_setting` "moten.*").

**Tech Stack:** Next.js route + Supabase (pgrest) på servern, TypeScript-moduler provade med `node --experimental-strip-types`, klientkod i en enda HTML-fil (`src/nav2/utkast.html`).

**Spec:** `docs/superpowers/specs/2026-11-15-moten-statistik-design.md`. Förlagan (facit för logik, texter och utseende): `docs/superpowers/specs/2026-11-15-moten-statistik-forlaga.dc.html`, version 9. Logiken står i `renderVals()`, raderna ~290–610. Förlagans prov: `docs/superpowers/specs/2026-11-15-moten-statistik-forlaga-prov.mjs`.

## Global Constraints

- Gren `moten-statistik`. Lokala stegcommits går bra. Före push slås allt ihop till **en** commit (`git merge --squash` eller `reset --soft`). Ingen push till `main` utan beställarens ja efter previewen.
- Kör aldrig `npm run build` eller `npm run dev` lokalt. Prov körs med `npm run test:<namn>` (TZ=UTC).
- Ingen migration. `nav_setting` finns och läses med `lasInstallningar`.
- Hårdkoda inget företagsspecifikt: inga namn, inga mål, inga gränser i koden utöver förvalen i `INST_FORVAL`.
- Procent visas först när nämnaren är minst **5**, annars "N av M". Jämförelse mot perioden före visas bara när båda perioderna har nämnare ≥ 5.
- Förvalet för mål är **inga mål**. Utan mål visas inget omdöme.
- Förvalen är `dodDagar` **21** och `dodTysta` **3**. Gränserna: dodDagar ett heltal 1–365, dodTysta ett heltal 1–20, mål ett heltal 0–100 per tal eller saknas.
- Texterna är förlagans, ordagrant. Omdömet skrivs i text ("Över målet 70 %" / "Under målet 70 %") och aldrig bara med färg. För noshow är lägre bättre.
- Allt i dagens chefsvy (`ndMsChef`) finns kvar under **Mer** med rubriken "Vecka för vecka". Det beräknas som i dag och följer inte panelens period eller person.
- `prefers-reduced-motion` stänger av uppräkning och inritning.
- Ny rad överst i `src/navnyheter/poster.ts` i samma commit. `docs/NASTA_SESSION.md` och `docs/ARBETSLOGG.md` uppdateras.

## Review Focus

1. **Ett företag utan ett enda möte**: panelen visar "Inga möten i perioden.", streck i rutorna och inga NaN eller "0 %". Provet ligger i Task 2 (`tomt underlag`) och Task 4 (`tomt ritas`).
2. **Ett möte sent på kvällen svensk tid den sista dagen i perioden**, till exempel 23:30 den 30 nov, som är 22:30Z. Det hör till november och till den perioden, och sommartid räknas rätt. Provet ligger i Task 2 (`gränsen följer svensk tid`).
3. **En sparad person som har slutat eller ligger utanför kretsen**: vyn börjar på "Alla" och kraschar inte. Provet ligger i Task 4 (`okänt sparat val`).
4. **En teamledare**: personlistan och "alla" omfattar bara kretsen. Provet ligger i Task 3 (`kretsen begränsar panelen`).
5. **Ett mål satt till 0 eller 100 och No-show rate**: omdömet vänds rätt, och 0 visar ingen pinne utanför mätaren. Provet ligger i Task 2 (`omdöme mot mål`).

---

### Task 1: Inställningarna mål och dödsgränser

**Files:**
- Modify: `src/lib/nav2/motesflode.ts` (`MotenInst`, `INST_FORVAL`, `INST_NYCKLAR`, `TOLKA`, `provaInstallning`)
- Modify: `src/lib/nav2/motenforma.ts` (`farAndraInstallning`), bara om de nya nycklarna inte redan släpps igenom för admin
- Test: `tests/motesflode.mjs`

**Interfaces:**
- Produces: `MotenInst.mal: Partial<Record<"show"|"noshow"|"bekr"|"kval"|"closing", number>>`, `MotenInst.dodDagar: number`, `MotenInst.dodTysta: number`. Nycklarna är `moten.mal`, `moten.dod-dagar` och `moten.dod-tysta`.

- [ ] **Step 1: Skriv de felande proven** i `tests/motesflode.mjs`:
  - `lasInstallningar([])` ger `mal` `{}`, `dodDagar` 21 och `dodTysta` 3.
  - `lasInstallningar([{key:"moten.mal", value:{show:80, noshow:15}}])` ger `mal` `{show:80, noshow:15}`.
  - `provaInstallning("moten.mal", {show:101})`, `{show:-1}`, `{show:7.5}`, `{okand:5}` och `[]` ger alla `ok:false`.
  - `provaInstallning("moten.mal", {})` ger `ok:true`, vilket betyder att alla mål tas bort.
  - `provaInstallning("moten.dod-dagar", 0)` och `366` ger `ok:false`. `1` och `365` ger `ok:true`.
  - `provaInstallning("moten.dod-tysta", 21)` ger `ok:false`. `20` ger `ok:true`.
  - En admin får ändra alla tre nycklarna, och en säljare får inte (`farAndraInstallning`).
- [ ] **Step 2:** Kör `npm run test:motesflode`. Väntat utfall: de nya raderna är röda.
- [ ] **Step 3:** Lägg fälten i `MotenInst`, `INST_FORVAL` (`mal: {}, dodDagar: 21, dodTysta: 3`), `INST_NYCKLAR` och `TOLKA` med gränserna från Global Constraints. `provaInstallning` använder samma tolkare.
- [ ] **Step 4:** Kör `npm run test:motesflode`. Väntat utfall: allt grönt.
- [ ] **Step 5:** Committa lokalt: `Möten: inställningarna mål och dödsgränser`.

### Task 2: `motespanel.ts`, alla tal i panelen

**Files:**
- Create: `src/lib/nav2/motespanel.ts`
- Create: `tests/motespanel.mjs`, och `tests/fixtures/motespanel-2026-11-14.json`
- Modify: `package.json` (lägg till `"test:motespanel": "TZ=UTC node --experimental-strip-types tests/motespanel.mjs"` och ta med det i `test:alla` efter `test:motesstat`)

**Interfaces:**
- Consumes: `StatMote` och `StatKedja` ur `motesstatforma.ts`, utökade i Task 3 med `forsok: number`, `niva: "kvalificerat"|"hallet"|null` och för kedjan `uppfoljningDatum: string|null` och `ingetSvarIRad: number`. Lägg till fälten i typerna här, som valfria, så att befintliga prov står kvar.
- Consumes: `MotenInst` från Task 1 (`mal`, `dodDagar`, `dodTysta`, `bekraftaDagar`, `tidszon`).
- Produces:
  ```ts
  export type PeriodNyckel = "vecka" | "manad" | "d90";
  export type PanelPeriod = { fran: string; till: string | null; foreFran: string; foreTill: string; mot: string };
  export function panelPerioder(nu: Date, tidszon: string): Record<PeriodNyckel, PanelPeriod>;
  export type Andel = { n: number; av: number; ids: string[] };     // ids = mötes- eller kedje-id bakom n
  export type Panel = {
    rubrik: [string, string];                    // ins1, ins2
    show: Andel; noshow: Andel; bekr: Andel & { svaradeInte: string[]; aldrig: string[] };
    kval: Andel & { obedomda: string[] };        // av = hållna första möten
    offert: Andel;                               // n = kedjor som nått offert, av = kedjor med hållet första möte
    closing: Andel & { ejAvgjorda: string[] };   // av = affär + nej
    efter: { offert: string[]; nytt: string[]; foljsUpp: string[]; dog: string[] };  // kedje-id
    attGora: { attBekr: string[]; utanTid: string[]; uppfNu: string[]; offSvar: string[] };
    kommer: string[];                            // mötes-id framåt, närmast först
    avgjorda: string[];                          // mötes-id i tidsordning, för strecken i navet
    fore: { show: Andel; bekr: Andel; kval: Andel; offert: Andel; closing: Andel } | null;
    omdome: Partial<Record<"show"|"noshow"|"bekr"|"kval"|"closing", "over"|"under">>;
  };
  export function byggPanel(moten: StatMote[], kedjor: StatKedja[], p: PanelPeriod, person: string | null, inst: MotenInst, nu: Date): Panel;
  ```

Reglerna är förlagans `renderVals()` och översätts rad för rad. Det här är de värden som är låsta:
- Ett möte hör till perioden genom `moteTid` i `inst.tidszon`. Vecka är måndag–söndag, Månad är kalendermånaden och d90 är rullande (`till: null`). Perioden före är veckan eller månaden innan, eller de 90 dagarna innan.
- Första möten har `art` i (`ny`, `ombokning`). Avgjorda har `utfall` i (`hallet`, `uteblev`).
- Kvalificerade: `n` = `niva==="kvalificerat"` och `av` = hållna. `obedomda` = hållna med `niva===null`.
- Svarade: `bekraftatNar` satt. `svaradeInte` = obekräftade med `forsok>0`. `aldrig` = obekräftade med `forsok===0`.
- Kedjans läge, ur förlagan rad ~300–311:
  - `natt` = hållet första möte och (offert eller avslut `affar`).
  - `ut` = `offert` om natt. Annars `nytt` om ett senare möte finns och kedjan inte är avslutad. Annars `dog` om (avslut, eller `ingetSvarIRad >= dodTysta`, eller `uppfoljningDatum` äldre än `dodDagar` dagar). Annars `foljsUpp`.
- Closing: `affar`/(`affar`+`nej`). `ejAvgjorda` = offerter utan avslut.
- Rubriken följer förlagan rad ~530–537, ordagrant: regeln om obekräftade kräver minst 2 obekräftade och minst 2 bekräftade, och skillnaden ska vara ≥ 15 procentenheter.
- `attBekr` = möten utan utfall, framåt, obekräftade, där mötesdagen ligger högst `bekraftaDagar` arbetsdagar bort. De sorteras med närmast först. `uppfNu` och `offSvar` följer förlagan rad ~580–584.
- Personfiltret: ett möte hör till personen om `bokatAv` eller `hallsAv` är personen. En kedja hör till personen genom sitt första möte.
- `omdome[t]` sätts bara när `inst.mal[t]` finns och `av>0`. Då gäller `over` om andelen ≥ målet, men för `noshow` gäller `over` om andelen ≤ målet. Andelen avrundas till heltal procent som i förlagan.

- [ ] **Step 1: Bygg fixturen.** Gör om förlagans `M`- och `K`-matriser för "Era siffror" (rad ~291, med `NU` 2026-11-14) till `StatMote[]` och `StatKedja[]` i `tests/fixtures/motespanel-2026-11-14.json`. Personnamnen blir `p-zen`, `p-mick`, `p-carl`, `p-fredrik` och kedjorna `k0…`. Inga bolagsnamn.
- [ ] **Step 2: Skriv de felande proven** i `tests/motespanel.mjs`. Talen är förlagans fakta (förlagans prov rad 83), med `byggPanel(fixtur, perioder.d90, null, INST_FORVAL, NU)`:
  - `show` {n:6, av:11}, `noshow` {n:5, av:11}, `bekr` {n:8, av:11}, `bekr.svaradeInte.length` 0, `bekr.aldrig.length` 3.
  - `kval` {n:2, av:6}, `kval.obedomda.length` 4.
  - `efter`-längderna `[2,2,2,0]` i ordningen offert, nytt, foljsUpp, dog.
  - `closing.av` 0. `rubrik[0]` = "Inget av de 3 obekräftade mötena blev av."
  - `attGora`-längderna `[7,5,1,2]`. `attBekr[0]` är mötet 2026-11-16T10:30.
  - **tomt underlag:** `byggPanel([], [], …)` ger rubriken "Inga möten i perioden.", varje `av` 0 och `fore` null.
  - **person:** med `p-carl` och perioden vecka blir `show.av` 0 och `kommer.length` 2.
  - **gränsen följer svensk tid:** ett möte 2026-11-30T22:30Z räknas i månaden november. Ett möte 2026-03-29T22:30Z räknas i dygnet 2026-03-30 efter övergången till sommartid.
  - **omdöme mot mål:**
    - `mal {show:50}` ger `omdome.show` `over`, eftersom 55 ≥ 50.
    - `mal {noshow:40}` ger `omdome.noshow` `under`, eftersom 45 > 40 och lägre är bättre.
    - `mal {kval:0}` ger `over`.
    - Utan mål saknas nyckeln.
  - **dödsgränser:** `dodTysta: 1` flyttar en kedja med `ingetSvarIRad` 1 från `foljsUpp` till `dog`.
- [ ] **Step 3:** Kör `npm run test:motespanel`. Väntat utfall: röda prov, eller att modulen saknas.
- [ ] **Step 4:** Skriv `panelPerioder` och `byggPanel` enligt signaturerna. Datum räknas med `src/lib/klocka.ts`, som redan har svensk tid, och med tidszonen ur inställningen. Ingen egen zonlogik.
- [ ] **Step 5:** Kör `npm run test:motespanel && npm run test:motesstat`. Väntat utfall: allt grönt, också de befintliga proven för motesstat.
- [ ] **Step 6:** Committa lokalt: `Möten: panelens tal i motespanel.ts`.

### Task 3: Servern läser 180 dagar och skickar panelen

**Files:**
- Modify: `src/lib/nav2/motesstat.ts` (`MOTE_KOLUMNER`, frågorna, `NdMotesstat`, `bygg`)
- Test: `tests/motesstat-db.mjs` (läser produktionen, bara läsning)

**Interfaces:**
- Consumes: `byggPanel` och `panelPerioder` från Task 2, och `lasInstallningar` från Task 1.
- Produces: `NdMotesstat.panel: null | { perioder: Record<PeriodNyckel, PanelPeriod>; personer: {id:string; namn:string}[]; tal: Record<PeriodNyckel, Record<string, Panel>>; mal: MotenInst["mal"]; moten: Record<string, {tid:string; art:string; utfall:string|null; bekr:boolean; kedja:string; bokatAv:string; hallsAv:string}>; kedjor: Record<string, {uppf:string|null}> }`. Nyckeln `"alla"` står för alla. `panel` är `null` för den som inte är chef. Bolagsnamnen kommer ur det befintliga `bolag`.

- [ ] **Step 1: Skriv de felande proven** i `tests/motesstat-db.mjs`:
  - `panel.tal.d90.alla.show.av` = antal i SQL för `art in ('ny','ombokning') and utfall in ('hallet','uteblev') and mote_tid >= now()-90 days`.
  - `kval.n` = samma sak med `niva='kvalificerat' and utfall='hallet'`.
  - **kretsen begränsar panelen:** med en teamledare (provets befintliga roll) innehåller `personer` bara kretsens id, och `alla` räknar bara kretsens möten.
- [ ] **Step 2:** Kör `npm run test:motesstat-db`. Väntat utfall: rött, eftersom `panel` saknas.
- [ ] **Step 3:** Bygg serverdelen.
  - Vidga läsningen till `foreFran` för d90, alltså 180 dagar bakåt. Behåll de öppna mötena och kedjorna.
  - Lägg `forsok, niva` till `MOTE_KOLUMNER`.
  - Läs `uppfoljning_datum, inget_svar_i_rad` ur `mote_kedja` sidvis, i bitar om `BIT` id.
  - Läs inställningarna (`nav_setting like 'moten.%'`).
  - Kör `byggPanel` för 3 perioder × (alla + varje person i kretsen).
  - Dagens `jag`, `chef`, `bakom` och övriga fält lämnas orörda, eftersom Mer bygger på dem.
- [ ] **Step 4:** Kör `npm run test:motesstat-db && npm run test:motesstat && npm run test:motespanel`. Väntat utfall: grönt. Logga storleken på `JSON.stringify(panel)` i provet och skriv siffran i ARBETSLOGG. Blir den över 300 kB med produktionens data, stanna och säg det. Specen har då en plan B: personerna räknas när de väljs.
- [ ] **Step 5:** Committa lokalt: `Möten: servern räknar panelen för alla perioder och personer`.

### Task 4: Panelen i utkastet

**Files:**
- Modify: `src/nav2/utkast.html`. Panelens kod och CSS står mellan markörerna `/* MSPANEL-START */` och `/* MSPANEL-SLUT */`. `ndMsChef` ritar panelen överst och dagens innehåll i en hopfälld del, Mer.
- Create: `tests/nav2-motespanel.mjs` och `package.json`-skriptet `test:nav2-motespanel`, som tas med i `test:alla`.

**Interfaces:**
- Consumes: `ND.motesstat.panel` från Task 3. `msBolag` och `msOppnaKort` finns redan och används för raden som öppnar kortet.
- Produces: `msPanelVy(P, val) → string` (ren, testbar) och `msPanelBlad(P, val, nyckel) → string`. `val` är `{period:'d90'|'vecka'|'manad', person:string|null, mer:boolean, blad:string|null}`.

- [ ] **Step 1: Skriv de felande proven** i `tests/nav2-motespanel.mjs`. Provet läser koden mellan markörerna och kör den i `node:vm` med en `panel` som byggs av Task 2:s fixtur genom `byggPanel`. Det är samma väg som förlagans prov tog.
  - Navet visar "55" och "6 av 11 kom". Kvalificerade visar "33" och "2 av 6 hållna möten", och raden under talet är "4 hållna saknar bedömning".
  - Att göra nu visar talen 7, 5, 1 och 2, och raden under det första är "Närmast mån 16 nov 10:30".
  - Med `mal {show:50}` står "Över målet 50 %" i navet. Utan mål står inget "målet" någonstans.
  - Bladet för `show` har raden "Hållet 6 · Uteblev 5". Varje rad med ett kort är en `data-ms-kort`-knapp.
  - **tomt ritas:** ett tomt underlag ger "Inga möten i perioden." och ingen text som innehåller "NaN" eller "undefined".
  - **okänt sparat val:** `msValLas()`, där localStorage har `{person:"p-slutat", period:"x"}`, ger `{period:'d90', person:null}`. Ett localStorage som kastar ger förvalet.
  - Mer innehåller rubriken "Vecka för vecka" och den befintliga `ms-tabell`.
  - CSS-reglerna för uppräkning ligger inom `@media (prefers-reduced-motion: no-preference)`.
- [ ] **Step 2:** Kör `npm run test:nav2-motespanel`. Väntat utfall: rött.
- [ ] **Step 3: Bygg panelen** efter förlagans mall och CSS, rad ~1–250, med Navs befintliga tokens.
  - Väljarna för period och person sparas i `localStorage` under `nd-ms-val:<ND.jag.id>`, genom `msValLas` och `msValSpara` med try/catch.
  - Bladet är en `role="dialog"` som stängs med Esc och ✕ och ger fokus tillbaka.
  - Listorna under Att göra nu sorteras med det mest brådskande först, och övriga listor med det senaste först. Bladets rad med antal följer förlagan (`grupper`).
  - Målet ritas som en pinne på mätaren (`left: mal%`) och en textrad.
  - Mer är en knapp med `aria-expanded`.
- [ ] **Step 4:** Kör `npm run test:nav2-motespanel && npm run test:motespanel && npm run test:klockan`. Väntat utfall: grönt. Klockan provar annan kod i utkastet, så att ingen markör har brutit något.
- [ ] **Step 5:** Committa lokalt: `Möten: statistiken ritas som panel, dagens vy under Mer`.

### Task 5: Målen i Mötens inställningar

**Files:**
- Modify: `src/nav2/utkast.html` (`moInstVy`, runt rad 40004, och dess sparhanterare)
- Test: `tests/nav2-motespanel.mjs`, med nya rader

**Interfaces:**
- Consumes: POST `/nav2/moten` `{handling:'installningar', nyckel, varde}`, som finns, och nycklarna från Task 1.

- [ ] **Step 1: Skriv de felande proven.**
  - `moInstVy` innehåller fem fält för mål, med etiketterna Show rate, No-show rate, Svarade på bekräftelsen, Kvalificerade och Closing rate. Fälten är `type="number" min="0" max="100"` och har platshållaren "Inget mål".
  - Det finns två fält för dödsgränserna, med texterna "Uppföljning äldre än (dagar)" och "Inget svar i rad".
  - Sparhanteraren skickar `moten.mal` som ett objekt utan de tomma fälten.
- [ ] **Step 2:** Kör provet. Väntat utfall: rött.
- [ ] **Step 3:** Bygg fälten i samma mönster som de befintliga inställningsfälten, med en rubrik Statistik. Ett tomt fält betyder inget mål.
- [ ] **Step 4:** Kör `npm run test:nav2-motespanel && npm run test:motesflode && npm run test:moten-rutt`. Väntat utfall: grönt.
- [ ] **Step 5:** Committa lokalt: `Möten: mål och dödsgränser i inställningarna`.

### Task 6: Register, hela sviten, preview

**Files:**
- Modify: `src/navnyheter/poster.ts` (ny rad överst, slug `moten-statistik-panel`, skriven för chefen)
- Modify: `docs/NASTA_SESSION.md`, `docs/ARBETSLOGG.md`

- [ ] **Step 1:** Skriv navnyhetsraden. Kör `npm run test:navnyheter`. Väntat utfall: grönt.
- [ ] **Step 2:** Kör hela sviten med nycklarna: `set -a; . ~/.clicknet/nav.env; set +a; npm test`. Väntat utfall: alla filer gröna. Ett rött prov som var rött redan före grenen skrivs in som befintligt.
- [ ] **Step 3:** Kör `npx tsc --noEmit`. Väntat utfall: inga fel. Det är en typkontroll, inte ett bygge.
- [ ] **Step 4:** Slå ihop stegcommitarna till en commit: `git reset --soft origin/main && git commit`, med meddelandet "Möten: statistiken som instrumentpanel (show rate, kvalificerade, closing, efter första mötet, att göra nu, mål per tal)" och Co-Authored-By-raden. Pusha grenen, inte main.
- [ ] **Step 5:** Vänta tills Vercels preview för grenen är byggd. Klicka igenom den i Chrome som Zen:
  - varje tal och dess blad
  - en rad som öppnar kortet
  - Mer
  - de tre perioderna och en person
  - ladda om sidan, och se att valet finns kvar
  - sätt ett mål och se omdömet, och ta sedan bort målet
  - mörkt läge och 400 px
  Konsolen ska vara ren. Ta skärmbilder.
- [ ] **Step 6:** Rapportera till beställaren med previewens adress och skärmbilderna. Merga till main först efter ett uttryckligt ja.
