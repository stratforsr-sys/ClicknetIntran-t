# Säljtavlan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En levande säljtavla på `/salesboard` för kontors-TV med helskärmsfirande, ljud, parning av skärmar och en inställningssida för admin.

**Architecture:** Rena moduler i `src/lib/salesboard/` (inställningar, regler, parning, typer) provas med node. Servern (`tavlan.ts`, `atkomst.ts`) bygger en display-säker ögonblicksbild med service role. Klienten i `src/app/salesboard/` hämtar den vid en Supabase Realtime-signal (ringklockan, en trigger per sats) och var 60:e sekund. Rörelsen är kompositioner i Remotions modell som körs av en egen motor (`motion/motor.tsx`) med Remotions API-namn. Ljudet är Web Audio, syntetiserat.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, @supabase/supabase-js 2.58 (Realtime broadcast), Postgres (Supabase), Web Audio API, `node --experimental-strip-types` för prov.

**Spec:** `docs/superpowers/specs/2026-10-23-salesboard-design.md`

## Global Constraints

- Grenen `salesboard` från `nav2-utkast`. Stegcommits lokalt, en sammanslagen commit vid push. Ingen `npm run build` och ingen `npm run dev` lokalt.
- Rena moduler importerar relativt med `.ts`-ändelse (som `saljtakt.ts` → `./order.ts`), aldrig `@/`, så att node kan köra dem. Server- och klientfiler får använda `@/`.
- Prov körs med `TZ=UTC node --experimental-strip-types tests/<fil>.mjs` och använder `ok(namn, villkor)`-mönstret från `tests/saljtakt.mjs`. Avslutningen är `process.exit(fel ? 1 : 0)`.
- Ingen provision, inget kronmål, inga employee-id, ingen e-post och inga telefonnummer får lämna servern i ögonblicksbilden.
- Duken är 1920×1080 med paletten `--hub #0F2A22`, `--hub-2 #153A2F`, `--hub-line rgba(220,245,232,.12)`, `--hub-ink #EAF4EE`, `--hub-ink-2 #A8C2B6`, `--hub-ink-3 #6F8F82`, `--hub-brand #4FD1A5` och `--hub-signal #F2B24C`.
- Typsnitten är `public/nav2/fonts/{bricolage,geist,geist-mono}.woff2` via `next/font/local` som i `src/app/logga-in/Skal.tsx`.
- Kronor skrivs `17 940 kr` (`Intl.NumberFormat("sv-SE")` och ` kr`), klockan `14:21` (sv-SE, h23, Europe/Stockholm).
- Varje svar från en rutt har `Cache-Control: private, no-store, max-age=0`.
- Ingen ny npm-beroende.
- Kommentarer på svenska, i samma täthet och ton som omgivande kod.

## Review Focus

1. **Tavlan startar mitt på dagen eller efter en omladdning** och ska inte fira något som redan fanns. Provet ligger i Task 2 (`planera` med `forra = null`).
2. **En order makuleras eller ändras efter att ha firats.** Den ska försvinna tyst och dras av, utan nytt firande och utan att målet "nås" en gång till. Provet ligger i Task 2.
3. **Månadsskifte medan tavlan står på.** Halvvägs och målet ska nollas, utan att den nya månadens tillstånd firas direkt. Provet ligger i Task 2.
4. **Långa namn och dolda säljare.** "Maximilian Andersson-Lindqvist" ska få plats, och en dold säljare ska visas som "En säljare", aldrig med sitt namn. Proven för namnet ligger i Task 1, för passningen i Task 10 (`passaText`) och för läckan i Task 6 (`byggTavlan` med `display='dold'`).
5. **Ljudet är blockerat eller utanför ljudtiden.** Tavlan ska fortsätta helt tyst och säga det, aldrig hänga på ett löfte. Provet för `ljudTillatet` ligger i Task 1 och för `lasUpp` med avvisat löfte i Task 8.

---

### Task 1: Inställningar, typer och regler

**Files:**
- Create: `src/lib/salesboard/typer.ts`, `src/lib/salesboard/installningar.ts`, `src/lib/salesboard/regler.ts`
- Test: `tests/salesboard.mjs`

**Interfaces:**
- Produces (`typer.ts`):
  - `Namnform = "fornamn" | "fornamn_e" | "hela"`
  - `Visning = "namn" | "initialer" | "dold"`
  - `Testtyp = "order" | "stor" | "forsta" | "serie" | "malet"`
  - `TavlansInstallningar` (exakt enligt spec §8, med fälten nedan)
  - `TavlePerson { nyckel; namn; initialer; motiv; dold }`
  - `TavleOrder`:
    - `nyckel`, `person`, `tid` (ISO), `dag` (YYYY-MM-DD), `vad`, `kund: string|null` och `belopp: number|null`
    - `niva: "vanlig"|"stor"`, `efterreg` och `forstaNagonsin`
    - `saljarensDagsantal` och `saljarensBasta`
  - `TavleHandelse { id: number; typ: Testtyp; tid: string }`
  - `Ogonblick`:
    - `v: 1`, `nu`, `bygge`, `lag`, `skarm: {namn; ljud}|null` och `installningar`
    - `manad`: `nyckel`, `namn`, `antal`, `mal`, `malKalla: "saljmal"|"forra"|null`, `forvantat`, `lage`, `kravPerDag`, `prognos`, `dagar: {gangna; totalt}`, `natt: string|null` och `bidrag: string[]`
    - `idag`: `datum`, `antal`, `summa` och `bastaDag`
    - `order: TavleOrder[]`, `personer: Record<string, TavlePerson>` och `handelser: TavleHandelse[]`
