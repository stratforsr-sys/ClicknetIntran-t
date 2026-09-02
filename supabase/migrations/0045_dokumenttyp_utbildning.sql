-- =============================================================================
-- 0045_dokumenttyp_utbildning.sql — 'training' som dokumenttyp
--
-- Utbildningsmaterial har hittills lagts som 'routine' för att det inte fanns
-- något bättre val i listan. Följden är att filtret på /rutiner inte går att
-- använda för att skilja "så här gör vi" från "så här lär du dig" — och att en
-- granskningspåminnelse på ett utbildningsmaterial ser ut som en förfallen
-- rutin. Förfallomarkeringen är avsiktligt hård för ALLA läsare (AC-5.2), och
-- den tappar sin skärpa om den ropar om fel saker.
--
-- Typen bär ingen spärr och inget lagkrav. Den ändrar alltså ingenting i
-- `compliance_gate` eller `standard_review_due()`: granskningsdatumet blir tolv
-- månader som för allt annat som inte är AFS-krävt.
--
-- Kurserna i `course` är en annan sak och rörs inte. Det här är ett styrande
-- dokument om utbildning, inte en kurs med moduler och quiz.
--
-- NUMRERINGEN: villkoret kördes mot produktion 2026-09-01 under namnet
-- `0043_dokumenttyp_utbildning`, innan coachningsmodulen tog 0043 och
-- lösenordstvånget 0044. Filen är omdöpt och raden i `schema_migrations`
-- likaså. Satserna nedan är avsiktligt omkörbara, så en miljö som fick den
-- under det gamla namnet landar rätt ändå.
-- =============================================================================

alter table document drop constraint if exists document_doc_type_check;
alter table document add constraint document_doc_type_check check (
  doc_type in ('routine','policy','work_env_policy','risk_assessment',
               'task_allocation','script','price_list','case','training',
               'interest_assessment','staff_information')
);

-- Självkontroll: villkoret ska släppa igenom 'training'. pg_get_constraintdef
-- versaliserar, därför gemener i jämförelsen (samma skäl som i 0043).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'document_doc_type_check'
      and lower(pg_get_constraintdef(oid)) like '%''training''%'
  ) then
    raise exception 'document_doc_type_check saknar training';
  end if;
end $$;
