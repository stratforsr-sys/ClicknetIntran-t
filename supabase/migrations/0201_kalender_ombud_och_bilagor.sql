-- =============================================================================
-- 0201_kalender_ombud_och_bilagor.sql — Kalendern: ombud som i Outlook, och
-- bilagor på möten
--
-- -----------------------------------------------------------------------------
-- 1. OMBUD (del 15)
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-22, efter del 9: "det vore faktiskt bra att ifall man vill
-- kunna dela behörighet till någon som kan flytta mina möten eller svara och
-- boka åt mig ifall jag tex har en assistent". Det tar tillbaka fråga 1 och
-- 0200. Nivåerna i Dela gäller igen, som texterna i utkastet säger:
--
--   redigera  "Kan planera om"   flyttar, ändrar och ställer in de möten ägaren
--                                ordnar (Outlooks Redigerare).
--   delegat   "Delegat"          det, och svarar på inbjudningar och bokar möten
--                                åt ägaren (Outlooks Ombud).
--
-- lk_far_andra blir som i 0069. Den frågas av lk_andra_mote, lk_besluta_forslag,
-- lk_flytta, lk_flytta_serie, lk_kopiera, lk_satt_utfall, lk_skapa_leverans,
-- lk_skapa_mote, lk_skapa_serie, lk_stall_in, lk_andra_serie (0202) och
-- lk_andra_heldag (0204). Att bara en delegat bokar åt ägaren (och inte den som
-- får planera om) avgör /nav2/kalender, som i Outlook.
--
-- lk_svara_at är nytt: delegaten svarar på ägarens inbjudan. Svaret blir
-- ägarens, med samma notis till arrangören som när ägaren svarar själv.
--
-- I dag delar ingen sin kalender (calendar_share är tom), så inget ändras för
-- någon förrän någon ger en kollega nivån.
--
-- -----------------------------------------------------------------------------
-- 2. BILAGOR (del 16)
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-22: ja till bilagor (Outlook: "Bifoga fil"). En fil hör
-- till ett möte, eller till en hel serie (då följer den med varje gång och
-- överlever att serien ändras). Filen ligger i lagringen (R2 eller Supabase,
-- som ärendenas bilagor i 0081); raden säger var. Bara service role läser och
-- skriver tabellen: /nav2/kalender prövar vem som ser mötet och vem som får
-- ändra det.
-- =============================================================================

create or replace function public.lk_far_andra(p_aktor uuid, p_organizer uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select p_aktor is not null and p_organizer is not null
     and (p_aktor = p_organizer
          or public.kalender_niva(p_organizer, p_aktor) in ('redigera','delegat'));
$function$;

create or replace function public.lk_svara_at(
  p_aktor uuid, p_for uuid, p_event uuid, p_svar text, p_note text, p_hela_serien boolean
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_r jsonb;
begin
  if p_aktor is null or p_for is null or p_aktor = p_for
     or public.kalender_niva(p_for, p_aktor) is distinct from 'delegat'
     or not public.lk_aktiv(p_aktor) then
    raise exception 'lk:behorighet';
  end if;
  v_r := public.lk_svara(p_for, p_event, p_svar, p_note, p_hela_serien);
  -- Ångra hör till den som tryckte (lk_angra prövar created_by).
  update calendar_undo set created_by = p_aktor where id = (v_r->>'undo_id')::uuid;
  return v_r;
end;
$function$;

revoke all on function public.lk_svara_at(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.lk_svara_at(uuid, uuid, uuid, text, text, boolean) to service_role;

create table if not exists public.calendar_attachment (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references public.calendar_event (id) on delete cascade,
  series_id   uuid references public.calendar_series (id) on delete cascade,
  store       text not null check (store in ('supabase', 'r2')),
  bucket      text not null,
  path        text not null unique,
  filename    text not null check (length(filename) between 1 and 200),
  mime_type   text not null,
  size_bytes  integer not null check (size_bytes > 0 and size_bytes <= 26214400),
  uploaded_by uuid not null references public.employee (id),
  uploaded_at timestamptz not null default now(),
  check ((event_id is null) <> (series_id is null))
);
alter table public.calendar_attachment enable row level security;
revoke all on table public.calendar_attachment from anon, authenticated;
create index if not exists calendar_attachment_event on public.calendar_attachment (event_id) where event_id is not null;
create index if not exists calendar_attachment_series on public.calendar_attachment (series_id) where series_id is not null;

comment on table public.calendar_attachment is
  'Bilagor på möten (Outlook: Bifoga fil). Ett möte eller en hel serie. Bara service role; /nav2/kalender prövar insyn och ändring. 0201.';
