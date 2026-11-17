# Hemvyn: kort, chatt och förslag som följs till dom — byggplan

> **För den som bygger:** använd superpowers:executing-plans (eller
> superpowers:subagent-driven-development) och bocka av stegen (`- [ ]`) i tur och ordning.

**Mål:** Bygga steg 1–3 i designdokumentet: underlaget (mått, förslagslogg,
ändringslogg, offertbelopp, jobb i torrkörning), det nya hemmet med kedjan för
obekräftade möten, och chatten med Claude, avstängd tills beställaren säger till.

**Arkitektur:** Alla tal räknas av rena funktioner i `src/lib/nav2/` (prov med
`node --experimental-strip-types`), läses av servern med inloggningens behörighet
och ritas av `src/nav2/utkast.html`. Förslag och ändringar är rader i två tabeller
som bara tar emot nya rader. Jobben skriver bara i sitt kvitto tills
`forslag.pa` slås på. Chatten är en strömmande rutt med verktyg som läser samma
funktioner, och den går inte att slå på utan nyckel, tak och ett godkänt prov.

**Teknik:** Next.js-rutter, Supabase (Postgres, RLS, pg_cron), en HTML-fil för
gränssnittet, `@anthropic-ai/sdk` för chatten.

**Spec:** `docs/superpowers/specs/2026-11-15-hemvyn-kort-chatt-design.md` (v3,
godkänd 2026-11-15). Skiss 9 (`~/nav-produkt/kundpresentation/skiss-9-hemvyn.html`)
bestämmer utseendet.

**Undantag från beställaren 2026-11-15:** provet av Claude-modellerna körs inte.
Provets skript och frågor byggs, men ingen körning görs och ingen modell godkänns.

## Övergripande regler

- Gren `hemvy-chatt`. Tre pushar, en per steg, var och en EN commit
  (`git reset --soft` till förra pushen + en commit). Merge till `main` först
  efter beställarens uttryckliga ja.
- Inga lokala byggen. Prov får köras. `npx tsc --noEmit` får köras.
- Migrationer: handskriven SQL, additiv, omkörbar, numret tas ur
  `schema_migrations` när den körs (`node scripts/apply-sql.mjs <namn>`).
  Nästa lediga nummer 2026-11-15 är 0303.
- Ingen rad läggs in för hand för att ett kort ska ha något att visa. Provdata
  märks `prov = true`, och den skrivs aldrig i tabeller med identitetssekvens.
- Inget slås på: `forslag.pa`, `hem.nytt` och `chatt.pa` är av från början.
  Beställaren slår på dem själv i Inställningar.
- Inget som bara gäller Clicknet hårdkodas. Gränser, klockslag och listor är
  `nav_setting` med standardvärden i koden.
- I `utkast.html`: allt nytt får prefixet `hv` (finns inte i filen i dag), grep
  efter namnet före varje ny funktion, sparning utan omladdning (`ndOmlas`),
  läs aldrig ett klickat elements dataset efter `render()`.
- Varje text följer designdokumentets ton: antal före procent, aldrig en orsak,
  "Det här ser jag inte: …" där det är sant, källraden "Räknat av regler".
- Allt nytt får en rad överst i `src/navnyheter/poster.ts` i samma commit.
- Varje ny serverhandling bokförs i `tests/notiser-tackning.mjs`.
- Standardvärden (nyckel → värde):
  `forslag.pa` false · `forslag.obekraftat-tid` "14:00" ·
  `forslag.grans-facit` 0.01 · `forslag.grans-dom` 0.05 ·
  `forslag.grans-person` 0.01 · `forslag.grans-motvikt` 0.20 ·
  `forslag.foljda-installningar` ["moten.bekrafta-dagar","moten.bekrafta-tid","moten.bekrafta-paminn"] ·
  `hem.nytt` [] (anställdas id, eller "alla") ·
  `chatt.pa` false · `chatt.modell` "claude-sonnet-5-5" · `chatt.tak-kr` null ·
  `chatt.tak-fragor` 30.

## Granskningsfokus

Fem fall som designen förutsätter men som lätt glöms. Varje rad har ett prov i
den uppgift som äger koden.

1. **Mötet flyttas efter att förslaget skapats.** Det gamla förslaget stängs som
   `inaktuellt` (räknas inte i facit), och den nya tiden får ett eget förslag om
   den också blir obekräftad sista dagen (nyckeln bär mötesdagen). Uppgift 4 och 8.
2. **Mötet bekräftas, eller byter hållare, innan någon valt.** Förslaget lämnar
   kortet och stängs som `inaktuellt`, aldrig som "ingen valde". Uppgift 4 och 8.
3. **Dubbelklick på ett val, och Ångra.** Två klick ger ett beslut. Ångra tar
   tillbaka uppgiften som valet lämnade över och öppnar förslaget igen. Uppgift 7.
4. **Takten första arbetsdagen, på helgen och efter en röd dag.** Inga arbetsdagar
   gångna ger ingen prognos och texten "För tidigt för en takt". Uppgift 2.
5. **Klockslaget runt sommartid, helger och röda dagar.** 14.00 är svensk tid,
   ett måndagsmöte frågas om på fredagen, och ett möte mindre än en timme bort
   ger inget förslag. Uppgift 4.
6. **Utfallet rättas efter domen.** Rätta utfall i Möten ändrar ett möte som
   redan har fått sin dom. Nattjobbet skriver då en ny dom som säger vilken den
   rättar, och den gamla står kvar i loggen. Facit räknar på den senaste.
   Uppgift 8 (rådgivaren, varv 6).

---

# STEG 1: UNDERLAGET

### Task 1: Statistiken (Fishers exakta prov och "tidigast vid")

**Filer:**
- Skapa: `src/lib/nav2/statistik.ts`
- Prov: `tests/forslag-statistik.mjs`, skript `test:forslag-statistik` i `package.json` och i `test:alla`

**Gränssnitt:**
- Ger: `type NAv = { n: number; av: number }`,
  `fisherEnsidig(hog: NAv, lag: NAv): number`,
  `tidigastVid(hog: NAv, lag: NAv, grans: number): number | null`

- [ ] **Steg 1: Skriv provet**

