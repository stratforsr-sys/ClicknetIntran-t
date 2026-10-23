-- 0229 · Anställda: checklistornas fritext tar inga personnummer (granskningen 2026-10-22, F1-9, S10)
--
-- "Be om ett värde tillbaka" är fri text, och värdet, anteckningen och skälet
-- för att hoppa över hamnade i `onboarding_task`/`offboarding_task`, i
-- händelseloggen och i chefens notis utan K27:s prövning. Rutterna prövar nu
-- (`harPersonnummer` i src/lib/nav2/avslutforma.ts), och villkoren här gör
-- samma sak i databasen, med samma funktion som Rekrytering (0030).
--
-- Inga rader bröt mot villkoren 2026-10-23 (12 + 8 rader). Inga funktioner,
-- inga policyer. `coalesce` gör att NULL prövas som tom text och aldrig
-- släpper igenom något av misstag.

alter table public.onboarding_task drop constraint if exists onboarding_task_inget_personnummer;
alter table public.onboarding_task add constraint onboarding_task_inget_personnummer check (
  not public.ser_ut_som_personnummer(coalesce(value, ''))
  and not public.ser_ut_som_personnummer(coalesce(note, ''))
  and not public.ser_ut_som_personnummer(coalesce(skipped_reason, ''))
);

alter table public.offboarding_task drop constraint if exists offboarding_task_inget_personnummer;
alter table public.offboarding_task add constraint offboarding_task_inget_personnummer check (
  not public.ser_ut_som_personnummer(coalesce(value, ''))
  and not public.ser_ut_som_personnummer(coalesce(note, ''))
  and not public.ser_ut_som_personnummer(coalesce(skipped_reason, ''))
);
