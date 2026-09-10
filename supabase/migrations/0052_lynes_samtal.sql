-- =============================================================================
-- 0052_lynes_samtal.sql — vaxeln borjar leverera samtal till navet
--
-- Lynes skickar en webhook per samtal: riktning, langd, utfall och — nar
-- inspelning ar pa — en adress till ljudet. Den har migrationen bygger
-- mottagningen. Kopplingen till order, till K&V och till coachningsvyn kommer i
-- egna steg, nar vi sett vad vaxeln faktiskt skickar.
--
-- =============================================================================
-- VARFOR RAPASEN SPARAS OFORANDRAD, OCH INTE BARA DE FALT VI FORSTAR
--
-- Lynes payloadformat ar inte publikt dokumenterat. Det star i deras app under
-- Profil -> API-dokumentation, och den anpassade webhooken maste dessutom
-- slas pa av Lynes support. Vi vet fran deras slappnoter att `callType` och
-- `itemType` finns, och att `itemType` skiljer besvarat, missat, studsat,
-- rostbrevlada och kopplat. Resten ar kvalificerade gissningar tills forsta
-- riktiga anropet kommit in.
--
-- En tolk som gissar fel pa ett faltnamn ar inte problemet. Problemet ar en
-- tolk som gissar fel OCH slanger det den inte forstod: da ar uppgiften borta,
-- och felet upptacks forst nar nagon undrar varfor halva september saknar
-- samtalslangd. Darfor tva tabeller och inte en:
--
--   `call_ingest`  ar radlogg. Varje leverans skrivs hel, med headers, och
--                  andras aldrig. Den ar sanningen.
--   `phone_call`   ar tolkningen av den. Blir tolkningen fel gar den att gora
--                  OM ur `call_ingest`, utan att nagot behover ha sparats en
--                  andra gang.
--
-- Det ar samma val som `work_time_journal` gjorde mot `time_event`: det rakna-
-- ade far bygga om sig sjalvt sa lange det raknade ligger kvar.
--
-- =============================================================================
-- SOMMEN HETER `source` + `external_ref`, OCH DEN FANNS REDAN
--
-- `kv_call` (0036) bar `source` + `external_ref` med ett partiellt unikt index
-- och en kommentar om att samtalen registreras for hand "tills dialer-API:t
-- finns". Vaxeln blev Lynes i stallet for dialern, men sommen ar densamma, och
-- `kv_call.source` far darfor ett tredje varde har. En K&V-bedomning ska kunna
-- peka pa ett samtal navet redan har, inte pa ett nagon skrivit av for hand.
--
-- =============================================================================
-- INSPELNINGEN: TVA OLIKA SAKER, MEDVETET
--
-- Bestallaren svarade 2026-09-10: samtal som lett till en ORDER ska hamtas hem
-- till var egen bucket, resten ska stanna hos vaxeln och bara ha en adress.
--
-- Det ar inte en teknisk optimering utan en avgransning av vad vi ar
-- personuppgiftsansvariga for. Ett ordersamtal ar bevis pa ett muntligt avtal
-- och maste finnas kvar sa lange avtalet gor det — det kan inte fa forsvinna
-- for att en lank hos tredje part slutar galla. Ett samtal som inte ledde nagon
-- vart har vi ingen anledning att lagra ljudet av.
--
-- Villkoret `phone_call_inspelning` nedan skriver in just den ordningen i
-- schemat: `recording_state = 'hamtad'` KRAVER en order. Det gar alltsa inte
-- att av misstag borja ladda ner allt.
--
-- =============================================================================
-- VARFOR EN INSPELNING FAR ETT SUBJEKT NAR ORDERBILAGAN INTE FICK DET
--
-- 0039 satte `subject_employee_id` till NULL for `sales_order` och skrev ut
-- skalet: kundens avtal ar inte en uppgift om den anstallda, och satt man
-- subjektet foljde kundens PDF med ut i saljarens registerutdrag.
--
-- For en INSPELNING galler motsatsen, och av samma sorts skal. Ljudet ar den
-- anstalldas egen rost. Det ar en uppgift om hen i artikel 15:s mening, precis
-- som ett inlamnat rollspel (0024) — som ocksa har `subject_employee_id NOT
-- NULL`, och som ar den narmaste foregangaren har.
--
-- Att det ocksa bar kundens rost gor det inte till mindre av en uppgift om
-- saljaren. Och utdraget lamnar inte ut ljudet: `registerutdrag-server.ts`
-- redovisar filraden — nar den kom, hur stor den ar, dess checksumma — medan
-- innehallet bara nas i navet, genom `signeraOchLogga()`, som skriver
-- `file_access_log` forst (K36). Subjektet gor alltsa inspelningen SYNLIG i
-- utdraget utan att gora den utlamnad.
--
-- **P0.6 registerforteckningen maste uppdateras**: inspelade kundsamtal ar en
-- ny behandling och en ny kategori av uppgifter. Migrationen kan inte gora det
-- — P0.6 ar ett dokument.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Radloggen
--
-- `fingerprint` ar sha256 av kroppen och ar AVSIKTLIGT INTE unik. En radlogg
-- som avvisar en rad ar ingen radlogg: skickar vaxeln om samma handelse vill vi
-- se att den kom tva ganger, inte att den ena forsvann. Dubbletterna hanteras
-- dar de hor hemma, i tolkningen, av det unika indexet pa `external_ref`.
-- -----------------------------------------------------------------------------