```js
import { fisherEnsidig, tidigastVid } from "../src/lib/nav2/statistik.ts";
lika("5/5 mot 0/5", fisherEnsidig({n:5,av:5},{n:0,av:5}).toFixed(4), "0.0040");
lika("5/5 mot 1/5", fisherEnsidig({n:5,av:5},{n:1,av:5}).toFixed(4), "0.0238");
lika("4/4 mot 0/4", fisherEnsidig({n:4,av:4},{n:0,av:4}).toFixed(4), "0.0143");
lika("4/5 mot 1/4", fisherEnsidig({n:4,av:5},{n:1,av:4}).toFixed(4), "0.1667");
lika("5/7 mot 1/4", fisherEnsidig({n:5,av:7},{n:1,av:4}).toFixed(4), "0.1970");
lika("tom grupp ger 1", fisherEnsidig({n:0,av:0},{n:1,av:4}), 1);
lika("tidigast 5/7 mot 1/4 vid 0,01", tidigastVid({n:5,av:7},{n:1,av:4},0.01), 40);
lika("tidigast 5/7 mot 1/4 vid 0,05", tidigastVid({n:5,av:7},{n:1,av:4},0.05), 30);
lika("lika andelar", tidigastVid({n:2,av:4},{n:1,av:2},0.01), null);
lika("fel håll", tidigastVid({n:1,av:4},{n:3,av:4},0.01), null);
```

- [ ] **Steg 2: Kör, se det falla** — `node --experimental-strip-types tests/forslag-statistik.mjs` → modulen saknas.

- [ ] **Steg 3: Skriv `statistik.ts`.** `fisherEnsidig` är den hypergeometriska
  övre svansen P(X ≥ hog.n) med loggade fakulteter. `tidigastVid`: för
  T = hog.av + lag.av … 2000, fördela T i samma proportion som av-talen
  (`a1 = round(T·hog.av/(hog.av+lag.av))`), räkna n med samma andelar
  (avrundat), första T där p ≤ gräns; svaret avrundas UPPÅT till tiotal
  (34 → 40). `null` när hog-andelen inte är större eller T passerar 2000.

- [ ] **Steg 4: Kör, se det gå igenom.**

- [ ] **Steg 5: Commit** `Hemvyn: statistiken (Fishers prov, tidigast vid)`.

### Task 2: Takten och dess facit

**Filer:**
- Skapa: `src/lib/nav2/takt.ts`
- Prov: `tests/takt.mjs` (`test:takt`, `TZ=UTC`)

**Gränssnitt:**
- Konsumerar: `arArbetsdag` ur `src/lib/saljtakt.ts`
- Ger: `arbetsdagarIManad(manad: string): string[]` ("YYYY-MM"),
  `taktLage(i: { netto: number; manad: string; idag: string }): { gatt: number; totalt: number; prognos: number | null }`,
  `taktEfterhand(nettoPerDag: Record<string, number>, manad: string): { efter5: number|null; efter10: number|null; efter15: number|null; blev: number }`,
  `taktFacit(sparade: { manad: string; gatt: number; prognos: number }[], blev: Record<string, number>): TaktManad[]`
  där `TaktManad = { manad: string; efter5: number|null; efter10: number|null; efter15: number|null; blev: number; efterhand: boolean }`

- [ ] **Steg 1: Skriv provet** med Clicknets riktiga dagstal (de är antal, inga namn):

```js
const SEP = {"2026-09-02":1,"2026-09-03":1,"2026-09-10":1,"2026-09-11":1,"2026-09-14":1,"2026-09-15":4,"2026-09-17":4,"2026-09-23":1,"2026-09-24":5,"2026-09-25":3,"2026-09-30":2};
const OKT = {"2026-10-02":1,"2026-10-22":1,"2026-10-29":1};
lika("september har 22 arbetsdagar", arbetsdagarIManad("2026-09").length, 22);
lika("november har 21", arbetsdagarIManad("2026-11").length, 21);
lika("sep efter 10", taktEfterhand(SEP,"2026-09").efter10, 11);
lika("sep blev", taktEfterhand(SEP,"2026-09").blev, 24);
lika("okt efter 10", taktEfterhand(OKT,"2026-10").efter10, 2);
lika("nov 15 nov: 2 order, 10 dagar", taktLage({netto:2,manad:"2026-11",idag:"2026-11-16"}), {gatt:10,totalt:21,prognos:4});
lika("skissens tal", taktLage({netto:19,manad:"2026-11",idag:"2026-11-15"}).prognos, 40);
lika("första arbetsdagen", taktLage({netto:0,manad:"2026-12",idag:"2026-12-01"}).prognos, null);
lika("helgen räknar inte", taktLage({netto:3,manad:"2026-11",idag:"2026-11-08"}).gatt, 5);
```

- [ ] **Steg 2: Kör, se det falla.**
- [ ] **Steg 3: Skriv `takt.ts`.** `gatt` = arbetsdagar i månaden med datum
  före `idag` (morgonens läge). `prognos = round(netto / gatt × totalt)`, null
  när `gatt = 0`. `taktEfterhand` räknar läget varje morgon ur dagstalen
  (summan av dagar före morgonen) och plockar morgnarna där `gatt` är 5, 10
  och 15. `taktFacit` använder sparade morgonvärden när de finns, annars
  efterhand-värdet, och märker månaden `efterhand: true`.
- [ ] **Steg 4: Kör, se det gå igenom.**
- [ ] **Steg 5: Commit** `Hemvyn: takten och dess facit`.

### Task 3: Måttregistret

**Filer:**
- Skapa: `src/lib/nav2/matt.ts`
- Prov: `tests/matt.mjs` (`test:matt`, `TZ=UTC`)

**Gränssnitt:**
- Konsumerar: `StatMote`, `Period`, `inomKrets` ur `motesstatforma.ts`; `skaBekraftas` ur `motesflode.ts`
- Ger: `type MattNyckel = "moten.uteblivna" | "moten.hallna-av-alla" | "moten.bekraftade" | "order.netto"`,
  `type Matt = { nyckel: MattNyckel; sort: "andel" | "antal"; battre: "upp" | "ned"; motvikt: MattNyckel | null; text: string; serInte: string }`,
  `MATT: Record<MattNyckel, Matt>`,
  `mattMoten(nyckel: Exclude<MattNyckel, "order.netto">, moten: StatMote[], p: Period, krets: readonly string[] | null): { n: number; av: number; bakom: string[] }`,
  `bokadePerVecka(moten: StatMote[], p: Period, krets: readonly string[] | null): number`

- [ ] **Steg 1: Skriv provet.** Fixtur med sex möten: ett uppföljningsmöte
  (räknas aldrig), ett utan utfall (räknas aldrig), hållet bekräftat,
  hållet obekräftat, uteblev obekräftat, avbokat bekräftat.

```js
lika("uteblivna", mattMoten("moten.uteblivna", M, V, null), {n:1,av:3,bakom:["h1","h2","u1"]});
lika("hållna av alla", mattMoten("moten.hallna-av-alla", M, V, null), {n:2,av:4,bakom:["h1","h2","u1","a1"]});
lika("bekräftade", mattMoten("moten.bekraftade", M, V, null).n, 2);
lika("krets utan personen", mattMoten("moten.uteblivna", M, V, ["annan"]).av, 0);
lika("motvikten", MATT["moten.uteblivna"].motvikt, "moten.hallna-av-alla");
lika("bättre håll", MATT["moten.uteblivna"].battre, "ned");
```

