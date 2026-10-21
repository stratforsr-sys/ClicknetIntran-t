-- =============================================================================
-- 0170_anstallda_behall_underlag.sql — Nav 2.0: företagets underlag raderas
-- aldrig med en person
--
-- Beställaren 2026-10-21: den som sägs upp ska gå att ta bort, och i övrigt
-- "best practice". `ta_bort_anstalld()` (0046) raderar allt som har en nyckel
-- mot employee med ON DELETE CASCADE, plus stämplingarna och arbetstids-
-- journalen, som står med för hand. Fyra av dem är företagets:
--
--   file_object.subject_employee_id   samtalsinspelningarna (5 743 för nio
--                                     säljare 2026-10-21) och anställnings-
--                                     avtalen som PDF
--   contract.employee_id              anställningsavtalen
--   time_event.employee_id            stämplingarna (och med dem rättelserna
--                                     i time_correction_extra)
--   work_time_journal.employee_id     arbetstidsjournalen
--
-- Inspelningarna är bevis för ordrarna, avtalet ska arbetsgivaren spara, och
-- stämplingarna och journalen är underlaget för lönerna, som redan står kvar
-- (payroll_row). Beställaren sa ja till de två sista samma kväll.
--
-- Här tas de fyra ur `anstalld_raderingsmal()`. Då räknar
-- `referenser_till_anstalld()` dem som "behalls", och `ta_bort_anstalld()`
-- låter personalposten stå kvar med "(borttagen anställd)" i stället för att
-- radera den (steg 3b), precis som för en signerad order. time_event och
-- work_time_journal har ON DELETE NO ACTION, så ingen kaskad tar dem heller.
--
-- Nav 2.0 spärrade "Ta bort helt" medan inspelningar och avtal skulle raderas
-- (`skyddat()` i src/app/nav2/anstallda/route.ts). När den här är körd
-- släpper spärren av sig själv. Ingenting annat i 0046 ändras.
-- =============================================================================

create or replace function public.anstalld_raderingsmal()
 returns table(tabell text, kolumn text)
 language sql
 stable
 set search_path to 'public'
as $function$
  select c.conrelid::regclass::text, a.attname::text
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and c.confrelid = 'public.employee'::regclass
    and array_length(c.conkey, 1) = 1
    and c.confdeltype = 'c'
    and (c.conrelid::regclass::text, a.attname::text) not in (
      ('file_object', 'subject_employee_id'),
      ('contract', 'employee_id')
    )
$function$;
