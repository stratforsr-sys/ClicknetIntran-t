# Arbetslogg — Clicknet Nav

Läs denna före arbete. Uppdatera efteråt.

---

## 2026-08-16 · Steg två byts från app till kod via e-post

Beställt efter att TOTP levererats: en kod till mejlen är enklare att leva med
än en app att skanna. Bytet är gjort och TOTP-vägen är helt borttagen.

**Levererat**

- Steg två är nu en engångskod till e-posten. Supabase har ingen e-postfaktor
  bland sina MFA-typer, så steget är byggt här: koden skickas med Supabase
  e-post-OTP, och när den stämmer skrivs ett signerat kvitto i en kaka.
- Kvittot är HMAC över användarens id och en utgångstid. Det går inte att
  skriva utan hemligheten och inte att flytta till ett annat konto. Utan giltig
  session är det värdelöst — det är ett kvitto på ett genomfört steg, inte en
  inloggning.
- Enheten kommer ihåg dig i 30 dagar. Det var hela poängen med bytet.
- `/tvafaktor` är borta. Med kod via mejl finns ingen inskrivning att göra, så
  grinden och verifieringen är samma sida: `/logga-in/verifiera`.
- Migration `0005`: `mfa_recovery_code` borttagen. Koderna fanns för en tappad
  telefon. Den som tappar sin brevlåda återställer den hos e-postleverantören.

**Vad bytet kostar i säkerhet**

Med TOTP kom den som har brevlådan ändå inte in. Nu räcker brevlådan ensam —
den bär både den magiska länken och koden. Kvar finns skyddet mot ett stulet
lösenord, vilket är det vanligaste angreppet. Avvägningen är verksamhetens och
är gjord med öppna ögon. K33 säger "MFA aktiverat" utan att peka ut faktortyp,
så kravet är uppfyllt.

**Ett val värt att känna till**

Spärren ligger kvar i middleware, men behovet kan inte längre läsas ur token —
det krävde rollerna. Ordningen är därför: kakan först (bara en HMAC, inget
nätverk), och rollerna hämtas bara när kakan saknas eller gått ut, alltså en
gång per enhet och månad. Svarar Supabase inte alls faller middleware tillbaka
på att släppa igenom, och `(app)`-layouten tar det som andra led — ett ja hade
låst ute alla chefer när Supabase har en dålig minut.

**Verifierat**

- `node tests/rls.mjs`: 52 kontroller, alla godkända. Hela kodvägen provas utan
  att något mejl skickas, via `admin/generate_link` som ger samma engångskod:
  fel kod nekas, rätt kod ger en session som är rätt persons, och samma kod går
  inte att använda igen.

**Beroende som måste lösas innan detta fungerar i drift**

Se `DRIFTSATTNING.md` punkt 0: mallen för magisk länk måste innehålla
`{{ .Token }}`, och egen SMTP måste vara påslagen. Utan det kommer koden inte
fram, och chefsrollerna kommer inte in.

**Samma dag: kravet avstängt igen.** Mejlet kom fram men innehöll bara en
"sign in"-länk, ingen kod — och länken fungerar inte, av samma orsak som
DRIFTSATTNING punkt 1. `MFA_REQUIRED_ROLES` är därför tom. Koden, spärren och
kvittot står kvar orörda och testade; det är en rad att slå på igen. Så länge
listan är tom är K33 inte uppfylld, och inloggning sker med lösenord.

---

## 2026-08-16 · E1.2 + E1.14 Tvåfaktor och profilsida

**Levererat**

- Migration `0004_mfa.sql`: `mfa_recovery_code` med RLS utan policyer. Ingen
  inloggad ser raden, inte ens sin egen — hashen hjälper ägaren noll och är en
  angreppsyta om den läcker vidare.
- `/profil` (E1.14): egna uppgifter, byte av lösenord, hantering av tvåfaktor.
  Namnet i sidopanelen är vägen dit.
- Tvåfaktor med TOTP (E1.2, AC-1.1, K33). Inskrivningen sker i webbläsaren mot
  Supabase, så hemligheten passerar aldrig vår egen server.
- Tio återställningskoder om 50 bitar, sha256 i databasen, klartext en enda
  gång vid utskrift. En kod tar bort faktorn och tvingar fram en ny
  inskrivning — den loggar alltså inte in någon på egen hand.
- Två grindar: `/tvafaktor` för den som **måste** ha MFA men saknar den, och
  `/logga-in/verifiera` för den som har en faktor men står kvar på aal1.
- Loggat i `audit_log`: `mfa.enrolled`, `mfa.disabled`, `mfa.recovered`,
  `mfa.recovery_failed`, `mfa.recovery_codes_created`, `auth.password_changed`.

**Två val värda att känna till**

- AAL-kontrollen ligger i middleware, inte i en layout. Då gäller den även
  route handlers och sidor som byggs till senare, utan att någon behöver minnas
  att lägga in den.
