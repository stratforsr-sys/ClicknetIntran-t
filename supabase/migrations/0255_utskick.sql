-- =============================================================================
-- 0255_utskick.sql — vem som får vad, i vilken kanal
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-29: "en allomfattande inställning" för vilka som får
-- mejl, på vad, och för notiserna — i gamla Nav och i Nav 2.0. Fram till nu
-- fanns bara Nav 2.0:s brytare för klockan, och de låg i webbläsarens
-- localStorage: de följde inte med till telefonen och nådde aldrig servern,
-- så mejlet och pushen gick ut ändå.
--
-- Spannet är 0255–0259 (PARALLELLT.md).
--
-- -----------------------------------------------------------------------------
-- EN RAD PER LAGER
-- -----------------------------------------------------------------------------
--
--   lager   niva          employee_id   vem som skriver
--   alla    –             –             superadmin, hela bolaget
--   niva    salesperson…  –             superadmin, en nivå
--   person  –             personen      superadmin, en enskild person
--   egen    –             personen      personen själv
--
-- `regler` är kanal → nyckel → på/av, och bara det som avviker sparas:
--   {"mejl": {"*": false, "omrade:order": true, "sort:order-makulerad": false}}
-- Hur lagren vägs mot varandra står i src/lib/utskick.ts.
--
-- -----------------------------------------------------------------------------
-- STÄNGD FÖR KLIENTEN
-- -----------------------------------------------------------------------------
--
-- RLS är påslaget och ingen policy finns, så bara service role når tabellen.
-- Det är servern som läser och skriver, efter att ha prövat vem som frågar:
-- det egna lagret för den inloggade, de tre andra bara för superadmin. Det är
-- samma väg som mejlet, pushen och morgonbrevet läser tabellen, och de har
-- ingen inloggad användare att låna en token av.
-- =============================================================================

create table if not exists public.notification_rule (
  id          uuid primary key default gen_random_uuid(),
  lager       text not null check (lager in ('alla', 'niva', 'person', 'egen')),
  niva        text check (niva in ('salesperson', 'admin', 'superadmin')),
  employee_id uuid references public.employee(id) on delete cascade,
  regler      jsonb not null default '{}'::jsonb check (jsonb_typeof(regler) = 'object'),
  updated_by  uuid references public.employee(id) on delete set null,
  updated_at  timestamptz not null default now(),
  -- Varje lager har exakt sina nycklar. Uttrycken är rena is null/is not null
  -- och ger aldrig NULL, så villkoret avvisar det det ska.
  constraint notification_rule_lager check (
       (lager = 'alla'   and niva is null     and employee_id is null)
    or (lager = 'niva'   and niva is not null and employee_id is null)
    or (lager in ('person', 'egen') and niva is null and employee_id is not null)
  ),
  constraint notification_rule_en_per_lager unique nulls not distinct (lager, niva, employee_id)
);

create index if not exists notification_rule_employee on public.notification_rule (employee_id)
  where employee_id is not null;

alter table public.notification_rule enable row level security;

revoke all on public.notification_rule from anon, authenticated;

comment on table public.notification_rule is
  'Utskicken (0255): vem som får vad i klockan, mejlet, telefonen och morgonbrevet. Lagren alla/niva/person skrivs av superadmin, egen av personen. Bara service role.';
