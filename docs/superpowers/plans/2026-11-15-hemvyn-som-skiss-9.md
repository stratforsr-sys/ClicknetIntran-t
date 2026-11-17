# Hemvyn exakt som skiss 9: byggplan

> **För den som bygger:** använd superpowers:executing-plans (Native). Stegen har kryssrutor (`- [ ]`).

**Mål:** Nav 2.0:s nya hemvy (grenen `hemvy-chatt`) ska se ut och fungera exakt som skiss 9, i mörkt och ljust läge, med riktiga tal ur Nav.

**Arkitektur:** Allt utseende och beteende finns i blocket `NYA HEMMET (prefix hv)` i `src/nav2/utkast.html`, med CSS från rad ~8998. Talen räknas på servern i `src/lib/nav2/hem*.ts` och kommer färdiga till klienten via `ND.hem` och `/nav2/forslag?las=…`. Klienten räknar ingenting. Nya uträkningar (dagens plan, kedjan och orsakerna) blir rena TS-funktioner med egna prov.

**Teknik:** Next.js-rutter, Supabase (Postgres), utkastets vanliga JS och CSS, Claude-chatten i `src/lib/nav2/chatt/`.

**Spec:** skissen `~/nav-produkt/kundpresentation/skiss-9-hemvyn.html` (facit för utseendet) och beställarens beslut i skillnadslistan (`/private/tmp/claude-501/-Users-techgruoppensweden/9699593b-ed2c-499c-ab83-238e2e359c31/scratchpad/skillnader-skiss9.md`, punkterna 1–42 och beslutsdel 2).

## Ramar för hela bygget

- Exakt som skissen: avstånd, storlekar, texter, ordning och färger, i både mörkt och ljust läge. Det enda som avgör är skissens CSS-värden (rad 11–519).
- Exempeltalen ur skissen (412 000, 19 av 46, +3, 7, 25 min och så vidare) kommer aldrig in. Saknas ett tal visas inte raden. Inget tal hittas på.
- De tolv skydden i `~/CLAUDE.md` gäller: orsaker räknas av regler och visas med sitt belägg ("9 av 20 mot 5 av 40"), och "Varför vet jag inte" står där orsaken inte syns i datan.
- Ljust eller mörkt följer Nav:s egen inställning (`S.theme`, `data-theme` på `<html>`). Hemvyn och chatten har ingen egen tonknapp.
- Bifoga och Tala ska fungera på riktigt. Tala visas bara i webbläsare som har taligenkänning.
- Ingen `npm run build` och ingen `npm run dev`. Mellan stegen körs bara de berörda provfilerna och `npx tsc --noEmit` (felskrivningen Pling.tsx/pling.ts ignoreras). `npm test` körs en gång före push.
- Committa lokalt efter varje uppgift. Före push slås allt ihop till en commit. Ingen merge till main.
- Frågor mot produktionsdatabasen skriver bara ut antal.
- Uppgift 17 slår på `chatt.pa` och `forslag.pa`, med beställarens ja 2026-11-15. `hem.nytt` slås inte på för någon annan.
- Samma commit uppdaterar `docs/NASTA_SESSION.md` och `docs/ARBETSLOGG.md` och får en rad i `src/navnyheter/poster.ts`.

## Svarat av beställaren, se "Frågor" sist

F1 svar-ledet · F2 det gamla hemmets saker · F3 Möten-talet · F4 när förslagen syns · F5 provet om avtrycket ändras · F6 mobilprovet.

## Det granskningen ska titta extra på

1. **Ett ark som är längre än skärmen:** skrivrutan ska alltid synas och arket rulla inuti fönstret. Prov i uppgift 10.
2. **En dag utan möten, eller utan uppgifter med tid:** Min dag får inte påstå "Allt ryms" utan underlag. Prov i uppgift 12.
3. **En person utan eget mål, eller utan samtal i växeln:** Teamet visar inte "av N" och ingen färg i kedjan. Prov i uppgift 14.
4. **Byte av tema medan hemmet är öppet:** hemvyn byter ton direkt, utan omladdning. Prov i uppgift 1.
5. **Bifoga en för stor fil eller en fil av fel sort:** ett tydligt besked, och inget skickas. Prov i uppgift 8.

---

