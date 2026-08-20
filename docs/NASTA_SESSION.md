# Läs detta först

Kort överlämning mellan sessioner. `docs/ARBETSLOGG.md` har hela historiken och
varför-resonemangen; det här är bara läget just nu och vad som står på tur.

**Senast uppdaterad:** 2026-08-20

---

## Arbetsregler i det här repot

- **Inga lokala byggen eller kloner** — allt ska gå direkt mot GitHub-repot.
  Verifieringen är Vercels egen build: en trasig build ersätter aldrig den
  version som körs.
  *Avvikelser som är kända av användaren:* när Vercels webhook hängde klonades
  repot till en scratchpad för `tsc`, `npm test` och `vercel deploy --prod`.
  Migrationer och tester körs också från en scratchpad, eftersom de behöver
  `pg` och `DATABASE_URL`.
- Committa som `stratforsr-sys <stratforsr@gmail.com>`.
- Pusha rakt till `main`. Inga feature-branches. `main` deployar automatiskt
  till Vercel.
- Migrationer är handskriven SQL i `supabase/migrations/`, körs med
  `node --env-file=$HOME/.clicknet/nav.env scripts/apply-sql.mjs`. Aldrig
  `prisma migrate` eller motsvarande.
- Nycklar ligger i `~/.clicknet/nav.env`.
- ASCII i kodkommentarer och commit-meddelanden. Svenska i allt som en
  människa läser i produkten.
- Läs `docs/ARBETSLOGG.md` före arbete, uppdatera den efteråt.

## Kör testerna

```
set -a && . $HOME/.clicknet/nav.env && set +a && npm test
```

Elva sviter. `tests/rls.mjs` går mot den **riktiga** databasen och skapar och
städar sina egna användare (prefix `rlstest+`). Den rör aldrig driftdata — det
som måste provas skarpt görs i en transaktion som rullas tillbaka.

`tests/registerutdrag.mjs` behöver `DATABASE_URL`: den frågar schemat efter
främmande nycklar och jämför dem mot utdragets lista.

---

## Läget i produktion

| Sak | Status |
|---|---|
| In- och utstämpling | **Påslagen.** `compliance_gate.stampling` |
| Raststämpling | Avstängd. Kräver K12 + K14 + rastschema |
| Sen ankomst | Påslagen, tolerans 1 minut, larm samma dag till chef |
| Nattjobb | Ett jobb, `/api/jobb/natt`, 02:30. Hämtar igen 14 dygn bakåt |
| Lönerapport | Klar, med attest och oföränderlig period |
| Personalärenden | Klara, med SLA och konfidentialitet |
| Tvingat lösenordsbyte | **Spärr i databasen sedan 2026-08-20.** Se nedan |
| Startsida | Rollstyrd. Chefens kö, säljarens stämpelknapp |
| Bottennavigering | Under 768 px: Hem, Sök, Stämpla, Mer |
| Registerutdrag | Klart. `/profil` → Hämta registerutdrag |

### Två saker användaren själv måste göra

1. **Zen står instämplad sedan måndag 2026-08-17 18:08.** Dagen lämnades
   avsiktligt öppen — schemat slutar 17:00, så en autostängning hade satt
   utstämplingen före instämplingen. Den behöver en rättelse, annars blockerar
   den löneperioden. Samma stämpling gav en registrerad sen ankomst på 548
   minuter som ser ut att vara ett test.
2. **Supabase-panelen**: Site URL pekar fortfarande på localhost,
   registreringen är öppen, och det delade lösenordet är inte bytt.

---

## Vad som byggdes 2026-08-20 (andra passet)

### Lösenordstvånget är nu en spärr i databasen — KLART

Migration `0017`. Provet som överlämningen bad om visade att tvånget bara satt i
mellanvaran: ett flaggat konto som gick rakt på API:t fick ut sin egen rad ur
`employee` och ett dokument ur `document`. Nu ger varje tabell noll rader.