- Produces (`installningar.ts`):
  - `STANDARD: TavlansInstallningar`
  - `normalisera(rå: unknown): TavlansInstallningar`
  - `uppdatera(nu: TavlansInstallningar, delar: unknown): TavlansInstallningar`
- Produces (`regler.ts`):
  - `visningsnamn(fornamn: string, efternamn: string, form: Namnform, visning: Visning): string`
  - `initialerFor(fornamn: string, efternamn: string, visning: Visning): string`
  - `motivFor(id: string, val: number | null): number`
  - `storAffarTroskel(varden: number[], val: {lage: "auto"|"belopp"; belopp: number}): number`
  - `arEfterregistrerad(signedOn: string | null, godkandDag: string, dagar: number): boolean`
  - `ljudTillatet(nuIso: string, ljud: TavlansInstallningar["ljud"]): boolean`
  - `inomArbetsdag(nuIso: string, arbetsdag: {fran: string; till: string}): boolean`

Standardvärden i `STANDARD`:
- `version: 1`, `lag: null`, `namn: "fornamn_e"`, `visaKund: true`, `visaVarde: true`
- `arbetsdag: {fran: "08:00", till: "18:00"}` och `rorelse: "full"`
- `firande`:
  - `storAffar: {lage: "auto", belopp: 30000}`
  - `forstaOrdern`, `dagensForsta`, `personbasta`, `dagsrekord`, `halvvags` och `maletNatt` är alla `true`
  - `efterregistreradDagar: 2`
- `ljud: {pa: true, volym: 70, fran: "08:00", till: "18:00", helgTyst: true}`

`normalisera` klipper:
- volymen till 0–100 (heltal)
- `efterregistreradDagar` till 0–30
- beloppet till 1 000–10 000 000
- tider som inte matchar `^([01]\d|2[0-3]):[0-5]\d$` tillbaka till standarden
- okända nycklar bort och fel typ tillbaka till standarden

- [ ] **Step 1: Skriv provet** `tests/salesboard.mjs`, avsnittet "regler":
  - `visningsnamn("Amira","Haddad","fornamn_e","namn") === "Amira H."` och `"hela"` ger `"Amira Haddad"`
  - `"initialer"` ger `"A. H."`, och `"dold"` ger `"En säljare"` för alla former
  - en tom efternamnsdel ger bara förnamnet utan punkt
  - `initialerFor("Amira","Haddad","namn") === "AH"`, `initialerFor("Åsa","Öberg","namn") === "ÅÖ"` och `"dold"` ger `"·"`
  - `motivFor("x", 7) === 7`, och `motivFor(id, null)` ger 0–11 och samma värde två gånger. Tolv olika uuid ger minst sex olika motiv.
  - `storAffarTroskel([...19 värden], auto) === 30000`
  - `storAffarTroskel(` 100 värden 1..100 × 1000 `, auto) === 90100` (P90 med linjär interpolering, `percentile_cont`)
  - `storAffarTroskel(x, {lage:"belopp", belopp: 50000}) === 50000`
  - `arEfterregistrerad("2026-10-20","2026-10-23",2) === true`, `("2026-10-21","2026-10-23",2) === false` och `(null, …) === false`
  - `ljudTillatet`:
    - `"2026-10-23T07:30:00Z"` (09:30 svensk tid, fredag) är true
    - `"2026-10-24T09:00:00Z"` (lördag) med `helgTyst` är false
    - `"2026-10-23T16:30:00Z"` (18:30) är false
    - `pa: false` är alltid false
    - `volym: 0` är false
    - `fran "22:00"` / `till "06:00"` över midnatt fungerar
    - julafton 2026-12-24 räknas som helg via `arArbetsdag` från `../src/lib/saljtakt.ts`
  - `normalisera(null)` deep-equalar `STANDARD`, och `normalisera({ljud:{volym: 400}}).ljud.volym === 100`
  - `normalisera({namn:"x"}).namn === "fornamn_e"`, och `uppdatera(STANDARD, {visaKund:false}).visaKund === false` med resten oförändrat

- [ ] **Step 2: Kör provet och se det falla**
  Run: `TZ=UTC node --experimental-strip-types tests/salesboard.mjs`
  Expected: FAIL (modulerna saknas)

- [ ] **Step 3: Skriv `typer.ts`, `installningar.ts` och `regler.ts`**
  - `motivFor` tar summan av teckenkoderna i id:t, gånger 31, modulo 12.
  - `ljudTillatet` och `inomArbetsdag` räknar svensk dag och svensk tid med `Intl.DateTimeFormat("sv-SE", {timeZone: "Europe/Stockholm"})`.
  - Helger och röda dagar kommer från `arArbetsdag` i `saljtakt.ts`.