create table if not exists call_ingest (
  id bigserial primary key,

  source      text not null default 'lynes' check (source in ('lynes')),
  received_at timestamptz not null default now(),

  -- Hela kroppen som den kom. Ar den inte JSON lagras den som {"_text": "..."}
  -- — se `taEmotSamtal()`. Aven en oformlig kropp ar ett besked om att nagot
  -- ringde hit.
  payload jsonb not null,

  -- Headers utan `authorization`. Den tas bort i routen: en radlogg ska inte
  -- vara stallet dar var egen hemlighet ligger i klartext.
  headers jsonb not null default '{}'::jsonb,

  fingerprint text not null check (length(fingerprint) = 64),

  -- Nar raden tolkades, och vad som gick fel om ingenting blev tolkat.
  normalized_at   timestamptz,
  normalize_error text
);

create index if not exists call_ingest_mottagen_idx on call_ingest (received_at desc);
create index if not exists call_ingest_avtryck_idx  on call_ingest (fingerprint);

-- Otolkade rader ar arbetslistan for en omkorning. Partiellt index: de ar fa,
-- och de ska ga att hitta utan att lasa hela loggen.
create index if not exists call_ingest_otolkad_idx
  on call_ingest (id) where normalized_at is null;

comment on table call_ingest is
  'Radlogg fran vaxelns webhook. Andras aldrig. `phone_call` ar tolkningen av '
  'den och gar att bygga om harifran nar faltnamnen visar sig vara andra.';

-- -----------------------------------------------------------------------------
-- 2. Samtalet
-- -----------------------------------------------------------------------------

