-- =============================================================================
-- 0279_andrat_i_inkio.sql — en order som makuleras eller sägs upp i Inkio
-- blir makulerad eller uppsagd i Nav
--
-- -----------------------------------------------------------------------------
-- VARFÖR (provet i produktionen 2026-11-02)
-- -----------------------------------------------------------------------------
--
-- `lk_inkio_andra_order` (0277) sätter `cancelled_by = null` och
-- `renewal_by = null`: ingen i Nav gjorde ändringen, den kom från Inkio. Men
-- två villkor kräver en person:
--
--   sales_order_makulerad_av  (0034)  cancelled_by och cancelled_on båda eller ingen
--   sales_order_fornyelse     (0068)  ett utfall kräver renewal_by
--
-- Funktionen kastade därför 23514 för makulerad och uppsagt, bevakningen
-- svalde felet, och ordern stod kvar oförändrad i Nav. Betald fungerade.
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- sales_order.cancelled_in_crm  makuleringen kom från Inkio
-- sales_order.renewal_in_crm    utfallet (avslutad) kom från Inkio
--
-- Villkoren släpper igenom en tom person bara när kolumnen säger Inkio. Navs
-- egna vägar (`makuleraOrder`, förnyelsens utfall) kräver en person som förut.
-- Ingen påhittad anställd: en sådan hade synts i listor, registerutdrag och
-- säljtavlan. Vem i Inkio som gjorde det står i Inkios historik och i
-- `audit_log` (`sales_order.cancelled_in_crm`, `sales_order.not_renewed_in_crm`).
--
-- Tas utfallet tillbaka i Nav nollas renewal_* men inte `renewal_in_crm`; det
-- första ledet i villkoret frågar inte efter den, så raden är giltig ändå.
--
-- Additiv: koden på main läser inte kolumnerna, och funktionen har samma
-- signatur. Omkörbar.
-- =============================================================================

alter table public.sales_order
  add column if not exists cancelled_in_crm boolean not null default false,
  add column if not exists renewal_in_crm   boolean not null default false;

comment on column public.sales_order.cancelled_in_crm is
  'Makuleringen kom från Inkio (0279). Då får cancelled_by vara tom.';
comment on column public.sales_order.renewal_in_crm is
  'Förnyelsens utfall kom från Inkio (0279). Då får renewal_by vara tom.';

alter table public.sales_order drop constraint if exists sales_order_makulerad_av;
alter table public.sales_order add constraint sales_order_makulerad_av check (
  (cancelled_on is null and cancelled_by is null)
  or (cancelled_on is not null and (cancelled_by is not null or cancelled_in_crm))
);

alter table public.sales_order drop constraint if exists sales_order_fornyelse;
alter table public.sales_order add constraint sales_order_fornyelse check (
  (renewal_outcome is null and renewal_at is null and renewal_by is null
   and renewal_reason is null and renewal_order_id is null)
  or (renewal_outcome is not null and renewal_at is not null
      and (renewal_by is not null or renewal_in_crm))
);

create or replace function public.lk_inkio_andra_order(
  p_order  uuid,
  p_vad    text,
  p_skal   text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  perform set_config('nav.fran_inkio', 'ja', true);

  if p_vad = 'makulerad' then
    update sales_order
       set status = 'makulerad',
           cancelled_on = (now() at time zone 'Europe/Stockholm')::date,
           cancelled_by = null,
           cancelled_in_crm = true,
           cancel_reason = left(p_skal, 500)
     where id = p_order and status in ('signerad', 'betald');
  elsif p_vad = 'betald' then
    update sales_order set status = 'betald' where id = p_order and status = 'signerad';
  elsif p_vad = 'uppsagt' then
    update sales_order
       set renewal_outcome = 'avslutad',
           renewal_at = now(),
           renewal_by = null,
           renewal_in_crm = true,
           renewal_reason = left(p_skal, 500)
     where id = p_order and renewal_outcome is null and status in ('signerad', 'betald');
  else
    raise exception 'Okänd ändring: %', p_vad;
  end if;

  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.lk_inkio_andra_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lk_inkio_andra_order(uuid, text, text) to service_role;