- [ ] **Steg 2: Kör, se det falla.**
- [ ] **Steg 3: Skriv `matt.ts`** med tabellen i spec 1.1. Underlag: möten där
  `skaBekraftas(art)`, mötestid i perioden (Stockholmsdag), med utfall, och i
  kretsen enligt `inomKrets`. `bakom` är nämnarens id:n i mötestidsordning.
  `text` och `serInte` är korta svenska meningar ("Räknar första möten med
  utfall. Ser inte möten som saknar utfall.").
- [ ] **Steg 4: Kör, se det gå igenom.**
- [ ] **Steg 5: Commit** `Hemvyn: måttregistret`.

### Task 4: Reglerna för förslag, facit och domar

**Filer:**
- Skapa: `src/lib/nav2/forslagforma.ts`
- Prov: `tests/forslagforma.mjs` (`test:forslagforma`, `TZ=UTC`)

**Gränssnitt:**
- Konsumerar: `NAv`, `fisherEnsidig`, `tidigastVid` (uppgift 1); `bekraftelseFonster`, `skaBekraftas`, `omfattas`, `lokalDag`, `lokalKlockan`, `nastaArbetsdag` ur `motesflode.ts`
- Ger:
  - `type ForslagMote = { id: string; moteTid: string; senastAndrad: string; hallsAv: string; bokatAv: string; art: string; bekraftat: boolean; utfall: string | null }`
  - `type NyttForslag = { moteId: string; om: string; nyckel: string; domsDag: string; utgar: string }`
  - `obekraftadeAttForesla(moten: ForslagMote[], aktiva: ReadonlySet<string>, nu: Date, inst: { tid: string; bekraftaDagar: number; tz: string; gallerFran: string | null }): NyttForslag[]`
  - `type Val = "ringer-sjalv" | "flytta" | "lat-sta"`; `type Beslut = Val | "ingen" | "inaktuellt"`
  - `inaktuellt(f: { nyckel: string; om: string }, m: ForslagMote | null, tz: string): boolean`
  - `type MotesUtfall = "hallet" | "uteblev" | "avbokat" | "flyttat" | "okant"`
  - `facitPerVal(rader: { beslut: Beslut; utfall: MotesUtfall; om: string }[], grans: number): Facit`
    där `Facit = { per: Record<Val | "ingen", NAv>; dom: { sort: "utslag" | "for-fa" | "en-person" | "tomt"; p: number | null; tidigast: number | null } }`
  - `facitDags(nuAvgjorda: number, vidSenaste: number): boolean`
  - `domAndring(i: AndringIn): AndringDom` (tabellen i spec 1.5) med
    `AndringIn = { fore: NAv; efter: NAv; motFore: NAv; motEfter: NAv; resten: { fore: NAv; efter: NAv } | null; veckor: number; battre: "upp" | "ned"; grans: number; gransMotvikt: number }`
    och `AndringDom = { sort: "inget-fore" | "for-tidigt" | "ser-bra-ut" | "battre-men" | "ser-samre-ut" | "ingen-skillnad" | "for-fa"; stangd: boolean; restenOcksa: boolean; helaLaget: boolean }`
  - `trendLaget(avgjorda: { moteTid: string; utfall: "hallet" | "uteblev" }[], grans: number): { lage: "saknas"; har: number; behover: 60 } | { lage: "utslag" | "inget"; p: number; nya: NAv; fore: NAv }`
  - `troddeAvstamning(rader: { trodde: NAv; utfall: MotesUtfall }[]): { raknade: number; av: number; blev: number } | null`
    — null under 20 dömda rader med `trodde`; annars summan av andelarna (avrundad) mot utfallet

- [ ] **Steg 1: Skriv provet.** Minst dessa fall (2026-11-16 är en måndag,
  2026-11-13 en fredag, 2026-10-25 byte till vintertid):

```js
const INST = { tid: "14:00", bekraftaDagar: 2, tz: "Europe/Stockholm", gallerFran: "2026-11-01T00:00:00Z" };
// Tisdagsmöte 10:30, obekräftat. Måndag 13:59 svensk tid: inget. 14:00: ett förslag.
lika("före 14", obekraftadeAttForesla([TIS], AKT, new Date("2026-11-16T12:59:00Z"), INST).length, 0);
lika("kl 14", obekraftadeAttForesla([TIS], AKT, new Date("2026-11-16T13:00:00Z"), INST)[0].nyckel, "TIS@2026-11-17");
lika("till hållaren", ...[0].om, "edvin");
lika("domsdag = arbetsdagen efter mötet", ...[0].domsDag, "2026-11-18");
// Måndagsmöte frågas om på fredagen.
lika("måndagsmöte", obekraftadeAttForesla([MAN], AKT, new Date("2026-11-13T13:00:00Z"), INST).length, 1);
// Bokat samma dag: sista dagen är mötesdagen, gränsen blir två timmar före.
lika("samma dag 11:00, möte 12:30", ...(SAMMA, "2026-11-16T10:00:00Z").length, 1);
lika("mindre än en timme kvar", ...(SAMMA, "2026-11-16T10:45:00Z").length, 0);
lika("bekräftat ger inget", ...); lika("uppföljning ger inget", ...); lika("hållare som slutat ger inget", ...);
lika("flyttat möte, ny nyckel", ...[0].nyckel, "TIS@2026-11-24");
lika("inaktuellt när mötesdagen bytts", inaktuellt({nyckel:"TIS@2026-11-17",om:"edvin"}, FLYTTAT, TZ), true);
lika("inaktuellt när hållaren bytts", inaktuellt(..., {...TIS, hallsAv:"zen"}, TZ), true);
lika("inaktuellt när bekräftat", inaktuellt(..., {...TIS, bekraftat:true}, TZ), true);
// Facit
const F = facitPerVal(rader(["ringer-sjalv",5,7],["lat-sta",1,4],["ingen",0,2]), 0.01);
lika("per val", F.per["ringer-sjalv"], {n:5,av:7});
lika("för få", F.dom, {sort:"for-fa", p: 0.197, tidigast: 40}); // p avrundat till 3 decimaler i provet
lika("utslag 5/5 mot 0/5", facitPerVal(rader(["ringer-sjalv",5,5],["lat-sta",0,5]),0.01).dom.sort, "utslag");
lika("en person > hälften", facitPerVal(raderMedSammaPerson, 0.01).dom.sort, "en-person");
lika("flyttat och okänt ingår inte", ...);
lika("var tionde", [facitDags(19,10), facitDags(20,10)], [false,true]);
// Ändringar (1.5)
lika("inget före", domAndring({...A, fore:{n:2,av:15}}).sort, "inget-fore");
lika("för tidigt", domAndring({...A, efter:{n:1,av:12}}).sort, "for-tidigt");
lika("ser bra ut", domAndring(BRA).sort, "ser-bra-ut");
lika("bättre men", domAndring({...BRA, motEfter: SAMRE}).sort, "battre-men");
lika("resten också", domAndring({...BRA, resten: OCKSA}).restenOcksa, true);
lika("12 veckor, ≥40 efter, inget utslag", domAndring(INGEN).sort, "ingen-skillnad");
lika("12 veckor, <40 efter", domAndring(FA).sort, "for-fa");
// Trend
lika("saknas", trendLaget(elva, 0.01), {lage:"saknas", har:11, behover:60});
lika("20 mot 40", trendLaget(sextio, 0.01).nya.av, 20);
```

- [ ] **Steg 2: Kör, se det falla.**
- [ ] **Steg 3: Skriv `forslagforma.ts`.** Regeln i spec 1.3: sista dagen är
  `bekraftelseFonster(...).senast`; förslaget skapas när `idag === senast` och
  klockan ≥ gränsen, där gränsen är `inst.tid`, eller när sista dagen är
  mötesdagen det tidigaste av `inst.tid` och två timmar före mötet; inget när
  mindre än en timme är kvar. `nyckel = "<mötes-id>@<mötesdag>"`,
  `utgar = moteTid`, `domsDag = nastaArbetsdag(mötesdag)`. Facit enligt spec 1.4:
  domen jämför bara `ringer-sjalv` mot `lat-sta`; `ingen` står bredvid;
  `inaktuellt`, `flyttat` och `okant` räknas inte; `en-person` när någon står
  för mer än hälften av raderna i ett av de två valen. Ändringsdomen enligt
  tabellen i 1.5, motvikten sämre när den gått åt fel håll med p ≤ 0,20,
  `restenOcksa` när resten av laget rört sig åt samma håll minst hälften så
  mycket. Trend: de 20 senaste mot de 40 före, `uteblev` är n.
- [ ] **Steg 4: Kör, se det gå igenom.**
- [ ] **Steg 5: Commit** `Hemvyn: reglerna för förslag, facit och domar`.

### Task 5: Texterna (mallar)

**Filer:**
- Skapa: `src/lib/nav2/hemtext.ts`
- Prov: `tests/hemtext.mjs` (`test:hemtext`)

**Gränssnitt:**
- Konsumerar: `Facit`, `AndringDom`, `NAv`
- Ger (alla returnerar `string` eller `string[]`):
  `textObekraftat(m: { kund: string; dag: string; kl: string; bokare: string | null; forsok: number; jag: boolean }, trodde: NAv | null, forFa: boolean): string[]`,
  `textKortObekraftade(antal: number): string`,
  `textKvitto(val: Val, harUppgift: boolean): string`,
  `textFacit(f: Facit): string`,
  `textTakt(t: { netto: number; mal: number | null; prognos: number | null; utanMal: number }): { stort: string; rad: string }`,
  `textTaktFacit(m: TaktManad | null, manadsnamn: string): string`,
  `textAndringDom(d: AndringDom): string`,
  `textTrendSaknas(har: number): string`,
  `textTrodde(t: { raknade: number; av: number; blev: number }): string`,
  `textAndel(k: NAv, bokade: { fore: number; efter: number }): string` (en andel står aldrig utan sitt antal),
  `KALLRAD = { regler: "Räknat av regler", ai: "Skrivet av AI ur Navs tal" }`

- [ ] **Steg 1: Skriv provet** med exakta texter ur spec och skiss 9:

```js
lika("kedjan", textObekraftat({kund:"Hagby Glas",dag:"i morgon",kl:"09.00",bokare:"Mick",forsok:2,jag:false},{n:1,av:4},true), [
  "Mötet med Hagby Glas i morgon 09.00 är inte bekräftat. Mick har ringt två gånger utan svar.",
  "Hittills har 1 av 4 obekräftade möten hållits. Det är för få för att säga något.",
  "Det här ser jag inte: om kunden har hört av sig på annat sätt."]);
lika("inget ringt", textObekraftat({...,forsok:0},null,true)[0].endsWith("Mick har inte ringt än."), true);
lika("kortet, ett", textKortObekraftade(1), "1 möte i morgon är obekräftat");
lika("kortet, tre", textKortObekraftade(3), "3 möten i morgon är obekräftade");
lika("kvitto", textKvitto("ringer-sjalv", true), "Klart. Bekräftelsen ligger i din lista i dag. I morgon efter mötet säger jag hur det gick.");
lika("facit för få", textFacit(F), "När någon har ringt själv har 5 av 7 möten hållits. Låt stå: 1 av 4. Ingen valde: 0 av 2. För få för att skilja från slump. Tidigast vid runt 40 möten, om skillnaden håller.");
lika("facit utslag", textFacit(UTSLAG).includes("Den som håller mötet väljer vilka möten hen ringer om, så den visar inte att samtalet gjorde den."), true);
lika("takt", textTakt({netto:19,mal:46,prognos:40,utanMal:0}), {stort:"19 av 46 order", rad:"I samma takt blir det ungefär 40. Det är en uträkning på takten, inget löfte."});
lika("utan mål", textTakt({netto:19,mal:null,prognos:40,utanMal:0}).stort, "19 order");
lika("för tidigt", textTakt({netto:0,mal:46,prognos:null,utanMal:0}).rad, "För tidigt för en takt.");
lika("taktens facit", textTaktFacit({manad:"2026-10",efter10:38,blev:44,efterhand:false}, "oktober"), "I oktober sa takten 38 efter 10 dagar. Det blev 44.");
lika("trend saknas", textTrendSaknas(11), "För att jämföra laget med sig självt behöver jag 60 avgjorda möten. Jag har 11.");
lika("trodde", textTrodde({raknade:9, av:20, blev:11}), "Jag räknade med att 9 av 20 skulle hållas. Det blev 11.");
lika("andel med antal", textAndel({n:2,av:20}, {fore:6, efter:5}), "2 av 20 uteblev. Bokade per vecka: 6 före, 5 efter.");
```

- [ ] **Steg 2: Kör, se det falla.**
- [ ] **Steg 3: Skriv `hemtext.ts`.** Antal försök skrivs med ord upp till tio
  ("en gång", "två gånger"), därefter siffror. Klockslag med punkt ("09.00").
  Inga orsaker, inga utropstecken.
- [ ] **Steg 4: Kör, se det gå igenom.**
- [ ] **Steg 5: Commit** `Hemvyn: texterna`.

### Task 6: Migrationen för loggen, offerten och inställningarnas historik

**Filer:**
- Skapa: `supabase/migrations/0303_forslagslogg.sql` (byt nummer om 0303 är taget när den körs)
- Ändra: `src/lib/registerutdrag.ts` (KALLOR), `src/lib/personal-radering.ts` (TABELL), `tests/rattigheter-db.mjs` (TILLATNA för nya SECURITY DEFINER-funktioner)
- Prov: `tests/forslag-db.mjs` (`test:forslag-db`), körs mot databasen

**Innehåll i migrationen** (allt omkörbart):
- `nav_forslag` med fälten i spec 1.2: `id uuid pk default gen_random_uuid()`,
  `sort text check in ('forslag','andring')`, `regel text not null`,
  `nyckel text not null`, `kalla text check in ('regel','person','installning')`,
  `om uuid references employee`, `lag uuid references team`,
  `skapad timestamptz default now()`, `skapad_av uuid references employee`,
  `belagg jsonb not null default '{}'`, `trodde jsonb`, `val text[] not null default '{}'`,
  `foljer jsonb not null default '{}'`, `doms_dag date`, `utgar timestamptz`,
  `text text check (char_length(text) <= 500)`, `prov boolean not null default false`,
  `avidentifierad timestamptz`; `unique (regel, nyckel)`.
- `nav_forslag_handelse`: `id uuid pk`, `forslag uuid not null references nav_forslag`,
  `sort text check in ('beslut','atgard','angrad','kommentar','matning','dom')`,
  `av uuid references employee`, `nar timestamptz default now()`,
  `data jsonb not null default '{}'`, `prov boolean not null default false`.
  Index på `(forslag, nar)`.
- Triggrar som nekar `update` och `delete` på båda (`'Förslagsloggen tar bara emot nya rader.'`).
  Undantag: funktionen `nav_forslag_avidentifiera(p_fore timestamptz)`
  (SECURITY DEFINER, bara service role) som sätter en transaktionslokal flagga
  `set local nav.forslag_avid = 'on'`, nollar `om`, `skapad_av`, `av`, tar bort
  id:n ur `belagg` och sätter `avidentifierad`. Raderingen av en person (0224)
  stänger redan av användartriggrar på tabeller som pekar på `employee`.
- Vyn `nav_forslag_lage` (`security_invoker = true`): en rad per förslag med
  senaste `beslut` som inte följts av `angrad`, senaste `atgard`, `kommentar`,
  `matning` och `dom`.
- RLS på båda tabellerna: läsning när `om = current_employee_id()`, eller `om`
  ligger i `mote_statkrets()` (null = alla), eller `om is null and lag is not null`
  och läsaren leder laget eller har sales_manager/ceo/admin, eller båda tomma och
  läsaren har sales_manager/ceo/admin. Ingen skrivning för `authenticated`
  (servern skriver med service role efter kontroll).
- `mote_kedja.offert_belopp integer check (offert_belopp between 0 and 100000000)`,
  `mote_kedja.offert_paket bigint references package(id)` (kontrollera tabellnamnet
  för paket i `0260`/ordermodellen före körning).
- `nav_takt_dag (krets text, manad date, gatt int, netto int, prognos int, sparad timestamptz default now(), primary key (krets, manad, gatt))`.
  `krets` är `'alla'` eller ett lag-id. RLS: läsning för den som får se kretsen.
- Trigger på `nav_setting` (after insert or update) som skriver
  `audit_log(handling 'installning', objekt nyckeln, meta {fore, efter, av})`.
  Lägg den efter de triggrar som finns; kontrollera kolumnnamnen i `audit_log` (0001).
- Funktionen `mote_bekrafta_overta(p_mote uuid, p_till uuid)` (SECURITY DEFINER):
  lämnar mötets öppna bekräftelseuppgift över till `p_till` med en
  `task_event`-rad som säger vem som tog den; finns ingen öppen uppgift, eller är
  den avbockad utan att mötet bekräftats, skapas en ny med dagens datum. Ger
  uppgiftens id. Bara service role.

- [ ] **Steg 1: Skriv databasprovet** (`tests/forslag-db.mjs`, mönster som
  `tests/uppgift-sett-db.mjs`): en provrad med `prov = true` går att lägga in;
  `update` och `delete` nekas; samma (regel, nyckel) två gånger nekas; en säljare
  läser sin egen rad men inte en kollegas; en teamledare läser sitt lags; en rad
  utan `om` och `lag` läses bara av säljchef; `nav_setting`-ändring ger en
  `audit_log`-rad med `fore` och `efter`; `mote_bekrafta_overta` på ett provmöte
  ger en uppgift till rätt person. Allt i en transaktion som rullas tillbaka.
- [ ] **Steg 2: Kör `npm run test:registerutdrag`, se det falla** på de nya kolumnerna (efter steg 3).
- [ ] **Steg 3: Skriv migrationen, kör den** med `scripts/apply-sql.mjs`. Fyll
  KALLOR (nav_forslag.om, nav_forslag.skapad_av, nav_forslag_handelse.av) och
  TABELL ("Navs förslag", "Händelser på Navs förslag").
- [ ] **Steg 4: Kör `test:forslag-db`, `test:registerutdrag`, `test:rattigheter`, `test:radering`.** Alla gröna.
- [ ] **Steg 5: Commit** `Hemvyn: förslagsloggen, offertens belopp, inställningarnas historik (0303)`.

### Task 7: Loggen på servern och rutten

**Filer:**
- Skapa: `src/lib/nav2/forslag.ts`, `src/app/nav2/forslag/route.ts`
- Ändra: `tests/notiser-tackning.mjs`
- Prov: `tests/forslag-rutt.mjs` (`test:forslag-rutt`, mönster som `tests/moten-rutt-behorighet.mjs`)

**Gränssnitt:**
- Konsumerar: uppgift 1–6
- Ger:
  - `type ForslagInst` och `lasForslagInst(rader: {key: string; value: unknown}[]): ForslagInst` (standardvärdena ovan)
  - `type NdForslag = { pa: boolean; oppna: NdForslagRad[]; andrat: NdAndring[]; trend: { har: number; behover: number } }`
  - `byggForslag(supabase: SupabaseClient, user: CurrentUser): Promise<NdForslag>` (bara den lilla läsningen för startladdningen)
  - `lasGenomgang(user: CurrentUser, vad: "team" | "facit" | "andrat" | "forslag", id?: string): Promise<unknown>` (tunga läsningar när ett kort öppnas)
  - Rutten: `GET /nav2/forslag?las=team|facit|andrat|forslag&id=` och
    `POST /nav2/forslag` med `handling`: `valj {forslag, val}`, `angra {forslag}`,
    `kommentar {forslag, text}`, `beratta {text, om: "jag"|uuid|"laget", fran, matt}`,
    `prova {text, fran, matt}`, `installningar {nyckel, varde}`.

- [ ] **Steg 1: Skriv ruttprovet:** `valj` av någon annan än `om` ger 403; `valj`
  två gånger ger ett beslut (andra svaret 409 "Valet är redan gjort.");
  `valj ringer-sjalv` anropar `mote_bekrafta_overta` och skriver `atgard` med
  uppgiftens id; `angra` skriver `angrad`, tar tillbaka uppgiften och gör
  förslaget öppet igen; `kommentar` över 200 tecken ger 400; `beratta` om en
  person utanför kretsen ger 403; `installningar` av en säljare ger 403;
  `forslag.grans-facit` utanför 0,001–0,1 ger 400. Alla rader `prov = true`.
- [ ] **Steg 2: Kör, se det falla.**
- [ ] **Steg 3: Skriv `forslag.ts` och rutten.** Samma ursprungskontroll och
  läsläge som `hem/route.ts`. `flytta` sparas först när flytten är gjord: rutten
  för Möten skriver beslutet när ett möte med öppet förslag flyttas av hållaren
  (lägg anropet i `flytta`-handlingen i `src/app/nav2/moten/route.ts`).
  Inställningar får ändras av samma roller som Mötens inställningar.
  Bokför handlingarna i `tests/notiser-tackning.mjs`.
- [ ] **Steg 4: Kör ruttprovet och `test:notiser-tackning`.** Gröna.
- [ ] **Steg 5: Commit** `Hemvyn: loggen på servern och rutten /nav2/forslag`.

### Task 8: Jobben

**Filer:**
- Skapa: `src/lib/nav2/forslag-jobb.ts`
- Ändra: `src/lib/nav2/moten-jobb.ts` (nytt steg efter bekräftelsen, eget try/catch), `src/app/api/jobb/natt/route.ts` (steget `forslag`)
- Prov: `tests/forslag-jobb.mjs` (`test:forslag-jobb`, ren del med fejkad db)

**Gränssnitt:**
- Konsumerar: uppgift 2–7
- Ger: `skapaObekraftade(db: Db, inst: MotenInst, finst: ForslagInst, nu: Date): Promise<{ skulle: number; skapade: number; inaktuella: number; torr: boolean }>`,
  `korForslagNatt(db: Db, nu: Date): Promise<{ domda: number; utanUtfall: number; ingenValde: number; andringar: number; trend: unknown; takt: number; torr: boolean }>`

- [ ] **Steg 1: Skriv provet** med en fejkad db som spelar in anrop: med
  `forslag.pa = false` skrivs inget och kvittot säger `skulle: 1, torr: true`;
  med `pa = true` skrivs en rad, och en andra körning skriver ingen dubblett;
  ett flyttat möte stänger det gamla förslaget som `inaktuellt`; natten dömer
  en rad vars domsdag kommit (`dom` med utfall och genomförande), skriver "ingen"
  efter `utgar`, låter en rad utan utfall vänta och stänger den som `okant`
  efter fem arbetsdagar; takten sparas för `alla` och för varje lag en gång per
  morgon.
- [ ] **Steg 2: Kör, se det falla.**
- [ ] **Steg 3: Skriv `forslag-jobb.ts`** enligt spec 1.8, plus tre saker:
  ändringar i de följda inställningarna (`forslag.foljda-installningar`) läses
  ur `audit_log` och blir rader med `sort = 'andring'`, `kalla = 'installning'`;
  rader vars domsdag är äldre än 24 månader avidentifieras med
  `nav_forslag_avidentifiera`; och från steg 3 nollas chattens text äldre än 90
  dagar. Allt går att köra om utan dubbletter. Trendregeln körs
  natten mot måndag och skriver bara i kvittot. Facit räknas om vid vart tionde
  avgjort möte per val (`facitDags`) och sparas som `dom` på en rad med
  `regel = 'facit.obekraftat'`, `nyckel = <antal>`.
- [ ] **Steg 4: Kör, se det gå igenom.** Kör också `test:motesflode` och `test:moten`.
- [ ] **Steg 5: Commit** `Hemvyn: jobben, i torrkörning tills forslag.pa slås på`.

### Task 9: Offertens belopp

**Filer:**
- Ändra: `src/lib/nav2/motenforma.ts` (`UtfallIn.belopp`, `UtfallIn.paket`, `utfallIndata`), `src/app/nav2/moten/route.ts` (skriv fälten), `src/lib/nav2/moten.ts` (läs dem), `src/nav2/utkast.html` (fältet Belopp i rutan Offert skickad)
- Prov: lägg fall i `tests/moten.mjs`

- [ ] **Steg 1: Skriv provet:** `resultat: "offert"` utan belopp ger "Skriv offertens belopp.";
  belopp 0–100 000 000 i hela kronor går igenom; ett paket med bindningstid ger
  förifyllt belopp = `ordervardeFor` (månadspris × löptid); belopp på något
  annat än offert ger "Beloppet hör till Offert skickad.".
- [ ] **Steg 2: Kör, se det falla.**
- [ ] **Steg 3: Bygg.** Fältet ligger under datumet för Ring kunden, med
  paketväljaren som fyller i beloppet och går att skriva över. Mötessidans
  offerttal leder med antalet: "5 offerter väntar, 3 med belopp: 212 000 kr."
- [ ] **Steg 4: Kör `test:moten`, `test:motesstat`, `test:moten-rutt`.** Gröna.
- [ ] **Steg 5: Commit** `Möten: offertens belopp`.

### Task 10: Steg 1 klart och ute på previewn

- [ ] `npx tsc --noEmit` och `npm test` gröna (provlåset tas av skriptet).
- [ ] Rad i `src/navnyheter/poster.ts`: "Offerten får ett belopp" (det enda användaren ser).
- [ ] `docs/NASTA_SESSION.md` och `docs/ARBETSLOGG.md` uppdaterade.
- [ ] Slå ihop till en commit, pusha `hemvy-chatt`, vänta på att previewn blir grön.
- [ ] Prova i previewn: Offert skickad med belopp på ett provmöte, städa efteråt.

---

# STEG 2: NYA HEMMET OCH KEDJAN

### Task 11: Hemmets data

**Filer:**
- Ändra: `src/lib/nav2/hem.ts` (`NdHem` får `nytt`, `forslag`, `team`), `src/lib/nav2/data.ts` om delen behöver nya beroenden
- Prov: `tests/hem-team.mjs` (`test:hem-team`, ren del)

**Gränssnitt:**
- Ger: `NdHem.nytt: boolean` (läsaren står i `hem.nytt` eller det är "alla"),
  `NdHem.forslag: NdForslag`,
  `NdHem.team: NdTeam | null` (bara för den som har en krets större än sig själv)
  där `NdTeam = { manad: string; netto: number; vantar: number; makulerade: number; mal: number | null; utanMal: number; takt: { gatt: number; totalt: number; prognos: number | null }; forra: TaktManad | null }`,
  `byggTeam(user: CurrentUser, nu?: Date): Promise<NdTeam | null>` (service role, samma krets som `mote_statkrets()`, återanvänder `nettoAntal` och `sales_target` som `byggGolvet`)

- [ ] **Steg 1: Skriv provet** för den rena delen `teamTal(order, mal, krets, idag)`:
  netto, väntande (ej godkända, ej utkast), makulerade i månaden, mål som summa,
  `utanMal` = personer i kretsen med order men utan mål.
- [ ] **Steg 2: Kör, se det falla.**
- [ ] **Steg 3: Bygg.** `forra` är förra avslutade månadens facit ur
  `nav_takt_dag`, annars räknat i efterhand och märkt.
- [ ] **Steg 4: Kör, och mät `npm run mat:startsidan` före och efter.** Startladdningen får inte bli långsammare än mätningens brus.
- [ ] **Steg 5: Commit** `Hemvyn: hemmets data`.

### Task 12: Det nya hemmet i utkastet

**Filer:**
- Ändra: `src/nav2/utkast.html` (CSS och JS med prefixet `hv`), ingen ändring i det gamla hemmets funktioner utöver ett villkor i `render()`
- Prov: `tests/nav2-hemvy.mjs` (`test:nav2-hemvy`): läser `utkast.html`, kontrollerar att varje ny funktion finns en gång, att inget `hv`-namn krockar, och kör de rena ritfunktionerna med en fast `ND` (samma mönster som `tests/nav2-uppgiftsrutan.mjs`)

**Vad som byggs**, i den ordning skiss 9 visar det:
- När `ND.hem.nytt` är sant ritar `render()` hemmet med `hvHem()` i stället för
  det gamla. Annars är allt som i dag.
- Glasfönstret kant i kant, mörkt och ljust läge, tokens som skiss 9.
  Sidopanelen står i Hovra om personen inte valt något (`S.prfLagrat.rail` utan sparat värde).
- Överraden: hur många som är på plats (klick visar laget), datum, Stämpla in.
- Hälsningen och en rad om läget.
- Fyra kort: `hvVantar()` (Väntar på dig, ur samma lista som `renderInbox`),
  `hvForeslar()`, `hvTeam()` (chef) eller `hvDinManad()` (säljare), `hvAndrat()`.
  Tomma lägen med texterna i spec.
- Ett öppnat kort tar ytan: korten viker undan, Nav talar först, genomgången
  hämtas från `/nav2/forslag?las=…` när kortet öppnas. Kvitto och Ångra i ytans fot.
- Kedjan: förslaget med texterna ur `hemtext.ts` (servern skickar färdiga
  rader), tre lika knappar, Flytta öppnar Mötens vanliga flytta-flöde, kvittot,
  Ångra, och dagen efter domen i Det som ändrats.
- Din månad: kortets tal är `ND.provision.underlag.summa`, väntande som antal,
  steget i order, uträkningen order för order med "≈ … fryses vid godkännandet"
  för väntande, "Det här ser jag inte: om en order makuleras senare. Då dras
  provisionen den månaden." och "Stämmer inte? Fråga om raden" (befintliga vägen
  i Provision). Den gamla "Prognos i din nuvarande takt" ligger bara i uträkningen.
  Ingen provisionsregel och ingen mötesprovision = inga kronor.