### Uppgift 1: Tonen följer Nav (punkt 3)

**Filer:** `src/nav2/utkast.html`, både hv-CSS och hv-JS. Prov: `tests/nav2-hemvy.mjs`.

- [ ] Prov "tonen följer Nav": blocket innehåller inte `nav2-hvton`, `hv-tonk` eller `data-hvton`. `hvHem()` ger `data-hvtema="ljus"` när `S.theme==='light'` och `"mork"` när det är `'dark'`. När det är `'auto'` följer det `matchMedia` (en attrapp som ger sant blir mörkt).
- [ ] Kör `node tests/nav2-hemvy.mjs`. Förväntat: provet faller.
- [ ] Ta bort `hvTon`, `.hv-tonk` och grenen `d.hvton` i `hvKlick`. Lägg till `const hvTema = () => S.theme === 'light' ? 'ljus' : S.theme === 'dark' ? 'mork' : (prfDatornMorkt() ? 'mork' : 'ljus')` och använd den i `hvHem`. Rita om när temat byts: `prfTemaSynk` och `themeSet` anropar redan `render()` eller får göra det.
- [ ] Kör provet. Förväntat: grönt. Committa.

### Uppgift 2: Överraden, alltid "på plats" och Stämpla in (punkt 1, 2 och 4)

**Filer:** `utkast.html` (`hvTopp`). Tas reda på: varför `TEAM` och `ND.tid.stamplar` är tomma för Zen (`teamNow0`, `smp`-blocket, `src/lib/nav2/tid.ts`). Prov: `tests/nav2-hemvy.mjs`.

- [ ] Ta reda på varifrån `TEAM` fylls och när `ND.tid.stamplar` är sant. Skriv orsaken i arbetsloggen.
- [ ] Prov "på plats syns alltid för den som leder": med 7 personer där ingen är inne ritar `hvTopp` `0<small>/7</small>` och stapeln. Med `ndKopplad('tid')` finns `hv-stamp`.
- [ ] Prov "Stämpla in finns": för en person som får stämpla visas knappen även när ingen stämpling är gjord i dag.
- [ ] Rätta datakällan så att laget kommer ur de anställda och dagens stämplingar, och så att Stämpla in visas för alla som har tidmodulen. Ingen annan kod ändras.
- [ ] Mät mot skissen i Chrome: datumet slutar där skissens slutar (x 1291 i 1440 bredd), och knappen ligger på x 1307. Committa.

### Uppgift 3: Hälsningen (punkt 6 och 7)

- [ ] Prov på CSS: `.hv-hero p` har `white-space:nowrap;overflow:hidden` och `gap:10px`, utan `flex-wrap`. `.hv-hero p>span` har `text-overflow:ellipsis`. I `@media (max-height:700px)` är `.hv-hero{padding-top:24px}`.
- [ ] Ändra CSS:en och lägg texten i `<span>` som i skissen. Kör provet. Committa.

### Uppgift 4: Korten, CSS (punkt 8–12, 20 och 40)

- [ ] Prov på CSS:
  - `.hv-card` saknar `min-height`
  - `.hv-chead{…align-items:baseline…}`, och märket `align-self:center`
  - `.hv-ftxt{…font-size:14.5px…max-width:46ch}`
  - `.hv-kfot` i Väntar har `color:var(--hv-ink-3)`, och `.hv-tal .hv-frad .hv-kfot` har `var(--hv-ink-2)`
  - `@media (max-height:700px)` har `.hv-rad{min-height:44px;height:44px}` och `.hv-ftxt{margin-top:8px}`
  - korten går till två kolumner först vid `max-width:860px`, inte vid 1180
  - `.hv-lugn` med bock är skissens: `border-top` och inget `min-height:60px` i korten
  - färgerna är skissens (punkt 39). I mörkt läge är `--hv-ink-3:#7C8E86` och `--hv-pop:rgba(16,31,26,.84)`. I ljust läge är `--hv-ink-3:#66746D`, `--hv-pop:rgba(255,255,255,.88)`, `--hv-signal:#D98A1C` och `--hv-danger:#C4473C`.
- [ ] Prov för texten: Väntar utan något kvar ritar bocken och "Inget väntar på dig just nu."
- [ ] Ändra CSS och text. Kör provet. Committa.

