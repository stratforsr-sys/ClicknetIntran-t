-- =============================================================================
-- 0273_sjukanteckning_raderas_inte.sql — en sjukanteckning tas inte bort
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Produktionsprovet 2026-10-30, gul 8. `sick_note_orubblig` (0048) gällde bara
-- BEFORE UPDATE, så `delete from sick_note` gick igenom, också som service role.
-- Sjukanmälan bredvid (`sick_report_last`) har nekat DELETE sedan 0020.
--
-- Nu nekar samma trigger också DELETE. Ingen väg i navet raderar en anteckning
-- (2026-10-31: inga `.delete()` mot sick_note i src).
--
-- "Ta bort helt" (`ta_bort_anstalld`, 0046/0170) går igenom som förut. Den slår
-- av användartriggrarna på varje tabell med en främmande nyckel mot employee
-- under raderingen, och sick_note har två (employee_id och author_id). Kaskaden
-- från employee och sick_report möter alltså ingen trigger. Provat i en rullad
-- transaktion 2026-10-31 med en syntetisk person, sjukanmälan och anteckning.
-- =============================================================================

create or replace function public.sick_note_ar_orubblig()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'En sjukanteckning tas inte bort.';
  end if;
  raise exception 'En anteckning skrivs en gang. Skriv en ny i stallet.';
end;
$$;

drop trigger sick_note_orubblig on public.sick_note;

create trigger sick_note_orubblig
  before update or delete on public.sick_note
  for each row execute function public.sick_note_ar_orubblig();
