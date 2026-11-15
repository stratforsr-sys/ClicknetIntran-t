-- 0303: Hemvyn, steg 1. Förslagsloggen, taktens morgonvärden, offertens belopp
-- och inställningarnas historik.
--
-- Designdokumentet: docs/superpowers/specs/2026-11-15-hemvyn-kort-chatt-design.md (1.2–1.6).
--
-- ALLT HÄR LÄGGER BARA TILL. Koden på main rör inget av det nya, utom på en
-- punkt: triggern på `nav_setting` (del 7) går för varje sparad inställning,
-- också från main. Den är skriven så att den aldrig kan fälla en sparning.
--
-- INGET SLÅS PÅ. Jobben skriver inga förslag förrän `forslag.pa` är sann, och
-- den inställningen finns inte förrän någon sätter den.
--
-- Omkörbar.

-- -----------------------------------------------------------------------------
-- 1. Förslagsloggen: två tabeller som bara tar emot nya rader
--
-- En rad i `nav_forslag` när Nav ser något (ett förslag) eller när något ändras
-- (en ändring). Allt som sedan händer med raden är en rad i
-- `nav_forslag_handelse`: valet, vad valet skapade, en ångring, personens egen
-- kommentar, mätningen och domen. Läget läses ur vyn `nav_forslag_lage`.
--
-- VARFÖR BARA NYA RADER. Nav ska döma sig själv ärligt: det Nav trodde skrivs
-- före valet, och ingen ska kunna skriva om det i efterhand. Därför nekar
-- triggrarna varje ändring och radering.
--
-- TRE VÄGAR ATT ÄNDÅ TA TILLBAKA, eftersom en logg som inte kan rättas blir fel
-- för alltid första gången något går snett:
--   - En händelse av sorten `ogiltig` pekar ut en tidigare händelse som inte ska
--     gälla (ett jobb som dömde fel). Vyn och facit räknar inte den utpekade.
--   - Ett utfall som rättas efter domen ger en NY mätning och en NY dom. Den
--     senaste gäller.
--   - Rader märkta `prov` får raderas. Provdata ska inte ligga kvar för alltid.
-- Avidentifieringen efter 24 månader och raderingen av en person har egna vägar
-- (del 5, och 0224 som stänger av triggrarna i sin transaktion).
-- -----------------------------------------------------------------------------

create table if not exists public.nav_forslag (
  id uuid primary key default gen_random_uuid(),
  sort text not null check (sort in ('forslag', 'andring')),
  -- Regelns eller måttets nyckel, till exempel moten.obekraftat.
  regel text not null check (regel ~ '^[a-z0-9.-]{1,60}$'),
  -- Det raden gäller. Regel och nyckel är unika, så att ett jobb kan köras om utan dubbletter.
  nyckel text not null check (char_length(nyckel) between 1 and 200),
  kalla text not null check (kalla in ('regel', 'person', 'installning')),
  -- Personen raden gäller, eller laget när `om` är tomt. Är båda tomma gäller raden hela företaget.
  -- Raderas personen helt följer raderna om hen med (kaskad, som 0046 räknar med). De som handlat i
  -- andras rader (`skapad_av`, händelsens `av`) står kvar som namn, enligt samma mönster som Uppgifter.
  om uuid references public.employee (id) on delete cascade,
  lag uuid references public.team (id) on delete set null,
  skapad timestamptz not null default now(),
  skapad_av uuid references public.employee (id),
  -- Talen när raden skapades, och id:n på raderna bakom.
  belagg jsonb not null default '{}'::jsonb,
  -- Vad Nav trodde: hur det brukar gå i samma läge, som {n, av}. Tomt när inget finns att gå på.
  trodde jsonb,
  val text[] not null default '{}',
  -- Vad som följs: måttet med version, motvikten, och en lista möten eller en period.
  foljer jsonb not null default '{}'::jsonb,
  doms_dag date,
  -- Tidpunkten då ett obesvarat förslag räknas som "ingen valde".
  utgar timestamptz,
  -- För en ändring från en person: vad som ändrades, med personens ord.
  text text check (text is null or char_length(text) <= 500),
  prov boolean not null default false,
  avidentifierad timestamptz,
  constraint nav_forslag_regel_nyckel unique (regel, nyckel)
);
create index if not exists nav_forslag_om on public.nav_forslag (om, skapad desc) where om is not null;
create index if not exists nav_forslag_dom on public.nav_forslag (doms_dag) where doms_dag is not null;
create index if not exists nav_forslag_sort on public.nav_forslag (sort, skapad desc);