### Uppgift 5: Nav föreslår (punkt 14 och 15)

**Filer:** `src/lib/nav2/forslag.ts` eller `hemforma.ts` (där `ND.hem.forslag.oppna` byggs), `utkast.html` (`hvForeslar`). Prov: `tests/forslagforma.mjs` och `tests/nav2-hemvy.mjs`.

- [ ] Prov på servern: varje öppet förslag har `kort:{tal:string, vad:string, text:string, knapp:string}`. `tal` är ett belopp i kronor (formaterat `412 000`) när förslaget bygger på offertbelopp, annars ett antal. `vad` blir till exempel "kr står still" eller "möte i morgon är obekräftat". `knapp` är förslagets egen handling: "Visa listan" eller "Välj vad som händer".
- [ ] Prov i klienten: med två förslag ritar kortet `kort.tal`, `kort.vad`, `kort.text`, knappen `kort.knapp`, meta "1 av 2" och foten "1 förslag till". Utan förslag ritar det bocken och "Inga förslag just nu.", och ordet "avstängda" finns inte.
- [ ] Bygg `kort` ur förslagets egna fält. Saknas ett belopp blir `tal` ett antal. Kör proven. Committa.

### Uppgift 6: Det som ändrats-kortet (punkt 18 och 19)

**Filer:** `hemforma.ts` (`andrat`), `utkast.html` (`hvAndrat`). Prov: `tests/hemforma.mjs` (eller den fil som provar `andrat`) och `tests/nav2-hemvy.mjs`.

- [ ] Prov på servern: `ND.hem.forslag.andratKort = {foljs:number, nastaDom:'YYYY-MM-DD'|null, stort:{tal:string, vad:string}|null, text:string}`.
  - `stort` finns bara när den senaste domen har ett mätt tal (skillnaden per vecka i måttet, med tecken, till exempel `+3` och "möten i veckan").
  - `text` är högst två meningar ur domarna: den bästa och en som ser sämre ut.
- [ ] Prov i klienten:
  - med data ritar kortet meta "N följs", stora talet, texten och foten "Visa översynen" med "nästa dom 27 nov"
  - utan stort tal ritas varken talet eller en tom ruta
  - utan några ändringar ritas bara rubriken och foten "Berätta om en ändring", utan text
- [ ] Prov för arket (punkt 38):
  - inledningen är som skissens: "Jag följer N ändringar. **N ser bra ut** …"
  - huvudet har märket "N följs" och "nästa dom D MMM" till höger
  - varje rad har pil, text, källa, mått med dom och sin egen handling. "Pröva med laget" står på raden som har en bra dom och en ändring som gäller en person.
  - foten har bara "Har ni ändrat något som inte syns i Nav?" och "Berätta om en ändring"
- [ ] Bygg det. Kör proven. Committa.

### Uppgift 7: Genvägarna (punkt 21 och 22)

- [ ] Prov:
  - när chatten är på och ett möte återstår i dag står "Förbered HH.MM med <första ordet>" först, med märket
  - när inget möte återstår står "Vem ska jag ringa nu?"
  - när chatten är av finns inget av dem
  - Möten bär `<small class="num">N</small>` när N > 0, med N enligt F3
- [ ] Bygg det. Talet för Möten räknas på servern, inte i klienten. Kör provet. Committa.

### Uppgift 8: Skrivrutan, Bifoga, Tala och tipsraden (punkt 25–27)

**Filer:** `utkast.html` (`hvSkriv`, `hvChattFraga`), `src/app/nav2/chatt/route.ts` och `src/lib/nav2/chatt/*`. Prov: `tests/chatt-rutt.mjs`, `tests/chattforma.mjs` och `tests/nav2-hemvy.mjs`.

- [ ] Prov för rutan:
  - platshållaren är "Fråga Nav eller be om något…"
  - raden har Bifoga (`+`), tipset "Prova: Vad måste jag göra för att sälja mer?" som knapp, Tala (mikrofon, bara när `SpeechRecognition` eller `webkitSpeechRecognition` finns) och Skicka
  - `.hv-srad{margin-left:-8px}`
  - `.hv-botten` ligger kant i kant med fönstrets nederkant: rutans underkant är 20 px ovanför (prov på CSS, `bottom:0`)