- Teamet i månaden: stort tal, takten, taktens facit bredvid, "Visa uträkningen",
  genomgången med en rad per person och lagets öppna rader överst, lagets facit per val.
- Det som ändrats: senaste domen, genomgången, Berätta om en ändring (fyra fält)
  och Pröva med laget.
- Personens egen rad på en rad om hen själv (högst 200 tecken).
- Skrivrutan längst ned: svarar som paletten (`svaraPaletten`) tills chatten är på.
  Genvägarna Min dag och Veckan i glas ovanför.
- Telefonen: korten staplas, skrivrutan tar hela bredden.

- [ ] **Steg 1: Skriv provet** med två fasta `ND` (chef och säljare): fyra kort
  ritas; tomma lägen ger rätt text; Din månad visar `summa` och aldrig väntande
  kronor i kortets tal; källraden "Räknat av regler" finns under varje genomgång;
  inga `hv`-namn finns två gånger.
- [ ] **Steg 2: Kör, se det falla.**
- [ ] **Steg 3: Bygg, del för del,** och kör provet efter varje kort.
- [ ] **Steg 4: Kör `test:nav2-hemvy`, `test:nav2-omladdning`, `test:nav2-uppgiftsrutan`.** Gröna.
- [ ] **Steg 5: Commit** `Hemvyn: det nya hemmet i utkastet`.

