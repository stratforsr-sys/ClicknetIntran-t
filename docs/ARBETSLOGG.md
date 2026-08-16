# Arbetslogg — Clicknet Nav

Läs denna före arbete. Uppdatera efteråt.

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
