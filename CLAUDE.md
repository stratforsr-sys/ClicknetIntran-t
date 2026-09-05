# Clicknet Nav — arbetsregler

Läs `docs/NASTA_SESSION.md` först (kort lägesbild), sedan `docs/ARBETSLOGG.md`
(historiken med varför-resonemangen). Uppdatera båda efter passet.

## EN COMMIT PER ÄNDRING — ALDRIG EN PER FIL

Arbetet sker via GitHub API utan lokal klon. En `PUT` mot Contents API är **en
commit**, och varje commit på en bevakad branch är **en Vercel-deploy**. En
ändring i trettiofem filer skriven fil för fil blir trettiofem deployer.

Projektet ligger på Vercels fria plan: **100 deployer per dygn**. Tar kvoten slut
svarar både git-integrationen och `vercel redeploy`
`402 api-deployments-free-per-day`. Det är en **plangräns, inte ett fel** — den
går inte att trycka igenom med omförsök. Och då går det inte längre att
verifiera någonting alls, vilket är det dyra: det hände 2026-09-04 mitt i ett
pass, och halva ändringen blev obyggd.

Skriv därför hela passets ändring som **en enda commit**. Använd
`scripts/en-commit.mjs`, som gör blobs, ett träd ovanpå grenens nuvarande, en
commit och en ref-uppdatering:

```
node scripts/en-commit.mjs <branch> "<meddelande>" \
  /tmp/ny-notiser.ts:src/lib/notiser.ts \
  /tmp/ny-klocka.tsx:src/components/shell/Notisklocka.tsx
```

`--torrkor` visar vad som skulle hänt, `--radera <sökväg>` tar bort en fil i
samma commit. Skriptet vägrar skriva en tom commit — ett träd identiskt med
grenens betyder att ingen fil faktiskt ändrats, och den commiten hade kostat en
deploy för ingenting.

Ett pass blir då en deploy i stället för trettiofem, och historiken säger vad
som byggdes i stället för i vilken ordning filerna råkade skrivas.

## Branch före main

Arbete går **inte** direkt till `main`. Skapa en branch, låt Vercel bygga
previewen, och merga först efter uttryckligt godkännande.

Preview: `https://clicknet-nav-git-<branch>-zens-projects-6c1be12b.vercel.app`.
Adressen kräver webbläsare — Vercels deployment protection ger 302 på curl.

**Previewen pekar på PRODUKTIONSDATABASEN.** Det finns ett Supabase-projekt, inte
ett per miljö. Håll migrationer additiva så `main`-koden aldrig rör de nya
tabellerna, och stäm av innan testdata skapas.

## Inga lokala byggen

Kör aldrig `npm run build` eller `npm run dev` lokalt. Vercel är bygget, och ett
kompileringsfel ersätter aldrig den live-version som körs. Undantaget är när
kvoten ovan är slut och ändringen annars blir helt overifierad — då går klon +
`npm ci` + `npx tsc --noEmit` + `npm run build` i en katalog som raderas
efteråt. Fråga först.

## Migrationer

Handskriven SQL, aldrig via Supabase-gränssnittet. Numret är taget när
migrationen **körts**, inte när branchen mergats — fråga
`select name from schema_migrations order by name desc limit 5`, inte
`ls supabase/migrations` på main. Flera brancher lever samtidigt mot samma
databas.

```
set -a; . ~/.clicknet/nav.env; set +a
node scripts/apply-sql.mjs 0047_notishandelser
```

Varje migration bokförs med checksumma. Skriv satserna omkörbara
(`drop policy if exists` före `create`).

## Två register som inte får glömmas

- **`src/navnyheter/poster.ts`** — allt nytt som byggs får en rad överst, i
  samma commit som funktionen. Skriv den för mottagaren, inte för utvecklaren.
  Slugen får aldrig ändras när posten är ute.
- **`tests/notiser-tackning.mjs`** — varje exporterad server action ska stå
  bokförd som `"notifierar"`, `"harledd"`, eller med en mening om varför den
  inte notifierar någon. Provet faller på en action som ingen tänkt på.

## Definition of Done

`npm test` ska gå igenom, och `node tests/rls.mjs` efter varje ändring i RLS
eller i en server action — det provet skapar riktiga användare med olika roller
och mäter vad de faktiskt får ut.
