-- VÄNTAR · Order: jobben (hör till 0083, körs när beställaren sagt ja för Order)
--
-- 1. Kampanjsidorna kollas var tionde minut, dygnet runt: `kalla_jobb()` (0059)
--    ringer /api/jobb/kampanjsidor med hemligheten ur Vault. Rutten kollar
--    varje kunds sida, skriver en rad i `landing_page_check` och gallrar rader
--    äldre än 14 dagar.
--
-- 2. En utskrift är en avskrift av inspelningen och följer den: när
--    inspelningen gallras (recording_file_id blir null) tas utskriften bort.
--
-- Kör med apply-sql.mjs som en vanlig migration och ge den nästa lediga
-- nummer ur schema_migrations när den körs.

select cron.schedule('nav-kampanjsidor', '*/10 * * * *', $$select public.kalla_jobb('/api/jobb/kampanjsidor')$$);

create function public.call_transcript_folj_inspelningen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.recording_file_id is not null and new.recording_file_id is null then
    delete from public.call_transcript where call_id = new.id;
  end if;
  return new;
end;
$$;

create trigger phone_call_utskrift_folj_inspelningen
  after update of recording_file_id on public.phone_call
  for each row execute function public.call_transcript_folj_inspelningen();
