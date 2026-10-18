-- 0110 · Rekrytering: det Nav 2.0 har och navet saknade (2026-10-18)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s rekrytering har funktioner som 0030 inte bär. Beställaren
-- 2026-10-15: ingen funktion i utkastet får försvinna. Beställaren 2026-10-18
-- om Rekrytering: en kandidat får sakna e-post, utskicken går med Resend (inga
-- SMS), ingen publik boknings- eller ansökningssida, gallring efter 12
-- månader, samtycket till talangpoolen registreras, mål sätts (också
-- periodiska), och anställningens slutorsak sparas så att företrädesrätten
-- går att avgöra. Migrationen körs tillsammans med resten av Nav 2.0, inte
-- före.
--
--   1. recruitment_position: tjänsterna, hur många som ska anställas, när de
--      börjar, och var annonsen ligger. Navet publicerar ingenting självt —
--      kolumnerna säger vad någon antecknat (Platsbanken, LinkedIn).
--   2. candidate: e-posten blir valfri (telefon räcker), tjänsten, tipset från
--      en anställd, svaren i ansökan, CV:t, erbjudandet och talangpoolens fråga
--      och nej.
--   3. interview_scorecard: de fem kriterierna och screeningens svar.
--   4. candidate_note: anteckningar, samtal, "svarade inte", läst CV.
--   5. interview_slot och candidate_booking: intervjutiderna och bokningarna,
--      med kalendermötet de blev.
--   6. candidate_message: allt som går till kandidaten, med mejl genom Resend
--      (src/lib/nav2/rekrytering-utskick.ts). Påminnelserna schemaläggs hos
--      Resend. Förhandsvisningen mejlar aldrig en kandidat.
--   7. candidate_merit_request: begäran om meriter (diskrimineringslagen
--      2 kap. 4 §) och svaret.
--   8. recruitment_template: mallarnas texter. Utkastets exempeltexter gäller
--      inte (beställaren): en mall utan rad här har ingen text, och då går
--      inget mejl ut.
--   9. recruitment_policy: Så är jobbet, när laget bads om tips, och
--      gallringsfristen 12 månader. Avslutade kandidater utan gallringsdag
--      får den som triggern i 0030 hade gett dem.
--  10. recruitment_goal: målet, en gång (till ett datum) eller varje månad
--      eller kvartal.
--  11. employee: varför anställningen tog slut (LAS 25 §).
--
-- Läsning: kretsen `far_rekrytera()`, som resten av 0030. Skrivning sker med
-- service role efter rutten /nav2/rekrytering:s egna kontroller.
-- =============================================================================

-- 1. Tjänsterna ---------------------------------------------------------------

