-- =============================================================================
-- 0008_kurs_frist.sql — frist for en kurs (AC-6.6)
--
-- "Forsenade" i progressvyn kraver ett datum att vara sen mot. Fristen raknas
-- i dagar fran anstallningens start i stallet for ett fast datum: en kurs som
-- ska vara klar inom tva veckor gor det for var och en som borjar, utan att
-- nagon behover satta om datumet vid varje nyanstallning.
-- =============================================================================

alter table course add column if not exists due_days int
  check (due_days is null or due_days > 0);

comment on column course.due_days is
  'AC-6.6: antal dagar fran anstallningens start. Null = ingen frist.';