- [ ] **Step 4: Kör provet och se det gå igenom**
  Run: `TZ=UTC node --experimental-strip-types tests/salesboard.mjs`
  Expected: alla ✓, exit 0

- [ ] **Step 5: Commit** — `git add src/lib/salesboard tests/salesboard.mjs && git commit -m "Säljtavlan: inställningar, typer och regler"`

### Task 2: Planeringen — vad som firas

**Files:**
- Modify: `src/lib/salesboard/regler.ts`
- Test: `tests/salesboard.mjs`, avsnittet "planera"

**Interfaces:**
- Consumes: typerna från Task 1.
- Produces:
  - `Tagg = {typ:"dagsrekord"; nu: number; forra: number} | {typ:"personbasta"; antal: number} | {typ:"dagensForsta"}`
  - `Firande`, en av:
    - `{typ:"order"; order: TavleOrder; variant: "vanlig"|"stor"|"forsta"; taggar: Tagg[]}`
    - `{typ:"serie"; order: TavleOrder[]}`
    - `{typ:"halvvags"}`
    - `{typ:"malet"; natt: string}`
    - `{typ:"test"; testtyp: Testtyp; id: number}`
  - `Minne = {kanda: string[]; handelse: number; manad: string; halvvags: boolean; malet: boolean; dagsrekord: string | null}`
  - `planera(forra: Ogonblick | null, ny: Ogonblick, minne: Minne | null): {firanden: Firande[]; minne: Minne}`
  - `samla(firanden: Firande[]): Firande[]`
  - `FARSK_MS = 600_000`, `TEST_FARSK_MS = 120_000`
  - `MOTIV_SPARR_MS = 20_000`
  - `motivTillatet(senastMs: number | null, nuMs: number): boolean`

Reglerna (spec §5.5):
- **Start**: `forra === null` eller `minne === null`. Alla nycklar blir kända och `handelse` blir högsta id. `halvvags` och `malet` sätts till om de redan passerats, och `dagsrekord` sätts till dagens datum om `idag.antal > idag.bastaDag`. Inga firanden.
- **Ny order**: en nyckel som inte är känd, där `dag === ny.idag.datum`, `!efterreg` och `ny.nu − tid ≤ FARSK_MS`. Ordern firas i tidsordning, och nyckeln blir känd även när den inte firas.
- **Variant**: `forstaNagonsin` med `forstaOrdern` på ger `"forsta"`, annars ger `niva==="stor"` `"stor"`, annars `"vanlig"`.
- **Taggar**:
  - `dagensForsta` om ordern är den tidigaste i dag.
  - `personbasta` om `saljarensDagsantal > saljarensBasta && saljarensDagsantal >= 2`.
  - `dagsrekord` på den sista nya ordern om `idag.antal > idag.bastaDag && idag.antal >= 3 && minne.dagsrekord !== idag.datum`.
  - Varje tagg kräver sin brytare.
- **Tre eller fler nya i samma bild** blir en `serie`.
- **Målet**: `!minne.malet && mal && forra.antal < mal <= ny.antal` ger `malet` efter ordrarna. Halvvägs gäller vid `ceil(mal/2)` och bara om målet inte nås i samma bild.
- **Nytt `manad.nyckel`**: minnet nollställs med samma regler som vid start, utan firanden.
- **Test**: id > `minne.handelse` och yngre än `TEST_FARSK_MS`.
- **Ordningen** i utdatat är order eller serie, sedan halvvags eller malet, sedan test.
- **`samla`** slår ihop alla `order` till en `serie` när de är tre eller fler, och lämnar resten i ordning.

- [ ] **Step 1: Skriv provet**, med en byggare `bild(over)` som ger en `Ogonblick` med rimliga standarder:
  - start med 3 order ger 0 firanden och 3 kända
  - en ny färsk order ger `[{typ:"order", variant:"vanlig"}]`
  - samma bild igen ger 0
  - en order 11 min gammal ger 0 men blir känd
  - en efterregistrerad ger 0
  - `forstaNagonsin` ger `"forsta"`, och `niva:"stor"` ger `"stor"`
  - första ordern i dag får taggen `dagensForsta`
  - säljaren har 2 i dag med bästa 1 och får `personbasta {antal:2}`
  - laget har 4 i dag med `bastaDag: 3` och får `dagsrekord {nu:4, forra:3}` på den sista nya; nästa order samma dag får ingen dagsrekord
  - 3 nya i en bild ger en `serie` med 3 i tidsordning
  - antal 9→10 med mal 10 ger `malet` sist; 10→11 ger inget
  - 4→5 med mal 10 ger `halvvags`; 4→10 med mal 10 ger bara `malet`
  - start med antal 12 och mal 10 och sedan 12→13 ger inget `malet`
  - makulering 10→9 och sedan 9→10 ger inget nytt `malet` (minnet säger firat)
  - månadsbyte från `2026-10` till `2026-11` ger 0 firanden och nollställt `malet`
  - en testhändelse med id 5 efter id 4 ger `{typ:"test", testtyp, id:5}`, och samma igen ger 0
  - `samla` av 2 order och `malet` ger oförändrat; av 3 order och `malet` ger `[serie, malet]`
  - `motivTillatet(null, 0)` är true, `(1000, 15000)` är false och `(1000, 21001)` är true

