-- =============================================================================
-- 0021_ical.sql — E7.3 / AC-3.3 kalenderfloden
--
-- Ett iCal-flode ar en URL utan inloggning. Den som har lanken har innehallet,
-- och en lank som klistras in i Google Calendar ligger darefter hos Google.
-- Tre saker foljer av det, och alla tre ar byggda in i schemat nedan.
--
-- 1. SJUKFRANVARO GAR ALDRIG UT I ETT FLODE.
--    Floden bar `absence_request`, aldrig `sick_report`. Ett kalenderflode med
--    sjukdagar ar halsodata pa en tredjepartsserver, och ingen rotation av
--    URL:en tar tillbaka det som redan synkats dit. Sparren sitter i koden som
--    bygger floden (`src/lib/ical.ts`) och star utskriven dar ocksa.
--
-- 2. TYPEN FOLJER INTE MED.
--    Posterna heter "Namn — Ledig". Att nagon ar foraldraledig eller vabbar ar
--    en upplysning om varfor, och den hor hemma i navet bakom inloggning, inte
--    i en delad kalender.
--
-- 3. FLODET AR ENKELRIKTAT OCH ROTERBART.
--    Ingen skrivning tar vagen tillbaka genom URL:en. `token` gar att byta nar
--    som helst, och `revoked_at` stanger den for gott.
--
-- E1.7: offboarding ska sparra flodet. Det behovs ingen atgard i
-- offboardingkoden for det — vagen ut kontrollerar agarens `status` vid varje
-- lasning. Samma resonemang som notisklockan i 0018: en sparr som kraver att
-- en annan del av systemet KOMMER IHAG att stanga den ar en sparr som en dag
-- star oppen. `revoked_at` finns anda, for det ar en annan fraga: "jag tror
-- min lank har lackt".
-- =============================================================================

create table if not exists calendar_feed (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,

  -- 'mine' = agarens egen ledighet. 'team' = de agaren leder.
  --
  -- Ett teamflode skapas bara at nagon som faktiskt leder folk, och det
  -- kontrolleras nar flodet skapas OCH nar det lases. Slutar nagon vara chef
  -- slutar flodet ge rader, utan att nagon behover minnas att stanga det.
  scope text not null default 'mine' check (scope in ('mine','team')),

  -- Hemligheten. Slumpas i koden, aldrig av en sekvens: ett flode med lopnummer
  -- gar att gissa sig till granne med.
  token text not null unique check (length(token) >= 32),

  created_at   timestamptz not null default now(),
  rotated_at   timestamptz,

  -- Sa att en lackt lank som nagon annan pollar gar att upptacka. Skrivs vid
  -- varje lasning; det ar den enda skrivning ett flode kan orsaka.
  last_read_at timestamptz,
  read_count   int not null default 0,

  revoked_at   timestamptz,
  revoked_by   uuid references employee(id),

  constraint calendar_feed_aterkallad check (
    (revoked_by is null) = (revoked_at is null)
  ),

  -- Ett flode per person och sort. Fler an sa ar fler hemligheter att halla
  -- reda pa utan att nagon far se nagot nytt.
  unique (employee_id, scope)
);

create index if not exists calendar_feed_token_idx on calendar_feed (token) where revoked_at is null;

alter table calendar_feed enable row level security;

-- Den egna raden, och ledningen som ska kunna se att ett flode finns.
--
-- Att `token` ligger i samma tabell ar med flit: agaren MASTE kunna lasa sin
-- egen hemlighet, annars gar lanken inte att kopiera. Ledningen ser raden och
-- darmed ocksa token — det ar priset for att kunna svara pa fragan "vilka
-- floden ar oppna", och sales_manager och ceo ser anda all ledighet i navet.
drop policy if exists calendar_feed_read on calendar_feed;
create policy calendar_feed_read on calendar_feed for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','ceo'])
  );
