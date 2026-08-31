-- =============================================================================
-- 0041_guideoversikt.sql — chefen får se hur långt hennes folk kommit
--
-- 0040 gav `guide_progress` en enda läspolicy: sina egna rader. Det var med
-- flit — att öppna läsningen för chefer innan det fanns en vy som visade den
-- hade varit att dela ut en uppgift om personalen som ingen frågat efter.
--
-- Nu finns vyn (`/utbildning/oversikt/systemguider`), och därmed skälet.
--
-- KRETSEN ÄR EXAKT DENSAMMA SOM FÖR KURSPROGRESSEN i 0007, och det är inte en
-- bekvämlighet utan en poäng: `module_progress` besvarar samma sorts fråga om
-- samma personer — hur långt har hon kommit — och två olika kretsar för det
-- hade betytt att svaret på "vem får se min utbildning" beror på vilken sorts
-- utbildning det gäller. Teamledaren ser sitt team, ledningen ser alla, och
-- alla andra ser bara sig själva.
--
-- `leads_employee()` och `can_read_all_employees()` är samma funktioner som
-- resten av navet frågar. Att kopiera villkoren hit i stället hade gett ett
-- andra ställe att glömma när teamstrukturen ändras.
--
-- SKRIVNINGEN ÄR FORTFARANDE STÄNGD. Ingen skrivpolicy tillkommer, och
-- självkontrollen längst ner vaktar det. En chef ska kunna SE att någon står
-- still — inte kunna bokföra att hon inte gör det.
-- =============================================================================

drop policy if exists guide_progress_read on guide_progress;
create policy guide_progress_read on guide_progress for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

-- -----------------------------------------------------------------------------
-- Självkontroll — samma sort som 0040 avslutades med. Den viktiga halvan är den
-- andra: läsningen växte, skrivningen fick inte göra det.
-- -----------------------------------------------------------------------------
do $$
declare
  skrivpolicyer int;
  laspolicyer   int;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'guide_progress' and c.relrowsecurity
  ) then
    raise exception 'guide_progress saknar row level security';
  end if;

  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public' and tablename = 'guide_progress' and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'guide_progress har % skrivpolicy(er) — skrivning ska gå via service role', skrivpolicyer;
  end if;

  select count(*) into laspolicyer
  from pg_policies
  where schemaname = 'public' and tablename = 'guide_progress' and cmd = 'SELECT';

  if laspolicyer <> 1 then
    raise exception 'guide_progress ska ha exakt en läspolicy, har %', laspolicyer;
  end if;
end;
$$;