- [ ] Prov för rutten:
  - en fråga får ha högst 3 bilagor, PNG, JPEG, WEBP eller PDF, högst 5 MB var
  - fel sort eller storlek ger 400 med "Filen går inte att skicka: …"
  - bilagan går till Claude som ett `image`- eller `document`-block
  - loggen sparar bara antal och sort, aldrig innehållet
- [ ] Bygg Bifoga med en dold `<input type=file accept="image/png,image/jpeg,image/webp,application/pdf" multiple>`. Bilagan visas som ett chip i rutan med "×".
- [ ] Bygg Tala med `SpeechRecognition` (`lang='sv-SE'`, `interimResults`). Den skriver in i rutan. Ett nytt tryck stoppar, och knappen visar läget.
- [ ] Tipset frågar chatten.
- [ ] Kontrollera avtrycket (`systemtext.ts`). Ändras det: se F5. Kör proven. Committa.

### Uppgift 9: Knappen Nästa att göra (punkt 28)

- [ ] Prov på CSS: i hemvyn är `.todopill.min` 46×46 och ligger `right:28px;bottom:28px`. Ringen är 38 px (`inset:4px`), och texten är `600 11px`.
- [ ] Ändra CSS:en bara under `body:has(.main.hvmode)`. Kör provet. Committa.

### Uppgift 10: Fönstret, arken och tråden (punkt 29, 30 och 37)

**Filer:** `utkast.html` (`hvHem`, `hvArk`, `hvOppna`, `hvArkChatt` och CSS). Prov: `tests/nav2-hemvy.mjs`.

**Gränssnitt:** `S.hv.lage: 'hem'|'ark'|'trad'`. `S.hv.trad: Array<{sort:'team'|'andrat'|'forslag'|'manad'|'chatt', id?:string, nr:number}>`. `hvTill(sort, id)` lägger till i tråden och visar inlägget från början. `hvStang()` går hem utan att tömma tråden. Tråden töms när sidan laddas om, som i skissen.

- [ ] Prov:
  - `.hv-fonster` är `height:100dvh` med `overflow:hidden`
  - arket och tråden rullar i `.hv-scen` med `overflow-y:auto`
  - skrivrutan står utanför den rullande ytan
- [ ] Prov för ark som Väntar, Min dag och Veckan: huvudet är märket, `#arktext` och "Stäng" med `<kbd>esc</kbd>` till höger. Ytan `.hv-arkyta` är ett glas i full bredd, och genvägarna syns inte.
- [ ] Prov för tråden (Teamet, Ändrat, förslagen och chatten): överst står "← Hem" (pil, `i-left`) och chippet "• N brinner", eller "Inget brinner" med grön prick. Öppnas Teamet och sedan Ändrat ligger båda i tråden i den ordningen. En chattfråga läggs efter dem.
- [ ] Bygg det. Det gamla `hvArkTopp` med "‹ Hem" tas bort. Kör provet. Committa.

### Uppgift 11: Hela listan bakom Väntar på dig (punkt 31–33)

**Filer:** `src/lib/nav2/hem.ts` (raden får `min` ur `task.estimate_minutes`), `utkast.html` (`hvArkVantar`). Prov: `tests/nav2-hemvy.mjs` och provet för hem.ts.

- [ ] Prov på servern: en uppgiftsrad har `min:number|null` ur `estimate_minutes`.
- [ ] Prov i klienten:
  - rubriken är "Fem saker väntar på dig. **Två saker brinner.**", med siffran i ord upp till tio (`hvOrd`)
  - grupperna heter "Nu", "Senare i dag" och "Kan vänta", med antal
  - foten säger "Det som brinner tar ungefär 25 min." bara när varje sak som brinner har `min`, och knappen heter "Alla uppgifter" och går till Uppgifter
  - ingen Lyssna-knapp
  - det som F2 säger
- [ ] Bygg det. Kör proven. Committa.

### Uppgift 12: Min dag som ark (punkt 23)

**Filer:** ny `src/lib/nav2/hemdag.ts`, `hem.ts` (skickar dagens plan i `ND.hem.dag`), `utkast.html` (`hvArkDag`, genvägen Min dag med `data-hvark="dag"`). Prov: ny `tests/hemdag.mjs` (`node --experimental-strip-types`) och `tests/nav2-hemvy.mjs`.