Villkoret bor i `public.kraver_losenordsbyte()` och läser flaggan ur JWT:n. Det
sitter i de fem hjälpfunktioner som nästan varje policy går genom, plus i de
fem policyer som inte frågar någon av dem.

**Gränsen går vid API:t, inte vid servern.** `getCurrentUser()` och
`behoverSteg2()` faller tillbaka på service role just för flaggade konton — utan
det tappar `/byt-losenord` namnkontrollen i lösenordsregeln, och steg två skulle
hoppas över för ett flaggat chefskonto. Rör inte det utan att läsa kommentarerna
i `src/lib/auth.ts` och `src/lib/supabase/middleware.ts`.

15 nya kontroller i `tests/rls.mjs`.

### `scripts/krav-losenordsbyte.mjs` — KLART

Sätter flaggan på konton som redan fanns. Torrkörning är normalläget:

```
node --env-file=$HOME/.clicknet/nav.env scripts/krav-losenordsbyte.mjs --alla
node --env-file=$HOME/.clicknet/nav.env scripts/krav-losenordsbyte.mjs --kor anna@clicknet.se
```

Kör den på dem som fått ett tillfälligt lösenord upplåst. **Den som flaggas
måste kunna sitt nuvarande lösenord** — bytessidan kräver det. Den som inte kan
det behöver ett nytt tillfälligt lösenord från personalkortet i stället.

De två konton som finns idag (`simon@`, `zen@`) är **inte** flaggade. Det är ett
val: de kan redan sina lösenord, och det finns ingen anledning att tvinga dem
förrän säljarna läggs upp.

### E5 startsida, bottenrad och hopfällbar panel — KLART

E5.1, E5.4, E5.5, E5.6. Kvar i E5: **E5.2 nyhetsinlägg**, **E5.3 under 1,5 s på
4G** (aldrig mätt) och **E5.7 notissystem med ångra**.

### E6.4 registerutdrag — KLART

`/personal/[id]/registerutdrag` ger JSON. Länk på `/profil`. Filbilagor saknas
tills Storage finns (E2.12).

`tests/registerutdrag.mjs` jämför listan mot databasens främmande nycklar och
faller när en ny kolumn pekar på `employee` utan att vara redovisad. **Lägger du
till en tabell med persondata måste den in i `src/lib/registerutdrag.ts`** —
annars faller provet, vilket är hela poängen.

---

## Vad som står på tur

I prioritetsordning för att få säljarna igång.

1. **Supabase-panelen** — användarens eget arbete, men påminn.
2. **X7 pilot** med tre personer i två veckor innan bredd.
3. **E5.2 nyhetsinlägg** med målgruppsstyrning. Sista biten av startsidan.
4. **E1.8** öppna ärenden avslutas med notis vid offboarding. Spärren är borta
   sedan E3 finns.
5. **E8.9 kursinnehåll** — åtta kurser ska skrivas. Ingen kod, men det är det
   som gör att 25 säljare kan lära sig samma sak utan att du upprepar dig.
6. **E2.13 global sökning** i toppraden.
7. Därefter #9 Storage-spåret, E7 frånvaro, E10+E9 rekrytering.

### E6.2 gallringsjobbet är blockerat, inte bortglömt

`retention_until` finns inte som kolumn någonstans. Att bygga jobbet betyder att
först bestämma vilka tabeller som ska bära en gallringsfrist och hur lång den
är. Det är **P0.6 registerförteckningen** som ska svara på det, och den är inte
skriven.

Ett gallringsjobb med påhittade frister raderar personaldata enligt en gissning
och ser samtidigt ut att uppfylla K10. Bygg det inte förrän fristerna finns.

### Pausat på användarens uttryckliga begäran

Spåren **E0.8 transaktionell e-post**, **notiser** och **domän** är pausade
("skippa mejl grejen helt", "glöm domän"). Ta inte upp dem igen utan att bli
tillfrågad.
