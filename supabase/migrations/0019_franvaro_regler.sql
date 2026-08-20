-- =============================================================================
-- 0019_franvaro_regler.sql — E7 / M3 Franvaro och ledighet, forsta halvan:
-- regelmotorn, saldon och sjalva ansokan (E7.1, E7.2, E7.5, E7.15-E7.18).
--
-- Sjukfranvaron ligger i 0020 och ar med flit en EGEN tabell. Skalet star dar.
--
-- -----------------------------------------------------------------------------
-- E7.15: REGLERNA AR KONFIGURATION, INTE VILLKOR I KOD.
--
-- Samma linje som `case_category.sla_hours` i 0013 och `payroll_export_column`
-- i 0012. Ansokningsfrist, huvudsemesterfonster, sparrperiod, bemanningstak,
-- maxlangd, karens och attestniva bor i tabeller. En regel som star som ett
-- `if` i en server action gar inte att andra utan en deploy, och den gar inte
-- att visa for den som ska folja den — vilket AC-3.13 kraver att den gar.
--
-- -----------------------------------------------------------------------------
-- K35 / AC-3.21: INGEN ORSAK, DIAGNOS ELLER SYMTOMBESKRIVNING.
--
-- `absence_request` har inget faltet den SOKANDE skriver fritt i. Det ar inte
-- en forglommelse som nagon ska fylla i senare — det ar kravet. De tva textfalt
-- som finns skrivs av den som BESLUTAR:
--
--   `decision_note`   — motivering till ett avslag (AC-3.13)
--   `override_reason` — motivering till att en regel overstyrs (AC-3.12)
--
-- Bada handlar om beslutet mot regeln, aldrig om personen. Sjukfranvaro gar
-- aldrig genom den har tabellen, sa vagen dar en diagnos kunde ha hamnat i ett
-- beslutsfalt finns inte.
-- =============================================================================

-- Behovs for exclusion-villkoret pa overlappande ledighet langre ned: btree_gist
-- ar det som later `employee_id with =` sta i samma villkor som ett datumspann.
create extension if not exists btree_gist;

-- -----------------------------------------------------------------------------
-- 1. Franvarotyperna och deras regler (E7.15, AC-3.11)
--
-- Kolumnerna ar de sju knappar E7.15 raknar upp. Att de sitter per typ och inte
-- globalt ar hela poangen: en dags kompledigt och sex manaders studieledighet
-- har inte samma frist, inte samma attestniva och inte samma maxlangd.
--
-- `requestable` skiljer det man ANSOKER om fran det som REGISTRERAS i efterhand.
-- Sjukfranvaro ar det senare, och villkoret langst ned gor det omojligt att
-- konfigurera om den till det forra. AC-3.6 forbjuder en digital
-- sjukanmalningsknapp; utan villkoret hade en kryssruta i regelvyn kunnat skapa
-- en, och da hade kravet hangt pa att ingen kryssar i den.
-- -----------------------------------------------------------------------------

create table if not exists absence_type (
  id     text primary key check (id in (
           'vacation','saved_vacation','parental','vab','unpaid_leave',
           'comp_leave','study_leave','military','other','sick')),
  label  text not null check (length(btrim(label)) > 0),
  sort   int  not null,

  -- Hur langt i forvag ansokan ska vara inne. 0 = gar att soka samma dag.
  notice_days int not null default 0 check (notice_days >= 0),

  -- Langsta sammanhangande period. null = ingen grans i navet.
  max_consecutive_days int check (max_consecutive_days is null or max_consecutive_days > 0),

  -- Karens. Redovisning, inte berakning: navet markerar vilken dag som ar
  -- karensdag sa att loneunderlaget kan bara med den. AC-2.17 och K5 star kvar
  -- — har raknas inget avdrag och ingen krona.
  waiting_days int not null default 0 check (waiting_days >= 0),

  -- Attestniva per typ (E7.15). 'manager' ar narmaste chef eller teamledare.
  approval_level text not null default 'manager'
    check (approval_level in ('manager','sales_manager','ceo')),

  -- Drar typen fran ett inmatat saldo? Bara semester och sparad semester gor
  -- det. Foraldraledighet och VAB har sina dagar hos Forsakringskassan, inte
  -- hos arbetsgivaren, och ett saldo i navet hade varit en gissning.
  uses_balance boolean not null default false,

  -- Raknas mot bemanningstaket (E7.2)? VAB gor det inte: den gar inte att
  -- planera, och en varning om bemanning nar barnet redan ar sjukt ar en
  -- tillsagelse utan atgard.
  counts_in_staffing boolean not null default true,

  allows_part_day boolean not null default true,

  -- Gar typen att ANSOKA om? Se rubriken ovan.
  requestable boolean not null default true,

  active boolean not null default true,

  constraint absence_type_sjuk_ansoks_inte
    check (id <> 'sick' or requestable = false)
);

