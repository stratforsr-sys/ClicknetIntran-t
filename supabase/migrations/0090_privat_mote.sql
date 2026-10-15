-- 0090 · Privat möte (Nav 2.0, 2026-10-15)
--
-- Nav 2.0:s kalender har kryssrutan Privat: den som får se kalendern i detalj
-- ser "Privat" i stället för rubriken, och ingen agenda eller plats. Den som
-- organiserar eller är med ser allt, som förut. Navet hade ingen sådan flagga.
--
-- Additiv, med false som förval, så alla befintliga möten är som förut. Nav
-- 2.0 läser flaggan (src/lib/nav2/kalender.ts); /kalender gör det inte än.

alter table public.calendar_event add column is_private boolean not null default false;
