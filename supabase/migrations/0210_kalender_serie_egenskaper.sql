-- =============================================================================
-- 0210_kalender_serie_egenskaper.sql — Kalendern: Privat, plats, länk och
-- "Visa som" ligger på serien och följer med varje ny gång
--
-- -----------------------------------------------------------------------------
-- VAD SOM VAR FEL (granskningen 2026-10-22, C2)
-- -----------------------------------------------------------------------------
--
-- Flaggan Privat (0090), platsen, möteslänken och "Visa som" fanns bara på
-- calendar_event. Nav 2.0 skrev dem på de gånger som redan fanns när en serie
-- skapades eller ändrades, men dagtidsjobbet föder nya gånger åtta veckor fram
-- (lk_fyll_serie → lk_fod_forekomster), och de fick bara seriens kolumner. En
-- privat veckovis 1:1 med Teams-länk och "Visa som ledig" blev från vecka 9
-- synlig för den som fått "Detaljer" via Dela, utan Anslut och som upptagen.
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- 1. calendar_series får is_private, plats, online_url och show_as, med samma
--    villkor som calendar_event. show_as null = upptagen (händelsens förval).
-- 2. Befintliga serier fylls ur seriens senaste gång som inte avviker.
-- 3. lk_fod_forekomster sätter dem på varje ny gång. Resten av funktionen är
--    ordagrant som i 0070 (pg_proc 2026-10-23).
--
-- /nav2/kalender skriver egenskaperna på serien när en serie skapas eller
-- ändras. Gamla Navs actions skriver dem inte, och där står det som förut:
-- serien har false/null och gångerna får det de alltid fått.
-- =============================================================================

alter table public.calendar_series
  add column if not exists is_private boolean not null default false,
  add column if not exists plats text,
  add column if not exists online_url text,
  add column if not exists show_as text;

alter table public.calendar_series drop constraint if exists calendar_series_show_as_check;
alter table public.calendar_series add constraint calendar_series_show_as_check
  check (show_as is null or show_as in ('upptagen', 'preliminar', 'ledig', 'borta', 'annan'));
alter table public.calendar_series drop constraint if exists calendar_series_plats_check;
alter table public.calendar_series add constraint calendar_series_plats_check
  check (plats is null or length(plats) <= 200);
alter table public.calendar_series drop constraint if exists calendar_series_online_url_check;
alter table public.calendar_series add constraint calendar_series_online_url_check
  check (online_url is null or (online_url ~ '^https://' and length(online_url) <= 500));

update public.calendar_series s
   set is_private = e.is_private,
       plats = e.plats,
       online_url = e.online_url,
       show_as = e.show_as
  from (select distinct on (series_id) series_id, is_private, plats, online_url, show_as
          from public.calendar_event
         where series_id is not null and not avviker
         order by series_id, dag desc) e
 where e.series_id = s.id;

create or replace function public.lk_fod_forekomster(p_series uuid, p_dagar date[], p_aktor uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_s    calendar_series;
  v_antal int;
begin
  select * into v_s from calendar_series where id = p_series;
  insert into calendar_event (kind, title, organizer_id, dag, tid, minuter, reminder_min,
                              series_id, occurrence_of, created_by, agenda_md,
                              is_private, plats, online_url, show_as)
  select v_s.kind, v_s.title, v_s.organizer_id, d, v_s.tid, v_s.minuter, v_s.reminder_min,
         v_s.id, d, coalesce(p_aktor, v_s.created_by), '',
         v_s.is_private, v_s.plats, v_s.online_url, coalesce(v_s.show_as, 'upptagen')
  from unnest(public.lk_giltiga_dagar(p_dagar, greatest(v_s.starts_on, current_date), v_s.ends_on)) d
  on conflict (series_id, occurrence_of) do nothing;
  get diagnostics v_antal = row_count;
  return v_antal;
end;
$function$;

revoke all on function public.lk_fod_forekomster(uuid, date[], uuid) from public, anon, authenticated;
grant execute on function public.lk_fod_forekomster(uuid, date[], uuid) to service_role;

comment on column public.calendar_series.is_private is
  'Privat (0090) för hela serien; lk_fod_forekomster sätter det på varje ny gång. 0210.';
comment on column public.calendar_series.show_as is
  'Visa som för seriens gånger; null = upptagen. 0210.';