create table if not exists phone_call (
  id uuid primary key default gen_random_uuid(),

  -- Vilken leverans raden kom ur. `set null` och inte `cascade`: rensas
  -- radloggen nagon gang ska samtalet sta kvar.
  ingest_id bigint references call_ingest(id) on delete set null,

  source       text not null default 'lynes' check (source in ('lynes')),
  -- Vaxelns eget id for samtalet. Sommen mot `kv_call`, och det som gor en
  -- omleverans till en uppdatering i stallet for en dubblett.
  external_ref text,

  direction text not null default 'okand'
    check (direction in ('in', 'ut', 'okand')),

  -- Lynes `itemType`, oversatt. `okant` ar inte ett fel utan ett arligt svar:
  -- kom det ett varde vi inte kanner igen star det kvar i `raw_item_type`.
  outcome text not null default 'okant'
    check (outcome in ('besvarat', 'missat', 'studsat', 'rostbrevlada', 'kopplat', 'okant')),

  raw_call_type text,
  raw_item_type text,

  -- Vad vaxeln kallar den som ringde: e-post, anknytning eller ett internt id.
  -- Vilket det blir vet vi forst nar forsta anropet kommit — darfor en text och
  -- inte fem kolumner.
  agent_ref text,

  -- Loses via `phone_identity`. NULL betyder "annu inte kopplad", inte "hor
  -- ingen till" — och just darfor far kolumnen inte vara NOT NULL: ett samtal
  -- vi inte kan placera ska anda sparas.
  employee_id uuid references employee(id) on delete set null,

  counterpart_e164 text,
  counterpart_raw  text,

  started_at timestamptz,
  ended_at   timestamptz,

  -- Hela samtalet respektive den del da nagon faktiskt talade. Vaxlar skiljer
  -- pa dem och skillnaden ar hela poangen for coachningen: femtio uppringningar
  -- med tre sekunders taltid ar inte femtio samtal.
  duration_seconds int check (duration_seconds >= 0),
  talk_seconds     int check (talk_seconds >= 0),

  recording_url text,
  recording_state text not null default 'ingen'
    check (recording_state in ('ingen', 'hos_vaxeln', 'hamtad', 'misslyckad')),
  recording_file_id uuid references file_object(id) on delete set null,
  recording_error text,

  -- Fylls i nar samtalet gar att para ihop med en order. Steg 2.
  sales_order_id uuid references sales_order(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Se rubriken om inspelningen. Hamtat ljud KRAVER en order — annars gar det
  -- att av misstag borja lagra allt, och da ar avgransningen bara en avsikt.
  constraint phone_call_inspelning check (
    (recording_state = 'hamtad') = (recording_file_id is not null)
    and (recording_state <> 'hamtad' or sales_order_id is not null)
  ),

  constraint phone_call_tider check (
    ended_at is null or started_at is null or ended_at >= started_at
  ),

  -- Taltiden ar en del av samtalet och kan inte vara langre an det.
  constraint phone_call_taltid check (
    talk_seconds is null or duration_seconds is null or talk_seconds <= duration_seconds
  )
);

-- Sommen. Partiellt, av samma skal som `kv_call_somm_idx`: ett samtal utan
-- vaxel-id gar inte att para ihop med nagot och ska inte blockera nasta.
create unique index if not exists phone_call_somm_idx
  on phone_call (source, external_ref) where external_ref is not null;

create index if not exists phone_call_person_idx on phone_call (employee_id, started_at desc);
create index if not exists phone_call_order_idx  on phone_call (sales_order_id) where sales_order_id is not null;
create index if not exists phone_call_tid_idx    on phone_call (started_at desc);

-- Arbetslistan for nedladdningen (steg 2) och for kopplingen mot order.
create index if not exists phone_call_okopplad_idx
  on phone_call (started_at desc) where employee_id is null;
create index if not exists phone_call_att_hamta_idx
  on phone_call (id) where recording_state = 'hos_vaxeln';

-- Motpartens nummer ar det enda vi har att para ihop en order med, och sokningen
-- gar pa det normaliserade numret.
create index if not exists phone_call_motpart_idx
  on phone_call (counterpart_e164, started_at desc) where counterpart_e164 is not null;

comment on table phone_call is
  'Ett samtal i vaxeln, tolkat ur `call_ingest`. Sommen ar source + external_ref. '
  'employee_id NULL betyder att `phone_identity` inte kunde placera samtalet an.';

create or replace function public.phone_call_ror_uppdaterad()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists phone_call_uppdaterad on phone_call;
create trigger phone_call_uppdaterad
  before update on phone_call
  for each row execute function public.phone_call_ror_uppdaterad();

-- -----------------------------------------------------------------------------
-- 3. Vem anknytningen tillhor
--
-- `employee` bar ingen telefonuppgift alls, och ska inte borja gora det: en
-- person kan ha flera anknytningar, byta nummer och ha ett internt id i vaxeln
-- som inte ar nagot av dem. En egen tabell later dessutom kopplingen bli fel
-- utan att anstallningsuppgiften blir det.
--
-- `unique (kind, value)` ar riktningen som spelar roll: EN anknytning hor till
-- EN person. Att samma person har fyra rader ar vantat.
-- -----------------------------------------------------------------------------

create table if not exists phone_identity (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null references employee(id) on delete cascade,

  kind text not null check (kind in ('lynes_user', 'anknytning', 'msisdn', 'epost')),
  value text not null check (length(btrim(value)) > 0),

  -- NULL nar navet gissat sig fram sjalvt, satt nar en manniska pekat ut det.
  -- Skillnaden behovs: en gissning far skrivas over, ett beslut inte.
  created_by uuid references employee(id),
  created_at timestamptz not null default now(),

  unique (kind, value)
);

create index if not exists phone_identity_person_idx on phone_identity (employee_id);

comment on table phone_identity is
  'Kopplar vaxelns namn pa en anvandare till en anstalld. created_by NULL = '
  'navet gissade sjalvt (i regel pa e-postadressen), satt = nagon pekade ut det.';

-- -----------------------------------------------------------------------------
-- 4. `kv_call` far en tredje kalla
--
-- Villkoren skrivs OM och laggs inte till bredvid — samma linje som 0024 och
-- 0039 drog. Tva villkor som bada beskriver vilka kallor som ar tillatna hade
-- varit tva stallen att halla lika.
-- -----------------------------------------------------------------------------

alter table kv_call drop constraint if exists kv_call_source_check;
alter table kv_call add constraint kv_call_source_check
  check (source in ('manual', 'dialer', 'lynes'));

alter table kv_call drop constraint if exists kv_call_kalla;
alter table kv_call add constraint kv_call_kalla check (
  (source = 'manual' and external_ref is null)
  or (source = 'dialer' and external_ref is not null)
  -- `external_ref` ar `phone_call.external_ref`, alltsa vaxelns id — inte
  -- `phone_call.id`. Da gar bedomningen att knyta till samtalet aven om
  -- tolkningen byggts om.
  or (source = 'lynes' and external_ref is not null)
);

-- -----------------------------------------------------------------------------
-- 5. Filen far ett sjatte andamal
--
-- Villkoren nedan ar den LEVANDE definitionen plus `call_recording`. `coaching`
-- star med for att den finns i databasen (0043) — skrivs villkoret av ur 0039
-- i stallet forsvinner coachningens filer tyst.
-- -----------------------------------------------------------------------------

alter table file_object drop constraint if exists file_object_purpose_check;
alter table file_object add constraint file_object_purpose_check
  check (purpose in ('sick_certificate', 'document_attachment', 'roleplay',
                     'sales_order', 'coaching', 'call_recording'));

alter table file_object drop constraint if exists file_object_koppling;
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
  (purpose = 'sales_order'
    and sales_order_id is not null
    and sick_report_id is null
    and document_id is null
    and subject_employee_id is null)
  or
  (purpose = 'coaching'
    and sick_report_id is null
    and document_id is null
    and sales_order_id is null
    and subject_employee_id is not null)
  or
  -- Se rubriken hogst upp. BADA ar satta, och det ar skillnaden mot
  -- `sales_order`: inspelningen hor till affaren OCH ar den anstalldas egen
  -- rost. Ordern kravs eftersom bara ordersamtal hamtas hem.
  (purpose = 'call_recording'
    and sales_order_id is not null
    and subject_employee_id is not null
    and sick_report_id is null
    and document_id is null)
);

