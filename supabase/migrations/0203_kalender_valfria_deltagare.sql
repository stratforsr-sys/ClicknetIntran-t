-- =============================================================================
-- 0203_kalender_valfria_deltagare.sql — Kalendern: valfria deltagare som i
-- Outlook
--
-- -----------------------------------------------------------------------------
-- VAD SOM BEHÖVS
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-22 (Kalendern som Outlook, fråga 4): "har Outlook det,
-- då gör det". En inbjuden är obligatorisk eller valfri. Den valfria får samma
-- inbjudan, men Föreslå tid och schemaläggningsassistenten letar bara en tid
-- då de obligatoriska är lediga.
--
--   calendar_attendee.optional   false = obligatorisk (som alla i dag).
--                                Sätts av /nav2/kalender efter lk_skapa_mote,
--                                lk_skapa_serie och lk_andra_mote, på mötets
--                                eller seriens rad, med service role.
--
-- Inga funktioner ändras: svar, förslag, påminnelser och notiser gäller den
-- valfria som alla andra.
--
-- NULL TILLÅTS (= obligatorisk) med flit: lk_angra lägger tillbaka deltagare
-- med jsonb_populate_recordset ur rader som sparats före den här filen, och där
-- saknas fältet. Med NOT NULL hade en Ångra strax efter körningen fallerat.
-- =============================================================================

alter table public.calendar_attendee
  add column if not exists optional boolean default false;

comment on column public.calendar_attendee.optional is
  'Valfri deltagare (Outlook). Föreslå tid och assistenten räknar bara de obligatoriska. 0203.';
