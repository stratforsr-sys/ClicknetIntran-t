-- =============================================================================
-- 0287_moten_bekraftelse_provision.sql — Möten: försöken att bekräfta, nivån
-- på ett hållet möte och den låsta mötesprovisionen
--
-- -----------------------------------------------------------------------------
-- VARFÖR (beställaren 2026-11-11, DESIGN-2026-11-11-bekraftelse-provision.md)
-- -----------------------------------------------------------------------------
--
-- Bokaren bekräftar mötet ett inställbart antal dagar före. Får hon inte tag
-- på kunden ligger mötet kvar och försöket räknas. Efter mötet svarar säljaren
-- på kvalificeringsfrågorna, och svaren ger nivån: kvalificerat eller hållet.
-- Nivån avgör bokarens mötesprovision, som låses när nivån sätts (eller när
-- mötet tappas), så att en senare ändring av beloppen aldrig rör ett avgjort
-- möte.
--
-- Inget här är skrivet för ett visst företag. Frågor, belopp, dagar och vilka
-- som får mötesprovision ligger i nav_setting under "moten.*" och har neutrala
-- förval i koden (src/lib/nav2/motesflode.ts).
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- 1. `mote` får försöken (`forsok`, `senast_forsok`), flyttiden
--    (`flyttad_nar`), nivån med svaren (`niva`, `niva_svar`, `niva_nar`,
--    `niva_av`) och `provision_last_nar`. Den sista sätts när låsningen körts,
--    också när den gav noll rader, så att "ingen rad" går att skilja från
--    "aldrig låst" (påminnelsejobbet lagar ett möte som aldrig låstes).
-- 2. Tabellen `mote_provision`: en rad per möte och person med det låsta
--    beloppet, det möjliga beloppet, satserna som gällde och vilken andel
--    raden är. En ändring i efterhand räknas om ur raden, aldrig ur dagens
--    inställning. Bara service role skriver; den anställda läser sina egna
--    rader, ekonomi och superadmin läser alla (samma krets som commission_entry).
-- 3. `mote_las_provision(...)`: nivån och raderna i EN transaktion, villkorad
--    på att nivån inte redan är satt. Dubbelklick ger P0409.
-- 4. `moten.galler-fran` = nu. Möten före den tiden får aldrig "väntar på
--    bedömning", påminnelser eller låsning. Gäller varje installation.
--
-- `mote_kolumn` (0261) avvecklas inte: uppföljningens lägen läses ur den.
-- Omkörbar.
-- =============================================================================

-- 1. Kolumnerna på mote.
alter table public.mote
  add column if not exists forsok             int not null default 0,
  add column if not exists senast_forsok      timestamptz,
  add column if not exists flyttad_nar        timestamptz,
  add column if not exists niva               text,
  add column if not exists niva_svar          jsonb,
  add column if not exists niva_nar           timestamptz,
  add column if not exists niva_av            uuid references public.employee(id) on delete set null,
  add column if not exists provision_last_nar timestamptz;

alter table public.mote drop constraint if exists mote_forsok_icke_negativt;
alter table public.mote add constraint mote_forsok_icke_negativt check (forsok >= 0);
alter table public.mote drop constraint if exists mote_niva_varde;
alter table public.mote add constraint mote_niva_varde check (niva is null or niva in ('kvalificerat','hallet'));
-- `is not distinct from` så att villkoret aldrig blir NULL (och därmed släpper igenom) när utfall saknas.
alter table public.mote drop constraint if exists mote_niva_kraver_hallet;
alter table public.mote add constraint mote_niva_kraver_hallet check (niva is null or utfall is not distinct from 'hallet');
alter table public.mote drop constraint if exists mote_niva_par;
alter table public.mote add constraint mote_niva_par check ((niva is null) = (niva_nar is null));

-- Påminnelsejobbet letar hållna möten utan nivå och avgjorda möten som aldrig låstes.
create index if not exists mote_olast_idx on public.mote (mote_tid) where utfall is not null and provision_last_nar is null;

-- 2. Den låsta mötesprovisionen.
create table if not exists public.mote_provision (
  mote_id        uuid not null references public.mote(id) on delete cascade,
  employee_id    uuid not null references public.employee(id),
  niva           text check (niva is null or niva in ('kvalificerat','hallet')),
  belopp         numeric(10,2) not null check (belopp >= 0),
  mojligt        numeric(10,2) not null check (mojligt >= 0),
  skal           text,
  satser         jsonb not null,
  delat_med      uuid references public.employee(id),
  del            text not null check (del in ('hel','forsta_halvan','andra_halvan')),
  manad          date not null check (extract(day from manad) = 1),
  version        int not null default 1 check (version >= 1),
  last_nar       timestamptz not null default now(),
  last_av        uuid references public.employee(id) on delete set null,
  ifragasatt_nar timestamptz,
  ifragasatt_av  uuid references public.employee(id) on delete set null,
  beslut_nar     timestamptz,
  beslut_av      uuid references public.employee(id) on delete set null,
  primary key (mote_id, employee_id),
  -- Ett hållet möte har en nivå och inget skäl, ett tappat har ett skäl och ingen nivå.
  constraint mote_provision_niva_eller_skal check ((niva is null) = (skal is not null))
);

create index if not exists mote_provision_person_manad_idx on public.mote_provision (employee_id, manad);

alter table public.mote_provision enable row level security;

drop policy if exists mote_provision_read on public.mote_provision;
create policy mote_provision_read on public.mote_provision for select to authenticated
  using (
    employee_id = (select public.current_employee_id())
    or (select public.far_hantera_provision())
    or (select public.has_any_role(array['admin']))
  );

revoke all on table public.mote_provision from anon;
revoke insert, update, delete, truncate on table public.mote_provision from authenticated;
grant select on table public.mote_provision to authenticated;
grant all on table public.mote_provision to service_role;

-- 3. Nivån och raderna i en transaktion.
create or replace function public.mote_las_provision(p_mote uuid, p_niva text, p_svar jsonb, p_av uuid, p_rader jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_antal int;
begin
  if p_niva is not null then
    update public.mote
       set niva = p_niva, niva_svar = p_svar, niva_nar = now(), niva_av = p_av, provision_last_nar = now()
     where id = p_mote and niva is null and utfall = 'hallet';
  else
    -- Ett tappat möte (uteblev, avbokat): bara raderna och låstiden.
    update public.mote
       set provision_last_nar = now()
     where id = p_mote and provision_last_nar is null and utfall is not null and utfall <> 'hallet';
  end if;
  get diagnostics v_antal = row_count;
  if v_antal = 0 then
    raise exception 'Mötets provision är redan låst, eller mötet har inte det utfallet'
      using errcode = 'P0409';
  end if;

  insert into public.mote_provision
    (mote_id, employee_id, niva, belopp, mojligt, skal, satser, delat_med, del, manad, last_av)
  select p_mote, r.employee_id, r.niva, r.belopp, r.mojligt, r.skal, r.satser, r.delat_med, r.del, r.manad, p_av
    from jsonb_to_recordset(coalesce(p_rader, '[]'::jsonb))
      as r(employee_id uuid, niva text, belopp numeric, mojligt numeric, skal text, satser jsonb, delat_med uuid, del text, manad date)
  on conflict (mote_id, employee_id) do nothing;
end;
$$;

revoke all on function public.mote_las_provision(uuid, text, jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mote_las_provision(uuid, text, jsonb, uuid, jsonb) to service_role;

-- 4. Från och med nu.
insert into public.nav_setting (key, value) values ('moten.galler-fran', to_jsonb(now()))
on conflict (key) do nothing;