alter table file_object drop constraint if exists file_object_typ;
alter table file_object add constraint file_object_typ check (
  (purpose = 'sick_certificate'
    and mime_type in ('application/pdf', 'image/jpeg', 'image/png'))
  or
  (purpose = 'document_attachment'
    and mime_type in ('application/pdf', 'image/jpeg', 'image/png'))
  or
  (purpose = 'roleplay'
    and mime_type in ('audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm'))
  or
  (purpose = 'sales_order' and mime_type = 'application/pdf')
  or
  (purpose = 'coaching'
    and mime_type in ('application/pdf', 'image/jpeg', 'image/png',
                      'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm'))
  or
  (purpose = 'call_recording'
    and mime_type in ('audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm'))
);

-- -----------------------------------------------------------------------------
-- 5b. En inspelning har ingen uppladdare
--
-- `uploaded_by` har varit NOT NULL sedan 0022, och for allt som en manniska
-- laddat upp ar det ratt. En inspelning hamtas av ett jobb. Att da skriva
-- saljarens id i kolumnen hade varit en osanning i loggen — och `uploaded_by`
-- ar precis den kolumn man senare lutar sig mot nar man vill veta vem som
-- lade dit en fil.
--
-- Villkoret ar tvasidigt sa att NULL inte kan smyga sig in nagon annanstans:
-- exakt `call_recording` saknar uppladdare, allt annat maste ha en.
-- -----------------------------------------------------------------------------

alter table file_object alter column uploaded_by drop not null;

alter table file_object drop constraint if exists file_object_uppladdare;
alter table file_object add constraint file_object_uppladdare check (
  (purpose = 'call_recording') = (uploaded_by is null)
);

-- -----------------------------------------------------------------------------
-- 6. RLS
--
-- `call_ingest` far NOLL policyer. Rapasen bar kundens telefonnummer i ett
-- oformat vi inte gatt igenom, och den finns for att kunna tolkas om — inte for
-- att lasas i navet. Servern kommer at den med service role, som pa resten.
--
-- `phone_call` och `phone_identity` foljer samma trappa som rollspelen:
-- sin egen, sitt lag, och hela huset for saljchef och VD.
-- -----------------------------------------------------------------------------

