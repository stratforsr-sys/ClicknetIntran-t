-- =============================================================================
-- 0056_samtal_pa_order.sql — samtalen hittar sin affar, och ljudet hamtas hem
--
-- Tre saker:
--   1. Ordern far ett NORMALISERAT telefonnummer att paras ihop pa.
--   2. Samtalet far veta HUR det kopplades — av navet eller av en manniska.
--   3. Inspelningen far hamtas hem for alla samtal, med en gallringsfrist for
--      dem som inte blev affar.
--
-- =============================================================================
-- 1. VARFOR NUMRET BLIR EN GENERERAD KOLUMN OCH INTE ETT FALT KODEN FYLLER I
--
-- `sales_order.contact_phone` ar fritext. "070-123 45 67", "+46701234567",
-- "0701234567 (Anna)" — alla tre ar samma kund, och ingen av dem gar att
-- jamfora med `phone_call.counterpart_e164` utan att tvattas forst.
--
-- Den enkla vagen ar en kolumn som koden fyller i nar ordern sparas. Den ar
-- ocksa den som gar sonder tyst: den dag nagon lagger en order via en vag som
-- inte kommer ihag att fylla i kolumnen far den ordern inga samtal, och
-- ingenting ser fel ut. Bara ett tomt avsnitt pa ordersidan, som ser precis ut
-- som en order ingen ringt om.
--
-- En GENERERAD kolumn kan inte bli inaktuell. Den raknas om av databasen vid
-- varje insert och update, oavsett vem som skrev raden eller varifran.
--
-- Priset ar att normaliseringen finns pa tva stallen — har och i
-- `normaliseraNummer()` i src/lib/samtal.ts. Det priset betalas med ett prov:
-- `tests/samtal-order.mjs` kor bada over samma lista och faller om de svarar
-- olika. Tva implementationer som INTE gar att jamfora vore oforsvarligt; tva
-- som provas mot varandra vid varje korning ar det inte.
--
-- =============================================================================
-- 2. VARFOR KOPPLINGEN BAR SITT URSPRUNG
--
-- Samma skal som `phone_identity.created_by` (0052). Navet parar ihop samtal
-- och order pa nummer och tid, och det ar en gissning — en bra gissning, men
-- en gissning. Pekar en manniska om ett samtal till ratt affar ska nasta
-- svepning INTE skriva over det.
--
-- `order_linked_by IS NULL` = navet kopplade sjalvt, far skrivas om.
-- `order_linked_by` satt   = nagon bestamde, rors aldrig av svepningen.
--
-- =============================================================================
-- 3. VARFOR ALLT LJUD HAMTAS HEM, OCH INTE BARA ORDERSAMTALENS
--
-- 0052 skrev in bestallarens avgransning i schemat: `recording_state = 'hamtad'`
-- KRAVDE en order. Den avgransningen gar inte att genomfora, och det upptacktes
-- forst nar vaxeln borjade leverera pa riktigt:
--
--   Lynes lamnar en forhandssignerad S3-adress med `X-Amz-Expires=1800`.
--   Den lever en halvtimme. Ordern laggs in EFTER samtalet, ofta timmar efter.
--   Nar vi vet att ett samtal blev en affar ar lanken sedan lange dod.
--
-- Bestallaren valde 2026-09-11: hamta hem allt direkt, gallra sedan. Villkoret
-- byts darfor mot ett annat som bar samma avsikt pa ett satt som gar att halla:
--
--   `recording_retained_until` SATT   -> tillfallig, gallras den dagen
--   `recording_retained_until` NULL   -> permanent, hor till en affar
--
-- Och ett samtal som fatt en order ska inte kunna behalla sin gallringsfrist.
-- Villkoret `phone_call_gallring` nedan ser till det: har raden en order maste
-- fristen vara null. Gallringen kan alltsa inte rada ett bevis.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Numret
-- -----------------------------------------------------------------------------

create or replace function public.normalisera_nummer(raa text)
returns text
language plpgsql
immutable
as $$
declare
  rensat  text;
  siffror text;