insert into absence_type
  (id, label, sort, notice_days, max_consecutive_days, waiting_days,
   approval_level, uses_balance, counts_in_staffing, allows_part_day, requestable)
select * from (values
  -- Semester: 14 dagars frist for en enstaka dag. Huvudsemestern har sin egen,
  -- langre frist i absence_policy — se 11 § semesterlagen.
  ('vacation',       'Semester',                1,  14, null::int, 0, 'manager',       true,  true,  true,  true),
  ('saved_vacation', 'Sparad semester',         2,  14, null,      0, 'manager',       true,  true,  true,  true),
  -- Foraldraledighetslagen 13 §: tva manaders varsel.
  ('parental',       'Föräldraledighet',        3,  60, null,      0, 'sales_manager', false, true,  true,  true),
  -- VAB gar inte att planera. Frist 0, och utanfor bemanningstaket.
  ('vab',            'Vård av sjukt barn',      4,   0, null,      0, 'manager',       false, false, true,  true),
  ('unpaid_leave',   'Tjänstledighet',          5,  30, 180,       0, 'sales_manager', false, true,  false, true),
  ('comp_leave',     'Kompledighet',            6,   7, 5,         0, 'manager',       false, true,  true,  true),
  -- Studieledighetslagen ger arbetsgivaren ratt att skjuta upp i sex manader.
  ('study_leave',    'Studieledighet',          7, 180, null,      0, 'ceo',           false, true,  false, true),
  ('military',       'Repetitionsutbildning',   8,  30, null,      0, 'sales_manager', false, true,  false, true),
  ('other',          'Övrig ledighet',          9,  14, null,      0, 'sales_manager', false, true,  true,  true),
  -- Registreras, ansoks aldrig om. Karens 1 dag enligt sjuklonelagen.
  ('sick',           'Sjukfrånvaro',           10,   0, null,      1, 'manager',       false, false, true,  false)
) as v(id, label, sort, notice_days, max_consecutive_days, waiting_days,
       approval_level, uses_balance, counts_in_staffing, allows_part_day, requestable)
where not exists (select 1 from absence_type);

-- -----------------------------------------------------------------------------
-- 2. De organisationsovergripande reglerna (E7.15, E7.16, K37)
--
-- En rad, alltid. `id boolean primary key check (id)` ar idiomet: kolumnen kan
-- bara vara `true`, alltsa kan tabellen bara ha en rad. Alternativet — en
-- key/value-tabell som `compliance_gate` — valdes bort har for att varje varde
-- nedan har sin egen typ och sitt eget rimlighetsvillkor, och de gar forlorade
-- i en jsonb-kolumn.
--
-- VARDENA AR LAGENS MINIMINIVA OCH INGET ANNAT. A2 ar besvarad med att
-- kollektivavtal saknas (2026-08-20), sa semesterlagen och LAS galler rakt av.
-- Tecknas ett avtal senare ar det de har raderna som ska andras — inte kod.
-- -----------------------------------------------------------------------------

