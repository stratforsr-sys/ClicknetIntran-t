-- =============================================================================
-- 0271_ledighet_installd.sql — en godkänd ledighet går att ställa in
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Produktionsprovet 2026-10-30, R1. Två regler motsade varandra:
--
--   absence_request_beslut (0019:342)  `cancelled` kräver att beslutet är tomt
--   absence_request_ar_last (0048)     ett fattat beslut får inte tömmas
--
-- `stallInLedighet` sätter bara status, withdrawn_by och withdrawn_at, och fick
-- `violates check constraint "absence_request_beslut"`. Ingen rad har någonsin
-- blivit `cancelled` (0 rader 2026-10-31).
--
-- Nu: en inställd ledighet behåller beslutet den hade. En inställd godkänd
-- ledighet har alltså vem som godkände och när, och en ansökan som ställdes in
-- innan den beslutades har inget beslut. Antingen båda fälten eller inget, så
-- att ett halvt beslut fortfarande inte går att skriva.
--
-- Ingen appkod ändras. Triggern 0048 bestämmer vilka övergångar som går
-- (godkänd → inställd, aldrig avslagen → något), villkoret bara hur raden ser ut.
--
-- Villkoret läggs `not valid` och valideras sedan, så att det prövas mot varje
-- befintlig rad innan migrationen räknas som körd.
-- =============================================================================

alter table public.absence_request drop constraint absence_request_beslut;

alter table public.absence_request add constraint absence_request_beslut check (
  (status in ('approved','rejected') and decided_by is not null and decided_at is not null)
  or (status = 'cancelled' and (decided_by is null) = (decided_at is null))
  or (status not in ('approved','rejected','cancelled') and decided_by is null and decided_at is null)
) not valid;

alter table public.absence_request validate constraint absence_request_beslut;