begin
  if raa is null then return null; end if;

  -- Samma tecken som `normaliseraNummer()` skalar bort: blanksteg, bindestreck,
  -- parenteser och punkt.
  rensat := regexp_replace(btrim(raa), '[[:space:]\-\(\)\.]', '', 'g');

  if rensat !~ '^\+?[0-9]+$' then return null; end if;

  if left(rensat, 1) = '+' then
    siffror := substr(rensat, 2);
  elsif left(rensat, 2) = '00' then
    siffror := substr(rensat, 3);
  elsif left(rensat, 1) = '0' then
    siffror := '46' || substr(rensat, 2);
  elsif length(rensat) <= 6 then
    -- En anknytning ar inte ett telefonnummer. `1042` som `+461042` hade
    -- kunnat para ihop en order med fel kund.
    return null;
  else
    siffror := rensat;
  end if;

  if length(siffror) < 8 or length(siffror) > 15 then return null; end if;

  return '+' || siffror;
end;
$$;

comment on function public.normalisera_nummer(text) is
  'Speglar normaliseraNummer() i src/lib/samtal.ts. tests/samtal-order.mjs kor '
  'bada over samma lista och faller om de svarar olika.';

alter table sales_order
  add column if not exists contact_phone_e164 text
    generated always as (public.normalisera_nummer(contact_phone)) stored;

create index if not exists sales_order_telefon_idx
  on sales_order (contact_phone_e164) where contact_phone_e164 is not null;

comment on column sales_order.contact_phone_e164 is
  'Genererad. Sommen mot phone_call.counterpart_e164. Kan inte bli inaktuell — '
  'se rubriken i 0056 om varfor det inte ar ett falt koden fyller i.';

-- -----------------------------------------------------------------------------
-- 2. Kopplingens ursprung
-- -----------------------------------------------------------------------------

alter table phone_call
  add column if not exists order_linked_at timestamptz,
  add column if not exists order_linked_by uuid references employee(id);

-- Ursprunget hor ihop med kopplingen. En rad som pekar ut vem som kopplade men
-- inte till vad ar en uppgift om en manniska utan andamal.
alter table phone_call drop constraint if exists phone_call_koppling;
alter table phone_call add constraint phone_call_koppling check (
  (order_linked_at is null) = (sales_order_id is null)
  and (order_linked_by is null or sales_order_id is not null)
);

create index if not exists phone_call_manuell_koppling_idx
  on phone_call (sales_order_id) where order_linked_by is not null;

-- -----------------------------------------------------------------------------
-- 3. Inspelningen
-- -----------------------------------------------------------------------------

alter table phone_call
  add column if not exists recording_retained_until timestamptz;

alter table phone_call drop constraint if exists phone_call_recording_state_check;
alter table phone_call add constraint phone_call_recording_state_check
  check (recording_state in ('ingen', 'hos_vaxeln', 'hamtad', 'misslyckad', 'gallrad'));

-- Det gamla villkoret krävde en order for hamtat ljud. Se rubriken hogst upp.
alter table phone_call drop constraint if exists phone_call_inspelning;
alter table phone_call add constraint phone_call_inspelning check (
  (recording_state = 'hamtad') = (recording_file_id is not null)
);

-- Ett samtal som hor till en affar har ingen gallringsfrist. Villkoret ar
-- avgransningen: gallringen kan inte rada ett bevis pa ett muntligt avtal,
-- eftersom den bara ser rader med en frist satt.
alter table phone_call drop constraint if exists phone_call_gallring;
alter table phone_call add constraint phone_call_gallring check (
  sales_order_id is null or recording_retained_until is null
);

-- Arbetslistan for gallringen. Partiellt: de rader som INTE ska gallras ar de
-- manga, och de ska inte behova lasas.
create index if not exists phone_call_att_gallra_idx
  on phone_call (recording_retained_until)
  where recording_retained_until is not null and recording_state = 'hamtad';