create table public.recruitment_position (
  id uuid primary key default gen_random_uuid(),
  title text not null check (btrim(title) <> '' and char_length(title) <= 120),
  short_title text not null check (btrim(short_title) <> '' and char_length(short_title) <= 60),
  headcount int not null check (headcount between 1 and 20),
  start_date date not null,
  opened_at date not null default current_date,
  platsbanken_until date,
  linkedin_until date,
  closed_at timestamptz,
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.recruitment_position enable row level security;
create policy recruitment_position_read on public.recruitment_position for select to authenticated
  using (public.far_rekrytera());

-- 2. Kandidaten ---------------------------------------------------------------

-- E-posten blir valfri (beställaren 2026-10-18): ett tips kan vara bara ett
-- nummer. 0030:s villkor på formen står kvar; ett nytt kräver e-post eller
-- telefon. En kandidat utan e-post får inga mejl, och vyn säger det.
alter table public.candidate alter column email drop not null;
alter table public.candidate add constraint candidate_kontakt_finns
  check (email is not null or nullif(btrim(phone), '') is not null);

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
  add column if not exists pool_asked_at timestamptz,
  add column if not exists pool_declined_at timestamptz;

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

-- 6. Det som går till kandidaten ----------------------------------------------
--
-- Mejl genom Resend (beställaren 2026-10-18: inga SMS). Rutten skickar direkt
-- när raden skrivits. En påminnelse före intervjun schemaläggs hos Resend
-- (`resend_id`), och en avbokning avbryter den där. Det som ligger längre fram
-- än Resends 29 dagar står som `vantar` tills utkorgsjobbet schemalägger det.
-- Utkorgen i 0069 rörs inte: dess `kind` känner inte kandidater.
--
-- FÖRHANDSVISNINGEN MEJLAR ALDRIG EN KANDIDAT: den delar databas med
-- produktionen, och en rad som skrivs där blir `fel` med orsaken, så att
-- produktionens jobb inte skickar den senare.

create table public.candidate_message (
  id bigserial primary key,
  candidate_id uuid not null references public.candidate (id) on delete cascade,
  booking_id uuid references public.candidate_booking (id) on delete set null,
  template text not null check (template in ('bekr', 'bokad', 'sms24', 'sms2', 'avslag1', 'avslag2', 'erbj', 'pool', 'ringt', 'pamin', 'avbokad', 'merit')),
  channel text not null default 'mejl' check (channel in ('mejl', 'mejl_ics')),
  body text not null check (char_length(body) <= 4000),
  status text not null default 'vantar' check (status in ('vantar', 'schemalagd', 'skickad', 'fel', 'avbruten')),
  send_after timestamptz not null default now(),
  resend_id text,
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);
create index candidate_message_idx on public.candidate_message (candidate_id, created_at);
create index candidate_message_vantar_idx on public.candidate_message (send_after) where status = 'vantar';
alter table public.candidate_message enable row level security;
create policy candidate_message_read on public.candidate_message for select to authenticated
  using (public.far_rekrytera());

-- 7. Begäran om meriter -------------------------------------------------------

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

-- 8. Mallarnas texter ---------------------------------------------------------

create table public.recruitment_template (
  slug text primary key check (slug in ('bekr', 'bokad', 'sms24', 'sms2', 'avslag1', 'avslag2', 'erbj', 'pool')),
  body text not null check (btrim(body) <> '' and char_length(body) <= 4000),
  updated_by uuid references public.employee (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.recruitment_template enable row level security;
create policy recruitment_template_read on public.recruitment_template for select to authenticated
  using (public.far_rekrytera());

-- 9. Bolagets val -------------------------------------------------------------

alter table public.recruitment_policy
  add column if not exists job_text text check (char_length(job_text) <= 4000),
  add column if not exists tips_asked_at timestamptz,
  add column if not exists tips_asked_by uuid references public.employee (id) on delete set null;

-- Gallringsfristen: 12 månader (beställaren 2026-10-18).
update public.recruitment_policy set purge_after_days = 365, updated_at = now() where id;

-- De som redan avslutats får den gallringsdag triggern i 0030 hade gett dem:
-- avslutet plus fristen, och talangpoolen undantas. Stegbytestriggern rör inte
-- raden (steget byts inte).
update public.candidate
   set gdpr_purge_at = closed_at + interval '365 days'
 where closed_at is not null and gdpr_purge_at is null and not talent_pool;

-- 10. Målet -------------------------------------------------------------------
--
-- Ett mål i taget. "engang" gäller till ett datum, "manad" och "kvartal"
-- börjar om varje period och räknar de anställda i den. Ett nytt mål stänger
-- det gamla (`closed_at`), så att historiken står kvar.

create table public.recruitment_goal (
  id uuid primary key default gen_random_uuid(),
  name text check (char_length(name) <= 80),
  headcount int not null check (headcount between 1 and 200),
  period text not null check (period in ('engang', 'manad', 'kvartal')),
  starts_on date not null default current_date,
  ends_on date,
  closed_at timestamptz,
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  check (period <> 'engang' or (ends_on is not null and ends_on >= starts_on))
);
create unique index recruitment_goal_ett_oppet on public.recruitment_goal ((true)) where closed_at is null;
alter table public.recruitment_goal enable row level security;
create policy recruitment_goal_read on public.recruitment_goal for select to authenticated
  using (public.far_rekrytera());

-- 11. Varför anställningen tog slut -------------------------------------------
--
-- LAS 25 §: den som sagts upp på grund av arbetsbrist efter mer än tolv
-- månader de senaste tre åren har företrädesrätt i nio månader. Personal
-- visste när någon slutade men inte varför. Sätts av säljchef, VD eller admin
-- (Rekryteringens företrädesrätt frågar; Anställdas avslut bör också göra det).

alter table public.employee
  add column if not exists end_reason text check (end_reason in ('arbetsbrist', 'egen', 'provanstallning', 'visstid', 'avsked', 'annat')),
  add column if not exists end_reason_by uuid references public.employee (id) on delete set null,
  add column if not exists end_reason_at timestamptz;