- [ ] **Step 2: Kör och se det falla.** Run: `TZ=UTC node --experimental-strip-types tests/salesboard.mjs`. Expected: FAIL (`planera` saknas)
- [ ] **Step 3: Skriv `planera`, `samla` och `motivTillatet`** i `regler.ts`
- [ ] **Step 4: Kör och se allt gå igenom.** Expected: alla ✓
- [ ] **Step 5: Commit** — `git commit -am "Säljtavlan: planeringen av firandet"`

### Task 3: Parningen

**Files:**
- Create: `src/lib/salesboard/parning.ts`
- Test: `tests/salesboard-parning.mjs` (egen fil, så att Task 3 kan byggas parallellt med Task 1–2)

**Interfaces:**
- Produces:
  - `KODALFABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"`, `KODLANGD = 8` och `KOD_GILTIG_MS = 600_000`
  - `nyKod(slump?: (n: number) => Uint8Array): string`
  - `normaliseraKod(s: string): string | null`
  - `visaKod(k: string): string`
  - `nyToken(): string` (32 byte i base64url)
  - `hasha(s: string): string` (sha256 i hex, `node:crypto`)

- [ ] **Step 1: Skriv provet**:
  - `nyKod()` har längd 8 och bara tecken ur alfabetet. 1 000 koder ger minst 990 unika.
  - En slump som alltid ger `0xFF` ger bara tecken ur alfabetet (`byte % 32`).
  - `normaliseraKod(" k7m4-qx9p ") === "K7M4QX9P"`.
  - `normaliseraKod("K7M4QX9")` och `"K7M4QX9I"` är `null`.
  - `visaKod("K7M4QX9P") === "K7M4-QX9P"`.
  - `nyToken()` har längd 43 och matchar `^[A-Za-z0-9_-]+$`.
  - `hasha("a")` är `"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"`.
- [ ] **Step 2: Kör och se det falla.**
- [ ] **Step 3: Skriv `parning.ts`.**
- [ ] **Step 4: Kör och se det gå igenom.**
- [ ] **Step 5: Commit** — `git commit -am "Säljtavlan: parningskoder"`

### Task 4: Rörelsemotorn

**Files:**
- Create: `src/app/salesboard/motion/motor.tsx`
- Test: `tests/salesboard-motor.mjs`, som importerar en ren kärna `src/app/salesboard/motion/matte.ts` (matematiken utan React). `motor.tsx` exporterar om den.

**Interfaces:**
- Produces (`matte.ts`):
  - `interpolate(input, inputRange, outputRange, options?)` med samma semantik som Remotion. `extrapolateLeft` och `extrapolateRight` är `"extend"` (standard), `"clamp"` eller `"identity"`. Med `easing` stigande intervall krävs.
  - `Easing`: `linear`, `quad`, `cubic`, `sin`, `exp` och `bezier(x1,y1,x2,y2)`, samt `in(f)`, `out(f)` och `inOut(f)`.
  - `spring({frame, fps, config?, from?, to?, durationInFrames?, delay?})`:
    - config-standarden är `damping 10, mass 1, stiffness 100, overshootClamping false`
    - lösningen är analytisk (underdämpad, kritisk och överdämpad)
    - `durationInFrames` skalar tiden så att fjädern är inom 0,5 % av slutet vid den bildrutan
    - `delay` förskjuter
  - `FPS = 60`, `BREDD = 1920`, `HOJD = 1080`
- Produces (`motor.tsx`, klient):
  - `useCurrentFrame()` och `useVideoConfig()`
  - `Sequence({from, durationInFrames?, children})`
  - `AbsoluteFill`
  - `Spelare<P>({komposition, props, varaktighet, klocka: () => number, onKlar})`. `klocka` ger sekunder sedan start, och bildrutan är `Math.floor(klocka()*FPS)`. Spelaren renderar om per `requestAnimationFrame` och anropar `onKlar` en gång vid `varaktighet`.

- [ ] **Step 1: Skriv provet**:
  - `interpolate(5,[0,10],[0,100]) === 50`
  - `interpolate(15,[0,10],[0,100]) === 150`, men med clamp blir det `100`
  - identity ger `15`
  - flera intervall ger `interpolate(15,[0,10,20],[0,100,0]) === 50`
  - `Easing.bezier(0.42,0,0.58,1)(0.5)` ≈ 0,5 (±1e-3), och `Easing.bezier(0,0,1,1)(0.3)` ≈ 0,3
  - `Easing.out(Easing.cubic)(0.5) === 0.875`
  - `spring({frame:0,fps:60}) === 0`, och `spring({frame:600,fps:60})` ≈ 1 (±1e-3)
  - standardfjädern slår över (max > 1,05 inom 120 bildrutor)
  - `damping 200` slår inte över (max ≤ 1,0001)
  - `durationInFrames:30` ger `|spring({frame:30,...})−1| < 0.005`
  - `delay:10` ger 0 vid bildruta 10
  - `from:100,to:0` ger 100 vid 0