- MFA-faktorerna bärs med i `getCurrentUser` i stället för att hämtas separat.
  `mfa.listFactors()` gör om samma `getUser()`-anrop, och kontrollen sker på
  varje sidvisning — det hade blivit ett extra nätverksanrop per sida.

**Verifierat**

- `node tests/rls.mjs`: 54 kontroller, alla godkända. Åtta av dem nya, och
  testet räknar själv ut TOTP-koden enligt RFC 6238 i stället för att lita på
  att Supabase gör rätt: rätt kod ger en token på aal2, fel kod ger 422, och
  lösenordstoken står kvar på aal1.
- TOTP är påslaget i Supabase-projektet. Provat mot en engångsanvändare innan
  spärren aktiverades — en spärr mot en avstängd funktion hade låst ute alla
  chefer.

**Konsekvens vid driftsättning**

`zen@clicknet.se` har `sales_manager` + `admin` och möts därför av
`/tvafaktor` vid nästa sidladdning. En autentiseringsapp behövs för att komma
vidare. Utvägen är att logga ut; kontot kan inte låsas ute permanent.

**Kvar i E1**

E1.5 (automatisk tilldelning), E1.12 (45-dagarsflaggan, kräver schemalagt
jobb), E1.13 (teamhantering i UI), E1.15 (admin-vy för `payroll_cost_viewer`).

---

## 2026-08-16 · E0 Fundament + E1 Identitet

**Levererat**

- Repo, Next.js App Router, TypeScript, Tailwind v4.
- Designsystem enligt UI-PRD §4 som tokens i `src/app/globals.css`.
  Kontrastkraven i AC-U5.1 mätta och verifierade, se DECISIONS D-U2.
- Supabase-projekt `kwsyvqymebamiqnxqjgj` i **eu-north-1** (K23 uppfylld).
- Migration `0001_identitet.sql`: `company`, `team`, `employee`,
  `employee_role`, `employee_permission`, `audit_log`, `offboarding_task`,
  hjälpfunktioner och RLS-policyer.
- Inloggning med magisk länk och lösenord (AC-1.1, MFA-delen kvarstår).
- Personalregister: lista, upplägg, roller, aktivering, offboarding med
  checklista (AC-1.2, 1.3, 1.4, 1.5, 1.7).
- Händelselogg (AC-12.1, delvis — täcker M1:s händelser).
- Levande stilguide på `/design`.

**Verifierat**

- AC-1.6: anonym anslutning returnerar `[]` från employee, employee_role,
  audit_log, offboarding_task, company och team. Testat mot REST-API:t.

**Kvar i M1 innan modulen får räknas som klar**

- AC-1.1: MFA obligatoriskt för `sales_manager`, `ceo`, `finance`, `admin`
  och alla med `payroll_cost_viewer` (K33). Kräver TOTP-inskrivning i UI:t
  och en spärr i middleware som tvingar fram det vid nästa inloggning.
- AC-1.3: automatisk tilldelning av rutiner, kurser och schema. Kan först
  byggas när M5 och M6 finns — hooken läggs i `laggUppAnstalld`.
- AC-1.8: konton utan inloggning på 45 dagar flaggas för granskning.
  Kräver ett schemalagt jobb; `employee.last_sign_in_at` finns redan.
- AC-1.4: dialer-kö och iCal-flöde kan inte stängas än — de systemen finns
  inte i navet. Checklistan täcker dem manuellt tills M9 och M3 byggs.

## 2026-08-16 (samma dag) · Granskning av kod, säkerhet och prestanda

**Genomfört på riktigt system, inte genom kodläsning:** `tests/rls.mjs` skapar
fem användare med olika roller, loggar in som var och en och mäter vad de
faktiskt får ut ur databasen. 33 kontroller. Hela personalflödet kördes
dessutom manuellt i webbläsaren, inklusive offboarding, med efterkontroll mot
databasen och auth-API:t.

**Fyra brister hittade och lagade**

1. **Skrivförsök gav HTTP 204 i stället för 403.** Ingen data ändrades — RLS
   höll — men svaret var missvisande och konstruktionen skör. Skrivrätten är
   nu borttagen helt från `anon` och `authenticated` (0002).
2. **`log_audit` gick att anropa som RPC.** PostgREST exponerar varje funktion
   i `public`. En säljare hade kunnat posta godtyckliga händelser och göra
   loggen obrukbar som bevis. Rättigheten återkallad (0002).
3. **Offboardad anställd kunde läsa sin egen rad.** Rollbaserad åtkomst var
   redan stängd. Policyn kräver nu `status <> 'offboarded'` även för egen rad,
   som tredje led efter bannlysning och middleware (0002).
