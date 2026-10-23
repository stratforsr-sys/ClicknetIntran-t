-- 0215 · Provision: att ta bort en övrig bonus görs i ett steg (2026-10-23)
--
-- =============================================================================
-- VARFÖR (granskningen 2026-10-22, D4 och C5)
--
-- Nav 2.0:s "Ta bort" på en övrig bonus gjorde tre separata turer i rutten
-- (src/app/nav2/provision/route.ts): läs kopplingen, skriv den negativa posten,
-- skriv kopplingen i `commission_entry_reversal`. Felet från den sista
-- kontrollerades inte.
--
-- Ett dubbelklick, eller ett nytt försök efter ett nätfel, gav då två negativa
-- poster: båda anropen såg ingen koppling, båda bokförde −X, och den andra
-- kopplingen föll på primärnyckeln utan att någon märkte det. Huvudboken
-- visade +X, −X, −X, och `commission_entry` går inte att skriva om
-- (`commission_entry_last`), så den extra posten kunde bara rättas med en ny.
--
-- Nu görs allt i en funktion, i en transaktion:
--   1. posten låses (`for update`), så ett andra anrop väntar på det första,
--   2. den prövas: övrig bonus, inte redan borttagen (och inte själv en
--      motpost), och månaden är inte fastställd,
--   3. motposten skrivs med exakt de fält rutten skrev förut,
--   4. kopplingen skrivs. Faller den, rullas motposten tillbaka med den.
--
-- Felkoderna (rutten översätter dem):
--   pv:ogiltig          posten finns inte eller är ingen övrig bonus
--   pv:redan_borttagen  posten är redan borttagen, eller är själv en motpost
--   pv:faststalld       månaden är fastställd
--
-- BARA SERVICE ROLE. Rutten prövar rollen (säljchef, ekonomi, VD) innan den
-- anropar, och skickar den inloggades id som p_aktor. Därför får varken anon
-- eller authenticated köra funktionen (minnet nav-security-definer-
-- standardrattighet: ett aktörsargument i en öppen funktion är ett hål).
-- =============================================================================

create or replace function public.ta_bort_ovrig_bonus(p_aktor uuid, p_post uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post public.commission_entry%rowtype;
  v_ny uuid;
begin
  select * into v_post from public.commission_entry where id = p_post for update;
  if not found or v_post.kind is distinct from 'ovrig_bonus' then
    raise exception 'pv:ogiltig';
  end if;

  if exists (
    select 1 from public.commission_entry_reversal r
    where r.original_id = p_post or r.reversal_id = p_post
  ) then
    raise exception 'pv:redan_borttagen';
  end if;

  if exists (select 1 from public.commission_period p where p.period_month = v_post.period_month) then
    raise exception 'pv:faststalld';
  end if;

  insert into public.commission_entry (employee_id, period_month, amount, kind, source, note, sales_order_id, entered_by)
  values (
    v_post.employee_id,
    v_post.period_month,
    -v_post.amount,
    'ovrig_bonus',
    'manual',
    left('Borttagen: ' || coalesce(v_post.note, ''), 500),
    v_post.sales_order_id,
    p_aktor
  )
  returning id into v_ny;

  insert into public.commission_entry_reversal (original_id, reversal_id, created_by)
  values (p_post, v_ny, p_aktor);

  return v_ny;
end;
$$;

revoke all on function public.ta_bort_ovrig_bonus(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ta_bort_ovrig_bonus(uuid, uuid) to service_role;
