-- =============================================================================
-- 0028_avtalsmallar.sql — E9.1: avtalsmallar for anstallning.
--
-- E9.2 e-signering ar blockerad av A14 och finns inte har. Det som byggs ar
-- mallen, avtalet som skapas ur den, och utskriften. Signeringen laggs till
-- som ett steg efter `issued` nar leverantoren ar vald — inget i schemat nedan
-- forutsatter vilken det blir.
--
-- =============================================================================
-- AVTALET FRYSER MALLTEXTEN NAR DET UTFARDAS
--
-- `contract.body_md` ar det FARDIGRENDERADE dokumentet, inte en pekare till
-- mallen. En mall som redigeras i oktober far inte andra ett avtal som skrevs
-- i augusti — det som en manniska skrev under ar det som stod da.
--
-- `template_id` star kvar for sparbarhet, men avtalet ar inte beroende av den:
-- kolumnen ar `on delete set null`. Att radera en mall ska inte kunna tomma
-- ett avtal.
--
-- =============================================================================
-- LONEN SKRIVS IN I AVTALET. DEN LASES INTE UR salary_basis.
--
-- Det ar frestande att lata avtalet hamta manadslonen ur E15, och det vore
-- fel at bada hallen:
--
--   1. `salary_basis` ligger bakom `payroll_cost_viewer` (K26). Den som lagger
--      upp en anstalld ar `canManageEmployees`, alltsa saljchef eller admin —
--      en annan och bredare krets. En hamtning hade rackt kostnadsdatan vidare
--      till fler an behorigheten slapper in.
--   2. Riktningen ar omvand. Avtalet ar KALLAN till den siffran; salary_basis
--      ar en inmatning av vad nagon kom overens om. 0025 sager det redan rakt
--      ut: den anstallda "far den ur sitt anstallningsavtal".
--
-- Avtalet skriver darfor heller INTE en rad i salary_basis. Den tabellen ar
-- append-only med eget `entered_by`, och en automatisk rad darifran hade sett
-- ut som att nagon med lonekostnadsbehorighet matat in den.
--
-- =============================================================================
-- INGET PERSONNUMMER, OCH VILLKORET SOM HALLER DET SANT
--
-- Navet lagrar inget personnummer nagonstans. tests/rls.mjs fragar
-- information_schema och faller den dag en KOLUMN som bar ett dyker upp.
--
-- `variables` ar jsonb, alltsa precis det stalle dar en sadan uppgift kan
-- smyga sig in utan att schemakontrollen ser den. Check-villkoret nedan nekar
-- en personnummerformad strang var som helst i jsonben.
--
-- Foljden: det utskrivna avtalet har en rad dar personnumret fylls i for hand.
-- Ska navet bara det maste K27-linjen omprovas medvetet — inte kringgas har.
-- =============================================================================