### Task 13: Inställningarna

**Filer:**
- Ändra: `src/nav2/utkast.html` (en ruta i Inställningar för den som får ändra Mötens inställningar)

- [ ] Rutan "Nya hemmet": vilka som har det (personväljare, eller Alla),
  `forslag.pa` med texten "Nav skapar förslag och dömer dem. Av: jobben räknar
  bara och skriver i kvittot.", klockslaget för obekräftade möten och de fyra
  gränserna, varje fält med en mening om vad det gör. Sparas via `installningar`
  i `/nav2/forslag`. Inget slås på av bygget.
- [ ] Prov i `test:nav2-hemvy`: rutan syns bara för rätt roll.
- [ ] Commit `Hemvyn: inställningarna`.

### Task 14: Det gamla hemmet, registren och steg 2 ute

- [ ] Skriv `docs/hemvy-gamla-hemmet.md`: varje sak dagens hem visar
  (`hello`, `renderHub`, `renderBrief`, `renderInbox`, `renderGolvet`,
  `renderAeHem`, `renderDev`, `renderNews`, `renderTeamGoal`, `renderCnHemChef`,
  `renderAgenda`, `renderCnHem`, `renderProv`, `renderFranvaro`, kvällsnotisen,
  Grattis, Stämmer inte, Visa inte X här) och var den finns i det nya. Saknas en
  plats byggs den, ingen funktion försvinner.
