-- Möten: bekräftelsen blir en uppgift (beställaren 2026-11-13).
--
-- När bekräftelsefönstret öppnar (arbetsdagar före mötet, kl. `moten.bekrafta-tid`) lägger jobbet
-- (/api/jobb/moten) upp en uppgift åt den som bokade mötet: "Bekräfta mötet med <bolaget>". Uppgiften och mötet
-- följs åt, åt båda hållen, och det sköts HÄR och inte i rutterna, för det finns sju vägar som ändrar ett möte
-- (Bekräfta, Ångra, Flytta, Ändra, utfallen, Rätta utfall, Radera) och varje ny väg hade varit ett ställe att glömma.
--
--   Mötet bekräftas i Möten      → uppgiften bockas av (av den som bekräftade).
--   Bekräftelsen ångras i Möten  → uppgiften öppnas igen.
--   Uppgiften bockas av          → mötet bekräftas (av den som bockade), om det inte redan är det.
--   Uppgiften öppnas igen        → bekräftelsen tas tillbaka, så länge mötet saknar utfall och låst provision.
--   Mötet flyttas, får ett utfall utan att ha bekräftats, raderas eller börjar obekräftat
--                                → en öppen uppgift tas bort: den har inget mer att göra. En ny tid ger en ny
--                                  uppgift när det nya fönstret öppnar. En avbockad uppgift står kvar som historik.
--
-- MÖTET ÄR SANNINGEN. Uppgiften är påminnelsen om det. Därför tar triggrarna aldrig bort eller ändrar något på
-- mötet utom bekräftelsen, och bara under samma villkor som rutten (`bekrafta`, `angra`).
--
-- KOPPLINGEN LIGGER I EN EGEN TABELL (`mote_uppgift`), inte som en kolumn på `mote`: varje uppdatering av `mote`
-- kör `mote_efter_andring` och flyttar bolagets `senast_handelse`, och en uppgift som Nav lägger upp är ingen
-- händelse hos kunden. `task_link.mote_id` är kopplingen som Uppgifter visar ("Möte: <bolaget>").
--
-- KÄNDA KANTER (granskningen 2026-11-13, godtagna): en flytt och en avbockning av samma möte i exakt samma
-- ögonblick låser i omvänd ordning, och Postgres avbryter då den ena (deadlock, efter en sekund); den som drabbas
-- får ett fel och trycker igen. En flytt vars kalender fallerar tar bort den öppna uppgiften innan tiden läggs
-- tillbaka; jobbet lägger upp en ny inom en kvart.
--
-- Omkörbar. Ingen ändring i befintliga rader.

-- 1. Mötets bekräftelseuppgift: högst en åt gången per möte.
create table if not exists public.mote_uppgift (
  task_id uuid primary key references public.task(id) on delete cascade,
  mote_id uuid not null references public.mote(id) on delete cascade,
  skapad timestamptz not null default now()
);
create unique index if not exists mote_uppgift_ett_per_mote on public.mote_uppgift (mote_id);
alter table public.mote_uppgift enable row level security;
revoke all on public.mote_uppgift from public, anon, authenticated;
grant select, insert, update, delete on public.mote_uppgift to service_role;

-- 2. Uppgiftens koppling till mötet, som de andra kopplingarna (0054).
alter table public.task_link add column if not exists mote_id uuid;
alter table public.task_link drop constraint if exists task_link_mote_id_fkey;
alter table public.task_link add constraint task_link_mote_id_fkey foreign key (mote_id) references public.mote(id) on delete cascade;
alter table public.task_link drop constraint if exists task_link_exakt_en;
alter table public.task_link add constraint task_link_exakt_en check (
  (order_id is not null)::int + (case_id is not null)::int + (employee_id is not null)::int
  + (coaching_task_id is not null)::int + (course_id is not null)::int + (document_id is not null)::int
  + (candidate_id is not null)::int + (contract_id is not null)::int + (kv_call_id is not null)::int
  + (mote_id is not null)::int = 1
);
create index if not exists task_link_mote on public.task_link (mote_id) where mote_id is not null;

