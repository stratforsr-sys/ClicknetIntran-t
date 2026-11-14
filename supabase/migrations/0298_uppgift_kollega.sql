-- =============================================================================
-- 0298_uppgift_kollega.sql — Uppgifter: lägg till en kollega i min uppgift
--
-- Beställaren 2026-11-13: "jag vill kunna lägga till en annan kollega med min
-- uppgift så att vi båda får uppgiften och båda kan jobba i den."
--
-- TABELLEN FINNS REDAN. `task_member` med rollen `redigerare` kom i 0054, och
-- `mittAttGora()` lägger sedan 2026-09-23 en redigerares uppgift bland hens
-- egna. Det som saknades var gränssnittet i Nav 2.0 och fyra saker som bara
-- databasen kan göra rätt. De fyra står här.
--
-- ADDITIV. Inga rader ändras, ingen kolumn tillkommer, ingen tabell.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Två händelser som inte ändrar läget
--
-- `andrad`: någon flyttade en DELAD uppgift i tiden eller bytte prioritet.
-- Utan raden ser den andra bara att uppgiften försvunnit ur "i dag".
-- `krets`: någon lades till, togs bort, lämnade eller fick bollen. Historiken
-- ska kunna svara på vem som var med när — det är priset för beslutet att den
-- som är med får lägga till fler (B4, 2026-11-13).
--
-- Villkoret är läst ur pg_constraint 2026-11-13, inte ur 0092: elva typer,
-- validerat. Det nya är samma lista plus två.
-- -----------------------------------------------------------------------------

alter table public.task_event drop constraint if exists task_event_type_check;
alter table public.task_event add constraint task_event_type_check
  check (type = any (array[
    'skapad', 'tilldelad', 'paborjad', 'inlamnad', 'godkand', 'returnerad',
    'klar', 'ateroppnad', 'avbruten', 'kommentar', 'paminnelse',
    'andrad', 'krets'
  ]));

-- -----------------------------------------------------------------------------
-- 2. Deluppgiftens händelser syns för den som ser föräldern
--
-- HÅLET (H16). `task_read` har haft föräldergrenen sedan 0054: den som ser en
-- uppgift ser dess deluppgifter. `task_event_read` fick den aldrig. Läget
-- räknas ur händelserna, så den som lagts till i en uppgift såg stegen men
-- inte att de var bockade — varje steg stod som ogjort hos kollegan, och
-- förloppsraden stod på noll.
--
-- EN FUNKTION OCH INTE EN UNDERFRÅGA I POLICYN, av samma skäl som
-- `uppgift_synlig()` själv: frågan gäller en annan rad i `task`, och policyn
-- på `task` hade annars körts en gång till inuti den här.
-- -----------------------------------------------------------------------------

