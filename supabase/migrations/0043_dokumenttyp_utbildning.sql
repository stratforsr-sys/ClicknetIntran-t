-- =============================================================================
-- 0043_dokumenttyp_utbildning.sql — 'training' som dokumenttyp
--
-- Utbildningsmaterial har hittills lagts som 'routine' för att det inte fanns
-- något bättre val i listan. Följden är att filtret på /rutiner inte går att
-- använda för att skilja "så här gör vi" från "så här lär du dig" — och att en
-- granskningspåminnelse på ett utbildningsmaterial ser ut som en förfallen
-- rutin.
--
-- Typen bär ingen spärr och inget lagkrav. Den ändrar alltså ingenting i
-- `compliance_gate` eller `standard_review_due()`: granskningsdatumet blir tolv
-- månader som för allt annat som inte är AFS-krävt.
--
-- Kurserna i `course` är en annan sak och rörs inte. Det här är ett styrande
-- dokument om utbildning, inte en kurs med moduler och quiz.
-- =============================================================================

alter table document drop constraint if exists document_doc_type_check;
alter table document add constraint document_doc_type_check check (
  doc_type in ('routine','policy','work_env_policy','risk_assessment',
               'task_allocation','script','price_list','case','training',
               'interest_assessment','staff_information')
);