- [ ] Rad i `src/navnyheter/poster.ts`: "Nya hemmet: fyra kort och Nav föreslår".
- [ ] `npx tsc --noEmit`, `npm test` gröna. NASTA_SESSION och ARBETSLOGG uppdaterade.
- [ ] En commit, push, previewn grön.
- [ ] Klickprov i previewn som chef och som säljare, mörkt och ljust, med
  `hem.nytt` satt till beställaren av beställaren själv. Skärmbilder till svaret.

---

# STEG 3: CHATTEN (AVSTÄNGD)

Läs färdigheten `claude-api` (TypeScript) före första raden kod.

### Task 15: Chattens rena delar

**Filer:**
- Skapa: `src/lib/nav2/chatt/chattforma.ts`
- Prov: `tests/chattforma.mjs` (`test:chattforma`)

**Gränssnitt:**
- Ger:
  - `type TalRef = { verktyg: string; anrop: number; falt: string }`
  - `sattInTal(text: string, svar: Record<string, unknown>[]): { text: string; tal: { id: string; varde: number | string; kalla: TalRef }[]; obelagda: number }`
    — Claude skriver `{{t:<anrop>.<fält>}}`, servern sätter in värdet; en siffra
    utanför en hänvisning märks med `⟦obelagt⟧` och räknas.
  - `kostnadKr(modell: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }, krPerDollar: number): number`
    med priserna i spec (Opus 5.5 4/20, Sonnet 5.5 2/10, Haiku 5.5 0,10/0,50 dollar per miljon)
  - `fårSlåsPå(i: { nyckel: boolean; takKr: number | null; modell: string; godkandaProv: string[] }): { ok: true } | { ok: false; skal: string }`
  - `inomTak(i: { manadKr: number; takKr: number; idagFragor: number; takFragor: number }): { ok: true } | { ok: false; skal: string }`

