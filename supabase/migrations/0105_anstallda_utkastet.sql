-- 0105 · Anställda: checklistmallar, utskicksregler och punkternas frister (2026-10-18)
--
-- =============================================================================
-- VARFÖR
--
-- Nav 2.0:s Anställda har funktioner som navet inte bär. Navets checklistor är
-- hårdkodade (`onboarding.ts`, `CHECKLISTA` i personal/actions.ts) och punkterna
-- har varken frist, ägare eller typ. Här:
--
--   1. onboarding_template + onboarding_template_item: Checklistor-fliken. En
--      mall per rollgrupp och en för avslut. Punkten har en frist i dagar från
--      start- eller slutdagen (eller en lagfrist: SKV 1160, provanställningen),
--      en typ (de som Nav själv bockar av), en lagrad lagrum och ett villkor.
--   2. onboarding_rule: Utskick-fliken. Vem som mejlas om vad när någon börjar
--      eller slutar, när det ska vara klart, påminnelsen och värdet tillbaka.
--   3. Punkterna i onboarding_task och offboarding_task får typ, frist, ägare,
--      anteckning, värde, mejlet som skickades, påminnelserna och mötet.
--      Fristen sparas som förskjutning; `due_date` sätts bara när någon flyttat
--      datumet. Då följer fristerna med när startdagen ändras.
--   4. employee_onboarding: det som hör till personen men inte till navets
--      employee: fadder, fadderträffar, privat mejl, telefon, tredjeland och
--      välkomstbrevet.
--   5. employee_access_level: Behörighet i Nav (tre nivåer). Sparas; vad den
--      ska styra är en öppen fråga till beställaren (se HANDOFF, Del: Anställda).
--
-- Allt skrivs av /nav2/anstallda med service role efter egna kontroller.
-- Läsningen följer navets regel för personalen: can_read_all_employees().
--
-- Mallarna är utkastets tre rollistor och avslutslistan, med navets egna
-- punkter (Inkio, Dialer, e-post, dator, telefon, passerkort, lönen) inlagda.
-- Inga utskicksregler läggs in: utkastets mottagare finns inte i navet.
-- Navets två befintliga listor får typ och frist ur samma punkter.
--
-- Beställaren 2026-10-15: ingen funktion i utkastet får försvinna.
-- =============================================================================