create table if not exists public.nav_forslag_handelse (
  id uuid primary key default gen_random_uuid(),
  forslag uuid not null references public.nav_forslag (id) on delete cascade,
  sort text not null check (sort in ('beslut', 'atgard', 'angrad', 'kommentar', 'matning', 'dom', 'ogiltig')),
  -- Vem som gjorde det. Tomt när Nav gjorde det (ett jobb).
  av uuid references public.employee (id),
  nar timestamptz not null default clock_timestamp(),
  data jsonb not null default '{}'::jsonb,
  -- Bara för sorten `ogiltig`: händelsen som inte längre ska gälla.
  ogiltigar uuid references public.nav_forslag_handelse (id) on delete cascade,
  prov boolean not null default false,
  constraint nav_forslag_handelse_ogiltig check ((sort = 'ogiltig') = (ogiltigar is not null)),
  constraint nav_forslag_handelse_kommentar check (sort <> 'kommentar' or char_length(coalesce(data ->> 'text', '')) between 1 and 200)
);
create index if not exists nav_forslag_handelse_forslag on public.nav_forslag_handelse (forslag, nar desc);
create index if not exists nav_forslag_handelse_ogiltigar on public.nav_forslag_handelse (ogiltigar) where ogiltigar is not null;
create index if not exists nav_forslag_handelse_av on public.nav_forslag_handelse (av) where av is not null;

-- En händelse är provdata precis när dess förslag är det.
create or replace function public.nav_forslag_handelse_prov()
returns trigger
language plpgsql
as $$
begin
  select f.prov into new.prov from public.nav_forslag f where f.id = new.forslag;
  new.prov := coalesce(new.prov, false);
  return new;
end;
$$;
drop trigger if exists nav_forslag_handelse_prov on public.nav_forslag_handelse;
create trigger nav_forslag_handelse_prov before insert on public.nav_forslag_handelse
  for each row execute function public.nav_forslag_handelse_prov();

-- Inga ändringar och inga raderingar, utom provdata och avidentifieringen.
create or replace function public.nav_forslag_orubblig()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.prov then
      return old;
    end if;
  elsif coalesce(current_setting('nav.forslag_avid', true), '') = 'on' then
    return new;
  end if;
  raise exception 'Förslagsloggen tar bara emot nya rader.' using errcode = '42501';
end;
$$;
drop trigger if exists nav_forslag_orubblig on public.nav_forslag;
create trigger nav_forslag_orubblig before update or delete on public.nav_forslag
  for each row execute function public.nav_forslag_orubblig();
drop trigger if exists nav_forslag_handelse_orubblig on public.nav_forslag_handelse;
create trigger nav_forslag_handelse_orubblig before update or delete on public.nav_forslag_handelse
  for each row execute function public.nav_forslag_orubblig();

create or replace function public.nav_forslag_ej_tom()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Förslagsloggen går inte att tömma.' using errcode = '42501';
end;
$$;
drop trigger if exists nav_forslag_ej_tom on public.nav_forslag;
create trigger nav_forslag_ej_tom before truncate on public.nav_forslag
  for each statement execute function public.nav_forslag_ej_tom();
drop trigger if exists nav_forslag_handelse_ej_tom on public.nav_forslag_handelse;
create trigger nav_forslag_handelse_ej_tom before truncate on public.nav_forslag_handelse
  for each statement execute function public.nav_forslag_ej_tom();