- [ ] **Steg 1: Skriv provet:** hänvisning ersätts med värdet; "12 möten" utan
  hänvisning ger `obelagda: 1`; datum och klockslag i texten räknas inte som tal;
  en hänvisning till ett anrop som inte finns ger `obelagda: 1`; kostnaden för
  20 000 in och 2 500 ut på Sonnet 5.5 vid 11 kr är 0,715 (avrundat 0,72);
  `fårSlåsPå` utan godkänt prov ger skälet "Modellen har inget godkänt prov.";
  utan tak "Sätt ett tak i kronor först."; utan nyckel "Nyckeln saknas i den här miljön.".
- [ ] **Steg 2–4:** kör, bygg, kör.
- [ ] **Steg 5: Commit** `Chatten: de rena delarna`.

### Task 16: Migrationen, verktygen och rutten

**Filer:**
- Skapa: `supabase/migrations/0304_chatt.sql`, `src/lib/nav2/chatt/verktyg.ts`, `src/lib/nav2/chatt/systemtext.ts`, `src/app/nav2/chatt/route.ts`
- Ändra: `package.json` (`@anthropic-ai/sdk`, exakt version), `src/lib/registerutdrag.ts`, `src/lib/personal-radering.ts`, `tests/notiser-tackning.mjs`
- Prov: `tests/chatt-rutt.mjs` (`test:chatt-rutt`) med en fejkad klient