**Gränssnitt:** `planeraDag({moten, uppgifter, nu, start, slut, lunch}) → {rader: Array<{a:number, b:number, typ:'mote'|'upg', id, namn, not?, brinner?:boolean}>, utanTid: Uppgift[], luft: number|null, kanVanta:number}`. Tiderna räknas i minuter från midnatt. `start`, `slut` och `lunch` kommer ur tidreglerna (`tidregler.ts`). Saknas de blir `luft` null.

- [ ] Prov för `planeraDag`:
  - mötena står på sina tider
  - uppgifterna läggs i luckorna efter `nu`, det som brinner först, var och en med sin `estimate_minutes`
  - en uppgift som inte ryms före `slut` hamnar inte i dagen
  - uppgifter utan tid hamnar i `utanTid`
  - `luft = slut − nu − lunch − summan av det som är kvar`, och är null om något saknar tid eller tidreglerna saknas
- [ ] Prov för arket:
  - rubriken är "Tre möten kvar och tre saker som väntar. **Allt ryms, med 2 h 19 min över.**" Utan `luft` faller den sista meningen bort.
  - stapeln `.hv-dbar` går 08–17 med skalan, och strecket "nu" ligger rätt
  - nästa rad är markerad med "om X min"
  - nästa möte har "Förbered", som frågar chatten
  - foten har länken "N saker kan vänta och ligger inte i dag" (till hela listan) och "Boka tiden i kalendern"
- [ ] Prov för bokningen: "Boka tiden i kalendern" lägger uppgifternas tider som händelser i Navs kalender via den befintliga kalenderrutten. Kvittot "Tiden för uppgifterna är bokad i din kalender." har Ångra, som tar bort just de händelserna.
- [ ] Bygg det. Kör proven och `tsc`. Committa.

### Uppgift 13: Veckan som ark (punkt 24)

**Filer:** `hem.ts` (`ND.hem.vecka`: fem vardagar med kalenderns poster `[timme, namn]`, borta och det med frist i veckan), `utkast.html` (`hvArkVecka`). Prov: `tests/nav2-hemvy.mjs` och provet för hem.ts.

- [ ] Prov på servern: veckan är den här veckans måndag till fredag på en vardag, och nästa vecka på en helgdag. Varje dag har `{dag:'Mån', datum:'16 nov', idag:boolean, poster:[[9,'Nordic Grön & Mark'], …]}`.
- [ ] Prov i klienten:
  - fem kolumner `.hv-dag` med rubrik, "i dag" och datum, "N i kalendern" och posterna som `<i>` med `top:${(t-8.5)/8.5*100}%`
  - dagen i dag öppnar Min dag
  - rubriken är "Veckan som kommer, **v.47**. 18 i kalendern, ingen borta, en sak att få klart."
  - foten är "Att få klart i veckan: **…**" med en knapp till sakens vy
  - inget annat i arket
- [ ] Ta bort det gamla innehållet (Nästa arbetsdag, kvällsnotisen och dagens slut) enligt F2. Kör proven. Committa.

### Uppgift 14: Teamet i månaden, kedjan, målen och orsakerna (punkt 16, 34–36)

**Filer:** ny `src/lib/nav2/kedja.ts`, `hem-team.ts`, `utkast.html` (`hvArkTeam` och kortet). Prov: ny `tests/kedja.mjs` och `tests/hem-team.mjs`.

**Gränssnitt:** `kedja(veckor: Array<{samtal, svar, bokade, hallna, order}>) → {led:Array<'n'|'u'|'d'|null>, orsak:{text, belagg}|null}`. Ett led är `'d'` när båda de två senaste veckorna ligger under personens eget spann (minsta och största av de åtta veckorna före), och `'u'` när båda ligger över. Ett led utan data är `null`. Svar enligt F1.

Orsaksreglerna, i den här ordningen. Den första som stämmer gäller:
- hållna `d` och bokade `n` ger "Möten uteblir", belagt med "X av Y möten uteblev, mot A av B före"
- bokade `d` och svar `n` ger "Färre svar blir möten"
- svar `d` och samtal `n` ger "Färre samtal besvaras"
- samtal `d` ger "Färre samtal"
- order `d` och hållna `n` ger "Färre möten blir order"

