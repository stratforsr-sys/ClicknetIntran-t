-- =============================================================================
-- 0284_lynes_plats_ateranvand.sql — samtal som bokförts på någon som slutat,
-- för att Lynes gett hens plats till en ny säljare
--
-- -----------------------------------------------------------------------------
-- VARFÖR (beställaren 2026-11-03)
-- -----------------------------------------------------------------------------
--
-- "Navet hittar inte samtalet just där jag slår upp en order." En av orsakerna:
-- Lynes återanvänder platser. Pontus plats (lynes_user 44da04ac…) gick till
-- Albin, och `slaUppPerson` slog upp platsen före e-posten, så Albins 166
-- samtal 22–29 oktober bokfördes på Pontus. Hans order kunde aldrig hitta sitt
-- säljsamtal. Samma sak för Carl på Eves plats (två samtal). Beställaren sa ja
-- till att e-posten till den som är kvar går före platsen efter någon som
-- slutat, och att de gamla samtalen flyttas över.
--
-- Koden rättar det som kommer in härefter (`flyttaPlatsen` i samtal-server.ts).
-- Den här filen rättar det som redan bokförts.
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- Urvalet: samtal som står på någon som slutat (`offboarded`) och vars
-- `agent_ref` är e-posten till någon annan som är kvar.
--
-- 1. Platsen flyttas till den som är kvar, när den som slutat har exakt en
--    plats och samtalen pekar ut exakt en ny person. `created_by` blir null:
--    det är navets gissning, och en människa kan rätta den.
-- 2. E-posten bokförs som gissning (`kind = 'epost'`), så att nästa samtal
--    träffar personen direkt.
-- 3. Samtalen flyttas, och inspelningsfilens `subject_employee_id` följer med
--    (rösten är säljarens, 0052).
--
-- Inget av samtalen sitter på en order (kontrollerat 2026-11-03), så ingen
-- bedömning av ett säljsamtal ändras bakåt. Omkörbar: andra gången är urvalet
-- tomt.
-- =============================================================================

create temp table flytt_0284 on commit drop as
select p.id as samtal, p.recording_file_id as fil, p.employee_id as gammal, n.id as ny
from public.phone_call p
join public.employee o on o.id = p.employee_id and o.status = 'offboarded'
join public.employee n on lower(n.email) = lower(btrim(p.agent_ref)) and n.status <> 'offboarded' and n.id <> o.id;

update public.phone_identity pi
set employee_id = x.ny, created_by = null
from (
  select gammal, (array_agg(distinct ny))[1] as ny
  from flytt_0284
  group by gammal
  having count(distinct ny) = 1
) x
where pi.kind = 'lynes_user'
  and pi.employee_id = x.gammal
  and (select count(*) from public.phone_identity q where q.kind = 'lynes_user' and q.employee_id = x.gammal) = 1;

insert into public.phone_identity (employee_id, kind, value)
select distinct f.ny, 'epost', lower(e.email)
from flytt_0284 f
join public.employee e on e.id = f.ny
on conflict (kind, value) do nothing;

update public.phone_call p
set employee_id = f.ny
from flytt_0284 f
where p.id = f.samtal;

update public.file_object fo
set subject_employee_id = f.ny
from flytt_0284 f
where fo.id = f.fil;
