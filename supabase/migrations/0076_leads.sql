-- =============================================================================
-- 0076_leads.sql — leads från hemsidan landar i navet
--
-- -----------------------------------------------------------------------------
-- VAD BESTÄLLAREN BAD OM
-- -----------------------------------------------------------------------------
--
-- 2026-10-07: "vi ska lägga in en integration från vår hemsida till vårt
-- intranät för att lägga in alla inkommande leads dit."
--
-- Frågan började som "kan jag få API-nyckeln", och svaret var nej: den enda
-- nyckel navet har är service role, som läser och skriver HELA databasen —
-- löner, avtal, provision. En hemsida är det mest exponerade vi äger. I stället
-- får hemsidan en egen hemlighet (`LEADS_WEBHOOK_SECRET`) som bara kan göra en
-- sak: lämna ett lead. Samma resonemang som `LYNES_WEBHOOK_SECRET` i
-- `/api/lynes/[token]`.
--
-- -----------------------------------------------------------------------------
-- VEM SER VAD
-- -----------------------------------------------------------------------------
--
-- Säljchef, VD och teamledare ser ALLA leads — det är de som fördelar dem.
-- En säljare ser bara de leads hen fått tilldelade. Ett otilldelat lead är
-- alltså osynligt för säljarkåren, och det är avsiktligt: annars blir det
-- först-till-kvarn på de bästa förfrågningarna.
--
-- Skrivning går via service role, som på resten av navet. Ingen skrivpolicy —
-- självkontrollen sist i filen faller om någon lägger till en.
--
-- -----------------------------------------------------------------------------
-- K27: INGA PERSONNUMMER I FRITEXTEN
-- -----------------------------------------------------------------------------
--
-- Hemsidans meddelandefält är fritext från en främling, och en enskild firmas
-- organisationsnummer ÄR ett personnummer. Mottagaren maskerar allt som ser ut
-- som ett innan raden skrivs (`maskeraPersonnummer` i `src/lib/leads.ts`) —
-- att vägra ta emot ett lead för att kunden skrev sitt orgnummer hade varit att
-- tappa en affär på en teknikalitet. Villkoret nedan är andra ledet, och det
-- ska aldrig slå till på en rad som gått genom mottagaren.
--
-- Telefonnumret har eget fält och provas inte, precis som `candidate.phone`.
-- =============================================================================

create table if not exists lead (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  -- Varifrån: "hemsida" i dag, men en andra källa (en annons, en mässlista)
  -- ska inte kräva en ny kolumn.
  source        text not null default 'hemsida',

  name          text,
  company       text,
  email         text,
  phone         text,
  message       text,

  page_url      text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,

  -- Allt annat formuläret skickade. Ett nytt fält på hemsidan ska inte tappas
  -- för att navet inte kände till det — det syns under "Övriga fält".
  extra         jsonb not null default '{}'::jsonb,

  status            text not null default 'new',
  status_changed_at timestamptz,
  assigned_to       uuid references employee(id) on delete set null,
  assigned_at       timestamptz,
  note              text,

  -- Samma e-post eller telefon inom ett dygn. Raden sparas ändå — kunden kan ha
  -- skrivit något nytt — men den notifierar ingen och pekar på originalet.
  duplicate_of  uuid references lead(id) on delete set null
);

-- Villkoren skrivs omkörbara: `create table if not exists` gör ingenting mot en
-- befintlig tabell, så ett ändrat villkor måste läggas om för sig.
alter table lead drop constraint if exists lead_source_check;
alter table lead add constraint lead_source_check
  check (length(btrim(source)) between 1 and 60);

-- `coalesce` och inte ett rakt `in`: `null in (...)` är NULL, och ett CHECK
-- släpper igenom NULL. Kolumnen är not null, men villkoret ska inte vila på det.
alter table lead drop constraint if exists lead_status_check;
alter table lead add constraint lead_status_check
  check (coalesce(status, '') in ('new', 'contacted', 'meeting', 'won', 'lost', 'spam'));

alter table lead drop constraint if exists lead_kontaktvag;
alter table lead add constraint lead_kontaktvag
  check (coalesce(btrim(email), '') <> '' or coalesce(btrim(phone), '') <> '');

alter table lead drop constraint if exists lead_langder;
alter table lead add constraint lead_langder check (
  coalesce(length(name), 0)         <= 200
  and coalesce(length(company), 0)  <= 200
  and coalesce(length(email), 0)    <= 254
  and coalesce(length(phone), 0)    <= 40
  and coalesce(length(message), 0)  <= 5000
  and coalesce(length(note), 0)     <= 5000
  and coalesce(length(page_url), 0) <= 1000
  and coalesce(length(utm_source), 0)   <= 200
  and coalesce(length(utm_medium), 0)   <= 200
  and coalesce(length(utm_campaign), 0) <= 200
  and pg_column_size(extra) <= 20000
);

alter table lead drop constraint if exists lead_inget_personnummer;
alter table lead add constraint lead_inget_personnummer check (
  not public.ser_ut_som_personnummer(coalesce(message, ''))
  and not public.ser_ut_som_personnummer(coalesce(note, ''))
  and not public.ser_ut_som_personnummer(coalesce(company, ''))
  and not public.ser_ut_som_personnummer(extra::text)
);

alter table lead drop constraint if exists lead_inte_sin_egen_dubblett;
alter table lead add constraint lead_inte_sin_egen_dubblett
  check (duplicate_of is distinct from id);

-- Listan: nyast först, filtrerad på status.
create index if not exists lead_status_idx on lead (status, created_at desc);
-- Säljarens egna.
create index if not exists lead_tilldelad_idx on lead (assigned_to, created_at desc)
  where assigned_to is not null;
-- Dubblettfrågan går på normaliserad e-post och telefon inom ett dygn.
create index if not exists lead_epost_idx on lead (lower(email), created_at desc)
  where email is not null;
create index if not exists lead_telefon_idx on lead (phone, created_at desc)
  where phone is not null;

comment on table lead is
  '0076: inkommande leads från hemsidan via /api/leads. Skrivs bara av service role.';
comment on column lead.duplicate_of is
  '0076: samma e-post eller telefon inom 24 h. Pekar alltid på originalet, aldrig på en annan dubblett.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

alter table lead enable row level security;

-- Anon har ingenting här att göra. Mottagaren använder service role.
revoke all on table lead from anon;

drop policy if exists lead_read on lead;
create policy lead_read on lead for select
  to authenticated
  using (
    public.has_any_role(array['sales_manager', 'ceo', 'team_lead'])
    or assigned_to = public.current_employee_id()
  );

-- -----------------------------------------------------------------------------
-- Självkontroll
-- -----------------------------------------------------------------------------

do $$
declare
  skrivpolicyer int;
begin
  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public' and tablename = 'lead' and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'lead har % skrivpolicy(er) — skrivning ska ga via service role', skrivpolicyer;
  end if;
end;
$$;

do $$
declare
  saknas text;
begin
  select string_agg(v.namn, ', ')
    into saknas
  from (values
    ('lead_source_check'),
    ('lead_status_check'),
    ('lead_kontaktvag'),
    ('lead_langder'),
    ('lead_inget_personnummer'),
    ('lead_inte_sin_egen_dubblett')
  ) as v(namn)
  where not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'lead' and c.conname = v.namn
  );

  if saknas is not null then
    raise exception 'Villkor saknas: %', saknas;
  end if;
end;
$$;