4. **Klickytor under 44 px.** Utloggningsknappen mätte 36 × 36 och namnlänken
   i personallistan 27 × 19. Båda uppfyller nu AC-U5.5.

**Headers**

CSP med nonce per svar, satt i middleware. Krävde att rendering tvingas
dynamisk — ett prerenderat svar kan inte bära ett nonce som varierar, och utan
nonce blockerade `strict-dynamic` Next:s egna inline-skript. Felet hade gett en
sida som såg korrekt ut men aldrig hydrerade. Upptäckt genom att räkna
nonce-attribut i det levererade svaret.

Därtill X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy som
stänger kamera, mikrofon och plats, COOP same-origin, och `no-store` på
persondatavyerna.

**Prestanda**

TTFB 0,24–0,44 s mot produktionsdomänen. Delad JS-bunt 103 kB. Startsidan
långt under kravet på 1,5 s i AC-11.3, men det är mätt på ett nästan tomt
register — mätningen ska göras om när rutinbiblioteket har innehåll.

**Verifierat i webbläsare**

Inloggning, upplägg av anställd, rolltilldelning och offboarding fungerar hela
vägen. Efter offboarding: status satt, alla roller återkallade, åtta
checklistposter skapade, auth-kontot bannlyst, inloggningsförsök nekat med
`user_banned`, och databasen vägrar hoppa över en checklistpost utan motivering.

**Kvarstår, kräver åtgärd i Supabase-panelen — se docs/DRIFTSATTNING.md**

- Magiska länkar omdirigerar till `localhost:3000`. Blockerande.
- Registreringen är öppen för vem som helst.

**Nästa steg**

E2 — M5 Rutinbibliotek. Det är modulen som skalar chefen (PRD §1.6 prio 1)
och den som måste finnas innan onboardingvågen i höst.

**Öppet som blockerar senare epics**

- K12 intresseavvägning för raststämpling: blockerar M2, skrivs av dig.
- K32 arbetsmiljöpolicy och uppgiftsfördelning vid 10 anställda:
  deadline cirka fyra veckor, oberoende av intranätet.
- A2 kollektivavtal, A3 lönesystem, A5 Inkio-API, A6 dialerns API.


---

## 2026-08-16 — E2, M5 Rutinbibliotek

Migration `0003_rutiner.sql`: `document`, `document_version`, `document_ack`,
`document_view`. `owner_id` och `review_due` är NOT NULL på databasnivå, så
AC-5.1 går inte att kringgå ens från en server action med servicerollen.
Kvittensens primärnyckel innehåller versionen — en ny version ger därför en ny
rad, inte en uppdaterad, och gammal kvittens står kvar som historik (AC-5.5).

**Byggt**

- Lista med fritextsök (svensk `tsvector`, GIN-index, `websearch`), kategorichips
  ur den faktiska datan och statusmärkning per dokument.
- Läsvy med markdown, versionshistorik, klistrad kvittensknapp och 404 för den
  som står utanför målgruppen (AC-5.8).
- Redaktör med förhandsgranskning, målgrupp per roll och ägarbyte.
- Kvittensrapport med de okvitterade överst (AC-5.6).
- Startsidans "Att göra" hämtar nu okvitterade rutiner och egna dokument med
  förfallen granskning.

**Två avsiktliga val**

Versionsnumret höjs bara när rubrik eller brödtext ändrats. En rättad kategori
tvingar alltså inte fram ny kvittens från alla — en kvittens som krävs utan
skäl är den snabbaste vägen till att folk klickar utan att läsa.

Markdown-parsern laddas med `next/dynamic` först när någon trycker
Förhandsgranska. Redigeringsvyn gick från 154 kB till 112 kB första laddning.

**Behörighetstestet**

`tests/rls.mjs` utökat med tolv kontroller för rutinbiblioteket. Verifierat mot
riktig databas med riktiga inloggningar: en säljare ser den öppna rutinen men
varken utkastet eller chefsdokumentet, får noll rader när hon frågar direkt på
deras id, kan inte skapa eller ändra dokument via API:t, kan inte kvittera i
någon annans namn och ser bara sin egen kvittens. 45 kontroller totalt, alla
godkända.

**Kvar i E2**

- E2.5 påminnelser 30/7/0 dagar — kräver transaktionell e-post (E0).
- Bilagor i Supabase Storage med signerade URL:er, och textextraktion ur PDF
  så att bilagornas innehåll också blir sökbart. Medvetet uppskjutet, inte
  bortglömt: sök över brödtext och titel täcker det som skrivs i navet, PDF
  täcker det som lyfts in utifrån.
- Global sökning i toppraden (E2.13).

**Nästa steg**

E3 — M4 Personalärenden med SLA, eller E8 — M6 Utbildning. Utbildning låser
upp E1.5 automatisk tilldelning vid upplägg, och är det som gör onboardingen
självgående. Ärenden är det som avlastar chefen mest per dag.
