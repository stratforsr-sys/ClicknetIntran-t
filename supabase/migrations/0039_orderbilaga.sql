-- =============================================================================
-- 0039_orderbilaga.sql — E13 steg 9: den uppladdade avtals-PDF:en pa en order
--
-- -----------------------------------------------------------------------------
-- VARFOR DET HAR AR EN EGEN MIGRATION OCH INTE ETT PAHANG PA 0034
-- -----------------------------------------------------------------------------
--
-- `file_object` (0022) BAR LAKARINTYG. Tabellen har ett stangt purpose-villkor,
-- ett "exakt en koppling"-villkor och en raderingstrigger som alla finns for
-- att skydda den sortens uppgift. Att vidga den ar darfor ett eget arbete med
-- egna RLS-policyer och en egen provkorning — precis som `0024_rollspel` fick
-- vara, och av samma skal. PROVISION_SPEC.md avsnitt 3.1 och byggordningens
-- steg 9 sager samma sak.
--
-- Villkoren skrivs OM i stallet for att laggas till bredvid: tva check-villkor
-- som bada beskriver vilka kopplingar som ar tillatna hade varit tva stallen
-- att halla lika. Samma linje som 0024 drog.
--
-- -----------------------------------------------------------------------------
-- VAD BILAGAN AR, OCH VAD DEN INTE AR
-- -----------------------------------------------------------------------------
--
-- Bilagan hor till en ORDER, alltsa till en KUNDAFFAR — inte till en manniska
-- som arbetar har. `subject_employee_id` ar darfor NULL, precis som for
-- `document_attachment`, och bilagan star INTE i registerutdraget: det bar
-- uppgifter om den anstallda (artikel 15), och en kunds avtal ar inte det.
--
-- MEN FILEN KAN BARA ETT PERSONNUMMER. En enskild firma har personnummer som
-- organisationsnummer (K27-undantaget i avsnitt 3.2), och en signerad PDF kan
-- dessutom bara en namnteckning. Filen ligger darfor i den stangda
-- `filer`-bucketen med atkomstlogg, vilket ar ratt skyddsniva — men
-- **P0.6 registerforteckningen maste uppdateras med kunduppgifter som ny
-- kategori.** Det ar inte gjort i den har migrationen for att den inte kan
-- gora det: P0.6 ar ett dokument och inte en tabell.
--
-- -----------------------------------------------------------------------------
-- BARA PDF
-- -----------------------------------------------------------------------------
--
-- O14: bestallaren svarade PDF, och ingen OCR behovs. Att slappa in JPEG hade
-- gett en bild som `pdftext.ts` inte kan lasa, och da hade forifyllningen tyst
-- slutat fungera for just de orderna — utan att nagot sag fel ut.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Filen far ett fjarde andamal
-- -----------------------------------------------------------------------------

alter table file_object
  add column if not exists sales_order_id uuid references sales_order(id) on delete cascade;

create index if not exists file_object_order_idx
  on file_object (sales_order_id) where removed_at is null;

alter table file_object drop constraint if exists file_object_koppling;
alter table file_object drop constraint if exists file_object_typ;

alter table file_object drop constraint if exists file_object_purpose_check;
alter table file_object add constraint file_object_purpose_check
  check (purpose in ('sick_certificate','document_attachment','roleplay','sales_order'));

alter table file_object add constraint file_object_koppling check (
  (purpose = 'sick_certificate'
    and sick_report_id is not null
    and document_id is null
    and sales_order_id is null
    and subject_employee_id is not null)
  or
  (purpose = 'document_attachment'
    and document_id is not null
    and sick_report_id is null
    and sales_order_id is null
    and subject_employee_id is null)
  or
  (purpose = 'roleplay'
    and sick_report_id is null
    and document_id is null
    and sales_order_id is null
    and subject_employee_id is not null)
  or
  -- Bilagan hor till ordern och till ingen manniska. `subject_employee_id`
  -- MASTE vara null: satt den till saljaren och kundens avtal blir en uppgift
  -- om den anstallda, som foljer med ut i hens registerutdrag.
  (purpose = 'sales_order'
    and sales_order_id is not null
    and sick_report_id is null
    and document_id is null
    and subject_employee_id is null)
);

alter table file_object add constraint file_object_typ check (
  (purpose = 'sick_certificate'
    and mime_type in ('application/pdf','image/jpeg','image/png'))
  or
  (purpose = 'document_attachment'
    and mime_type in ('application/pdf','image/jpeg','image/png'))
  or
  (purpose = 'roleplay'
    and mime_type in ('audio/mpeg','audio/mp4','audio/wav','audio/webm'))
  or
  -- O14. Bara PDF: en bild gar inte att lasa text ur, och forifyllningen hade
  -- tyst uteblivit for just de orderna.
  (purpose = 'sales_order' and mime_type = 'application/pdf')
);

