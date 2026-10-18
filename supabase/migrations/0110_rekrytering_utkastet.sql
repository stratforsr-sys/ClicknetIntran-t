-- 0110 · Rekrytering: det Nav 2.0 har och navet saknade (2026-10-18)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s rekrytering har funktioner som 0030 inte bär. Beställaren
-- 2026-10-15: ingen funktion i utkastet får försvinna. Allt nedan är additivt;
-- stegautomaten, K27-villkoren och gallringsregeln i 0030 rörs inte.
--
--   1. recruitment_position: tjänsterna, hur många som ska anställas, när de
--      börjar, och var annonsen ligger. Navet publicerar ingenting självt —
--      kolumnerna säger vad någon antecknat.
--   2. candidate: tjänsten, tipset från en anställd, svaren i ansökan, CV:t,
--      erbjudandet och när frågan om talangpoolen gick ut.
--   3. interview_scorecard: de fem kriterierna och screeningens svar.
--   4. candidate_note: anteckningar, samtal, "svarade inte", läst CV.
--   5. interview_slot och candidate_booking: intervjutiderna och bokningarna,
--      med kalendermötet de blev.
--   6. candidate_booking_link: bokningslänken som kandidaten väljer tid med.
--   7. candidate_message: allt som ska till kandidaten. INGENTING SKICKAR
--      HÄRIFRÅN — raderna står som `vantar` tills beställaren bestämt hur
--      mejl och SMS till kandidater ska gå. Se HANDOFF, Del: Rekrytering.
--   8. candidate_merit_request: begäran om meriter (diskrimineringslagen
--      2 kap. 4 §) och svaret.
--   9. recruitment_template: mallarnas ändrade texter. Utkastets text är
--      grunden; en rad här är en ändring av den.
--  10. recruitment_policy: Så är jobbet, målet och när laget bads om tips.
--      Inget av dem sätts här.
--
-- Läsning: kretsen `far_rekrytera()`, som resten av 0030. Skrivning sker med
-- service role efter rutten /nav2/rekrytering:s egna kontroller.
-- =============================================================================

-- 1. Tjänsterna ---------------------------------------------------------------

create table public.recruitment_position (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  title text not null check (btrim(title) <> '' and char_length(title) <= 120),
  short_title text not null check (btrim(short_title) <> '' and char_length(short_title) <= 60),
  headcount int not null check (headcount between 1 and 20),
  start_date date not null,
  opened_at date not null default current_date,
  platsbanken_until date,
  linkedin_until date,
  page_open boolean not null default true,
  closed_at timestamptz,
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.recruitment_position enable row level security;
create policy recruitment_position_read on public.recruitment_position for select to authenticated
  using (public.far_rekrytera());

-- 2. Kandidaten ---------------------------------------------------------------

alter table public.candidate
  add column if not exists position_id uuid references public.recruitment_position (id) on delete set null,
  add column if not exists tipped_by uuid references public.employee (id) on delete set null,
  add column if not exists tip_text text check (char_length(tip_text) <= 2000),
  add column if not exists tip_consent_at timestamptz,
  add column if not exists application_answers jsonb,
  add column if not exists cv_file_id uuid references public.file_object (id) on delete set null,
  add column if not exists offer_start date,
  add column if not exists offer_form text check (offer_form in ('probation', 'permanent')),
  add column if not exists offer_reply_by date,
  add column if not exists offer_sent_at timestamptz,
  add column if not exists pool_asked_at timestamptz;

-- Ett tips kräver att personen vet om det (utkastets bock).
alter table public.candidate add constraint candidate_tips_kraver_samtycke
  check (tip_text is null or tip_consent_at is not null);
-- K27 på det nya fritextfältet, med 0030:s egen funktion.
alter table public.candidate add constraint candidate_tips_inget_personnummer
  check (not public.ser_ut_som_personnummer(coalesce(tip_text, '')));

create index if not exists candidate_tipped_by_idx on public.candidate (tipped_by) where tipped_by is not null;

-- 3. Scorecarden --------------------------------------------------------------

alter table public.interview_scorecard
  add column if not exists criteria jsonb,
  add column if not exists screening jsonb;
alter table public.interview_scorecard add constraint scorecard_utkast_inget_personnummer
  check (not public.ser_ut_som_personnummer(coalesce(screening::text, '')));

-- 4. Anteckningar och samtal --------------------------------------------------

create table public.candidate_note (
  id bigserial primary key,
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  kind text not null check (kind in ('not', 'ring', 'ej_svar', 'cv')),
  body text check (char_length(body) <= 2000),
  by_employee uuid references public.employee (id) on delete set null,
  at timestamptz not null default now(),
  constraint candidate_note_inget_personnummer check (not public.ser_ut_som_personnummer(coalesce(body, '')))
);
create index candidate_note_idx on public.candidate_note (candidate_id, at);
alter table public.candidate_note enable row level security;
create policy candidate_note_read on public.candidate_note for select to authenticated
  using (public.far_rekrytera());

-- 5. Tiderna och bokningarna --------------------------------------------------

create table public.interview_slot (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  place text not null check (btrim(place) <> '' and char_length(place) <= 120),
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_min > start_min),
  unique (day, start_min)
);
alter table public.interview_slot enable row level security;
create policy interview_slot_read on public.interview_slot for select to authenticated
  using (public.far_rekrytera());