-- 3. Är uppgiften öppen? Samma läge som Uppgifter räknar (`lageAv`): den senaste av händelserna som avgör läget.
-- Inlämnad för granskning och påbörjad räknas som öppen: den är inte klar förrän någon bockat av eller godkänt den.
create or replace function public.mote_uppgift_oppen(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select ev.type not in ('klar', 'godkand', 'avbruten')
      from public.task_event ev
     where ev.task_id = p_task
       and ev.type in ('klar', 'godkand', 'avbruten', 'ateroppnad', 'inlamnad', 'returnerad', 'paborjad')
     order by ev.at desc
     limit 1
  ), true);
$$;

-- 4. Lägg upp uppgiften. Jobbet anropar; villkoren prövas här under radlås, så att två körningar aldrig ger två
-- uppgifter och ett möte som hunnit bekräftas, få ett utfall eller börja inte får någon. Null = ingen uppgift.
-- `created_by` är bokaren: en uppgift måste ha en upphovsperson, och händelsen säger att det var Nav.
-- `p_mote_tid` är tiden jobbet läste: har mötet flyttats sedan dess gäller texten och dagen en annan tid, och då
-- läggs ingen uppgift upp (nästa körning läser om). `p_dag` är senast-dagen, uppgiftens deadline.
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
  select id, bokat_av, bekraftat_nar, utfall, mote_tid into v_m from public.mote where id = p_mote for update;
  if not found or v_m.bekraftat_nar is not null or v_m.utfall is not null or v_m.mote_tid <= now()
     or v_m.mote_tid is distinct from p_mote_tid then
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

-- 5. Mötet ändras → uppgiften följer.
create or replace function public.mote_uppgift_efter_mote()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task uuid;
  v_oppen boolean;
begin
  select task_id into v_task from public.mote_uppgift where mote_id = new.id;
  if v_task is null then
    return null;
  end if;
  v_oppen := public.mote_uppgift_oppen(v_task);

  -- Ny tid: den gamla uppgiften gällde den gamla tiden. Öppen tas den bort; avbockad står den kvar som historik
  -- men är inte längre mötets uppgift, så att det nya fönstret får en ny.
  if new.mote_tid is distinct from old.mote_tid then
    if v_oppen then
      delete from public.task where id = v_task;
    else
      delete from public.mote_uppgift where task_id = v_task;
    end if;
    return null;
  end if;

  -- Utfall utan bekräftelse (avbokat, eller satt efter mötet): det finns inget att bekräfta längre.
  if old.utfall is null and new.utfall is not null then
    if v_oppen then
      delete from public.task where id = v_task;
    end if;
    return null;
  end if;

  -- Bekräftat: uppgiften är gjord, av den som bekräftade.
  if old.bekraftat_nar is null and new.bekraftat_nar is not null then
    if v_oppen and new.bekraftat_av is not null then
      insert into public.task_event (task_id, type, by_employee_id, note, at)
      values (v_task, 'klar', new.bekraftat_av, 'Mötet är bekräftat.', clock_timestamp());
    end if;
    return null;
  end if;

  -- Bekräftelsen ångrad (bara Ångra gör det utan ny tid): uppgiften öppnas igen.
  if old.bekraftat_nar is not null and new.bekraftat_nar is null then
    if not v_oppen and old.bekraftat_av is not null then
      insert into public.task_event (task_id, type, by_employee_id, note, at)
      values (v_task, 'ateroppnad', old.bekraftat_av, 'Bekräftelsen ångrades i Möten.', clock_timestamp());
    end if;
    return null;
  end if;

  return null;
end;
$$;

drop trigger if exists mote_uppgift_efter_mote on public.mote;
create trigger mote_uppgift_efter_mote
  after update of mote_tid, utfall, bekraftat_nar on public.mote
  for each row execute function public.mote_uppgift_efter_mote();

-- 6. Mötet raderas → en öppen uppgift tas bort med det. En avbockad står kvar (kopplingen försvinner med mötet).
create or replace function public.mote_uppgift_fore_radering()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task uuid;
begin
  select task_id into v_task from public.mote_uppgift where mote_id = old.id;
  if v_task is not null and public.mote_uppgift_oppen(v_task) then
    delete from public.task where id = v_task;
  end if;
  return old;
end;
$$;

drop trigger if exists mote_uppgift_fore_radering on public.mote;
create trigger mote_uppgift_fore_radering
  before delete on public.mote
  for each row execute function public.mote_uppgift_fore_radering();