Förklaringen slutar alltid med "Varför vet jag inte." när ingen regel säger varför.

**Status mot eget mål:** `forvantat = mal × gått/totalt`.
- "Före sitt mål" när `order ≥ forvantat + 1`
- "Efter sitt mål" när `order ≤ forvantat − 1`
- annars "I takt"
- utan mål står ingen status och inget "av N"

- [ ] Prov för `kedja`, med fasta veckor för varje regel, för `null` och för att färg kräver två veckor i rad.
- [ ] Prov för `hem-team`:
  - varje person har `{namn, fornamn, mal|null, order, status|null, led, orsak, forklaring, kommentar|null}`
  - laget har `saknarUtfall` (antal möten utan utfall), `tillMalet` (`{kvar, dagar, perDag, hittills}` när ett mål finns) och `facit[]` med `{manad, sa (takten efter 10 dagar), blev, skillnad}`
- [ ] Prov för arket:
  - mätaren med `≈N i samma takt · M mål` när målet finns
  - en rad per person: förnamn, kedjan, "7 av 12", status och orsaken, med chevron som fäller ut förklaringen och personens egen rad
  - raden "Kedjan: samtal · svar · bokade · hållna · order. Färg = utanför eget spann två veckor i rad."
  - "Det här ser jag inte: vad som sägs i samtalen. N möten saknar utfall." med "Visa dem" som går till Möten
  - Facit: "Takten sa X" / "Det blev Y" / "N fler" eller "N färre", med "efter 10 arbetsdagar"
  - "**Till målet.** …" bara med mål
  - "Visa underlaget" fäller ut orderna som talet bygger på
  - "En åtgärd" eller "N åtgärder" med Godkänn när laget har öppna förslag (via `hvValj`)
  - inget annat
- [ ] Kortet: med mål står "av M order" och mätaren. Utan mål står bara antalet, utan raden "Inget mål satt", eftersom beställaren sätter målen.
- [ ] Bygg det. Kör proven och `tsc`. Committa.

### Uppgift 15: Menyraden som skissen (punkt 42)

**Filer:** `utkast.html` (`renderRail` rad ~25864 och CSS `.rls-*`). Prov: de befintliga provfilerna för menyraden (`grep -l renderRail tests/`) och `tests/nav2-hemvy.mjs`.

- [ ] Prov:
  - märket med "nav" och företagsnamnet, och klockan med antal till höger
  - sökrutan är en ruta med ram, "Sök" och `<kbd>⌘K</kbd>`
  - grupperna har rubriker (`rhead`) med samma poster som i dag
  - antalen står i mono till höger, och den aktiva posten har en markör till vänster
  - profilen ligger längst ned med bokstav, namn, roll och upp/ned-ikon
  - raden "Sidopanel" har de tre lägena Utfälld, Hopfälld och Hovra
  - alla mått är skissens (rad 52–113)
- [ ] Bygg det utan att ta bort något: varje post, räknare och genväg finns kvar. Kör alla prov för menyraden. Committa.

### Uppgift 16: Mobil (punkt 41)

Mönstret hos Claude, ChatGPT och Gemini: hälsningen överst, skrivrutan fast längst ned i full bredd med bara de övre hörnen rundade, och förslagen som en rad som går att svepa. Skrivrutan ligger kvar i flödet (`100dvh`), så att ytan krymper när tangentbordet kommer i stället för att gissa höjden. Nederkanten har `env(safe-area-inset-bottom)`.

- [ ] Prov på CSS i `@media (max-width:860px)`:
  - `.hv-fonster` är en kolumn i `100dvh`, där korten och arken rullar och skrivrutan står sist
  - `.hv-skriv` har `border-radius:20px 20px 0 0`, `max-width:none` och `padding-bottom:calc(10px + env(safe-area-inset-bottom))`
  - `.hv-genv` har `overflow-x:auto;flex-wrap:nowrap;justify-content:flex-start;scrollbar-width:none`
  - korten ligger i en kolumn med 12 px mellanrum, och Veckans kolumner blir en lista per dag
  - Nästa att göra lyfts över rutan
- [ ] Bygg det. Prova i mobilbredd enligt F6. Committa.

### Uppgift 17: Påslaget, med beställarens ja

