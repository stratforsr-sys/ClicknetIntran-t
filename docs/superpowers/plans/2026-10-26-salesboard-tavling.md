# Säljtavlan: månadens tävling — plan

> Utförs i den här sessionen (Native, inga subagenter enligt beställarens regel). Stegen bockas av i ARBETSLOGG.

**Mål:** Superadmin lägger upp månadens tävling i Nav 2.0 (pris, bild, kvalgräns, brytaren På). Tavlan visar
mellanspelet, knuffen, gränsscenen och vinnaren. Står brytaren på Av visas ingenting av tävlingen.

**Arkitektur:** Inställningen ligger i `nav_setting.salesboard.tavling`. Bilden ligger som egen rad
`nav_setting` `salesboard.bild.<id>` (JPEG, beskuren till 4:5 i webbläsaren) och serveras av
`/salesboard/bild`. Servern lägger `tavling` och `vinnare` i ögonblicksbilden. Klienten räknar
loppet ur `Siffror`. Planeringen (regler.ts) ger knuff och gräns, och Tavla.tsx lägger in mellanspel och
vinnare när tavlan är lugn. Kompositionerna går i den befintliga bildrutemotorn.

**Spec:** `docs/superpowers/specs/2026-10-26-salesboard-tavling-design.md`, plus beställarens tillägg
2026-10-26: brytaren På av stänger av alla tävlingsscener på tavlan, också de som väntar i kön.

## Globala villkor

- Pris högst 60 tecken. Bilden JPEG/PNG/WebP, högst 5 MB in, sparas som JPEG i 800×1000 (4:5).
- Kvalgräns inom `MAL_GRANSER` eller tom (ingen gräns).
- Mellanspelet var 10:e minut (var 5:e när högst 4 arbetsdagar är kvar), tyst, bara inom arbetsdagen.
- Knuff: högst en gång per säljare och dag. Gräns: en gång per säljare och månad.
- Inom räckhåll: högst 3 snittorder bakom, högst två utöver ledaren.
- Dolda säljare är aldrig med.
- Inga lokala byggen. Prov: `TZ=UTC node --experimental-strip-types tests/<fil>.mjs`.

## Granskningsfokus

1. Brytaren slås av medan en knuff väntar i kön: den spelas inte (`aktuell`).
2. En dold säljare leder på ordervärde: ledaren är nästa synliga, och den dolda knuffar aldrig.
3. En gammal `salesboard.minne` utan de nya fälten: den läses, och ingenting firas två gånger.
4. Lika i ledningen: "delar ledningen", ingen knuff mellan dem.
5. Månad utan order, eller en order utan belopp: inget mellanspel, ingen division med noll.

## Uppgifter

### 1. Inställningen och skrivvägen
- `typer.ts`: `Tavling = {pa, pris, bild, grans}`, `TavlansInstallningar.tavling: Record<string, Tavling>`,
  `Testtyp` + `"tavling" | "knuff" | "grans"`.
- `installningar.ts`: `tavlingen()` läser och klipper (36 månader, pa kräver pris, `TAVLING_GRANSER`),
  `tavlingFor(t, manad)` ger månadens påslagna tävling eller null. Ärvs inte.
- `skrivning.ts`: regeln `tavling` (månad → grupp pa/pris/grans, null tar bort), text-regeln,
  belopp-eller-null-regeln, `FEL.prisKravs`, bild avvisas i `spara`. Ny handling `bild {manad, data}`.
- `handlingar.ts`: `bild` lägger upp raden, sparar id:t och tar bort den gamla bilden.
- Rutt `src/app/salesboard/bild/route.ts`: `tavlansAtkomst`, 24 hex, `immutable`.
- Prov i `tests/salesboard-installningar.mjs`.

### 2. Ögonblicksbilden
- `Ogonblick.tavling: {pris, bild, grans, dagarKvar} | null`. `Ogonblick.vinnare: {manad, pris, bild,
  personer[], varde} | null`, bara första arbetsdagen. `installningar` utan `tavling`.
- `tavlan.ts` läser förra månadens order den dagen. `forma.ts` räknar vinnaren utan dolda och mot gränsen.
- Prov i `tests/salesboard-server.mjs`.

### 3. Loppet och planeringen
- Ny ren modul `src/app/salesboard/tavling.ts`: `lopp()`, `orderOrd()`, `mellanspelDags()`, `vinnareDags()`.
- `regler.ts`: `Firande` + `grans`/`knuff`/`tavling`/`vinnare`. `Minne` + `knuff`, `grans` och `vinnare`.
  Gamla minnen läses med standarder. Planeringen sker i kön mellan ordern och målet.
- `ko.ts`: `aktuell` släpper tävlingsposter när brytaren är av, och `forlopp` ger data för de fyra.
- Prov i `tests/salesboard.mjs` och `tests/salesboard-ko.mjs`.

### 4. Kompositionerna
- `motion/Tavlingen.tsx`: mellanspelet och vinnaren. `motion/Knuffen.tsx`: knuffen och gränsen.
- Tider och ljud står i `tider.ts`, prov i `tests/salesboard-motor.mjs`. CSS står i `tavla.css`.
- Tavla.tsx lägger in mellanspelet och vinnaren, förladdar bilden (`decode`) och tar med de nya testtyperna.

### 5. Nav 2.0-kortet "Tävling"
- `ndsb.js`: kortet mellan Månadsmål och Visning, med två månader. Varje månad har På, Pris, Kvalgräns och
  Bild (beskärning i canvas) och läget just nu. Testkortet får knapparna Mellanspelet, Knuffen och Gränsen.
- `saljtavlan.ts`: `facit.lopp` (topp tre och antal över gränsen).
- Sidprov i headless Chrome med låtsasservern.

### 6. Selen, skärmbilder, dokumentation och push
- Selen: fallen `tavling`, `knuff`, `grans` och `vinnare`. Varje scen ses på skärm.
- ARBETSLOGG, NASTA_SESSION och poster.ts. En commit. Push till `nav2-utkast` och Vercel-bygget.