- [ ] **Step 2: Kör och se det falla.** Run: `TZ=UTC node --experimental-strip-types tests/salesboard-motor.mjs`
- [ ] **Step 3: Skriv `matte.ts`** (bezier: Newton–Raphson med bisektion som reserv) **och `motor.tsx`** (kontexten `Bildruta`; `Sequence` ger `frame − from` och renderar null utanför sitt fönster).
- [ ] **Step 4: Kör och se det gå igenom.**
- [ ] **Step 5: Commit** — `git commit -m "Säljtavlan: rörelsemotorn med Remotions API"`

### Task 5: Migrationen och ringklockan

**Files:**
- Create: `supabase/migrations/0250_saljtavlan.sql`
- Modify: `~/nav2-utkast/PARALLELLT.md` (raden `| Säljtavlan | 0250–0254 |` sist i tabellen)

**Interfaces:**
- Produces:
  - tabellerna `salesboard_screen`, `salesboard_pairing`, `salesboard_person` och `salesboard_event` (kolumner enligt spec §8)
  - funktionen `salesboard_statistik(p_dag date) returns jsonb`: `{saljare: [{id, forsta, basta}], p90, antal90, bastaDag}`
    - `forsta` är id för säljarens första godkända order (efter `approved_at`)
    - `basta` är det största antalet godkända på en svensk dag före `p_dag`
    - `p90` är `percentile_cont(0.9)` på `order_value` för godkända de senaste 90 dagarna
    - `antal90` är antalet sådana order
    - `bastaDag` är lagets största dagsantal i `p_dag`s månad före `p_dag`
  - funktionen `salesboard_ringklocka()` och triggers enligt spec §8
- Godkänd betyder `status in ('signerad','betald') and approved_at is not null`.

- [ ] **Step 1: Fråga databasen om numret** (`select name from public.schema_migrations where name like '025%'` ska ge 0 rader) och registrera spannet i PARALLELLT.md.
- [ ] **Step 2: Skriv migrationen**:
  - RLS på alla fyra tabeller, utan policyer, och `revoke all … from anon, authenticated`.
  - `salesboard_statistik` är `security definer`, `set search_path = ''`, `stable`, `revoke execute … from public, anon, authenticated` och `grant execute … to service_role`.
  - `salesboard_ringklocka()` är `security definer`, `set search_path = ''` och returnerar `null`. Inuti `begin … exception when others then raise warning … end` anropas `perform realtime.send(jsonb_build_object('t', extract(epoch from clock_timestamp())), 'ping', 'salesboard', false)`.
  - Triggers:
    - `salesboard_order_ping after insert or update or delete on public.sales_order for each statement`
    - samma per sats på `salesboard_event`, `salesboard_person` och `salesboard_screen`
    - `salesboard_setting_ping after insert or update on public.nav_setting for each row when (new.key = 'salesboard')`
- [ ] **Step 3: Kör den med `apply-sql.mjs`**, som kör vakten. Expected: vakten grön.
- [ ] **Step 4: Prova ringklockan**:
  - Ett node-skript i scratchpaden prenumererar på kanalen `salesboard` med anonnyckeln.
  - Kör `update public.sales_order set status = status where false` med DATABASE_URL.
  - Expected: `ping` tas emot inom 3 s. Om inte: kontrollera att Realtimes publika åtkomst är påslagen; i annat fall går tavlan på 8 s-hämtningen och detta skrivs i NASTA_SESSION.
  - Kör också `select public.salesboard_statistik(current_date)` och se ett jsonb med `p90`.
- [ ] **Step 5: Commit** — `git add supabase/migrations/0250_saljtavlan.sql && git commit -m "Säljtavlan: tabellerna, statistiken och ringklockan (0250)"`

### Task 6: Servern — ögonblicksbilden, åtkomsten och parningsrutten

**Files:**
- Create: `src/lib/salesboard/tavlan.ts`, `src/lib/salesboard/atkomst.ts`, `src/app/salesboard/data/route.ts` och `src/app/salesboard/par/route.ts`
- Modify:
  - `src/lib/supabase/middleware.ts:19`, där `PUBLIC` får `"/salesboard"`
  - `src/lib/handelselogg.ts`, där `MODUL` får `salesboard: "Säljtavlan"`

