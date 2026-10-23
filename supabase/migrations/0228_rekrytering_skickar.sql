-- 0228 · Rekrytering: ett mejl till en kandidat går en gång (granskningen 2026-10-22, F1-7, S10)
--
-- Rutten /nav2/rekrytering och utkorgsjobbet (/api/jobb/utkorg, varje minut)
-- tog samma `vantar`-rader och uppdaterade dem först efter utskicket. Gick båda
-- i samma fönster fick kandidaten två bekräftelser och två schemalagda
-- påminnelser, och bara den ena kunde avbrytas vid en avbokning.
--
-- Nu tas en rad med en villkorad uppdatering, vantar → skickar, innan den
-- skickas (`skickaKandidatmejl` i src/lib/nav2/rekrytering-utskick.ts). Bara
-- den som flyttade raden skickar den. Villkoret får det nya läget.
--
-- Additiv: inga funktioner, ingen policy, inga rader ändras (tabellen var tom
-- 2026-10-23). Main läser inte tabellen.

alter table public.candidate_message drop constraint if exists candidate_message_status_check;
alter table public.candidate_message add constraint candidate_message_status_check
  check (status in ('vantar', 'skickar', 'schemalagd', 'skickad', 'fel', 'avbruten'));

comment on column public.candidate_message.status is
  'vantar → skickar (tagen av den som skickar, 0228) → schemalagd/skickad, eller fel/avbruten.';