create table public.candidate_booking (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  slot_id uuid references public.interview_slot (id) on delete set null,
  kind text not null check (kind in ('tel', 'int1', 'int2')),
  day date not null,
  start_min int not null check (start_min between 0 and 1439),
  end_min int not null check (end_min between 1 and 1440),
  place text not null check (char_length(place) <= 120),
  attendees uuid[] not null default '{}',
  status text not null default 'bokad' check (status in ('bokad', 'klar', 'uteblev', 'avbokad')),
  booked_by_candidate boolean not null default false,
  calendar_event_id uuid references public.calendar_event (id) on delete set null,
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (end_min > start_min)
);
-- En tid har högst en bokning som gäller.
create unique index candidate_booking_slot_uniq on public.candidate_booking (slot_id)
  where slot_id is not null and status <> 'avbokad';
create index candidate_booking_idx on public.candidate_booking (candidate_id, day);
alter table public.candidate_booking enable row level security;
create policy candidate_booking_read on public.candidate_booking for select to authenticated
  using (public.far_rekrytera());

-- 6. Bokningslänken -----------------------------------------------------------

create table public.candidate_booking_link (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  kind text not null check (kind in ('tel', 'int1', 'int2')),
  attendees uuid[] not null default '{}',
  token text not null unique check (char_length(token) >= 20),
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  cancelled_at timestamptz
);
create index candidate_booking_link_idx on public.candidate_booking_link (candidate_id) where used_at is null and cancelled_at is null;
alter table public.candidate_booking_link enable row level security;
create policy candidate_booking_link_read on public.candidate_booking_link for select to authenticated
  using (public.far_rekrytera());

-- 7. Det som ska till kandidaten ----------------------------------------------
--
-- INGENTING TÖMMER DEN HÄR TABELLEN. Utkorgen i 0069 rörs inte (dess `kind`
-- känner inte kandidater, och den är påslagen). En rad här är ett beslut att
-- något ska skickas, och den står som `vantar` tills utskicket finns.

create table public.candidate_message (
  id bigserial primary key,
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  booking_id uuid references public.candidate_booking (id) on delete set null,
  template text not null check (template in ('bekr', 'lank', 'bokad', 'sms24', 'sms2', 'avslag1', 'avslag2', 'erbj', 'pool', 'ringt', 'pamin', 'avbokad', 'merit')),
  channel text not null check (channel in ('mejl', 'sms', 'mejl_ics', 'mejl_sms')),
  body text not null check (char_length(body) <= 4000),
  status text not null default 'vantar' check (status in ('vantar', 'skickad', 'fel', 'avbruten')),
  send_after timestamptz not null default now(),
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);
create index candidate_message_idx on public.candidate_message (candidate_id, created_at);
alter table public.candidate_message enable row level security;
create policy candidate_message_read on public.candidate_message for select to authenticated
  using (public.far_rekrytera());

-- 8. Begäran om meriter -------------------------------------------------------

create table public.candidate_merit_request (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  requested_at date not null default current_date,
  answered_at timestamptz,
  answer_text text check (char_length(answer_text) <= 4000),
  registered_by uuid references public.employee (id) on delete set null,
  answered_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint merit_inget_personnummer check (not public.ser_ut_som_personnummer(coalesce(answer_text, '')))
);
create unique index candidate_merit_oppen_uniq on public.candidate_merit_request (candidate_id) where answered_at is null;
alter table public.candidate_merit_request enable row level security;
create policy candidate_merit_request_read on public.candidate_merit_request for select to authenticated
  using (public.far_rekrytera());

-- 9. Mallarnas ändrade texter -------------------------------------------------

create table public.recruitment_template (
  slug text primary key check (slug in ('bekr', 'lank', 'bokad', 'sms24', 'sms2', 'avslag1', 'avslag2', 'erbj', 'pool')),
  body text not null check (btrim(body) <> '' and char_length(body) <= 4000),
  updated_by uuid references public.employee (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.recruitment_template enable row level security;
create policy recruitment_template_read on public.recruitment_template for select to authenticated
  using (public.far_rekrytera());

-- 10. Bolagets val ------------------------------------------------------------

alter table public.recruitment_policy
  add column if not exists job_text text check (char_length(job_text) <= 4000),
  add column if not exists goal_name text check (char_length(goal_name) <= 80),
  add column if not exists goal_count int check (goal_count between 1 and 200),
  add column if not exists goal_by date,
  add column if not exists tips_asked_at timestamptz,
  add column if not exists tips_asked_by uuid references public.employee (id) on delete set null;