create or replace function public.uppgift_synlig_i_trad(p_task uuid, p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.uppgift_synlig(p_task, p_employee)
      or exists (
        select 1
        from task t
        where t.id = p_task
          and t.parent_id is not null
          and public.uppgift_synlig(t.parent_id, p_employee)
      );
$$;

revoke all on function public.uppgift_synlig_i_trad(uuid, uuid) from public, anon;
grant execute on function public.uppgift_synlig_i_trad(uuid, uuid) to authenticated, service_role;

alter policy task_event_read on public.task_event
  using (public.uppgift_synlig_i_trad(task_id, (select public.current_employee_id())));

-- -----------------------------------------------------------------------------
-- 3. Passa bollen, i ett steg
--
-- Tre skrivningar som måste lyckas eller falla ihop: bollen byter hand,
-- mottagarens plats bland de tillagda tas bort (hen har uppgiften nu, och en
-- person med två roller är frågan 0054 vägrade svara på), och den som hade
-- bollen blir kvar som med. Via PostgREST är det tre anrop, och faller det
-- tredje har någon tappat sin uppgift utan att veta om det.
--
-- LÖFTET (B5): INGEN TAPPAR EN UPPGIFT AV ATT NÅGON ANNAN FLYTTAR DEN.
-- `p_stanna` får bara vara falskt när den som hade bollen själv lämnar över
-- och har valt att gå. Det avgörs i `tilldela()`; funktionen litar på
-- anroparen, och därför är den inte körbar för någon annan än service role.
--
-- `p_till` null är inkorgen: ingen har bollen.
-- -----------------------------------------------------------------------------

create or replace function public.uppgift_passa(
  p_task uuid,
  p_till uuid,
  p_av uuid,
  p_stanna boolean,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hade uuid;
begin
  select assignee_id into v_hade from task where id = p_task for update;
  if not found then
    raise exception 'Uppgiften finns inte.';
  end if;

  if v_hade is not distinct from p_till then
    return;
  end if;

  update task set assignee_id = p_till, updated_at = now() where id = p_task;

  if p_till is not null then
    delete from task_member where task_id = p_task and employee_id = p_till;
  end if;

  if p_stanna and v_hade is not null then
    insert into task_member (task_id, employee_id, role, added_by)
    values (p_task, v_hade, 'redigerare', p_av)
    on conflict (task_id, employee_id) do update set role = 'redigerare';
  end if;

  insert into task_event (task_id, type, by_employee_id, note)
  values (p_task, 'tilldelad', p_av, nullif(btrim(coalesce(p_note, '')), ''));
end;
$$;

revoke all on function public.uppgift_passa(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.uppgift_passa(uuid, uuid, uuid, boolean, text) to service_role;

-- -----------------------------------------------------------------------------
-- 4. En händelse som bara skrivs om läget tillåter det
--
-- TVÅ SOM BOCKAR SAMTIDIGT (H15). `bocka()` läste läget och skrev sedan
-- händelsen, i två anrop. I en delad uppgift är det inte längre ett
-- teoretiskt fall: båda har den i sin lista, och båda kan trycka. Utfallet var
-- två `klar` i historiken, och från och med nu två besked till de andra.
--
-- Funktionen låser uppgiftsraden, läser vilken den senaste LÄGESBÄRANDE
-- händelsen är och skriver bara om den inte står bland de stoppande.
--
-- VILKA HÄNDELSER SOM BÄR ETT LÄGE STÅR INTE HÄR. De kommer in som argument ur
-- `LAGESHANDELSER` i src/lib/uppgifter.ts, så att regeln om vad som ändrar
-- läget fortfarande finns på ett enda ställe. Två kopior av den listan hade
-- glidit isär första gången någon la till en händelsetyp.
--
-- Svaret är typen som stoppade, eller null när händelsen skrevs.
-- -----------------------------------------------------------------------------

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

  insert into task_event (task_id, type, by_employee_id, note)
  values (p_task, p_typ, p_av, nullif(btrim(coalesce(p_note, '')), ''));
  update task set updated_at = now() where id = p_task;

  return null;
end;
$$;

revoke all on function public.uppgift_handelse_villkorad(uuid, text, uuid, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.uppgift_handelse_villkorad(uuid, text, uuid, text, text[], text[]) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Kvittot
-- -----------------------------------------------------------------------------

do $$
declare
  f text;
begin
  -- De två som skriver får inte vara körbara utifrån: de litar på anroparen.
  foreach f in array array['uppgift_passa', 'uppgift_handelse_villkorad'] loop
    if exists (
      select 1 from information_schema.routine_privileges
      where routine_schema = 'public' and routine_name = f
        and grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception '% är körbar för anon eller authenticated', f;
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'task_event' and policyname = 'task_event_read'
      and qual like '%uppgift_synlig_i_trad%'
  ) then
    raise exception 'task_event_read använder inte uppgift_synlig_i_trad';
  end if;

  -- Fortfarande ingen skrivpolicy: skrivning går via service role (0054).
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('task', 'task_member', 'task_event') and cmd <> 'SELECT'
  ) then
    raise exception 'en skrivpolicy har smugit in på uppgiftstabellerna';
  end if;
end;
$$;