-- -----------------------------------------------------------------------------
-- 2. Vem som får läsa (RLS). Skrivning sker bara från servern, efter kontroll.
--
-- Personen raden handlar om, och de som får se den personens tal: teamledaren
-- för personens lag, och säljchef, vd och administratör. En rad för ett lag
-- läses av lagets teamledare. En rad för hela företaget läses bara av säljchef,
-- vd och administratör. `mote_ar_chef()` räcker alltså inte som villkor: den
-- släpper in varje teamledare.
-- -----------------------------------------------------------------------------

alter table public.nav_forslag enable row level security;
alter table public.nav_forslag_handelse enable row level security;
revoke all on public.nav_forslag, public.nav_forslag_handelse from public, anon, authenticated;
grant select on public.nav_forslag, public.nav_forslag_handelse to authenticated;
grant select, insert, update, delete on public.nav_forslag, public.nav_forslag_handelse to service_role;

drop policy if exists nav_forslag_las on public.nav_forslag;
create policy nav_forslag_las on public.nav_forslag for select to authenticated using (
  public.has_any_role(array['sales_manager', 'ceo', 'admin'])
  or om = public.current_employee_id()
  or (om is not null and public.has_any_role(array['team_lead']) and public.leads_employee(om))
  or (om is null and lag is not null and exists (
        select 1 from public.team t where t.id = nav_forslag.lag and t.lead_id = public.current_employee_id()))
);

drop policy if exists nav_forslag_handelse_las on public.nav_forslag_handelse;
create policy nav_forslag_handelse_las on public.nav_forslag_handelse for select to authenticated using (
  exists (select 1 from public.nav_forslag f where f.id = nav_forslag_handelse.forslag)
);

-- -----------------------------------------------------------------------------
-- 3. Läget: en rad per förslag med det senaste som gäller
--
-- Beslutet gäller när den senaste av händelserna beslut och ångrad är ett
-- beslut. En händelse som pekats ut av en `ogiltig` räknas inte.
-- `security_invoker`: vyn läses med läsarens egen RLS.
-- -----------------------------------------------------------------------------

create or replace view public.nav_forslag_giltig with (security_invoker = true) as
select h.*
  from public.nav_forslag_handelse h
 where h.sort <> 'ogiltig'
   and not exists (select 1 from public.nav_forslag_handelse o where o.ogiltigar = h.id);

create or replace view public.nav_forslag_lage with (security_invoker = true) as
select
  f.id, f.sort, f.regel, f.nyckel, f.kalla, f.om, f.lag, f.skapad, f.skapad_av, f.belagg, f.trodde, f.val,
  f.foljer, f.doms_dag, f.utgar, f.text, f.prov, f.avidentifierad,
  b.id as beslut_id, b.data as beslut, b.av as beslut_av, b.nar as beslut_nar,
  a.data as atgard,
  k.data as kommentar, k.nar as kommentar_nar,
  m.data as matning, m.nar as matning_nar,
  d.data as dom, d.nar as dom_nar
from public.nav_forslag f
left join lateral (
  select h.id, h.sort, h.data, h.av, h.nar
    from public.nav_forslag_giltig h
   where h.forslag = f.id and h.sort in ('beslut', 'angrad')
   order by h.nar desc, h.id desc
   limit 1
) s on true
left join lateral (select s.id, s.data, s.av, s.nar where s.sort = 'beslut') b on true
left join lateral (
  select h.data from public.nav_forslag_giltig h
   where h.forslag = f.id and h.sort = 'atgard' and b.id is not null and h.nar >= b.nar
   order by h.nar desc, h.id desc limit 1
) a on true
left join lateral (
  select h.data, h.nar from public.nav_forslag_giltig h
   where h.forslag = f.id and h.sort = 'kommentar' order by h.nar desc, h.id desc limit 1
) k on true
left join lateral (
  select h.data, h.nar from public.nav_forslag_giltig h
   where h.forslag = f.id and h.sort = 'matning' order by h.nar desc, h.id desc limit 1
) m on true
left join lateral (
  select h.data, h.nar from public.nav_forslag_giltig h
   where h.forslag = f.id and h.sort = 'dom' order by h.nar desc, h.id desc limit 1
) d on true;