create table if not exists absence_policy (
  id boolean primary key default true check (id),

  -- Semesteraret. 3 § semesterlagen: 1 april-31 mars nar inget annat avtalats.
  -- Beslutat av anvandaren 2026-08-20.
  vacation_year_start_month int not null default 4  check (vacation_year_start_month between 1 and 12),
  vacation_year_start_day   int not null default 1  check (vacation_year_start_day   between 1 and 28),

  -- Huvudsemesterfonstret. 12 § semesterlagen: fyra veckor sammanhangande
  -- under juni-augusti om inget annat avtalats.
  main_vacation_start_month int not null default 6  check (main_vacation_start_month between 1 and 12),
  main_vacation_start_day   int not null default 1  check (main_vacation_start_day   between 1 and 31),
  main_vacation_end_month   int not null default 8  check (main_vacation_end_month   between 1 and 12),
  main_vacation_end_day     int not null default 31 check (main_vacation_end_day     between 1 and 31),

  -- 11 § semesterlagen: beskedet ska lamnas senast tva manader i forvag.
  -- Fristen galler ansokan om huvudsemester och gar fore typens egen frist.
  main_vacation_notice_days int not null default 60 check (main_vacation_notice_days >= 0),

  -- 18 § semesterlagen: sparade dagar maste tas ut inom fem ar (E7.16).
  saved_days_max_years int not null default 5 check (saved_days_max_years > 0),

  -- AC-3.5: ett saldo aldre an sa har manga dagar visas som foraldrat i
  -- stallet for som sanning.
  balance_stale_days int not null default 45 check (balance_stale_days > 0),

  -- K37 / AC-3.23. Dagnumren raknas fran forsta sjukdagen.
  sick_certificate_day int not null default 8  check (sick_certificate_day  > 0),
  sick_fk_day          int not null default 15 check (sick_fk_day           > 0),
  sick_return_plan_day int not null default 30 check (sick_return_plan_day  > 0),

  -- AC-3.17: en sjukanmalan som ingen chef bekraftat inom sa har manga timmar
  -- eskalerar.
  sick_confirm_hours int not null default 48 check (sick_confirm_hours > 0),

  -- AC-3.24: aterinsjuknande inom sa har manga dagar hor till foregaende
  -- period.
  relapse_days int not null default 5 check (relapse_days > 0),

  -- AC-3.25: sa manga sjuktillfallen inom sa manga manader ger den tysta
  -- signalen om rehabiliteringsansvar.
  repeat_sick_count  int not null default 6  check (repeat_sick_count  > 0),
  repeat_sick_months int not null default 12 check (repeat_sick_months > 0),

  -- AC-3.19: hur lange en paminnelse om oregistrerad franvaro ar den
  -- anstalldas ensak innan den syns for chefen.
  unregistered_reminder_hours int not null default 24 check (unregistered_reminder_hours >= 0),

  updated_by uuid references employee(id),
  updated_at timestamptz not null default now()
);

insert into absence_policy (id) select true
where not exists (select 1 from absence_policy);

-- -----------------------------------------------------------------------------
-- 3. Sparrperioder (E7.15)
--
-- `label` beskriver PERIODEN, aldrig en person: "Kampanjvecka 45",
-- "Bokslut". Det ar organisationens skal, inte nagons orsak, och beror darfor
-- inte K35. Ett fritextfalt om en enskild anstalld finns ingenstans i E7.
-- -----------------------------------------------------------------------------

create table if not exists absence_blackout (
  id         uuid primary key default gen_random_uuid(),
  label      text not null check (length(btrim(label)) > 0),
  starts_on  date not null,
  ends_on    date not null,

  type_ids   text[] not null default '{}',   -- tom = alla typer
  team_ids   uuid[] not null default '{}',   -- tom = hela bolaget

  created_by uuid references employee(id),
  created_at timestamptz not null default now(),

  constraint absence_blackout_ordning check (ends_on >= starts_on)
);

create index if not exists absence_blackout_period_idx on absence_blackout (starts_on, ends_on);

-- -----------------------------------------------------------------------------
-- 4. Bemanningstak (E7.2, AC-3.2)
--
-- Hogsta antal samtidigt franvarande. `team_id is null` ar taket for hela
-- bolaget. Taket ar en VARNING och inte en sparr: chefen ska kunna godkanna
-- anda, men da med en motivering (AC-3.12). Ett tak som blockerar tvingar fram
-- vagen runt systemet, och da vet ingen vem som ar ledig.
-- -----------------------------------------------------------------------------

create table if not exists staffing_cap (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid references team(id) on delete cascade,
  max_absent int not null check (max_absent >= 0),
  created_by uuid references employee(id),
  created_at timestamptz not null default now()
);

-- Ett tak per team, och ett for bolaget. `unique (team_id)` hade slappt igenom
-- flera bolagstak, eftersom null aldrig ar lika med null.
create unique index if not exists staffing_cap_niva_idx
  on staffing_cap ((coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)));

-- -----------------------------------------------------------------------------
-- 5. Saldon (E7.5, AC-3.5)
--
-- MATAS IN FOR HAND. Navet raknar ingen semesterratt — AC-2.17 och K5 galler
-- har lika mycket som i loneunderlaget. En siffra i den har tabellen ar nagons
-- pastaende, med namn och datum, inte en berakning.
--
-- Tabellen ar en historik och inte ett falt: raderna laggs till, aldrig om.
-- Den senaste per person och typ galler. Skalet ar att en rattad siffra ska ga
-- att se bredvid den den ersatte — ett saldo som andrats i tysthet gar inte att
-- ifragasatta, och det ar precis vad en anstalld ska kunna gora med sina dagar.
-- -----------------------------------------------------------------------------