alter table call_ingest    enable row level security;
alter table phone_call     enable row level security;
alter table phone_identity enable row level security;

drop policy if exists phone_call_read on phone_call;
create policy phone_call_read on phone_call for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.leads_employee(employee_id)
    or public.has_any_role(array['sales_manager', 'ceo'])
  );

-- OBS att ett OKOPPLAT samtal (employee_id is null) bara syns for saljchef och
-- VD: `leads_employee(null)` och `null = current_employee_id()` ar bada NULL,
-- och NULL slapper inte igenom en policy. Det ar avsiktligt — ett samtal vi
-- inte kunnat placera ska inte visas for nagon som kanske inte ringde det.

drop policy if exists phone_identity_read on phone_identity;
create policy phone_identity_read on phone_identity for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.leads_employee(employee_id)
    or public.has_any_role(array['sales_manager', 'ceo'])
  );

-- Filen: en gren till, byggd pa den levande policyn.
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
    -- Inspelningen arver ORDERNS behorighet och inte subjektets. Skalet ar
    -- samma som 0039 gav for bilagan: ordern har redan en policy for vem som
    -- far se affaren, och ett andra svar pa samma fraga hinner glida isar fran
    -- det forsta. Att saljaren ser sin egen foljer redan av orderns policy.
    (purpose = 'call_recording' and exists (
      select 1 from public.sales_order o where o.id = file_object.sales_order_id))
  );

-- -----------------------------------------------------------------------------
-- 7. Sjalvkontroll
-- -----------------------------------------------------------------------------

-- Skrivning gar via service role, som pa resten av navet.
do $$
declare
  skrivpolicyer int;
begin
  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public'
    and tablename in ('call_ingest', 'phone_call', 'phone_identity')
    and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'Samtalstabellerna har % skrivpolicy(er) — skrivning ska ga via service role', skrivpolicyer;
  end if;
end;
$$;

-- Rapasen ska inte ga att lasa med en anvandartoken. Faller den har raden har
-- nagon lagt en lasepolicy pa `call_ingest`, och da lacker de otolkade
-- kundnumren ut i vyerna.
do $$
declare
  n int;
begin
  select count(*) into n
  from pg_policies where schemaname = 'public' and tablename = 'call_ingest';

  if n > 0 then
    raise exception 'call_ingest har % policy(er) — rapasen lases bara med service role', n;
  end if;
end;
$$;

-- RLS ska faktiskt vara pa. En tabell med policyer men utan RLS ar oppen, och
-- det ser likadant ut i `pg_policies` som en skyddad.
do $$
declare
  oskyddad text;
begin
  select string_agg(c.relname, ', ')
    into oskyddad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('call_ingest', 'phone_call', 'phone_identity')
    and not c.relrowsecurity;

  if oskyddad is not null then
    raise exception 'RLS ar av pa: %', oskyddad;
  end if;
end;
$$;

-- Avgransningen av vad vi lagrar ljud av ska sta i schemat och inte bara i
-- specifikationen. Faller den har raden gar det att borja hamta hem samtal som
-- inte lett till en order.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'phone_call_inspelning'
  ) then
    raise exception 'phone_call saknar villkoret som knyter hamtat ljud till en order';
  end if;
end;
$$;

-- Villkoren pa `file_object` ska vara omskrivna och inte bara pastadda, och
-- `coaching` ska ha overlevt omskrivningen. Kors migrationen mot en databas dar
-- nagot tappats bort faller den har i stallet for att lamna tabellen halvt
-- oskyddad.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'file_object_koppling'
      and pg_get_constraintdef(oid) like '%coaching%'
  ) then
    raise exception 'file_object_koppling tappade bort coaching';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'file_object_koppling'
      and pg_get_constraintdef(oid) like '%call_recording%'
  ) then
    raise exception 'file_object_koppling saknar call_recording';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'file_object_typ'
      and pg_get_constraintdef(oid) like '%call_recording%audio%'
  ) then
    raise exception 'file_object_typ slapper inte in ljud for call_recording';
  end if;
end;
$$;

-- 0022:s bucket slapper redan in ljud (den listade dem for rollspelens skull).
-- Star det inte kvar faller nedladdningen i steg 2 med ett fel fran Storage som
-- inte namner mime-typen, och det ar en timmes felsokning.
do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'filer' and 'audio/mpeg' = any (allowed_mime_types)
  ) then
    raise exception 'Bucketen `filer` slapper inte in audio/mpeg';
  end if;
end;
$$;
