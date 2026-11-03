-- =============================================================================
-- 0285_start_fore_signering.sql — avtalet får börja gälla före signeringen
--
-- -----------------------------------------------------------------------------
-- VARFÖR (beställaren 2026-11-03)
-- -----------------------------------------------------------------------------
--
-- Fyra order signerade i oktober lades upp i november och fick startdatumet
-- 2 november, eftersom formuläret inte tog ett startdatum före dagens. De
-- rättades för hand till signeringsdagen, och beställaren bad att formuläret
-- ska kunna "backa till tidigare månader" på startdatumet, även när
-- signeringen är i dag. Månaden ordern räknas i ska fortfarande avgöras av
-- signeringsdatumet (`period_month`), och den rörs inte här.
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- 0068 satte `sales_order_start_efter_signering` (starts_on >= signed_on),
-- med skälet att en start före signeringen var ett skrivfel. Nu är den
-- tillåten, men högst ett år bakåt: längre än så är fortfarande ett skrivfel
-- och ger ett avtal som redan har löpt ut. Samma gräns står i `tidigasteStart`
-- i src/lib/order.ts.
--
-- Varje befintlig rad har starts_on >= signed_on och klarar alltså det nya
-- villkoret, som därför valideras direkt. Båda kolumnerna är NOT NULL, så
-- villkoret kan inte bli NULL och släppa igenom något.
--
-- Omkörbar.
-- =============================================================================

alter table sales_order drop constraint if exists sales_order_start_efter_signering;
alter table sales_order drop constraint if exists sales_order_start_hogst_ett_ar_fore;
alter table sales_order add constraint sales_order_start_hogst_ett_ar_fore
  check (starts_on >= (signed_on - interval '1 year')::date);

comment on column sales_order.starts_on is
  'Nar avtalet borjar galla. Far ligga hogst ett ar fore signeringen (0285); manaden ordern raknas i avgors anda av signed_on. Slutdatumet raknas harifran, inte fran signed_on.';