create table if not exists absence_balance (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,
  type_id     text not null references absence_type(id),

  days        numeric(5,1) not null check (days >= 0),

  -- Vilken dag siffran gallde. AC-3.5 raknar aldern harifran, inte fran
  -- `entered_at`: matar nagon in juni-saldot i augusti ar det juni-siffran som
  -- ar tva manader gammal.
  as_of       date not null,

  -- Vilket semesterar dagarna tjanades in. Bara sparade dagar behover det, och
  -- da behover de det verkligen: 18 § semesterlagen ger fem ar att ta ut dem,
  -- och utan aret gar forfallodagen inte att rakna ut. AC-3.9 kraver den
  -- varningen.
  --
  -- Null for allt annat, och for sparade dagar dar aret inte ar kant. Da ges
  -- ingen varning alls — en varning pa gissad grund far folk att ta ut dagar
  -- de inte behover ta ut, vilket ar samre an tystnad.
  --
  -- Aret anges som det ar semesteraret BORJAR: 2022 betyder 2022/23.
  earned_year int check (earned_year between 2000 and 2100),

  entered_by  uuid not null references employee(id),
  entered_at  timestamptz not null default now(),

  constraint absence_balance_intjanandear
    check (earned_year is null or type_id = 'saved_vacation')
);

create index if not exists absence_balance_person_idx
  on absence_balance (employee_id, type_id, as_of desc, entered_at desc);

create or replace function public.absence_balance_ar_orubblig()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Ett saldo skrivs inte om. Mata in en ny rad med dagens datum i stallet.';
end;
$$;

drop trigger if exists absence_balance_orubblig on absence_balance;
create trigger absence_balance_orubblig
  before update or delete on absence_balance
  for each row execute function public.absence_balance_ar_orubblig();

-- -----------------------------------------------------------------------------
-- 6. Ansokan (E7.1, AC-3.1)
--
-- `rules_broken` fryses vid inskicket. Andras en frist i morgon far det inte
-- gora gardagens ansokan retroaktivt regelvidrig — samma resonemang som
-- `hr_case.sla_hours` i 0013 och AC-2.35 om att historiska avvikelser aldrig
-- omvarderas.
-- -----------------------------------------------------------------------------