**Interfaces:**
- Consumes: Task 1 (typer, `normalisera`, regler), Task 3 (`hasha`, `nyKod`, `nyToken`, `normaliseraKod`), Task 5 (tabellerna och `salesboard_statistik`), samt `nettoAntal`, `harGodkants` (`@/lib/order`), `arbetsdagarIManad`, `arbetsdagarTill`, `motMal`, `MINSTA_DAGAR_FOR_PROGNOS` (`@/lib/saljtakt`), `svensktDatum` (`@/lib/klocka`) och `nivaFor` (`@/lib/nav2/forma`).
- Produces:
  - `byggTavlan(skarm: {namn: string; ljud: boolean} | null, nu?: Date): Promise<Ogonblick>`
  - `SKARMKAKA = "nav_tavla"`, `PARKAKA = "nav_tavla_par"`
  - `Atkomst = {typ:"skarm"; skarm:{id; namn; ljud}} | {typ:"person"; user: CurrentUser}`
  - `tavlansAtkomst(request?: Request): Promise<Atkomst | null>`
  - `tavlansAdmin(): Promise<CurrentUser | null>` (nivån admin eller superadmin)
  - `nyckelFor(id: string): string`: sha256 av `"tavla:"+id`, de första 12 tecknen

Byggets regler:
- Reglerna följer Golvet: laget är `installningar.lag` eller alla, och månaden är order med `period_month` eller `cancel_period_month` = månaden till `nettoAntal`.
- Målet är summan av `target_orders` ("saljmal"), annars förra månadens `nettoAntal` ("forra") om den är > 0, annars null.
- `forvantat`, `lage` och `kravPerDag` kommer från `motMal` när det finns ett mål.
- Prognosen är `Math.round(antal × totalt / gangna)` när `gangna >= MINSTA_DAGAR_FOR_PROGNOS` och `antal > 0`, annars null.
- `natt` är `approved_at` för den order där löpande antal godkända (i tidsordning) når målet.
- `bidrag` är personnycklar i ordning efter deras första godkända order i månaden.
- Orderlistan innehåller alla godkända i dag och de åtta senaste godkända inom 14 dagar, med den nyaste först.
  - `vad` är `"Paket 2 · 24 mån"`, och en order utan paket ger `"Fri order"`.
  - `kund` och `belopp` är null om visningen är av.
- `personer` innehåller bara de som finns i order eller bidrag. En dold person får `namn` och `initialer` enligt regel, aldrig sitt namn.
- `handelser` kommer från `salesboard_event` de senaste 10 minuterna.
- En cache på modulnivå gäller i 2 000 ms.
- `atkomst.ts`:
  - Skärmkakan räknas till en hash och slås upp med `revoked_at is null`.
  - `last_seen_at`, `last_ip` och `user_agent` uppdateras om `last_seen_at` är äldre än 60 s.
  - Annars gäller `getCurrentUser()` med `employee` och `status` i `active` eller `onboarding`.

Rutterna:
- `data/route.ts` (GET):
  - Utan åtkomst blir det 401 `{fel:"Skärmen är inte parad."}`.
  - Svaret är JSON med ETag (sha1 av kroppen) och 304 vid `If-None-Match`.
  - För en skärm förnyas kakan om den sattes för mer än ett dygn sedan. Tiden ligger i kakan `nav_tavla_t`.
- `par/route.ts`:
  - POST skapar en parningsrad (kod och nonce, med städning av utgångna; 50 globalt och 5 per IP ger 429) och sätter `PARKAKA`. Kakan är HttpOnly, Secure, SameSite=Lax, gäller för `/salesboard` och lever i 900 s. Svaret är `{kod: visaKod(kod), giltigTill}`.
  - GET läser `PARKAKA`. Om raden har `screen_id`:
    - token skapas och hashen sätts på skärmen tillsammans med `claimed_at`
    - kakan `nav_tavla` sätts (Max-Age 34 560 000) och PARKAKA tas bort
    - raden raderas och svaret är `{klar:true}`
  - Annars blir det `{klar:false}`, eller 410 om koden gått ut.

- [ ] **Step 1: Skriv provet för de rena delarna**:
  - `byggTavlan` tar en extraherad ren funktion `formaOgonblick(rader, installningar, nu)` i `tavlan.ts`, som provas i `tests/salesboard.mjs` med påhittade rader.
  - Den dolda personen har `namn === "En säljare"`, och inget fält i JSON-strängen innehåller "Haddad".
  - Prognosen är null vid gångna 2.
  - `malKalla` är "forra" utan säljmål.
  - `natt` sätts vid den order som når målet.
  - `vad` för en fri order är "Fri order".
  - Med `visaVarde:false` är alla `belopp` null.
- [ ] **Step 2: Kör och se det falla.**
- [ ] **Step 3: Skriv `formaOgonblick`** (ren, i `src/lib/salesboard/forma.ts`, importerad relativt), **och sedan `tavlan.ts`, `atkomst.ts`, rutterna, PUBLIC och MODUL.**
- [ ] **Step 4: Kör `tests/salesboard.mjs`, `tests/handelselogg.mjs` och `node ~/nav2-utkast/verktyg/tsparse.mjs`** på varje ny fil. Expected: ✓ och inga parsefel.
- [ ] **Step 5: Commit** — `git commit -am "Säljtavlan: ögonblicksbilden, åtkomsten och parningen"`

### Task 7: Inställningssidan och skrivrutten

**Files:**
- Create: `src/app/salesboard/skriv/route.ts`, `src/app/salesboard/installningar/page.tsx`, `src/app/salesboard/installningar/Installningar.tsx` och `src/app/salesboard/installningar/installningar.css`