-- -----------------------------------------------------------------------------
-- 2. Raderingstriggern far sitt fjarde undantag
--
-- SAMMA FALLA SOM 0023 OCH 0033 GICK I. Triggern `file_object_ar_last` nekar
-- att en fil raderas — den ska avpubliceras med `removed_at`, sa att
-- oppningsloggen inte gar att stada bort genom att ta bort filen.
--
-- Men `on delete cascade` KOR EN DELETE. Ett orderutkast gar att radera (0034
-- tillater det for just `utkast`), och utan undantaget nedan hade den
-- raderingen fallit pa den har triggern — en sparr mot att stada bort bevis
-- hade blivit en sparr mot att kasta ett utkast.
--
-- Undantaget ar smalt: det galler bara nar ordern REDAN ar borta, alltsa nar
-- raderingen kommer fran kaskaden och inte fran nagon som vill bli av med
-- filen.
-- -----------------------------------------------------------------------------

create or replace function public.file_object_ar_last()
returns trigger
language plpgsql
as $$
begin
  if old.subject_employee_id is not null
     and not exists (select 1 from public.employee where id = old.subject_employee_id) then
    return old;
  end if;

  if old.document_id is not null
     and not exists (select 1 from public.document where id = old.document_id) then
    return old;
  end if;

  if old.sales_order_id is not null
     and not exists (select 1 from public.sales_order where id = old.sales_order_id) then
    return old;
  end if;

  raise exception 'En fil tas inte bort ur registret. Satt removed_at i stallet.';
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. RLS: bilagan arver orderns egen behorighet
--
-- Grenen ar en `exists` mot `sales_order` och INGET eget rollvillkor — precis
-- som `document_attachment` gor mot `document`. Ordern har redan en policy som
-- sager vem som far se den (saljaren sin egen, provisionskretsen allas), och
-- ett andra svar pa samma fraga hinner glida isar fran det forsta.
-- -----------------------------------------------------------------------------

drop policy if exists file_object_read on file_object;
create policy file_object_read on file_object for select
  to authenticated
  using (
    (purpose = 'sick_certificate' and exists (
      select 1 from public.sick_report r where r.id = file_object.sick_report_id))
    or
    (purpose = 'document_attachment' and exists (
      select 1 from public.document d where d.id = file_object.document_id))
    or
    (purpose = 'roleplay' and (
      subject_employee_id = public.current_employee_id()
      or public.leads_employee(subject_employee_id)
      or public.has_any_role(array['sales_manager','ceo'])
    ))
    or
    (purpose = 'sales_order' and exists (
      select 1 from public.sales_order o where o.id = file_object.sales_order_id))
  );

-- -----------------------------------------------------------------------------
-- 4. Sjalvkontroll — samma sort som 0032, 0034, 0035, 0036 och 0037 avslutades med
-- -----------------------------------------------------------------------------

-- Bilagan far ALDRIG bara ett subjekt. Faller den har raden har nagon gjort
-- kundens avtal till en uppgift om en anstalld, och da foljer den med ut i
-- hens registerutdrag.
do $$
begin
  if exists (
    select 1 from public.file_object
    where purpose = 'sales_order' and subject_employee_id is not null
  ) then
    raise exception 'En orderbilaga har fatt ett subject_employee_id';
  end if;
end;
$$;

-- Skrivning ska ga via service role, som pa resten av navet.
do $$
declare
  skrivpolicyer int;
begin
  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public' and tablename = 'file_object' and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'file_object har % skrivpolicy(er) — skrivning ska ga via service role', skrivpolicyer;
  end if;
end;
$$;

-- Villkoren ska faktiskt vara omskrivna och inte bara pastadda. Kor
-- migrationen mot en databas dar nagot av dem redan tappats bort faller den
-- har i stallet for att lamna tabellen halvt oskyddad.
do $$
declare
  saknas text;
begin
  select string_agg(v.namn, ', ')
    into saknas
  from (values
    ('file_object_purpose_check'),
    ('file_object_koppling'),
    ('file_object_typ')
  ) as v(namn)
  where not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'file_object' and c.conname = v.namn
  );

  if saknas is not null then
    raise exception 'file_object saknar villkor: %', saknas;
  end if;
end;
$$;

-- O14 star i schemat och inte bara i specifikationen: en orderbilaga som inte
-- ar en PDF gar inte att lasa text ur, och forifyllningen hade tyst uteblivit.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'file_object_typ'
      and pg_get_constraintdef(oid) like '%sales_order%application/pdf%'
  ) then
    raise exception 'PDF-kravet (O14) saknas for purpose = sales_order';
  end if;
end;
$$;