revoke all on public.nav_forslag_giltig, public.nav_forslag_lage from public, anon, authenticated;
grant select on public.nav_forslag_giltig, public.nav_forslag_lage to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Ett val per förslag, tvingat här
--
-- Två klick i samma ögonblick ska ge ett beslut. Rutten kan inte lova det med
-- "läs, sedan skriv". Funktionen låser förslagets rad, ser efter om ett beslut
-- redan gäller och skriver bara annars. Svaret är händelsens id, eller null när
-- valet redan är gjort. Bara servern får köra den.
-- -----------------------------------------------------------------------------

create or replace function public.nav_forslag_valj(p_forslag uuid, p_av uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_senaste text;
  v_id uuid;
begin
  perform 1 from public.nav_forslag where id = p_forslag for update;
  if not found then
    return null;
  end if;
  select h.sort into v_senaste
    from public.nav_forslag_giltig h
   where h.forslag = p_forslag and h.sort in ('beslut', 'angrad')
   order by h.nar desc, h.id desc
   limit 1;
  if v_senaste = 'beslut' then
    return null;
  end if;
  insert into public.nav_forslag_handelse (forslag, sort, av, data)
  values (p_forslag, 'beslut', p_av, coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.nav_forslag_valj(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.nav_forslag_valj(uuid, uuid, jsonb) to service_role;

-- Ångra: bara när ett beslut gäller, under samma lås. Svaret är det ångrade beslutets id, eller null.
create or replace function public.nav_forslag_angra(p_forslag uuid, p_av uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sort text;
  v_beslut uuid;
begin
  perform 1 from public.nav_forslag where id = p_forslag for update;
  if not found then
    return null;
  end if;
  select h.sort, h.id into v_sort, v_beslut
    from public.nav_forslag_giltig h
   where h.forslag = p_forslag and h.sort in ('beslut', 'angrad')
   order by h.nar desc, h.id desc
   limit 1;
  if v_sort is distinct from 'beslut' then
    return null;
  end if;
  -- Ett förslag som redan fått sin dom går inte att ångra.
  if exists (select 1 from public.nav_forslag_giltig h where h.forslag = p_forslag and h.sort = 'dom') then
    return null;
  end if;
  insert into public.nav_forslag_handelse (forslag, sort, av, data)
  values (p_forslag, 'angrad', p_av, coalesce(p_data, '{}'::jsonb) || jsonb_build_object('beslut', v_beslut));
  return v_beslut;
end;
$$;
revoke all on function public.nav_forslag_angra(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.nav_forslag_angra(uuid, uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 5. Avidentifieringen: 24 månader efter domsdagen
--
-- Personen och id:n på raderna bakom tas bort. Talen blir kvar, så att Navs
-- facit finns kvar. Flaggan gäller bara den här transaktionen.
-- -----------------------------------------------------------------------------

create or replace function public.nav_forslag_avidentifiera(p_fore date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antal integer;
begin
  perform set_config('nav.forslag_avid', 'on', true);
  update public.nav_forslag_handelse h
     set av = null,
         data = case when h.sort = 'kommentar' then jsonb_build_object('text', '(borttagen)') else h.data - 'uppgift' - 'fran' end
    from public.nav_forslag f
   where f.id = h.forslag and f.avidentifierad is null and f.om is not null
     and coalesce(f.doms_dag, f.skapad::date) < p_fore;
  update public.nav_forslag f
     set om = null, skapad_av = null, belagg = f.belagg - 'rader' - 'mote', text = null, avidentifierad = now(),
         nyckel = 'avid:' || f.id::text
   where f.avidentifierad is null and f.om is not null
     and coalesce(f.doms_dag, f.skapad::date) < p_fore;
  get diagnostics v_antal = row_count;
  perform set_config('nav.forslag_avid', '', true);
  return v_antal;
end;
$$;
revoke all on function public.nav_forslag_avidentifiera(date) from public, anon, authenticated;
grant execute on function public.nav_forslag_avidentifiera(date) to service_role;

-- -----------------------------------------------------------------------------
-- 6. Navs facit och taktens morgonvärden: det som visades, sparat
--
-- `nav_facit_dom`: domen över ett val, sparad varje gång antalet avgjorda möten
-- passerar ett nytt tiotal. Egen tabell, inte en rad i förslagsloggen: annars
-- krockar nycklarna mellan lag och antal, och facit dyker upp som "senaste
-- domen" i Det som ändrats.
--
-- `nav_takt_dag`: vad takten sa varje morgon. Taktens facit räknas ur det som
-- faktiskt stod på kortet, inte ur en uträkning i efterhand.
--
-- Båda läses bara av servern, som lämnar ut summor för kretsen (som Golvet).
-- -----------------------------------------------------------------------------

create table if not exists public.nav_facit_dom (
  id uuid primary key default gen_random_uuid(),
  regel text not null check (regel ~ '^[a-z0-9.-]{1,60}$'),
  -- 'alla' eller ett lags id.
  krets text not null,
  -- Antalet avgjorda möten domen räknades på (ett jämnt tiotal).
  vid integer not null check (vid >= 0),
  hog_n integer not null, hog_av integer not null,
  lag_n integer not null, lag_av integer not null,
  sort text not null check (sort in ('utslag', 'for-fa', 'en-person', 'tomt')),
  p numeric,
  tidigast integer,
  matt_version integer not null default 1,
  sparad timestamptz not null default now(),
  prov boolean not null default false,
  constraint nav_facit_dom_unik unique (regel, krets, vid, hog_n, hog_av, lag_n, lag_av)
);
alter table public.nav_facit_dom enable row level security;
revoke all on public.nav_facit_dom from public, anon, authenticated;
grant select, insert, delete on public.nav_facit_dom to service_role;

create table if not exists public.nav_takt_dag (
  krets text not null,
  manad date not null check (extract(day from manad) = 1),
  -- Arbetsdagar som gått på morgonen.
  gatt integer not null check (gatt >= 0),
  netto integer not null,
  prognos integer,
  sparad timestamptz not null default now(),
  primary key (krets, manad, gatt)
);
alter table public.nav_takt_dag enable row level security;
revoke all on public.nav_takt_dag from public, anon, authenticated;
grant select, insert on public.nav_takt_dag to service_role;

-- -----------------------------------------------------------------------------
-- 7. Inställningarnas historik
--
-- `nav_setting` sparar vem och när, men inte det gamla värdet. Triggern skriver
-- gammalt och nytt värde i `audit_log` för varje ändring, så att en ändrad
-- inställning kan bli en ändring i loggen (1.5, ingång 3).
--
-- DEN FÅR ALDRIG FÄLLA EN SPARNING. Den går också för koden på main, så ett fel
-- här hade stoppat varje inställning i Nav. Allt ligger i ett eget block som
-- fångar felet och bara varnar.
-- -----------------------------------------------------------------------------

create or replace function public.nav_setting_historik()
returns trigger
language plpgsql
as $$
begin
  begin
    if tg_op = 'INSERT' or new.value is distinct from old.value then
      insert into public.audit_log (actor_id, action, object_type, object_id, meta)
      values (
        new.updated_by, 'installning', 'nav_setting', new.key,
        jsonb_build_object('fore', case when tg_op = 'UPDATE' then old.value else null end, 'efter', new.value)
      );
    end if;
  exception when others then
    raise warning 'nav_setting_historik: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists nav_setting_historik on public.nav_setting;
create trigger nav_setting_historik after insert or update on public.nav_setting
  for each row execute function public.nav_setting_historik();

-- -----------------------------------------------------------------------------
-- 8. Offertens belopp (1.6)
--
-- Rutan Offert skickad får ett belopp. Äldre offerter saknar det, så varje tal
-- leder med antalet: "5 offerter väntar, 3 med belopp: 212 000 kr."
-- -----------------------------------------------------------------------------

alter table public.mote_kedja add column if not exists offert_belopp integer;
alter table public.mote_kedja add column if not exists offert_paket smallint;
alter table public.mote_kedja drop constraint if exists mote_kedja_offert_belopp_check;
alter table public.mote_kedja add constraint mote_kedja_offert_belopp_check
  check (offert_belopp is null or offert_belopp between 0 and 100000000);
alter table public.mote_kedja drop constraint if exists mote_kedja_offert_paket_fkey;
alter table public.mote_kedja add constraint mote_kedja_offert_paket_fkey
  foreign key (offert_paket) references public.sales_package (id) on delete set null;

-- -----------------------------------------------------------------------------
-- 9. "Jag ringer själv": bekräftelsen går till den som håller mötet
--
-- `mote_uppgift_skapa` (0291) gör ingenting när mötet redan har en uppgift. Här
-- lämnas den öppna uppgiften över med `uppgift_passa` (0298), så att bokaren
-- står kvar i uppgiften och ser vem som tog den. Har bokaren bockat av sin
-- uppgift utan att mötet blev bekräftat, eller finns ingen, läggs en ny upp.
--
-- Svaret: {task, fran, ny}. `fran` är den som hade uppgiften före (för Ångra),
-- `ny` är sant när uppgiften lades upp här. Null när mötet inte längre går att
-- bekräfta (bekräftat, har utfall eller har börjat).
-- -----------------------------------------------------------------------------

create or replace function public.mote_bekrafta_overta(p_mote uuid, p_till uuid, p_dag date, p_titel text, p_beskrivning text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m record;
  v_task uuid;
  v_fran uuid;
begin
  select id, bokat_av, bekraftat_nar, utfall, mote_tid into v_m from public.mote where id = p_mote for update;
  if not found or v_m.bekraftat_nar is not null or v_m.utfall is not null or v_m.mote_tid <= now() then
    return null;
  end if;

  select mu.task_id into v_task from public.mote_uppgift mu where mu.mote_id = p_mote;
  if v_task is not null and not public.mote_uppgift_oppen(v_task) then
    -- Avbockad utan att mötet blev bekräftat: den står kvar som historik men är inte längre mötets uppgift.
    delete from public.mote_uppgift where task_id = v_task;
    v_task := null;
  end if;

  if v_task is not null then
    select assignee_id into v_fran from public.task where id = v_task;
    perform public.uppgift_passa(v_task, p_till, p_till, true, 'tog över bekräftelsen: Jag ringer själv');
    update public.task set due_date = p_dag where id = v_task and due_date is distinct from p_dag;
    return jsonb_build_object('task', v_task, 'fran', v_fran, 'ny', false);
  end if;

  insert into public.task (title, description_md, assignee_id, created_by, due_date, priority, estimate_minutes)
  values (left(p_titel, 200), coalesce(p_beskrivning, ''), p_till, v_m.bokat_av, p_dag, 2, 5)
  returning id into v_task;
  insert into public.task_event (task_id, type, by_employee_id, note, at)
  values (v_task, 'skapad', p_till, 'Upplagd av Nav efter valet Jag ringer själv.', clock_timestamp());
  insert into public.task_link (task_id, mote_id, created_by) values (v_task, p_mote, p_till);
  insert into public.mote_uppgift (task_id, mote_id) values (v_task, p_mote);
  return jsonb_build_object('task', v_task, 'fran', null, 'ny', true);
end;
$$;
revoke all on function public.mote_bekrafta_overta(uuid, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.mote_bekrafta_overta(uuid, uuid, date, text, text) to service_role;

-- Ångra "Jag ringer själv": uppgiften går tillbaka till den som hade den, eller tas bort om den lades upp av valet.
-- Bara en öppen uppgift rörs. Svaret är sant när något togs tillbaka.
create or replace function public.mote_bekrafta_aterlamna(p_task uuid, p_fran uuid, p_ny boolean, p_av uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.mote_uppgift where task_id = p_task) or not public.mote_uppgift_oppen(p_task) then
    return false;
  end if;
  if p_ny then
    delete from public.task where id = p_task;
    return true;
  end if;
  perform public.uppgift_passa(p_task, p_fran, p_av, false, 'ångrade Jag ringer själv');
  return true;
end;
$$;
revoke all on function public.mote_bekrafta_aterlamna(uuid, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.mote_bekrafta_aterlamna(uuid, uuid, boolean, uuid) to service_role;