**Interfaces:**
- Consumes: `tavlansAdmin`, `normalisera`, `uppdatera`, `normaliseraKod`, `hasha`, `storAffarTroskel`, `skrivHandelse` (`@/lib/handelselogg-server`), `medNyckel` (`@/lib/nav2/nyckel`) och `sammaUrsprung` (`@/lib/nav2/skrivlage`).
- Produces: POST `/salesboard/skriv` med `{handling, …}`. Svaret är `{ok, installningar?, skarmar?, personer?}` eller `{fel}`.

Handlingarna:

| handling | fält | gör | händelse |
|---|---|---|---|
| `spara` | `delar` | `uppdatera` → upsert i `nav_setting` | `salesboard.settings_changed` |
| `para` | `kod`, `namn` | slår upp en giltig kod (annars 404 "Koden finns inte eller har gått ut."), skapar skärmen och sätter `screen_id` | `salesboard.screen_created` |
| `byt_namn` | `id`, `namn` (1–60) | | |
| `ljud_skarm` | `id`, `ljud` | | |
| `koppla_bort` | `id` | sätter `revoked_at` och `revoked_by` och nollar `token_hash` | `salesboard.screen_revoked` |
| `person` | `id`, `display`, `motiv` (null eller 0–11) | upsert | `salesboard.person_changed` |
| `testa` | `typ: Testtyp` | insert, och raderar händelser äldre än ett dygn | |

En säljare får 403 `{fel:"Bara admin kan ändra säljtavlan."}`. Fel ursprung ger 403.

Sidan:
- `page.tsx` (server):
  - Utan inloggning sker en redirect till `/logga-in?nasta=/salesboard/installningar`.
  - En säljare ser en enkel 403-text.
  - Annars läses inställningarna, skärmarna (inte bortkopplade, sorterade på namn), aktiva säljare (roll `salesperson`, status active eller onboarding, lagfiltret), deras `salesboard_person`, lagen och den gällande tröskeln. Alltihop skickas till `Installningar`.
- `Installningar.tsx` (klient) har sex kort i spec §7:s ordning.
  - Varje kontroll sparar direkt (av- och påknappar, val, nummer på blur) och visar kvittensen "Sparat" i 1,5 s.
  - "Lyssna" spelar motivet lokalt via Task 8:s `Ljudmotor`.
  - Formen är Nav 2.0:s ljusa: `--bg #EEF1EC`, `--surface #FBFCFA`, `--ink #13201C`, `--brand #0E7A5F`, radien 12, Geist och Bricolage för rubriker. Mörkt läge följer `prefers-color-scheme` med utkastets mörka värden.

- [ ] **Step 1:** Skriv en ren valideringsfunktion `tolkaSkrivning(kropp: unknown): {handling: …} | {fel: string}` i `src/lib/salesboard/skrivning.ts`, och prova den i `tests/salesboard.mjs`:
  - okänd handling ger fel
  - namn över 60 ger fel
  - motiv 12 ger fel
  - display "x" ger fel
  - testtyp "malet" är ok
  - en kod normaliseras
- [ ] **Step 2: Kör och se det falla.**
- [ ] **Step 3:** Skriv `skrivning.ts`, rutten, sidan, klienten och CSS:en.
- [ ] **Step 4:** Kör proven och tsparse. Expected: ✓.
- [ ] **Step 5: Commit** — `git commit -am "Säljtavlan: inställningarna"`

### Task 8: Ljudmotorn

**Files:**
- Create: `src/app/salesboard/ljud.ts`

**Interfaces:**
- Produces:
  - `LjudId = "svepUpp"|"svepNer"|"motiv"|"tick"|"lagton"|"duns"|"massing"|"glitter"|"fanfar"|"hjalte"|"halvvags"`
  - `MOTIV: number[][]` (tolv fyrtonsfraser som MIDI-tal i C-dur-pentatonik, 60–88)
  - `class Ljudmotor`:
    - `constructor(skapa?: () => AudioContext)`
    - `lasUpp(): Promise<boolean>`
    - `get tillstand(): "igang"|"blockerat"|"saknas"`
    - `satt(o: {volym: number; tyst: boolean}): void`
    - `nu(): number`
    - `spela(id: LjudId, vid: number, p?: {motiv?: number; steg?: number; antal?: number}): void`
- Kedjan och klangerna följer spec §6. Nivåerna i dB är vanlig −6, stor −3 och målet 0. Kompressorn har tröskeln −18, ratio 4, attack 0,003 och release 0,25.
- `lasUpp` får aldrig kasta. Ett avvisat `resume()` ger `false` och `tillstand === "blockerat"`.
- `spela` utan kontext gör ingenting.

- [ ] **Step 1:** Prov i `tests/salesboard.mjs` med en låtsas-AudioContext:
  - `lasUpp` med ett `resume()` som avvisar ger `false` och `"blockerat"`
  - `spela` när tyst ger 0 skapade oscillatorer
  - `MOTIV.length === 12`, och varje fras har 4 tal i 60–88 ur mängden {0,2,4,7,9} mod 12