-- ---------------------------------------------------------------- 1. Mallarna
create table public.onboarding_template (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  roles text[] not null default '{}',
  is_exit boolean not null default false,
  sort integer not null default 0,
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- En avslutslista. Den går inte att ta bort i vyn.
create unique index onboarding_template_ett_avslut on public.onboarding_template (is_exit) where is_exit;
alter table public.onboarding_template enable row level security;
create policy onboarding_template_read on public.onboarding_template for select to authenticated
  using (public.can_read_all_employees());

create table public.onboarding_template_item (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.onboarding_template (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_-]{1,40}$'),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  offset_days integer check (offset_days between -60 and 365),
  offset_special text check (offset_special in ('skv', 'prov')),
  kind text not null default 'vanlig' check (kind in ('vanlig', 'konto', 'avtal', 'avtalsign', 'valkomst', 'boka', 'fadder', 'losen', 'coach', 'las7', 'las30', 'rutin', 'kurs', 'traff')),
  law_ref text check (char_length(law_ref) <= 80),
  condition text check (condition in ('tredje', 'prov')),
  owner text not null default 'chef' check (owner in ('chef', 'fadder', 'person')),
  owner_id uuid references public.employee (id) on delete set null,
  sort integer not null default 0,
  unique (template_id, key),
  check ((offset_days is null) <> (offset_special is null))
);
alter table public.onboarding_template_item enable row level security;
create policy onboarding_template_item_read on public.onboarding_template_item for select to authenticated
  using (public.can_read_all_employees());

-- ---------------------------------------------------------------- 2. Reglerna
create table public.onboarding_rule (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  recipient_id uuid references public.employee (id) on delete set null,
  -- null = alla roller
  roles text[],
  trigger text not null check (trigger in ('start', 'slut')),
  due_offset integer not null check (due_offset between -30 and 30),
  remind_days integer not null default 2 check (remind_days between 1 and 3),
  ask_for text check (char_length(ask_for) <= 40),
  subject text not null check (char_length(btrim(subject)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 800),
  active boolean not null default true,
  sort integer not null default 0,
  created_by uuid references public.employee (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.onboarding_rule enable row level security;
create policy onboarding_rule_read on public.onboarding_rule for select to authenticated
  using (public.can_read_all_employees());

-- ---------------------------------------------------------------- 3. Punkterna
do $$
declare t text;
begin
  foreach t in array array['onboarding_task', 'offboarding_task'] loop
    execute format($f$
      alter table public.%1$I
        add column item_key text,
        add column kind text not null default 'vanlig' check (kind in ('vanlig', 'konto', 'avtal', 'avtalsign', 'valkomst', 'boka', 'fadder', 'losen', 'coach', 'las7', 'las30', 'rutin', 'kurs', 'traff', 'regel')),
        add column offset_days integer,
        add column offset_special text check (offset_special in ('skv', 'prov')),
        add column due_date date,
        add column law_ref text,
        add column condition text check (condition in ('tredje', 'prov')),
        add column owner text not null default 'chef' check (owner in ('chef', 'fadder', 'person')),
        add column owner_id uuid references public.employee (id) on delete set null,
        add column self_owned boolean not null default false,
        add column note text check (char_length(note) <= 500),
        add column value text check (char_length(value) <= 200),
        add column rule_id uuid references public.onboarding_rule (id) on delete set null,
        add column created_on date not null default current_date,
        add column sent_on date,
        add column remind_days integer check (remind_days between 1 and 3),
        add column ask_for text,
        add column mail_subject text,
        add column mail_body text,
        add column reminded date[] not null default '{}',
        add column auto_reminded_on date,
        add column escalated_on date,
        add column calendar_event_id uuid
    $f$, t);
    execute format('create index %1$s_owner on public.%1$I (owner_id) where state = ''open''', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 4. Personen
create table public.employee_onboarding (
  employee_id uuid primary key references public.employee (id) on delete cascade,
  template_id uuid references public.onboarding_template (id) on delete set null,
  mentor_id uuid references public.employee (id) on delete set null,
  mentor_meetings integer not null default 0 check (mentor_meetings between 0 and 8),
  private_email text check (private_email is null or private_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  phone text check (char_length(phone) <= 40),
  third_country boolean not null default false,
  welcome jsonb,
  welcome_sent_at timestamptz,
  welcome_sent_to text,
  updated_by uuid references public.employee (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.employee_onboarding enable row level security;
create policy employee_onboarding_read on public.employee_onboarding for select to authenticated
  using (public.can_read_all_employees());

-- ---------------------------------------------------------------- 5. Behörigheten
create table public.employee_access_level (
  employee_id uuid primary key references public.employee (id) on delete cascade,
  level text not null check (level in ('salesperson', 'admin', 'superadmin')),
  set_by uuid references public.employee (id) on delete set null,
  set_at timestamptz not null default now()
);
alter table public.employee_access_level enable row level security;
create policy employee_access_level_read on public.employee_access_level for select to authenticated
  using (employee_id = public.current_employee_id() or public.can_read_all_employees());

-- ---------------------------------------------------------------- Mallarnas innehåll
with mall (sort, name, roles, is_exit) as (values
  (1, 'Säljare', array['salesperson'], false),
  (2, 'Teamledare och chefer', array['team_lead', 'sales_manager', 'ceo'], false),
  (3, 'Leverans och övriga', array['delivery', 'project_manager', 'finance', 'admin'], false),
  (9, 'Avslut', array[]::text[], true)
), ny as (
  insert into public.onboarding_template (sort, name, roles, is_exit)
  select sort, name, roles, is_exit from mall returning id, sort
)
insert into public.onboarding_template_item (template_id, sort, key, label, offset_days, offset_special, kind, law_ref, condition)
select ny.id, p.ord, p.key, p.label, p.off, p.spec, p.kind, p.lag, p.villkor
from ny join (values
  -- Säljare
  (1, 1, 'konto', 'Lägg upp i navet: konto, roll och team', -14, null, 'konto', null, null),
  (1, 2, 'avtal', 'Anställningsavtalet: fyll i lönen och skicka för påskrift', -14, null, 'avtal', null, null),
  (1, 3, 'avtalsign', 'Avtalet påskrivet och arkiverat', -7, null, 'avtalsign', null, null),
  (1, 4, 'tillstand', 'Arbets- och uppehållstillstånd kontrollerat, kopia sparad', -7, null, 'vanlig', 'Utlänningslagen', 'tredje'),
  (1, 5, 'valkomst', 'Välkomstbrev med första dagens schema skickat', -5, null, 'valkomst', null, null),
  (1, 6, 'intro', 'Introduktion med närmaste chef bokad', -5, null, 'boka', null, null),
  (1, 7, 'fadder', 'Fadder utsedd', -5, null, 'fadder', null, null),
  (1, 8, 'epost', 'E-postkonto upplagt', -3, null, 'vanlig', null, null),
  (1, 9, 'dator', 'Dator och kringutrustning utlämnad', -3, null, 'vanlig', null, null),
  (1, 10, 'telefon', 'Telefon och SIM utlämnat', -3, null, 'vanlig', null, null),
  (1, 11, 'inkio', 'Inkio-behörighet upplagd', -2, null, 'vanlig', null, null),
  (1, 12, 'dialer', 'Dialer-kö och kösegment tilldelat', -1, null, 'vanlig', null, null),
  (1, 13, 'pass', 'Passerkort och nycklar utlämnade', -1, null, 'vanlig', null, null),
  (1, 14, 'lon', 'Lön och anställningsuppgifter lämnade till lönehanteringen', -1, null, 'vanlig', null, null),
  (1, 15, 'sakerhet', 'Rundvandring: utrymning, larm och första hjälpen', 0, null, 'vanlig', 'AFS 2023:1', null),
  (1, 16, 'losen', 'Tillfälliga lösenordet bytt vid första inloggningen', 0, null, 'losen', null, null),
  (1, 17, 'saljprocess', 'Genomgång av säljprocessen, K&V och säljsamtalets krav', 0, null, 'vanlig', null, null),
  (1, 18, 'coach', 'Första övningen i Coachning', 2, null, 'coach', null, null),
  (1, 19, 'invand', 'Invändningshantering: medlyssning och rollspel', 4, null, 'vanlig', null, null),
  (1, 20, 'las7', 'Skriftlig information om lön, arbetstid och befattning', 6, null, 'las7', 'LAS 6 c §, inom 7 dagar', null),
  (1, 21, 'rutiner', 'Obligatoriska rutiner kvitterade', 7, null, 'rutin', null, null),
  (1, 22, 'kurser', 'Tilldelade kurser klara', 14, null, 'kurs', null, null),
  (1, 23, 'avslut1', 'Första egna affären, med säljsamtalet kopplat', 30, null, 'vanlig', null, null),
  (1, 24, 'las30', 'Information om semester, uppsägning, utbildning och kollektivavtal', 30, null, 'las30', 'LAS 6 c §, inom en månad', null),
  (1, 25, 'samtal30', '30-dagarssamtal', 30, null, 'boka', null, null),
  (1, 26, 'skv', 'Anställningen anmäld till Skatteverket (SKV 1160)', null, 'skv', 'vanlig', 'Senast tredje månaden efter startmånaden', 'tredje'),
  (1, 27, 'traff', 'Fadderträffar, minst åtta de första 90 dagarna', 90, null, 'traff', null, null),
  (1, 28, 'samtal90', '90-dagarssamtal', 90, null, 'boka', null, null),
  (1, 29, 'prov', 'Besked om provanställningen, senast två veckor före slutet', null, 'prov', 'vanlig', 'LAS 31 §', 'prov'),
  -- Teamledare och chefer
  (2, 1, 'konto', 'Lägg upp i navet: konto, roll och team', -14, null, 'konto', null, null),
  (2, 2, 'avtal', 'Anställningsavtalet: fyll i lönen och skicka för påskrift', -14, null, 'avtal', null, null),
  (2, 3, 'avtalsign', 'Avtalet påskrivet och arkiverat', -7, null, 'avtalsign', null, null),
  (2, 4, 'valkomst', 'Välkomstbrev med första dagens schema skickat', -5, null, 'valkomst', null, null),
  (2, 5, 'intro', 'Introduktion med närmaste chef bokad', -5, null, 'boka', null, null),
  (2, 6, 'epost', 'E-postkonto upplagt', -3, null, 'vanlig', null, null),
  (2, 7, 'dator', 'Dator och kringutrustning utlämnad', -3, null, 'vanlig', null, null),
  (2, 8, 'telefon', 'Telefon och SIM utlämnat', -3, null, 'vanlig', null, null),
  (2, 9, 'inkio', 'Inkio-behörighet upplagd', -2, null, 'vanlig', null, null),
  (2, 10, 'dialer', 'Dialer-kö och kösegment tilldelat', -1, null, 'vanlig', null, null),
  (2, 11, 'pass', 'Passerkort och nycklar utlämnade', -1, null, 'vanlig', null, null),
  (2, 12, 'lon', 'Lön och anställningsuppgifter lämnade till lönehanteringen', -1, null, 'vanlig', null, null),
  (2, 13, 'sakerhet', 'Rundvandring: utrymning, larm och första hjälpen', 0, null, 'vanlig', 'AFS 2023:1', null),
  (2, 14, 'losen', 'Tillfälliga lösenordet bytt vid första inloggningen', 0, null, 'losen', null, null),
  (2, 15, 'mfa', 'Tvåstegsverifiering påslagen', 0, null, 'vanlig', null, null),
  (2, 16, 'attest', 'Genomgång av attest: order, frånvaro och tidsrättelser', 2, null, 'vanlig', null, null),
  (2, 17, 'las7', 'Skriftlig information om lön, arbetstid och befattning', 6, null, 'las7', 'LAS 6 c §, inom 7 dagar', null),
  (2, 18, 'rutiner', 'Obligatoriska rutiner kvitterade', 7, null, 'rutin', null, null),
  (2, 19, 'las30', 'Information om semester, uppsägning, utbildning och kollektivavtal', 30, null, 'las30', 'LAS 6 c §, inom en månad', null),
  (2, 20, 'samtal30', '30-dagarssamtal', 30, null, 'boka', null, null),
  (2, 21, 'prov', 'Besked om provanställningen, senast två veckor före slutet', null, 'prov', 'vanlig', 'LAS 31 §', 'prov'),
  -- Leverans och övriga
  (3, 1, 'konto', 'Lägg upp i navet: konto, roll och team', -14, null, 'konto', null, null),
  (3, 2, 'avtal', 'Anställningsavtalet: fyll i lönen och skicka för påskrift', -14, null, 'avtal', null, null),
  (3, 3, 'avtalsign', 'Avtalet påskrivet och arkiverat', -7, null, 'avtalsign', null, null),
  (3, 4, 'valkomst', 'Välkomstbrev med första dagens schema skickat', -5, null, 'valkomst', null, null),
  (3, 5, 'intro', 'Introduktion med närmaste chef bokad', -5, null, 'boka', null, null),
  (3, 6, 'fadder', 'Fadder utsedd', -5, null, 'fadder', null, null),
  (3, 7, 'epost', 'E-postkonto upplagt', -3, null, 'vanlig', null, null),
  (3, 8, 'dator', 'Dator och kringutrustning utlämnad', -3, null, 'vanlig', null, null),
  (3, 9, 'telefon', 'Telefon och SIM utlämnat', -3, null, 'vanlig', null, null),
  (3, 10, 'inkio', 'Inkio-behörighet upplagd', -2, null, 'vanlig', null, null),
  (3, 11, 'pass', 'Passerkort och nycklar utlämnade', -1, null, 'vanlig', null, null),
  (3, 12, 'lon', 'Lön och anställningsuppgifter lämnade till lönehanteringen', -1, null, 'vanlig', null, null),
  (3, 13, 'sakerhet', 'Rundvandring: utrymning, larm och första hjälpen', 0, null, 'vanlig', 'AFS 2023:1', null),
  (3, 14, 'losen', 'Tillfälliga lösenordet bytt vid första inloggningen', 0, null, 'losen', null, null),
  (3, 15, 'leverans', 'Genomgång av leveransprocessen och Leveranskalendern', 1, null, 'vanlig', null, null),
  (3, 16, 'las7', 'Skriftlig information om lön, arbetstid och befattning', 6, null, 'las7', 'LAS 6 c §, inom 7 dagar', null),
  (3, 17, 'rutiner', 'Obligatoriska rutiner kvitterade', 7, null, 'rutin', null, null),
  (3, 18, 'las30', 'Information om semester, uppsägning, utbildning och kollektivavtal', 30, null, 'las30', 'LAS 6 c §, inom en månad', null),
  (3, 19, 'samtal30', '30-dagarssamtal', 30, null, 'boka', null, null),
  (3, 20, 'prov', 'Besked om provanställningen, senast två veckor före slutet', null, 'prov', 'vanlig', 'LAS 31 §', 'prov'),
  -- Avslut
  (9, 1, 'slutsamtal', 'Avslutningssamtal hållet', -3, null, 'vanlig', null, null),
  (9, 2, 'nav', 'Konto i navet stängt och roller återkallade', 0, null, 'konto', null, null),
  (9, 3, 'arenden', 'Öppna personalärenden kontrollerade', 0, null, 'vanlig', null, null),
  (9, 4, 'inkio', 'Inkio-behörighet borttagen', 0, null, 'vanlig', null, null),
  (9, 5, 'dialer', 'Dialer-kö avslutad och kösegment frigjort', 0, null, 'vanlig', null, null),
  (9, 6, 'epost', 'E-postkonto avslutat eller vidarebefordrat', 0, null, 'vanlig', null, null),
  (9, 7, 'dator', 'Dator och kringutrustning återlämnad', 0, null, 'vanlig', null, null),
  (9, 8, 'telefon', 'Telefon och SIM återlämnat', 0, null, 'vanlig', null, null),
  (9, 9, 'pass', 'Passerkort och nycklar återlämnade', 0, null, 'vanlig', null, null),
  (9, 10, 'slutlon', 'Slutlön och provisionsunderlag överlämnat till lön', 5, null, 'vanlig', null, null),
  (9, 11, 'intyg', 'Arbetsgivarintyg utfärdat', 5, null, 'vanlig', 'Ska lämnas när den anställda ber om det', null)
) as p (mall, ord, key, label, off, spec, kind, lag, villkor) on p.mall = ny.sort;

-- ---------------------------------------------------------------- Navets befintliga listor
-- Navets punkter (onboarding.ts och offboarda) får typ och frist ur mallarnas
-- motsvarande punkter. Listans dag är dagen personen lades upp eller avslutades.
with karta (lista, monster, key, kind, off) as (values
  ('on', 'Konto i navet skapat%', 'konto', 'konto', -14),
  ('on', 'Rutiner tilldelade enligt målgrupp%', 'rutiner-tilldelade', 'konto', -14),
  ('on', 'Kurser tilldelade enligt målgrupp%', 'kurser-tilldelade', 'konto', -14),
  ('on', 'Anställningsavtal skapat som utkast%', 'avtal', 'avtal', -14),
  ('on', 'Anställningsavtal upprättat%', 'avtalsign', 'avtalsign', -7),
  ('on', 'Inkio-behörighet%', 'inkio', 'vanlig', -2),
  ('on', 'Dialer-kö%', 'dialer', 'vanlig', -1),
  ('on', 'E-postkonto%', 'epost', 'vanlig', -3),
  ('on', 'Dator och kringutrustning%', 'dator', 'vanlig', -3),
  ('on', 'Telefon och SIM%', 'telefon', 'vanlig', -3),
  ('on', 'Passerkort och nycklar%', 'pass', 'vanlig', -1),
  ('on', 'Introduktion bokad%', 'intro', 'boka', -5),
  ('on', 'Lön och anställningsuppgifter%', 'lon', 'vanlig', -1)
)
update public.onboarding_task o
   set item_key = k.key, kind = k.kind, offset_days = k.off,
       created_on = coalesce((select min(a.ts)::date from public.audit_log a where a.action = 'employee.created' and a.object_id = o.employee_id::text), current_date)
  from karta k
 where o.label like k.monster and o.item_key is null;

with karta (monster, key, kind, off) as (values
  ('%personalärende%', 'arenden', 'vanlig', 0),
  ('Konto i navet avslutat%', 'nav', 'konto', 0),
  ('Inkio-behörighet%', 'inkio', 'vanlig', 0),
  ('Dialer-kö%', 'dialer', 'vanlig', 0),
  ('E-postkonto%', 'epost', 'vanlig', 0),
  ('Dator och kringutrustning%', 'dator', 'vanlig', 0),
  ('Telefon och SIM%', 'telefon', 'vanlig', 0),
  ('Passerkort och nycklar%', 'pass', 'vanlig', 0),
  ('Slutlön och provisionsunderlag%', 'slutlon', 'vanlig', 5)
)
update public.offboarding_task o
   set item_key = k.key, kind = k.kind, offset_days = k.off,
       created_on = coalesce((select max(a.ts)::date from public.audit_log a where a.action = 'employee.offboarded' and a.object_id = o.employee_id::text), current_date)
  from karta k
 where o.label like k.monster and o.item_key is null;

-- Punkter som inte känns igen blir vanliga punkter med frist på startdagen.
update public.onboarding_task set offset_days = 0 where item_key is null and offset_days is null;
update public.offboarding_task set offset_days = 0 where item_key is null and offset_days is null;

-- Listan byggdes på mallen för personens roll.
insert into public.employee_onboarding (employee_id, template_id)
select e.id, (select t.id from public.onboarding_template t
               where not t.is_exit and t.roles && coalesce((select array_agg(r.role::text) from public.employee_role r where r.employee_id = e.id), '{}')
               order by t.sort limit 1)
  from public.employee e
 where exists (select 1 from public.onboarding_task o where o.employee_id = e.id)
on conflict (employee_id) do nothing;