**Innehåll:**
- `nav_chatt_logg`: vem, när, miljö, modell, in/ut/cachade token, verktyg med
  argument, `stop_reason`, ms, kostnad i kr, obelagda tal, `fraga` och `svar`
  (text, nollas efter 90 dagar av nattjobbet), `prov boolean`. RLS: bara personen läser sin egen text.
- `nav_chatt_prov`: modell, datum, antal frågor, antal rätt, kostnad per fråga,
  `godkand boolean`, vem som godkände. Ingen rad skapas av bygget.
- Trigger på `nav_setting`: `chatt.pa = true` nekas om `chatt.modell` saknar en
  godkänd rad i `nav_chatt_prov` eller om `chatt.tak-kr` saknas.
- Verktygen i spec (`las_matt`, `las_forslag`, `las_vantar`, `las_dag`,
  `las_provision`, `forbered_uppgifter`), `strict: true`, med den inloggades
  behörighet, återanvänder registret, `byggForslag`, palettens och vyernas byggfunktioner.
- Rutten `POST /nav2/chatt` strömmar (SSE): rader om vad som hämtas, sedan
  texten med insatta tal, sist källraden. `tool_choice: auto`,
  `output_config.effort` satt per modell, `fallbacks: "default"` med betarubriken
  `server-side-fallback-2026-07-01` för Sonnet och Opus, `stop_reason` kontrolleras
  före innehållet. Systemtext och verktyg oförändrade mellan anrop; datum i användarens tur.
- Svarar 409 "Chatten är inte påslagen." när `chatt.pa` är av, och då svarar
  skrivrutan som paletten.

- [ ] **Steg 1: Skriv provet** med fejkad klient: av ger 409; en fråga om en
  person utanför kretsen ger verktygssvaret "Det får du inte se." och inget tal;
  tak nått ger 429 med skälet; loggraden skrivs med kostnad och obelagda;
  `forbered_uppgifter` skapar ingenting i `task`.
- [ ] **Steg 2–4:** kör migrationen, bygg, kör proven och `test:registerutdrag`.
- [ ] **Steg 5: Commit** `Chatten: loggen, verktygen och rutten (0304), avstängd`.

### Task 17: Chatten i skrivrutan och provet som väntar

**Filer:**
- Ändra: `src/nav2/utkast.html` (`hvChatt*`)
- Skapa: `scripts/chatt-prov.mjs`, `tests/chatt-fragor.json` (30 frågor med kända svar och de svåra fallen i spec)

- [ ] `NdHem.chatt: boolean` (sant bara när `chatt.pa` är på och nyckeln finns i miljön).
- [ ] Skrivrutan: när `ND.hem.chatt` är sant går frågan till `/nav2/chatt`,
  korten viker undan, raderna om vad som hämtas syns, talen är klickbara och
  visar källan, källraden "Skrivet av AI ur Navs tal", ett förberett utkast får
  knappen "Lägg i min dag" (befintliga rutten för uppgifter). Annars paletten.
- [ ] `scripts/chatt-prov.mjs` kör frågorna N gånger per modell och skriver en
  rad i `nav_chatt_prov` först när någon kör det med `--kor`. **Körs inte nu.**
- [ ] Prov i `test:nav2-hemvy`: med chatten av går skrivrutan till paletten.
- [ ] Rad i `src/navnyheter/poster.ts` först när chatten slås på (inte nu).
- [ ] `npx tsc --noEmit`, `npm test` gröna, NASTA_SESSION och ARBETSLOGG, en
  commit, push, previewn grön.
- [ ] Commit `Chatten: skrivrutan och provet som väntar`.

---

## Det som inte byggs nu, och varför

- **Steg 4** (trendregeln påslagen, månadens spann, fler kedjor) kräver data som
  inte finns: 60 avgjorda möten (tidigast slutet av december), ungefär åtta
  avslutade månader för ett spann, samtal med utfall. Regeln och takten räknar
  redan i det tysta från steg 1 och 2.
- **Steg 5** (samtalens innehåll) kräver en vald leverantör för utskrift, ett
  prov på tio samtal och beställarens godkännande av kostnaden.
- **Provet av Claude-modellerna** väntar på beställaren.
