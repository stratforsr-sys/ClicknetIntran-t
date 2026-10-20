-- 0101 · Coachning: rollspel live utan rollspelsmodul (2026-10-20)
--
-- =============================================================================
-- VARFÖR
--
-- 0043 kräver att en överenskommelse av slaget `rollspel_live` pekar på en
-- rollspelsmodul i en kurs. Utkastet (Nav 2.0) väljer ingen modul: chefen
-- väljer bara motpart, och de två övar på riktigt. 0100 löste det genom att
-- spara den som `uppgift` och märka den med `nav2_kind`.
--
-- Beställaren 2026-10-19 (beslutsrundan): "lossa kravet". Rollspel live får
-- därför sakna modul. En modul som anges sparas som förut.
--
-- Körs efter 0100 (den lägger till `nav2_kind`). Rader som 0100 märkt får sitt
-- riktiga slag här. Repots formulär på /coachning kräver fortfarande en modul
-- för rollspel live (`TYP_KRAVER_KALLA`); det är formulärets regel, inte
-- databasens, och ändras inte här.
-- =============================================================================

alter table public.coaching_task drop constraint if exists coaching_task_kalla;
alter table public.coaching_task add constraint coaching_task_kalla check (
     (kind = 'kurs'              and course_id   is not null)
  or (kind = 'rollspel_inspelat' and module_id   is not null)
  or (kind = 'lasning'           and document_id is not null)
  or (kind in ('rollspel_live', 'manus', 'medlyssning', 'uppgift'))
);

-- Serierna (0062) har samma krav och följer med.
alter table public.task_series drop constraint if exists task_series_kalla;
alter table public.task_series add constraint task_series_kalla check (
     slag <> 'coachningsuppgift'
  or (kind = 'kurs'              and course_id   is not null)
  or (kind = 'rollspel_inspelat' and module_id   is not null)
  or (kind = 'lasning'           and document_id is not null)
  or (kind in ('rollspel_live', 'manus', 'medlyssning', 'uppgift'))
);

-- Det 0100 märkte blir riktiga rollspel live.
update public.coaching_task
   set kind = 'rollspel_live', nav2_kind = null
 where nav2_kind = 'rollspel_live';
