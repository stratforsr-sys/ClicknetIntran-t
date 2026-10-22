-- =============================================================================
-- 0200_kalender_inga_ombud.sql — Kalendern: ett ombud ändrar inte i ägarens
-- kalender
--
-- -----------------------------------------------------------------------------
-- VAD SOM BEHÖVS
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-22 (Kalendern som Outlook, fråga 1): den som fått
-- nivån "Kan planera om" (redigera) eller "Delegat" av ägaren ska inte flytta
-- eller boka i ägarens kalender. lk_far_andra släppte fram de två nivåerna, och
-- den frågas av lk_andra_mote, lk_besluta_forslag, lk_flytta, lk_flytta_serie,
-- lk_kopiera, lk_satt_utfall, lk_skapa_leverans, lk_skapa_mote, lk_skapa_serie
-- och lk_stall_in. Nu är det bara arrangören själv.
--
-- Nivåerna står kvar i calendar_share: de ger fortfarande hela insynen
-- (kalender_niva rörs inte). Nav 2.0:s rutt (/nav2/kalender) stänger samma sak
-- redan utan den här filen; den här stänger den också för gamla Navs actions.
--
-- I dag delar ingen sin kalender (calendar_share är tom), så inget ändras för
-- någon i dag.
-- =============================================================================

create or replace function public.lk_far_andra(p_aktor uuid, p_organizer uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select p_aktor is not null and p_organizer is not null and p_aktor = p_organizer;
$function$;
