# Läs detta först

Kort överlämning mellan sessioner. `docs/ARBETSLOGG.md` har hela historiken och
varför-resonemangen; det här är bara läget just nu och vad som står på tur.

**Senast uppdaterad:** 2026-08-20

---

## Arbetsregler i det här repot

- **Inga lokala byggen eller kloner** — allt ska gå direkt mot GitHub-repot.
  *Avvikelse som är känd av användaren:* när Vercels webhook hängde klonades
  repot till en scratchpad för att kunna köra `tsc`, `npm test` och
  `vercel deploy --prod`. Det är disponerat och redovisat, inte glömt.
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

Tio sviter. `tests/rls.mjs` går mot den **riktiga** databasen och skapar och
städar sina egna användare (prefix `rlstest+`). Den rör aldrig driftdata — det
som måste provas skarpt görs i en transaktion som rullas tillbaka.

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
| Tvingat lösenordsbyte | **Nytt 2026-08-20.** Se nedan |

### Två saker användaren själv måste göra

1. **Zen står instämplad sedan måndag 2026-08-17 18:08.** Dagen lämnades
   avsiktligt öppen — schemat slutar 17:00, så en autostängning hade satt
   utstämplingen före instämplingen. Den behöver en rättelse, annars blockerar
   den löneperioden. Samma stämpling gav en registrerad sen ankomst på 548
   minuter som ser ut att vara ett test.
2. **Supabase-panelen** (uppgift #2): Site URL pekar fortfarande på localhost,
   registreringen är öppen, och det delade lösenordet är inte bytt.

---

## Vad som byggdes 2026-08-20

### 1. Behörighetsprov för `late_arrival` och `compliance_gate` — KLART

Commit `53fff70`. De två tabellerna hade byggts utan den RLS-täckning
Definition of Done p. 4 kräver. 34 nya kontroller i `tests/rls.mjs`.

Provet går hela vägen fram till ett **lyckat** påslag av raststämplingen, i en
rullad transaktion — en spärr som aldrig går att öppna är inte en spärr utan
ett oupptäckt fel.

Sidoupptäckt: tre gamla kontroller räknade rader med `=== 3` och `=== 2` och
föll så fort det fanns riktiga ärenden och löneperioder i databasen. De letar
numera efter sina egna id:n.

### 2. Tvingat lösenordsbyte vid första inloggningen — KLART

Uppgift #14. Tillfälliga lösenord gick tidigare att behålla för alltid, och de
är kända av chefen som läste upp dem.

**Så fungerar det**

- Flaggan bor i auth-kontots `app_metadata`, nyckel `byt_losenord`. Se
  `src/lib/losenordsbyte.ts` för varför just där: `user_metadata` får
  användaren själv skriva i, och mellanvaran har redan svaret från `getUser()`
  så kontrollen kostar ingen extra databasfråga.
- `src/lib/supabase/middleware.ts` skickar den som har flaggan till
  `/byt-losenord` från **varje** annan adress. Att det sitter i mellanvaran och
  inte i en layout är avsiktligt: en server action är ett POST till sidans egen
  adress och passerar där, så ett flaggat konto kan inte skriva något heller.
- Kontrollen ligger **efter** steg två (MFA). En chef som bytt enhet ska
  bekräfta enheten först — annars kan den som kommit över ett tillfälligt
  lösenord sätta ett eget och låsa ute den rätta ägaren.
- `/byt-losenord` ligger utanför `(app)` och har ingen navigering. Det finns
  inget att klicka på som inte studsar tillbaka.

**Regelmotorn** — `src/lib/losenordskrav.ts`, ren logik, inga imports.

Följer NIST SP 800-63B, inte den gamla vanan med versal + siffra + tecken. Den
vanan ger `Sommar2026!`: fyra krav uppfyllda och ett ord högt upp i varje
ordlista. Här gäller i stället längd, spärrlista, tangentbordsrader,
upprepning, och att namn och e-post ur den egna profilen inte får stå i ordet.
Alla fel visas på en gång — ett i taget är en pina.

Styrkemätaren i formuläret är en **uppskattning** och avgör ingenting.
`granska()` dömer, både i webbläsaren och en gång till på servern.

**En bugg som testet hittade:** spärrlistan innehöll `abc`, matchat som
delsträng. Det nekade ungefär vartannat hundrade slumpat tillfälligt lösenord —
chefen hade alltså kunnat dela ut ord som navet självt vägrade ta emot. Korta
ord matchas nu bara när de är hela lösenordet. `tests/losenordskrav.mjs`
slumpar 500 tillfälliga lösenord och granskar dem, just för att den sortens
regel ska falla direkt.

**Bytet ligger på ett ställe:** `src/lib/losenordsbyte-server.ts`. Profilsidan
krävde tidigare bara längd och att e-postadressen inte stod i ordet, medan den
tvingade sidan hade hela spärrlistan. Två vägar in i samma konto med olika krav
är detsamma som att bara ha det svagare kravet.

**Kvar på den här punkten:**

- [ ] **Befintliga konton är inte flaggade.** Flaggan sätts när ett konto
      skapas eller ett lösenord återställs. De som redan finns går fria. Skriv
      `scripts/krav-losenordsbyte.mjs` som sätter `app_metadata.byt_losenord`
      på valda konton, och kör den på dem som fått ett tillfälligt lösenord
      upplåst. Användaren har inte lagt upp säljarna än, så det brådskar inte —
      men det ska inte glömmas.
- [ ] Provet av flödet är inte skrivet. `tests/rls.mjs` borde visa att ett
      flaggat konto får noll rader ur API:t och att flaggan inte går att skriva
      bort med användarens egen token (`user_metadata`-vägen).

---

## Vad som står på tur

Uppgiftslistan i verktyget är sanningen; det här är den korta versionen i
prioritetsordning för att få säljarna igång.

1. **Flagga befintliga konton** (se ovan) — liten, och en förutsättning för att
   tvånget ska betyda något.
2. **#2 Supabase-panelen** — användarens eget arbete, men påminn.
3. **#13 X7 pilot** med tre personer i två veckor innan bredd.
4. **#7 E5 M11** rollstyrd startsida och mobilnavigering. Säljarna stämplar från
   telefonen; startsidan är det första de ser och den är inte byggd för det än.
5. **#8 E6 M12** gallringsjobb och registerutdrag. Gallringen är delvis byggd i
   nattjobbet men registerutdraget saknas, och K14 lovar det.
6. Därefter #10 global sökning, #9 Storage-spåret, #11 E7 frånvaro,
   #12 E10+E9 rekrytering.

Spåren **#1 E0.8 transaktionell e-post**, **#3 notiser** och **#5 domän** är
pausade på användarens uttryckliga begäran ("skippa mejl grejen helt", "glöm
domän"). Ta inte upp dem igen utan att bli tillfrågad.