create table if not exists contract_template (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,

  -- Markdown med {{platshallare}}. Vilka som ar tillatna star i
  -- src/lib/avtal.ts, och en okand nyckel stoppas nar mallen sparas.
  body_md     text not null,

  -- Vilken anstallningsform mallen ar tankt for. NULL = alla. Styr bara vilken
  -- mall som foreslas forst, aldrig vilken som gar att valja: en provanstalld
  -- konsult ska inte behova en nionde mall.
  employment_type text
    check (employment_type is null or employment_type in
      ('permanent','probation','consultant','intern')),

  status      text not null default 'draft'
                check (status in ('draft','published','archived')),

  created_by  uuid references employee(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references employee(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create index if not exists contract_template_status_idx
  on contract_template (status, employment_type);

create table if not exists contract (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id) on delete cascade,

  -- Sparbarhet, inte beroende. Se rubriken ovan.
  template_id   uuid references contract_template(id) on delete set null,
  template_slug text not null,
  title         text not null,

  -- Det frysta dokumentet. Det har ar avtalet.
  body_md     text not null,

  -- Vad som fylldes i. Star kvar for att kunna svara pa "vilken lon stod det
  -- i avtalet" utan att lasa igenom brodtexten.
  variables   jsonb not null default '{}'::jsonb,

  status      text not null default 'draft'
                check (status in ('draft','issued','withdrawn')),

  issued_at   timestamptz,
  issued_by   uuid references employee(id) on delete set null,
  withdrawn_at timestamptz,
  withdrawn_by uuid references employee(id) on delete set null,
  withdrawn_reason text,

  created_by  uuid references employee(id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint contract_utfardat_har_tidpunkt check (
    status <> 'issued' or (issued_at is not null and issued_by is not null)
  ),

  -- Se rubriken. Villkoret galler hela jsonben som text, sa det spelar ingen
  -- roll vilken nyckel nagon skulle lagga numret under.
  constraint contract_utan_personnummer check (
    variables::text !~ '\d{6}[-+]?\d{4}'
  )
);

create index if not exists contract_employee_idx on contract (employee_id, created_at desc);
create index if not exists contract_status_idx   on contract (status);

-- -----------------------------------------------------------------------------
-- Ett utfardat avtal skrivs inte om
--
-- Samma linje som `time_event` (AC-2.3), `salary_basis` och
-- `cost_calculation`. Ett dokument som en manniska skrivit under far inte
-- kunna andras i efterhand — da ar det inte langre ett bevis pa vad man kom
-- overens om.
--
-- Statusbytet till `withdrawn` slapps igenom. Ett avtal som drogs tillbaka ska
-- kunna markeras som tillbakadraget; det ar inte samma sak som att andra det.
-- Texten, variablerna och utfardandet star kvar ororda.
-- -----------------------------------------------------------------------------

create or replace function public.contract_ar_last()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'issued' then
    if new.body_md is distinct from old.body_md
       or new.variables is distinct from old.variables
       or new.employee_id is distinct from old.employee_id
       or new.issued_at is distinct from old.issued_at then
      raise exception 'Ett utfardat avtal skrivs inte om. Dra tillbaka det och skapa ett nytt.';
    end if;

    if new.status not in ('issued','withdrawn') then
      raise exception 'Ett utfardat avtal kan bara dras tillbaka, inte atergaa till utkast.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists contract_last on contract;
create trigger contract_last
  before update on contract
  for each row execute function public.contract_ar_last();

-- -----------------------------------------------------------------------------
-- Behorighet
--
-- MALLARNA lases av den som far lagga upp anstallda, alltsa sales_manager och
-- admin, plus ceo. En mall ar inte persondata — men den ar bolagets
-- avtalsvillkor i klartext, och en publicerad mall som varje saljare kan lasa
-- ar en forhandlingsposition som lackt.
--
-- AVTALET lases av samma krets OCH av den det galler — men bara nar det ar
-- UTFARDAT. Ett utkast dar nagon provar sig fram med en siffra ska inte ligga
-- synligt for den som siffran handlar om. Det ar samma resonemang som
-- roleplay_criterion i 0024 drog at andra hallet: den som ska bedomas far se
-- kriterierna FORE, men den som ska erbjudas ett avtal ska se erbjudandet nar
-- det ar ett erbjudande.
--
-- Teamledaren star utanfor bada. Hon leder sitt team, hon forhandlar inte
-- deras loner.
-- -----------------------------------------------------------------------------

create or replace function public.far_hantera_avtal()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_any_role(array['sales_manager','ceo','admin'])
$$;

revoke execute on function public.far_hantera_avtal() from public;
grant execute on function public.far_hantera_avtal() to anon, authenticated, service_role;

alter table contract_template enable row level security;
alter table contract          enable row level security;

drop policy if exists contract_template_read on contract_template;
create policy contract_template_read on contract_template for select
  to authenticated using (public.far_hantera_avtal());

drop policy if exists contract_read on contract;
create policy contract_read on contract for select
  to authenticated
  using (
    public.far_hantera_avtal()
    or (status = 'issued' and employee_id = public.current_employee_id())
  );

-- Skrivning sker via server actions med service role, som pa resten av navet
-- (0002). Ingen insert-, update- eller delete-policy finns.