-- -----------------------------------------------------------------------------
-- 4. Filen far finnas utan order
--
-- 0052 krävde `sales_order_id is not null` for `call_recording`, av samma skal
-- som villkoret ovan. Nu hamtas ljudet innan vi vet om det blir en affar, sa
-- kopplingen kommer efterat — eller inte alls, och da gallras filen.
--
-- `subject_employee_id` ar fortfarande OBLIGATORISKT. Inspelningen ar den
-- anstalldas egen rost oavsett om den ledde till en order, och resonemanget i
-- 0052 om varfor den har ett subjekt nar orderbilagan inte har det galler
-- oforandrat.
-- -----------------------------------------------------------------------------

alter table file_object drop constraint if exists file_object_koppling;
alter table file_object add constraint file_object_koppling check (
  (purpose = 'sick_certificate'
    and sick_report_id is not null and document_id is null
    and sales_order_id is null and subject_employee_id is not null)
  or
  (purpose = 'document_attachment'
    and document_id is not null and sick_report_id is null
    and sales_order_id is null and subject_employee_id is null)
  or
  (purpose = 'roleplay'
    and sick_report_id is null and document_id is null
    and sales_order_id is null and subject_employee_id is not null)
  or
  (purpose = 'sales_order'
    and sales_order_id is not null and sick_report_id is null
    and document_id is null and subject_employee_id is null)
  or
  (purpose = 'coaching'
    and sick_report_id is null and document_id is null
    and sales_order_id is null and subject_employee_id is not null)
  or
  -- Ordern ar nu VALFRI. Subjektet ar det inte.
  (purpose = 'call_recording'
    and subject_employee_id is not null
    and sick_report_id is null and document_id is null)
);

-- -----------------------------------------------------------------------------
-- 4b. En gallrad inspelning har ingen som tog bort den
--
-- `file_object_borttagen` har sedan 0022 krävt att `removed_by` och
-- `removed_at` följs åt, och for allt en manniska tar bort ar det ratt: en fil
-- som forsvann ska peka ut vem som lat den forsvinna.
--
-- Gallringen ar ingen manniska. Den kor i nattjobbet, pa en frist som satts
-- automatiskt, och att skriva nagons id dar hade varit samma osanning som
-- `uploaded_by` skulle ha varit (0052). Undantaget ar darfor smalt: BARA
-- `call_recording` far avpubliceras utan aktor.
-- -----------------------------------------------------------------------------

alter table file_object drop constraint if exists file_object_borttagen;
alter table file_object add constraint file_object_borttagen check (
  (removed_at is null and removed_by is null)
  or (removed_at is not null and removed_by is not null)
  or (removed_at is not null and removed_by is null and purpose = 'call_recording')
);

-- RLS: en inspelning utan order arver inte langre nagon orders behorighet, sa
-- den grenen behover ett eget svar. Samma trappa som rollspelen: sin egen, sitt
-- lag, och hela huset for saljchef och VD.
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
      -- Den vars rost det ar, hens chef, och ledningen. PLUS den som far se
      -- affaren, nar inspelningen hor till en: ett ordersamtal ar bevis pa
      -- avtalet och hor hemma hos den som hanterar affaren.
      subject_employee_id = public.current_employee_id()
      or public.leads_employee(subject_employee_id)
      or public.has_any_role(array['sales_manager','ceo'])
      or (sales_order_id is not null and exists (
        select 1 from public.sales_order o where o.id = file_object.sales_order_id))
    ))
  );

-- -----------------------------------------------------------------------------
-- 4c. Samtalet syns for den som far se affaren
--
-- `phone_call_read` (0052) foljde rollspelens trappa: sin egen, sitt lag,
-- ledningen. Nu hanger samtal pa order, och da racker inte den trappan:
-- EKONOMI far se varje order men ar ingens chef, och hade darfor sett en affar
-- med ett tomt samtalsavsnitt — vilket ser likadant ut som en kund ingen
-- ringt.
--
-- Grenen ar en `exists` mot `sales_order` utan eget rollvillkor, precis som
-- filen gor. Ordern har redan en policy for vem som far se affaren, och ett
-- andra svar pa samma fraga hinner glida isar fran det forsta.
--
-- OBS att den bara galler KOPPLADE samtal. Ett samtal utan order syns
-- fortfarande bara for den som ringde, hens chef och ledningen.
-- -----------------------------------------------------------------------------

