-- =============================================================================
-- 0004_mfa.sql — Aterstallningskoder for tvafaktor (E1.2, AC-1.1, K33)
--
-- Sjalva TOTP-faktorn bor i Supabase auth-schema. Det som saknas dar ar
-- aterstallningskoder: tappar nagon sin telefon finns annars ingen vag in
-- annat an att en admin plockar bort faktorn at dem. Da har ett supportarende
-- blivit en behorighetsgrind, och den grinden oppnas av den som later mest
-- stressad — precis den svaghet MFA skulle taga bort.
--
-- Koderna lagras som sha256 av klartexten. De ar 50 bitar entropi och
-- engangsbruk, sa en langsam nyckelharddning tillfor inget mot en angripare
-- som redan har databasen: han maste anda prova 2^50 gissningar per kod.
-- Klartexten visas en enda gang, vid utskrift.
-- =============================================================================

create table if not exists mfa_recovery_code (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  used_ip     text,
  unique (employee_id, code_hash)
);

create index if not exists mfa_recovery_code_employee_idx
  on mfa_recovery_code (employee_id) where used_at is null;

-- Ingen policy = ingen rad ar synlig for nagon inloggad. Tabellen las och
-- skrivs uteslutande av server actions med service role. Att den egna
-- anvandaren inte far lasa sina egna hashar ar avsiktligt: hashen tillfor
-- honom ingenting, men lackt vidare ar den en angreppsyta.
alter table mfa_recovery_code enable row level security;

revoke select on mfa_recovery_code from anon, authenticated;
