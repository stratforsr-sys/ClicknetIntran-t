-- =============================================================================
-- 0299_uppgift_villkorad_tid.sql — den villkorade händelsen får sin egen tid
--
-- Hittat 2026-11-14 när 0298:s prov kördes om mot produktionen efter körningen:
-- "Två som bockar samtidigt" föll en gång av tre. `uppgift_handelse_villkorad`
-- väljer den senaste lägesbärande händelsen på `at desc, id desc`. `at` har
-- förvalet now(), som är samma tid för allt i en transaktion, och `id` är
-- gen_random_uuid(). Två lägesbärande händelser i samma transaktion (`skapad`
-- och den första `klar`) blev då lika på tiden, och slumpen avgjorde vilken
-- som var senast. Valde den `skapad` släpptes en andra `klar` igenom.
--
-- Händelsen som funktionen skriver får nu clock_timestamp(): den är alltid
-- senare än det som redan står, också i samma transaktion. Inget annat ändras;
-- kroppen är 0298:s.
--
-- Omkörbar: create or replace, och rättigheterna sätts som i 0298.
-- =============================================================================

create or replace function public.uppgift_handelse_villkorad(
  p_task uuid,
  p_typ text,
  p_av uuid,
  p_note text,
  p_lagestyper text[],
  p_stoppande text[]
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_senaste text;
begin
  perform 1 from task where id = p_task for update;
  if not found then
    raise exception 'Uppgiften finns inte.';
  end if;

  select e.type into v_senaste
  from task_event e
  where e.task_id = p_task and e.type = any (p_lagestyper)
  order by e.at desc, e.id desc
  limit 1;

  if v_senaste is not null and v_senaste = any (p_stoppande) then
    return v_senaste;
  end if;

  -- clock_timestamp(), inte now(): se rubriken.
  insert into task_event (task_id, type, by_employee_id, note, at)
  values (p_task, p_typ, p_av, nullif(btrim(coalesce(p_note, '')), ''), clock_timestamp());
  update task set updated_at = now() where id = p_task;

  return null;
end;
$$;

revoke all on function public.uppgift_handelse_villkorad(uuid, text, uuid, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.uppgift_handelse_villkorad(uuid, text, uuid, text, text[], text[]) to service_role;