drop policy if exists phone_call_read on phone_call;
create policy phone_call_read on phone_call for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.leads_employee(employee_id)
    or public.has_any_role(array['sales_manager', 'ceo'])
    or (sales_order_id is not null and exists (
      select 1 from public.sales_order o where o.id = phone_call.sales_order_id))
  );

-- -----------------------------------------------------------------------------
-- 5. Bucketens tak
--
-- 0022 satte 10 MB. Det langsta samtalet hittills ar 2662 sekunder, och Lynes
-- levererar mp3 i 64 kbit/s — alltsa omkring 21 MB. Taket hade avvisat filen
-- med ett fel fran Storage som inte namner storleken, och just de langa
-- samtalen — de som faktiskt ledde till affar — hade varit de som forsvann.
--
-- 50 MB racker for ett samtal pa en timme och en kvart. `MAX_BYTE` i
-- src/lib/filer.ts sallar exakt per andamal; bucketen sallar grovt.
-- -----------------------------------------------------------------------------

update storage.buckets
   set file_size_limit = 52428800
 where id = 'filer' and coalesce(file_size_limit, 0) < 52428800;

-- -----------------------------------------------------------------------------
-- 6. Sjalvkontroll
-- -----------------------------------------------------------------------------

-- Normaliseringen ska ge samma svar som `normaliseraNummer()`. Provet i
-- tests/samtal-order.mjs kor hela listan; de har ar de fall som skiljer en
-- fungerande implementation fran en som ser ut att fungera.
do $$
declare
  prov text[][] := array[
    array['070-123 45 67', '+46701234567'],
    array['+46701234567',  '+46701234567'],
    array['0046701234567', '+46701234567'],
    array['(08) 123 456 78', '+46812345678'],
    array['46701234567',   '+46701234567'],
    array['1042',          null],
    array['anonymous',     null],
    array['',              null],
    array['+4670123456789012', null]
  ];
  rad text[];
  fick text;
begin
  foreach rad slice 1 in array prov loop
    fick := public.normalisera_nummer(rad[1]);
    if fick is distinct from rad[2] then
      raise exception 'normalisera_nummer(%) gav % — vantade %', rad[1], coalesce(fick, 'NULL'), coalesce(rad[2], 'NULL');
    end if;
  end loop;
end;
$$;

-- Den genererade kolumnen ska vara just genererad. Ar den en vanlig kolumn gar
-- den att fylla i for hand, och da kan den bli inaktuell — vilket ar precis det
-- konstruktionen finns for att omojliggora.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'sales_order' and column_name = 'contact_phone_e164'
      and is_generated = 'ALWAYS'
  ) then
    raise exception 'sales_order.contact_phone_e164 ar inte en genererad kolumn';
  end if;
end;
$$;

-- Gallringen far inte kunna rada ett ordersamtal.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'phone_call_gallring') then
    raise exception 'phone_call_gallring saknas — gallringen kan rada ett bevis';
  end if;

  if exists (
    select 1 from public.phone_call
    where sales_order_id is not null and recording_retained_until is not null
  ) then
    raise exception 'Ett ordersamtal har en gallringsfrist';
  end if;
end;
$$;

-- Bucketen maste rymma ett langt samtal.
do $$
declare
  tak bigint;
begin
  select file_size_limit into tak from storage.buckets where id = 'filer';
  if coalesce(tak, 0) < 52428800 then
    raise exception 'Bucketen `filer` tar hogst % byte — ett langt samtal far inte plats', tak;
  end if;
end;
$$;

-- Villkoren pa file_object ska vara omskrivna med alla sex andamalen kvar.
do $$
declare
  saknas text;
begin
  select string_agg(v.namn, ', ') into saknas
  from (values ('sick_certificate'),('document_attachment'),('roleplay'),
               ('sales_order'),('coaching'),('call_recording')) as v(namn)
  where position(v.namn in (
    select pg_get_constraintdef(oid) from pg_constraint where conname = 'file_object_koppling'
  )) = 0;

  if saknas is not null then
    raise exception 'file_object_koppling tappade bort: %', saknas;
  end if;
end;
$$;