create table if not exists absence_request (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,
  type_id     text not null references absence_type(id),

  starts_on   date not null,
  ends_on     date not null,

  -- AC-3.1 "inklusive del av dag". Satt bara nar ansokan galler en enda dag;
  -- villkoret nedan haller ihop det. Minuter och inte timmar, samma enhet som
  -- resten av navet raknar tid i.
  part_day_minutes int check (part_day_minutes is null or part_day_minutes > 0),

  status text not null default 'submitted'
    check (status in ('submitted','approved','rejected','withdrawn','cancelled')),

  submitted_at timestamptz not null default now(),

  decided_by   uuid references employee(id),
  decided_at   timestamptz,
  decision_note text,

  -- AC-3.11, AC-3.12
  rules_broken    text[] not null default '{}',
  override_reason text,

  -- 'withdrawn' = den anstallda tog tillbaka den fore beslut.
  -- 'cancelled' = en godkand ledighet stalldes in efterat.
  withdrawn_by uuid references employee(id),
  withdrawn_at timestamptz,

  created_by uuid references employee(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint absence_request_ordning check (ends_on >= starts_on),

  constraint absence_request_deldag
    check (part_day_minutes is null or starts_on = ends_on),

  constraint absence_request_beslut check (
    (status in ('approved','rejected') and decided_by is not null and decided_at is not null)
    or (status not in ('approved','rejected') and decided_by is null and decided_at is null)
  ),

  constraint absence_request_avslut check (
    (status in ('withdrawn','cancelled')) = (withdrawn_at is not null)
  ),

  -- AC-3.13: ett avslag utan skal gar inte att bemota.
  constraint absence_request_avslag_kraver_skal check (
    status <> 'rejected'
    or (decision_note is not null and length(btrim(decision_note)) > 0)
  ),

  -- AC-3.12: overstyrning kraver motivering. Godkanns en ansokan som brot mot
  -- en regel maste det sta varfor.
  constraint absence_request_overstyrning_kraver_skal check (
    status <> 'approved'
    or cardinality(rules_broken) = 0
    or (override_reason is not null and length(btrim(override_reason)) > 0)
  ),

  -- Ingen kan vara ledig tva ganger samtidigt. Villkoret galler bara godkanda
  -- rader: tva ansokningar som overlappar ar ett normallage som chefen ska
  -- kunna se och valja mellan, medan tva godkanda ar ett fel i underlaget.
  constraint absence_request_ingen_dubbel
    exclude using gist (
      employee_id with =,
      daterange(starts_on, ends_on, '[]') with &&
    ) where (status = 'approved')
);

create index if not exists absence_request_person_idx
  on absence_request (employee_id, starts_on desc);
create index if not exists absence_request_ko_idx
  on absence_request (submitted_at) where status = 'submitted';
create index if not exists absence_request_kalender_idx
  on absence_request (starts_on, ends_on) where status = 'approved';

create or replace function public.absence_request_ror_vid()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists absence_request_rord on absence_request;
create trigger absence_request_rord
  before update on absence_request
  for each row execute function public.absence_request_ror_vid();

-- Ett fattat beslut star kvar. Perioden, typen och personen gar inte att andra
-- i efterhand — annars kan en godkand ledighetsvecka tyst bli en annan vecka
-- an den chefen sa ja till. Vagen bort fran ett godkannande ar att stalla in
-- den, vilket lamnar bade beslutet och installningen att lasa.
create or replace function public.absence_request_ar_last()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'submitted' then
      raise exception 'En beslutad eller avslutad ansokan tas inte bort. Stall in den i stallet.';
    end if;
    return old;
  end if;

  if old.status in ('approved','rejected','withdrawn','cancelled') then
    if new.employee_id      is distinct from old.employee_id
    or new.type_id          is distinct from old.type_id
    or new.starts_on        is distinct from old.starts_on
    or new.ends_on          is distinct from old.ends_on
    or new.part_day_minutes is distinct from old.part_day_minutes
    or new.decided_by       is distinct from old.decided_by
    or new.decided_at       is distinct from old.decided_at then
      raise exception 'Ansokan ar beslutad och kan inte skrivas om (AC-3.12).';
    end if;

    if old.status = 'approved' and new.status not in ('approved','cancelled') then
      raise exception 'En godkand ledighet kan bara stallas in, inte avslas i efterhand.';
    end if;

    if old.status in ('rejected','withdrawn','cancelled') and new.status is distinct from old.status then
      raise exception 'Ansokan ar avslutad. Skicka in en ny i stallet.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists absence_request_last on absence_request;
create trigger absence_request_last
  before update or delete on absence_request
  for each row execute function public.absence_request_ar_last();

-- -----------------------------------------------------------------------------
-- 7. Behorighet
--
-- Uppslagstabellerna lases av alla inloggade: AC-3.13 kraver att den anstallda
-- ser reglerna INNAN hen skickar in. En regel man far veta forst i avslaget ar
-- ingen regel, det ar ett bakhall.
--
-- De fyra policyerna nedan gar inte genom nagon hjalpfunktion och far darfor
-- INTE losenordssparren fran 0017 gratis. Villkoret star darfor utskrivet.
-- Exakt det misstaget rattades i 0017 for company_read, team_read,
-- case_category_read och compliance_gate_read.
-- -----------------------------------------------------------------------------

alter table absence_type     enable row level security;
alter table absence_policy   enable row level security;
alter table absence_blackout enable row level security;
alter table staffing_cap     enable row level security;
alter table absence_balance  enable row level security;
alter table absence_request  enable row level security;

drop policy if exists absence_type_read on absence_type;
create policy absence_type_read on absence_type for select
  to authenticated using (not public.kraver_losenordsbyte());

drop policy if exists absence_policy_read on absence_policy;
create policy absence_policy_read on absence_policy for select
  to authenticated using (not public.kraver_losenordsbyte());

drop policy if exists absence_blackout_read on absence_blackout;
create policy absence_blackout_read on absence_blackout for select
  to authenticated using (not public.kraver_losenordsbyte());

drop policy if exists staffing_cap_read on staffing_cap;
create policy staffing_cap_read on staffing_cap for select
  to authenticated using (not public.kraver_losenordsbyte());

-- Saldot ar uppgifter om en sjalv, plus den som ska besluta om ledigheten.
-- Ekonomi ar utelamnad med flit: loneunderlaget bar franvaron i minuter, och
-- saldot i dagar ar ett personalarende, inte ett loneunderlag.
drop policy if exists absence_balance_read on absence_balance;
create policy absence_balance_read on absence_balance for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.leads_employee(employee_id)
    or public.has_any_role(array['sales_manager','ceo'])
  );

-- Egen ansokan alltid. Chefen ser sitt folk. Ledningen ser alla.
--
-- `admin` ar utelamnad, samma grans som hr_case drog i 0013: rollen ar teknisk
-- och inte personalansvarig. Nar nagon ar foraldraledig ar inte en driftfraga.
drop policy if exists absence_request_read on absence_request;
create policy absence_request_read on absence_request for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.leads_employee(employee_id)
    or public.has_any_role(array['sales_manager','ceo'])
  );