- [ ] **Step 2–4:** Skriv ljudmotorn, kör proven och lyssna i förhandsvisningens sele (Task 11).
- [ ] **Step 5: Commit** — `git commit -am "Säljtavlan: ljudet"`

### Task 9: Tavlan — sidan, källan och vyn i vila

**Files:**
- Create: `src/app/salesboard/layout.tsx`, `src/app/salesboard/page.tsx`, `src/app/salesboard/Tavla.tsx`, `src/app/salesboard/Parning.tsx`, `src/app/salesboard/kalla.ts` och `src/app/salesboard/tavla.css`

**Interfaces:**
- Consumes: `Ogonblick` (Task 1), `planera`, `samla`, `motivTillatet` och `ljudTillatet` (Tasks 1–2), `Ljudmotor` (Task 8), `Spelare` (Task 4), `tavlansAtkomst` och `byggTavlan` (Task 6).
- Produces:
  - `Kalla = (h: {bild: (b: Ogonblick) => void; status: (s: Kallstatus) => void}) => () => void`
  - `Kallstatus = {live: boolean; senast: number | null; offset: number; fel: number}`
  - `natkalla(): Kalla`
  - `default function Tavla(p: {start: Ogonblick; kalla: Kalla})`
- `page.tsx` (server, `dynamic = "force-dynamic"`): med åtkomst renderas `<Tavla start={await byggTavlan(…)} kalla="nat" />`, annars `<Parning />`. Klienten väljer `natkalla()` när prop:en är strängen `"nat"`, och förhandsvisningen skickar en egen funktion.
- Vyn i vila följer spec §4 i detalj (layout, storlekar, text) med:
  - vägmätarsiffrorna
  - segmentstapeln (en hel stapel med tioskalor när målet är över 60)
  - takt-strecket
  - tidslinjen med staplade monogram och nu-streck
  - flödet med dagavdelare och mintkant i 60 s
  - remsan "Sålt i dag"
  - statusraden
  - dämpningen utanför arbetsdagen
  - pixelskiftet
  - skalningen till fönstret
  - Wake Lock och helskärm
  - "Starta tavlan"
  - omladdningsreglerna (spec §8)
- [ ] **Steg:** bygg, rendera i förhandsvisningens sele med påhittade bilder (tomt mål, utan mål, nära målet, nått, 0 order i dag, 14 order i dag och ett långt namn), granska i headless Chrome och commit "Säljtavlan: tavlan i vila".

### Task 10: Kompositionerna

**Files:**
- Create: `src/app/salesboard/motion/delar.tsx`, `Ordern.tsx`, `Serie.tsx` och `Malet.tsx`
- Modify: `src/app/salesboard/Tavla.tsx` (kön, spelaren, landningen och halvvägs i hjälten)

**Interfaces:**
- Produces:
  - `Ordern(p: {order: TavleOrder; person: TavlePerson; variant; taggar: Tagg[]; fran: Rekt; till: Rekt; lag: {antal: number; mal: number|null}; lugn: boolean; test: boolean})`
  - `Rekt = {x; y; w; h}`
  - `orderVaraktighet(variant): number` (vanlig 444, stor 534, forsta 504 bildrutor, inklusive 60 för samlingen)
  - `orderLjud(p): {f: number; ljud: LjudId; p?}[]`
  - `Serie` och `Malet` på samma sätt (`serieVaraktighet(n)`, `MALET_VARAKTIGHET = 840`)
  - `passaText(text: string, typsnitt: string, maxBredd: number, start: number, min: number): number` (canvas `measureText`)
- Tider, easing, storlekar och ljudpunkter enligt spec §5.1–5.4, med tavlans tillstånd bytt under täckningen.
- [ ] **Steg:** bygg, spela varje ögonblick i selen med ljud, finslipa och commit "Säljtavlan: firandet".

### Task 11: Förhandsvisningen

**Files (utanför repot):** `<scratchpad>/sb/forhand/` med en esbuild-ingång som importerar `Tavla` och en låtsaskälla. Den har påhittade säljare och företag, en regipanel ("Ny order", "Stor affär", "Första ordern", "Tre order", "Halvvägs", "Målet nått", "Lugn rörelse" och "Ljud") och typsnitten inlinade som base64.

- [ ] **Steg:** bygg till en självbärande HTML, granska den i headless Chrome och publicera den som artifact enligt `artifact-design`.

### Task 12: Dokumenten, nyheten och pushen

**Files:**
- Modify:
  - `package.json`: `"test:salesboard"` och `"test:salesboard-motor"` läggs in i `test`-kedjan
  - `src/navnyheter/poster.ts`: en rad
  - `docs/NASTA_SESSION.md` och `docs/ARBETSLOGG.md`

- [ ] **Steg:**
  1. Kör alla tavlans prov, `tests/handelselogg.mjs` och tsparse.
  2. Slå ihop till en commit (`git reset --soft nav2-utkast` och en commit).
  3. Pusha grenen `salesboard` en gång (kontrollera kvoten först).
  4. Verifiera Vercels bygge och previewn.
