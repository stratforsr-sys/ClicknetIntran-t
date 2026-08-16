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

**Nästa steg**

E2 — M5 Rutinbibliotek. Det är modulen som skalar chefen (PRD §1.6 prio 1)
och den som måste finnas innan onboardingvågen i höst.

**Öppet som blockerar senare epics**

- K12 intresseavvägning för raststämpling: blockerar M2, skrivs av dig.
- K32 arbetsmiljöpolicy och uppgiftsfördelning vid 10 anställda:
  deadline cirka fyra veckor, oberoende av intranätet.
- A2 kollektivavtal, A3 lönesystem, A5 Inkio-API, A6 dialerns API.
