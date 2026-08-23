-- =============================================================================
-- 0031_provision.sql — intjanad provision, forsta skivan av E13
--
-- VAD DEN HAR TABELLEN AR, OCH VAD DEN INTE AR
--
-- Den ar en HUVUDBOK over intjanad provision per person och manad. Varje rad ar
-- en post, aldrig ett saldo. Summan av posterna ar sanningen.
--
-- Den ar INTE en provisionsmotor. Q78-Q80 ar obesvarade — hur provisionen
-- raknas fram vet navet inte, och ska inte gissa. AC-10.1 kraver dessutom att
-- reglerna ar konfiguration och inte kod den dag de kommer. Tills dess tar
-- navet emot ett tal nagon annan bestamt, precis som `salary_basis` gor med
-- manadslonen i 0025.
--
-- VARFOR EN POST OCH INTE ETT SALDO
--
-- `salary_basis` ar append-only och en ny lon ersatter den gamla. Det gar inte
-- har: intjanad provision ackumuleras, sa en rattelse som skrivs som "ny rad
-- med nytt varde" hade dubbelraknats av varje summering. Darfor ar beloppet
-- signerat och en rattelse ar en NEGATIV post. Historiken blir lasbar bakat —
-- det gar att se bade vad som bokades och vad som rattades, vilket AC-13.8:s
-- linje kraver av lonekostnaden och som galler har av samma skal.
--
-- INKIO
--
-- A5 ar obesvarad och integrationen finns inte. Sommen ar `source` och
-- `external_ref`: nar Inkio kopplas in skriver den i den har tabellen med
-- source = 'inkio' och sitt eget id i external_ref. Det partiella unika indexet
-- gor importen idempotent — samma affar kan skickas tva ganger utan att bli tva
-- poster. Ingen vy och ingen fraga behover roras den dagen.
--
-- K13 AR OMPROVAD 2026-08-23, PA BESTALLARENS BESLUT
--
-- K13 sa att provisionsdata och tiddata inte far samkoras i nagon vy. Efter en
-- direkt fraga i det har passet beslutade bestallaren att bada ska sta pa
-- startsidan, och att K13 skrivs om. Det ar ett medvetet beslut, inte ett
-- forbiseende, och det star i DECISIONS.md med samma datum.
--
-- Tva sakerhetsmarginaler star anda kvar, eftersom de inte kostar nagot:
--   1. Ingen fraga i navet JOINAR de tva tabellerna. Korten pa startsidan
--      hamtar var for sig och mots forst i webblasaren.
--   2. Rastavvikelser och sen ankomst nar fortfarande aldrig den har tabellen.
--      Det var den delen av K13 som K12-intresseavvagningen §5 lovar
--      personalen ("Data nar varken provision eller lonekostnadsvy"), och den
--      utfastelsen ar inte omprovad.
-- =============================================================================

create table if not exists commission_entry (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,

  -- Manaden provisionen tjanades in, alltid den forsta i manaden. En period
  -- som ar ett datumintervall gar att stalla fel; en manad gor det inte.
  period_month date not null,

  -- Signerat med flit. En rattelse ar en negativ post, inte en overskrivning.
  amount numeric(12,2) not null,

  -- Antal affarer bakom beloppet. Nullable: den som matar in en klumpsumma vet
  -- inte alltid antalet, och en nolla hade sett ut som "inga affarer".
  deals int check (deals is null or deals >= 0),

  source       text not null default 'manual' check (source in ('manual','inkio')),
  external_ref text,

  note       text,
  entered_by uuid not null references employee(id),
  entered_at timestamptz not null default now(),

  constraint commission_entry_manad check (period_month = date_trunc('month', period_month)::date),

  -- En manuell post har ingen extern referens, och en importerad post maste ha
  -- en. Utan det villkoret gar det att importera samma affar som "manuell" och
  -- kringga idempotensen nedan.
  constraint commission_entry_kalla check (
    (source = 'manual' and external_ref is null)
    or (source = 'inkio' and external_ref is not null)
  )
);

create index if not exists commission_entry_person_idx
  on commission_entry (employee_id, period_month desc);

-- Idempotent import. Partiellt sa att manuella poster, som alla har
-- external_ref = null, inte krockar med varandra.
create unique index if not exists commission_entry_extern_idx
  on commission_entry (source, external_ref)
  where external_ref is not null;

-- -----------------------------------------------------------------------------
-- Append-only. Samma linje som `salary_basis` och `time_event`: en bokford
-- uppgift om nagons intjaning skrivs inte om i tysthet.
--
-- Skillnaden mot `salary_basis` ar vagen tillbaka. Dar ar den en ny rad med
-- nytt `valid_from`; har ar den en negativ post. Bada lamnar spar, och det ar
-- hela poangen.
-- -----------------------------------------------------------------------------
create or replace function public.commission_entry_ar_last()
returns trigger
language plpgsql
as $$
begin
  raise exception 'En provisionspost skrivs inte om. Bokfor en rattelse som en negativ post.';
end;
$$;

drop trigger if exists commission_entry_last on commission_entry;
create trigger commission_entry_last
  before update or delete on commission_entry
  for each row execute function public.commission_entry_ar_last();

-- -----------------------------------------------------------------------------
-- Behorighet
--
-- Skillnaden mot 0025 ar avsiktlig och viktig: DEN ANSTALLDA SER SIN EGEN RAD.
--
-- Lonekostnaden ar bolagets kalkyl PA en person och darfor stangd for alla utom
-- `payroll_cost_viewer`. Intjanad provision ar nagot annat — det ar personens
-- egen intjaning, det hen arbetat ihop. Att dolja den for den som tjanat in
-- den vore inte sekretess utan hemlighetsmakeri.
--
-- Kretsen som ser ANDRAS provision ar liten: ekonomi och VD, alltsa de som
-- matar in den. Saljchefen star medvetet utanfor tills nagon beslutar annat —
-- bestallaren sa "ekonomi/VD" i det har passet, och en roll till ar en rad har.
-- -----------------------------------------------------------------------------
create or replace function public.far_hantera_provision()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['finance','ceo'])
$$;

-- 0027 stangde nya funktioner for klienten som standard. Predikatet nedan
-- anropas inifran en policy och maste darfor ha execute, annars ger tabellen
-- noll rader at alla. `anon` far den inte: policyn galler bara `authenticated`,
-- sa anon utvarderar den aldrig.
grant execute on function public.far_hantera_provision() to authenticated, service_role;

alter table commission_entry enable row level security;

drop policy if exists commission_entry_read on commission_entry;
create policy commission_entry_read on commission_entry for select
  to authenticated using (
    employee_id = public.current_employee_id()
    or public.far_hantera_provision()
  );

-- Skrivning sker uteslutande via server actions med service role. Ingen
-- insert-, update- eller delete-policy finns, som pa resten av navet.

comment on table commission_entry is
  'Huvudbok over intjanad provision. En rad ar en post, aldrig ett saldo; en rattelse ar en negativ post. Manuell inmatning i dag, Inkio via source/external_ref senare (E13, A5).';
comment on column commission_entry.amount is
  'Signerat belopp i kronor. Negativt = rattelse av en tidigare post.';
comment on column commission_entry.external_ref is
  'Inkios eget id for affaren. Bar idempotensen vid import; null for manuella poster.';
