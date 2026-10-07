-- =============================================================================
-- 0073_bifogat_anstallningsavtal.sql — ett påskrivet avtal laddas upp som fil
--
-- -----------------------------------------------------------------------------
-- VARFÖR ETT UPPLADDAT AVTAL ÄR EN RAD I `contract` OCH INTE EN LÖS FIL
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-07: "gör så att man kan bifoga in anställningsavtalet för
-- varje person. Så att de själva kan gå in på Avtal och se sitt
-- anställningsavtal och kunna ladda ner det."
--
-- Allt det där finns redan för avtal skrivna ur en mall (0028): listan på
-- /avtal, regeln att den anställda ser sitt eget först när det är utfärdat,
-- tillbakadragandet, notisen "Du har fått ett avtal" och raden i
-- registerutdraget. Ett uppladdat avtal är samma sak med en annan kropp — en
-- fil i stället för en fryst text — så det får bli en rad i samma tabell.
-- En egen tabell hade varit en andra lista, en andra RLS-policy och en andra
-- notis, och de två hade glidit isär.
--
-- `contract.source` säger vilket det är. Ett mallavtal har text och mall, ett
-- uppladdat har ingetdera — check-villkoret nedan tvingar det, så att en sida
-- aldrig behöver gissa vilket fält som bär innehållet.
--
-- -----------------------------------------------------------------------------
-- FILEN ÄRVER AVTALETS BEHÖRIGHET — INGET EGET ROLLVILLKOR
-- -----------------------------------------------------------------------------
--
-- Grenen i `file_object_read` är en `exists` mot `contract`, precis som
-- `sales_order` gör mot ordern och `document_attachment` mot dokumentet.
-- `contract_read` svarar redan: den som får hantera avtal ser alla, den
-- anställda sitt eget så länge det är utfärdat. Dras avtalet tillbaka
-- försvinner filen ur hennes vy i samma ögonblick som raden gör.
--
-- -----------------------------------------------------------------------------
-- K27: FILEN KAN BÄRA ETT PERSONNUMMER
-- -----------------------------------------------------------------------------
--
-- Navet lagrar inga personnummer i sina tabeller, och `contract_utan_personnummer`
-- står kvar orört. Men ett inskannat, påskrivet avtal har nästan alltid numret
-- ifyllt för hand — det var hela poängen med raden i det utskrivna avtalet.
-- Samma läge som orderbilagan i 0039: filen ligger i den stängda lagringen,
-- nås bara genom `/filer/[id]` och varje öppning skrivs i `file_access_log`.
-- Det är rätt skyddsnivå för en sådan fil, men P0.6 registerförteckningen bör
-- nämna att anställningsavtal nu lagras som fil.
--
-- `subject_employee_id` SÄTTS: avtalet handlar om den anställda och ska följa
-- med i hennes registerutdrag (K25), till skillnad från orderbilagan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Avtalet får en källa
-- -----------------------------------------------------------------------------

alter table contract
  add column if not exists source text not null default 'template';

alter table contract drop constraint if exists contract_source_check;
alter table contract add constraint contract_source_check
  check (source in ('template', 'upload'));

alter table contract alter column template_slug drop not null;
alter table contract alter column body_md drop not null;

-- Ett mallavtal har text och mall. Ett uppladdat har ingetdera — innehållet är
-- filen. Utan villkoret hade en rad kunnat ha båda, och då vet ingen sida vilket
-- som gäller.
alter table contract drop constraint if exists contract_kropp;
alter table contract add constraint contract_kropp check (
  (source = 'template' and body_md is not null and template_slug is not null)
  or
  (source = 'upload' and body_md is null and template_slug is null and template_id is null)
);

comment on column contract.source is
  '0073: template = renderat ur en mall (body_md bär texten); upload = påskrivet '
  'avtal uppladdat som fil (file_object.contract_id, purpose employment_contract).';

-- -----------------------------------------------------------------------------
-- 2. Filen får ett sjunde ändamål
-- -----------------------------------------------------------------------------

alter table file_object
  add column if not exists contract_id uuid references contract(id) on delete cascade;

-- Ett avtal, en fil. Ska filen bytas dras avtalet tillbaka och ett nytt laddas
-- upp — samma regel som för mallavtalet, vars text inte heller skrivs om.
create unique index if not exists file_object_avtal_idx
  on file_object (contract_id) where contract_id is not null and removed_at is null;

alter table file_object drop constraint if exists file_object_purpose_check;
alter table file_object add constraint file_object_purpose_check
  check (purpose in ('sick_certificate','document_attachment','roleplay','sales_order',
                     'coaching','call_recording','employment_contract'));

