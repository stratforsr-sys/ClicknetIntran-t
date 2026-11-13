-- 0295: bara det första mötet med kunden bekräftas (beställaren 2026-11-13).
--
-- Ett uppföljningsmöte (mote.art = 'uppfoljning', bokat efter ett hållet möte i
-- kedjan, se motesArt i motenforma.ts) ska inte bekräftas: ingen uppgift, ingen
-- notis. Jobbet frågar inte längre om sådana möten (vemBekraftar). Här:
--
--   - mote_uppgift_skapa nekar ett uppföljningsmöte (returnerar null), så att
--     ingen väg kan lägga upp en bekräftelseuppgift på ett.
--   - mote_uppgift_stada tar också bort en öppen uppgift på ett uppföljningsmöte.
--     Den första körningen efter migrationen tar bort uppgiften som redan lagts
--     upp (Nordic Grön, måndag 16 nov).
--
-- Båda är omskrivningar av 0291 (stämda mot pg_get_functiondef i produktionen
-- 2026-11-13), med samma signaturer. Ombokningar ('ombokning') bekräftas
-- fortfarande: kunden har inte träffats än.

create or replace function public.mote_uppgift_skapa(p_mote uuid, p_mote_tid timestamptz, p_till uuid, p_titel text, p_beskrivning text, p_dag date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m record;
  v_task uuid;
begin
  select id, bokat_av, bekraftat_nar, utfall, mote_tid, art into v_m from public.mote where id = p_mote for update;
  if not found or v_m.bekraftat_nar is not null or v_m.utfall is not null or v_m.mote_tid <= now()
     or v_m.mote_tid is distinct from p_mote_tid or v_m.art = 'uppfoljning' then
    return null;
  end if;
  if exists (select 1 from public.mote_uppgift where mote_id = p_mote) then
    return null;
  end if;
  insert into public.task (title, description_md, assignee_id, created_by, due_date, priority, estimate_minutes)
  values (left(p_titel, 200), coalesce(p_beskrivning, ''), p_till, v_m.bokat_av, p_dag, 2, 5)
  returning id into v_task;
  insert into public.task_event (task_id, type, by_employee_id, note, at)
  values (v_task, 'skapad', v_m.bokat_av, 'Upplagd av Nav när mötet skulle bekräftas.', clock_timestamp());
  insert into public.task_link (task_id, mote_id, created_by) values (v_task, p_mote, v_m.bokat_av);
  insert into public.mote_uppgift (task_id, mote_id) values (v_task, p_mote);
  return v_task;
end;
$$;

create or replace function public.mote_uppgift_stada()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antal integer := 0;
  v_task uuid;
begin
  for v_task in
    select mu.task_id
      from public.mote_uppgift mu
      join public.mote m on m.id = mu.mote_id
     where (m.mote_tid <= now() or m.art = 'uppfoljning')
       and public.mote_uppgift_oppen(mu.task_id)
  loop
    delete from public.task where id = v_task;
    v_antal := v_antal + 1;
  end loop;
  return v_antal;
end;
$$;

revoke all on function public.mote_uppgift_skapa(uuid, timestamptz, uuid, text, text, date) from public, anon, authenticated;
revoke all on function public.mote_uppgift_stada() from public, anon, authenticated;
grant execute on function public.mote_uppgift_skapa(uuid, timestamptz, uuid, text, text, date) to service_role;
grant execute on function public.mote_uppgift_stada() to service_role;
