-- 0098 · Utbildning, steg 2: färdigheterna, påminnelserna (2026-10-20)
--
-- =============================================================================
-- 1. FÄRDIGHETERNA PER KURS OCH PER PROV (beställaren 2026-10-20, U1)
--
-- Förslaget i delar/utbildning/beslut.md är godkänt, per kurs och per prov,
-- med två ändringar: färdigheten `regler` heter Regler (utan GDPR), och
-- Introduktionens prov räknas som Regler (vad vi lovar och inte lovar, och vem
-- man frågar; det finns ingen garanterad förstaplats).
--
--   learning_meta.skills   kursens färdigheter, i ordning
--   learning_meta.moduler  provmodulens färdighet; en fråga får provets,
--                          med kursens första som reserv (utbildning.ts)
--
-- Additivt: `||` lägger till nycklarna och lämnar resten av learning_meta.
-- Öppningen, Eftersälj och Produkt och pris (utom Introduktionen) har inget
-- prov än och står som "inga svar än" tills det finns ett.
--
-- 2. PÅMINNELSEN OM REPETITIONEN (beslut.md punkt 4)
--
-- En gång per person och dag, som startsidans kvällsnotis: en rad i push_sent
-- (0121) med sorten `utb-rep`, skriven innan pushen går.
--
-- 3. PÅMINNELSEN OM CERTIFIKAT SOM GÅR UT
--
-- En gång per certifikat: `certification.reminded_at` sätts av dagtidsjobbet i
-- samma uppdatering som avgör vem som skickar. Ett förnyat certifikat är en ny
-- rad, så nästa påminnelse kommer av sig själv.
--
-- Teamets veckomål (U2) och frysdagarna (U3) räknas på servern ur
-- learning_answer och frånvaron. De behöver ingen tabell.
-- =============================================================================

update public.course
   set learning_meta = learning_meta || jsonb_build_object(
         'skills', jsonb_build_array('regler', 'produkt'),
         'moduler', jsonb_build_object('156bc6cb-31f9-4d92-b1d0-0c66c6e824d3', 'regler'))
 where slug = 'introduktion-for-nya-saljare';

update public.course
   set learning_meta = learning_meta || jsonb_build_object(
         'skills', jsonb_build_array('invand', 'behov', 'avslut'),
         'moduler', jsonb_build_object(
           '992bcfdd-741d-44f5-b604-b65305bf4a31', 'invand',   -- Prov 1: fråga eller exit?
           '8ebde35e-c363-4cdd-afca-801690fc7672', 'invand',   -- Prov 2: välj följdfrågan
           '448d5796-4def-44be-90c6-1b791936b469', 'behov',    -- Prov 3: kedjan
           'cf4a7053-886a-4880-8642-9896784ad4b7', 'avslut'))  -- Prov 4: dörr eller nej?
 where slug = 'slapp-inte-kunden-for-tidigt';

update public.course
   set learning_meta = learning_meta || jsonb_build_object('skills', jsonb_build_array('oppning', 'behov', 'avslut'))
 where slug = 'saljstruktur';

alter table public.push_sent drop constraint if exists push_sent_kind_check;
alter table public.push_sent add constraint push_sent_kind_check check (kind in ('kvall', 'sondag', 'prov', 'utb-rep'));
comment on table public.push_sent is
  'Nav 2.0 (0121, 0098): skickade pushnotiser, en per person, sort och dag (kvällsnotisen, provet, repetitionens påminnelse).';

alter table public.certification add column if not exists reminded_at timestamptz;
comment on column public.certification.reminded_at is
  'Nav 2.0 (0098): när påminnelsen en månad innan certifikatet går ut skickades. En gång per certifikat.';