-- Skrivs OM och inte bredvid, av samma skäl som 0039: två villkor som båda
-- beskriver vilka kopplingar som är tillåtna är två ställen att hålla lika.
-- De sex befintliga grenarna är oförändrade utöver `contract_id is null`.
alter table file_object drop constraint if exists file_object_koppling;
alter table file_object add constraint file_object_koppling check (
  (purpose = 'sick_certificate'
    and sick_report_id is not null
    and document_id is null
    and sales_order_id is null
    and contract_id is null
    and subject_employee_id is not null)
  or
  (purpose = 'document_attachment'
    and document_id is not null
    and sick_report_id is null
    and sales_order_id is null
    and contract_id is null
    and subject_employee_id is null)
  or
  (purpose = 'roleplay'
    and sick_report_id is null
    and document_id is null
    and sales_order_id is null
    and contract_id is null
    and subject_employee_id is not null)
  or
  (purpose = 'sales_order'
    and sales_order_id is not null
    and sick_report_id is null
    and document_id is null
    and contract_id is null
    and subject_employee_id is null)
  or
  (purpose = 'coaching'
    and sick_report_id is null
    and document_id is null
    and sales_order_id is null
    and contract_id is null
    and subject_employee_id is not null)
  or
  (purpose = 'call_recording'
    and subject_employee_id is not null
    and sick_report_id is null
    and document_id is null
    and contract_id is null)
  or
  -- 0073. Avtalet handlar om en människa, så subjektet MÅSTE vara satt — och
  -- triggern nedan ser till att det är rätt människa.
  (purpose = 'employment_contract'
    and contract_id is not null
    and subject_employee_id is not null
    and sick_report_id is null
    and document_id is null
    and sales_order_id is null)
);

alter table file_object drop constraint if exists file_object_typ;
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
  (purpose = 'sales_order' and mime_type = 'application/pdf')
  or
  (purpose = 'coaching'
    and mime_type in ('application/pdf','image/jpeg','image/png',
                      'audio/mpeg','audio/mp4','audio/wav','audio/webm'))
  or
  (purpose = 'call_recording'
    and mime_type in ('audio/mpeg','audio/mp4','audio/wav','audio/webm'))
  or
  -- Ett påskrivet avtal är en skannad PDF eller ett telefonfoto av papperet.
  (purpose = 'employment_contract'
    and mime_type in ('application/pdf','image/jpeg','image/png'))
);

-- -----------------------------------------------------------------------------
-- 3. Subjektet ska vara den avtalet gäller
--
-- `subject_employee_id` är denormaliserad för registerutdragets skull. Pekar
-- den på någon annan än avtalets person hade Annas avtal följt med ut i
-- Bertils utdrag — samma fel som 0022 stängde för läkarintyget.
-- -----------------------------------------------------------------------------

create or replace function public.file_object_subjekt_stammer()
returns trigger
language plpgsql
as $$
declare
  v_person uuid;
begin
  if new.purpose = 'sick_certificate' then
    select employee_id into v_person from public.sick_report where id = new.sick_report_id;
    if v_person is distinct from new.subject_employee_id then
      raise exception 'Filen maste handla om den som sjukanmalan galler.';
    end if;
  end if;

  if new.purpose = 'employment_contract' then
    select employee_id into v_person from public.contract where id = new.contract_id;
    if v_person is distinct from new.subject_employee_id then
      raise exception 'Filen maste handla om den som avtalet galler.';
    end if;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Raderingstriggern får sitt undantag för avtalet
--
-- Samma fälla som 0023, 0033 och 0039: `on delete cascade` kör en DELETE. Ett
-- utkast går att radera, och uppladdningen skriver avtalet som utkast innan
-- filen registreras — faller registreringen städas utkastet bort, och då
-- måste kaskaden gå igenom.
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

  if old.contract_id is not null
     and not exists (select 1 from public.contract where id = old.contract_id) then
    return old;
  end if;

  raise exception 'En fil tas inte bort ur registret. Satt removed_at i stallet.';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. RLS: filen ärver avtalets behörighet
--
-- De sex befintliga grenarna är avskrivna ur pg_policy 2026-10-07, inte ur
-- migrationsfilerna — 0043 och 0052/0056 har lagt till grenar sedan 0039.
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
    or
    (purpose = 'coaching' and (
      subject_employee_id = public.current_employee_id()
      or public.leads_employee(subject_employee_id)
      or public.has_any_role(array['sales_manager','ceo'])
      or exists (
        select 1
        from public.coaching_task_event e
        join public.coaching_task t on t.id = e.task_id
        where e.file_id = file_object.id
          and (t.partner_id = public.current_employee_id()
               or t.created_by = public.current_employee_id()))
    ))
    or
    (purpose = 'call_recording' and (
      subject_employee_id = public.current_employee_id()
      or public.leads_employee(subject_employee_id)
      or public.has_any_role(array['sales_manager','ceo'])
      or (sales_order_id is not null and exists (
        select 1 from public.sales_order o where o.id = file_object.sales_order_id))
    ))
    or
    -- 0073. Ingen egen regel — `contract_read` avgör.
    (purpose = 'employment_contract' and exists (
      select 1 from public.contract c where c.id = file_object.contract_id))
  );

-- -----------------------------------------------------------------------------
-- 6. Självkontroll
-- -----------------------------------------------------------------------------

-- Skrivning ska gå via service role, som på resten av navet.
do $$
declare
  skrivpolicyer int;
begin
  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public' and tablename in ('file_object', 'contract') and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'file_object/contract har % skrivpolicy(er) — skrivning ska ga via service role', skrivpolicyer;
  end if;
end;
$$;

-- Villkoren ska faktiskt finnas efter omskrivningen.
do $$
declare
  saknas text;
begin
  select string_agg(v.tabell || '.' || v.namn, ', ')
    into saknas
  from (values
    ('file_object', 'file_object_purpose_check'),
    ('file_object', 'file_object_koppling'),
    ('file_object', 'file_object_typ'),
    ('contract', 'contract_source_check'),
    ('contract', 'contract_kropp'),
    ('contract', 'contract_utan_personnummer')
  ) as v(tabell, namn)
  where not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = v.tabell and c.conname = v.namn
  );

  if saknas is not null then
    raise exception 'Villkor saknas: %', saknas;
  end if;
end;
$$;