- [ ] Läs avtrycket för den kod som pushas. Ändrades det i uppgift 8: kör provet först (F5).
- [ ] Godkänn den Sonnet-rad i `nav_chatt_prov` som har samma avtryck: `godkand=true`, `godkand_av=` Zens id, `godkand_nar=now()`. Sätt sedan `chatt.avtal` och `chatt.pa` i `nav_setting`. Kontrollera att databasen tog emot det: skriv ut antalet rader med `godkand=true` och nycklarna.
- [ ] Sätt `forslag.pa=true` via Inställningar → Nya hemmet i previewn, och kontrollera nyckeln. F4 säger när förslagen syns.

### Uppgift 18: Klickprov, dokument och push

- [ ] Kör `npm test` en gång. Förväntat: allt grönt.
- [ ] Uppdatera `docs/NASTA_SESSION.md` och `docs/ARBETSLOGG.md`, och lägg en rad i `src/navnyheter/poster.ts`.
- [ ] Slå ihop alla lokala commits till en, med `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Pusha till `hemvy-chatt`.
- [ ] Vänta tills bygget är grönt (commit-status).
- [ ] Klickprova i Chrome mot skissen, sida vid sida, i mörkt och ljust läge: hemmet, varje kort, varje ark, tråden, genvägarna, Bifoga, Tala, tipset, Nästa att göra och Inställningar → Nya hemmet. Mät samma element med skript i båda flikarna, och spara en skärmbild av varje ställe.
- [ ] Varje skillnad som finns kvar rättas i en ny runda: prov, rättelse, `npm test`, en ny squashad push.
- [ ] Låt `hem.nytt` stå tills beställaren säger att klickprovet är klart.

---

## Frågor till beställaren

- **F1, svar i kedjan:** växeln (Lynes) säger inte om ett samtal blev besvarat. Alla 5 279 samtal de senaste 30 dagarna har utfallet "okänt", och 5 270 har en samtalstid över 0. Ska ledet "svar" (a) räknas som samtal med minst N sekunders samtalstid, där du säger N, eller (b) stå som "ser jag inte" tills växeln skickar utfallet?
- **F2, det gamla hemmets saker:** skissen har inte de här:
  - Stämmer inte och Visa inte här på raderna i hela listan
  - raden "Sedan du tittade…"
  - Veckans Nästa arbetsdag, kvällsnotisen och dagens slut
  - Navs facit per val i Teamet
  
  Ska de bort helt (exakt som skissen), eller flyttas, till exempel Stämmer inte bakom ett högerklick och kvällsnotisen till Inställningar?
- **F3, Möten 7:** vad ska talet räkna? Förslag: mötena i Möten som väntar på dig (obekräftade och sådana som saknar utfall), samma tal som Möten får i menyn.
- **F4, förslagen:** jobben som skapar förslag körs av produktionens nattjobb (`/api/jobb/natt`), som bara har main-koden. `forslag.pa` blir därför på direkt, men förslagen syns först efter mergen till main. Går det bra, eller ska jobbet köras för hand från previewn en gång?
- **F5, provet:** om Bifoga ändrar chattens avtryck måste provet köras om, för ungefär 6 kr. Okej?
- **F6, mobilprovet:** Chrome-fönstret här går inte att göra smalare, och previewn går inte att visa i en ram. Mobilen provas i din telefon, eller så gör du fönstret smalt en stund.

## Beställarens svar (2026-11-15)

- **F1:** (b) "ser jag inte". Ledet svar är alltid `null` tills växeln skickar utfallet.
- **F2:** knappen Mer får Golvet, Teamet i november och Coachning. Allt öppnas i chattrutan (tråden), ingen vy byts. Statistik öppnas också i chattrutan senare, som en dashboard. Det väntar, och Statistik lämnas som i dag. Det gamla hemmets saker som skissen saknar tas bort.
- **F3:** ja, möten som väntar på dig (obekräftade och sådana som saknar utfall).
- **F4:** kör nattjobbets förslagsdel för hand en gång.
- **F5:** provet körs när allt är byggt, före mergen till main.
- **F6:** fönstret görs smalt. Mobilen ska vara som Claude: korten blir mycket mindre och får plats som på datorn, fast i mobilen.
- **Utförande:** Native, utan underagenter.