-- 7. Uppgiften bockas av eller öppnas igen → mötet följer. Samma villkor som rutten: bekräfta bara ett möte utan
-- utfall som inte börjat; ångra bara utan utfall och utan låst mötesprovision. Händelsen hamnar i loggen med
-- `via: uppgift`, så att det syns var bekräftelsen kom ifrån.
create or replace function public.mote_uppgift_efter_handelse()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mote uuid;
  v_kedja uuid;
begin
  select mote_id into v_mote from public.mote_uppgift where task_id = new.task_id;
  if v_mote is null then
    return null;
  end if;

  if new.type in ('klar', 'godkand') then
    update public.mote
       set bekraftat_nar = now(), bekraftat_av = new.by_employee_id
     where id = v_mote and bekraftat_nar is null and utfall is null and mote_tid > now()
    returning kedja_id into v_kedja;
    if v_kedja is not null then
      insert into public.audit_log (actor_id, action, object_type, object_id, meta)
      values (new.by_employee_id, 'mote.confirmed', 'mote', v_mote::text,
              jsonb_build_object('kedja', v_kedja, 'via', 'uppgift', 'uppgift', new.task_id));
    end if;
  elsif new.type = 'ateroppnad' then
    -- Bara när det som öppnas är en AVBOCKAD uppgift: en avbruten uppgift som öppnas igen har aldrig bekräftat
    -- mötet, och ett möte som bekräftats i Möten under tiden ska inte tappa sin bekräftelse för det.
    if coalesce((
      select ev.type in ('klar', 'godkand')
        from public.task_event ev
       where ev.task_id = new.task_id and ev.id <> new.id
         and ev.type in ('klar', 'godkand', 'avbruten', 'ateroppnad', 'inlamnad', 'returnerad', 'paborjad')
       order by ev.at desc
       limit 1
    ), false) is not true then
      return null;
    end if;
    update public.mote
       set bekraftat_nar = null, bekraftat_av = null
     where id = v_mote and bekraftat_nar is not null and utfall is null and provision_last_nar is null and mote_tid > now()
    returning kedja_id into v_kedja;
    if v_kedja is not null then
      insert into public.audit_log (actor_id, action, object_type, object_id, meta)
      values (new.by_employee_id, 'mote.confirmation_undone', 'mote', v_mote::text,
              jsonb_build_object('kedja', v_kedja, 'via', 'uppgift', 'uppgift', new.task_id));
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists mote_uppgift_efter_handelse on public.task_event;
create trigger mote_uppgift_efter_handelse
  after insert on public.task_event
  for each row
  when (new.type in ('klar', 'godkand', 'ateroppnad'))
  execute function public.mote_uppgift_efter_handelse();

-- 8. Möten som börjat obekräftade: den öppna uppgiften tas bort (jobbet anropar var kvart). Efter mötet tar
-- Möten över ("Hos säljaren"), och en uppgift om att bekräfta något som redan hänt vore brus.
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
     where m.mote_tid <= now()
       and public.mote_uppgift_oppen(mu.task_id)
  loop
    delete from public.task where id = v_task;
    v_antal := v_antal + 1;
  end loop;
  return v_antal;
end;
$$;

-- Rättigheterna (0233-regeln): `public` får EXECUTE på varje ny funktion, så den tas bort uttryckligen.
revoke all on function public.mote_uppgift_oppen(uuid) from public, anon, authenticated;
drop function if exists public.mote_uppgift_skapa(uuid, uuid, text, text, date);
revoke all on function public.mote_uppgift_skapa(uuid, timestamptz, uuid, text, text, date) from public, anon, authenticated;
revoke all on function public.mote_uppgift_efter_mote() from public, anon, authenticated;
revoke all on function public.mote_uppgift_fore_radering() from public, anon, authenticated;
revoke all on function public.mote_uppgift_efter_handelse() from public, anon, authenticated;
revoke all on function public.mote_uppgift_stada() from public, anon, authenticated;
grant execute on function public.mote_uppgift_skapa(uuid, timestamptz, uuid, text, text, date) to service_role;
grant execute on function public.mote_uppgift_stada() to service_role;
grant execute on function public.mote_uppgift_oppen(uuid) to service_role;
