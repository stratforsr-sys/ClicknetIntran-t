-- =============================================================================
-- 0022_filer.sql — fillagring med signerade URL:er och oppningslogg.
--
-- Laser upp E2.12 bilagor, E7.10 lakarintyg, E8.7 rollspel och X5 pa en gang.
-- Den har migrationen bygger BARA fundamentet plus lakarintyget; bilagorna och
-- rollspelen laggs pa i egna migrationer och behover ingen ny tabell.
--
-- =============================================================================
-- K36 / AC-3.22 / X5: INGEN FIL NAS UTAN ATT OPPNINGEN SKRIVS.
--
-- Kravet ar inte "filen ska vara atkomstbegransad OCH loggad" som tva separata
-- saker. Det ar en sak: den enda vagen till en fil gar genom en handling som
-- forst skriver raden i `file_access_log` och sedan utfardar en signerad URL
-- med kort livslangd. Misslyckas skrivningen utfardas ingen URL.
--
-- Det ar tvartemot den vanliga instinkten att loggning aldrig ska kunna stoppa
-- en funktion. Har ar loggen sjalva kravet, och en fil som gick att oppna utan
-- att det syns ar exakt det K36 forbjuder.
--
-- Sparren sitter i tva lager:
--
--   1. `storage.objects` har RLS pa och NOLL tillatande policyer. Med en
--      anvandares egen token ger bucketen ingenting, oavsett vad man kan om
--      sokvagen. Dessutom ligger en RESTRIKTIV policy dar: en restriktiv
--      policy AND:as med allt annat och gar darfor inte att OR:a bort med en
--      ny tillatande policy nagon lagger till i framtiden.
--
--   2. `file_object` bar behorigheten pa raden, och den arvs fran det objekt
--      filen hor till — se policyerna langst ned.
--
-- Servern kommer forbi bada med service role. Det ar meningen: den vagen gar
-- genom `signeraOchLogga()` i src/lib/filer-server.ts, som skriver raden.
--
-- =============================================================================
-- K35 IGEN: ETT FILNAMN AR ETT FRITEXTFALT.
--
-- `sick_report` har noll textkolumner for att det inte ska finnas nagonstans
-- for en diagnos att hamna (0020). Ett uppladdat lakarintyg som heter
-- "cancerbesked.pdf" hade gjort hela den insatsen meningslos — filnamnet ar
-- text som anvandaren skriver, det hade lagrats bredvid sjukanmalan och det
-- hade dessutom synts i sokvagen.
--
-- Darfor: for `sick_certificate` ar `filename` NULL, tvingat av ett
-- check-villkor. Namnet som visas raknas fram ur datumet ("Lakarintyg
-- 2026-08-21.pdf"), och sokvagen i bucketen ar filens uuid. Ingenting som
-- anvandaren skrivit foljer med.
--
-- =============================================================================
-- VARFOR OPPNINGARNA INTE GAR TILL `audit_log`.
--
-- Den fragan har ett svar som inte ar smaksak: `audit_log_read` slapper in
-- `admin`. En rad "Cecilia oppnade Annas lakarintyg" i den loggen hade beratta
-- for admin att Anna har en sjukanmalan — och admin ar med flit utestangd fran
-- `sick_report` (AC-3.26, 0020). Den allmanna loggen kan alltsa inte bara den
-- har handelsen utan att lacka det 0020 stangde.
--
-- `file_access_log` har darfor sin egen behorighet: den som far se filen far
-- se vem som oppnat den. Att den som ar sjuk sjalv ser vilka som oppnat hennes
-- intyg ar inte en bieffekt utan halva poangen med K36.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Bucketen
--
-- En enda, privat. Uppdelning per andamal sker i `file_object.purpose` och i
-- sokvagen, inte i flera buckets: behorigheten avgors anda aldrig av bucketen
-- utan av raden, och tva stallen att satta samma regel pa ar ett stalle for
-- mycket.
--
-- `allowed_mime_types` ar unionen av vad alla andamal far bara. Vad VART
-- andamal far bara star i check-villkoret pa `file_object` — bucketen kan bara
-- salla grovt, tabellen sallar exakt.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'filer', 'filer', false, 10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    -- E8.7 rollspel. Ligger med nu sa att bucketen inte behover roras senare;
    -- ingen `purpose` slapper igenom dem an.
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/webm'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- 2. Filerna
--
-- `path` ar filens uuid under sitt andamal. Inget av det anvandaren skrivit
-- finns i den — se rubriken om K35. Sokvagen ar inte hemlig och ska inte
-- behova vara det: den ensam ger ingenting, eftersom bucketen ar stangd.
-- -----------------------------------------------------------------------------

create table if not exists file_object (
  id     uuid primary key default gen_random_uuid(),
  bucket text not null default 'filer',
  path   text not null unique,

  purpose text not null check (purpose in ('sick_certificate','document_attachment')),

  -- Vem filen handlar OM. Satts for de andamal dar filen ar en uppgift om en
  -- person; en bilaga till en rutin handlar inte om nagon. Kolumnen ar den som
  -- registerutdraget hamtar pa (K25).
  subject_employee_id uuid references employee(id) on delete cascade,

  -- Kopplingen. Exakt en av dem ar satt, se check-villkoret nedan.
  sick_report_id uuid references sick_report(id) on delete cascade,
  document_id    uuid references document(id)    on delete cascade,

  -- Originalnamnet. NULL for lakarintyg, och det ar ett krav och inte ett
  -- utrymme for framtiden.
  filename text,

  mime_type  text   not null,
  size_bytes bigint not null check (size_bytes > 0),

  -- Sha256 i hex. Gor det mojligt att sa i efterhand att filen ar densamma som
  -- laddades upp — ett intyg som byts ut mot ett annat ska ga att upptacka.
  checksum text not null check (length(checksum) = 64),

  uploaded_by uuid not null references employee(id),
  uploaded_at timestamptz not null default now(),

  -- En fil tas inte bort, den avpubliceras. Se triggern langre ned: raderas
  -- raden foljer oppningsloggen med, och en logg som forsvinner nar nagon
  -- stadar ar ingen logg.
  removed_at timestamptz,
  removed_by uuid references employee(id),

  constraint file_object_borttagen check (
    (removed_by is null) = (removed_at is null)
  ),

  -- Exakt en koppling, och ratt sorts subjekt for varje andamal.
  constraint file_object_koppling check (
    (purpose = 'sick_certificate'
      and sick_report_id is not null
      and document_id is null
      and subject_employee_id is not null)
    or
    (purpose = 'document_attachment'
      and document_id is not null
      and sick_report_id is null
      and subject_employee_id is null)
  ),

  -- K35. Star som ett villkor och inte som en regel i koden, av samma skal som
  -- `absence_type_sjuk_ansoks_inte` i 0019: en regel som bara finns i koden
  -- haller sa lange ingen skriver en andra vag in i tabellen.
  constraint file_object_intyg_utan_filnamn check (
    purpose <> 'sick_certificate' or filename is null
  ),

  -- Vad varje andamal far bara. Bucketens lista ar unionen; den har ar exakt.
  constraint file_object_typ check (
    (purpose = 'sick_certificate'
      and mime_type in ('application/pdf','image/jpeg','image/png'))
    or
    (purpose = 'document_attachment'
      and mime_type in ('application/pdf','image/jpeg','image/png'))
  )
);

create index if not exists file_object_sjuk_idx  on file_object (sick_report_id) where removed_at is null;
create index if not exists file_object_dok_idx   on file_object (document_id)    where removed_at is null;
create index if not exists file_object_person_idx on file_object (subject_employee_id);

comment on table file_object is
  'K36/X5: filer nas bara via signerad kortlivad URL fran signeraOchLogga(), '
  'som skriver file_access_log forst. K35: filename ar NULL for lakarintyg.';

-- `subject_employee_id` ar denormaliserad for registerutdragets skull. Den far
-- inte kunna peka pa nagon annan an den anmalan galler — da hade utdraget
-- lamnat ut ett intyg till fel person.
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
  return new;
end;
$$;

drop trigger if exists file_object_subjekt on file_object;
create trigger file_object_subjekt
  before insert or update on file_object
  for each row execute function public.file_object_subjekt_stammer();

-- En fil raderas inte ur tabellen. `removed_at` racker: filens innehall tas
-- bort ur bucketen av koden, men raden och dess logg star kvar. Annars kunde
-- den som oppnat ett intyg tio ganger stada bort beviset genom att radera
-- filen efterat.
--
-- MED ETT UNDANTAG, och det ar inte ett kryphal utan skillnaden mellan att
-- stada bort ett spar och att radera en manniska ur registret: en kaskad fran
-- den rad filen hor till slapps igenom. Forsvinner personen ur `employee`
-- forsvinner filerna om hen med, och det ar vad en radering betyder.
--
-- Utan undantaget hade `delete from employee` fallit pa den har triggern, och
-- bade provens stadning och en framtida gallring (E6.2) hade slutat fungera —
-- en sparr mot att radera bevis hade blivit en sparr mot att radera personen
-- bevisen handlar om.
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

  raise exception 'En fil tas inte bort ur registret. Satt removed_at i stallet.';
end;
$$;

drop trigger if exists file_object_last on file_object;
create trigger file_object_last
  before delete on file_object
  for each row execute function public.file_object_ar_last();

-- -----------------------------------------------------------------------------
-- 3. Oppningsloggen (K36)
--
-- En rad per gang nagon fick tillgang till filens innehall. `open` skrivs INNAN
-- den signerade URL:en utfardas — inte efter, och inte "om det gick bra".
-- -----------------------------------------------------------------------------

create table if not exists file_access_log (
  id      bigserial primary key,

  -- Kaskad, av samma skal som undantaget i triggern ovan: loggen far bara
  -- forsvinna tillsammans med filen, och filen bara tillsammans med den som
  -- den handlar om.
  file_id uuid not null references file_object(id) on delete cascade,

  actor_id uuid not null references employee(id),

  -- 'open' = en signerad URL utfardades. 'upload' = filen kom in.
  -- 'remove' = innehallet togs bort ur bucketen.
  action text not null check (action in ('open','upload','remove')),

  -- Kopieras fran filen vid skrivningen sa att loggen gar att lasa utan att
  -- joina in det den handlar om.
  purpose text not null,

  ts timestamptz not null default now(),
  ip inet
);

create index if not exists file_access_log_fil_idx on file_access_log (file_id, ts desc);
create index if not exists file_access_log_ts_idx  on file_access_log (ts desc);

comment on table file_access_log is
  'K36: varje oppning av en fil. Append-only. Ligger INTE i audit_log — den '
  'lases av admin, som med flit inte far se att en sjukanmalan finns (0020).';

-- Append-only. En logg som gar att skriva om ar ett pastaende, inte en logg.
--
-- Samma undantag som pa filen: har filen redan forsvunnit ar det en kaskad,
-- och da ska raden folja med. En rad kan alltsa aldrig raderas for sig.
create or replace function public.file_access_log_ar_last()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.file_object where id = old.file_id) then
    return old;
  end if;

  raise exception 'Atkomstloggen skrivs bara till (K36).';
end;
$$;

drop trigger if exists file_access_log_last on file_access_log;
create trigger file_access_log_last
  before update or delete on file_access_log
  for each row execute function public.file_access_log_ar_last();

-- -----------------------------------------------------------------------------
-- 4. Behorighet pa raden
--
-- Bada policyerna arver i stallet for att upprepa. `exists (select 1 from
-- sick_report r where r.id = ...)` kor med den fragandes egen token, sa
-- sick_reports EGEN policy avgor — inklusive att `finance`, `admin` och
-- `payroll_cost_viewer` far noll rader, och inklusive losenordssparren fran
-- 0017. Samma monster som `document_version_read` i 0003.
--
-- Att i stallet skriva av villkoret hade gett tva stallen som ska hallas lika,
-- och den dagen sjukfranvarons behorighet andras hade filen legat kvar oppen
-- for den som tappade tillgangen till anmalan.
--
-- Den som LADDADE UPP filen har ingen egen ratt att lasa den. Behorigheten
-- foljer relationen som galler nu, aldrig vad man en gang gjorde — samma linje
-- som iCal-flodet och offboardingen i 0021.
-- -----------------------------------------------------------------------------

alter table file_object     enable row level security;
alter table file_access_log enable row level security;

drop policy if exists file_object_read on file_object;
create policy file_object_read on file_object for select
  to authenticated
  using (
    (purpose = 'sick_certificate' and exists (
      select 1 from public.sick_report r where r.id = file_object.sick_report_id))
    or
    (purpose = 'document_attachment' and exists (
      select 1 from public.document d where d.id = file_object.document_id))
  );

-- Vem som oppnat filen syns for den som far se filen. Det ar transparensen i
-- K36: den sjuke ser sjalv vilka som last hennes intyg.
drop policy if exists file_access_log_read on file_access_log;
create policy file_access_log_read on file_access_log for select
  to authenticated
  using (exists (select 1 from public.file_object f where f.id = file_access_log.file_id));

-- Skrivning gar aldrig via API:t. Ingen insert-, update- eller delete-policy
-- finns pa nagon av tabellerna, och det ar samma regel som resten av navet:
-- servern skriver, med service role, efter att ha kontrollerat behorigheten.

-- -----------------------------------------------------------------------------
-- 5. Bucketen ar stangd for anvandartokens — och gar inte att oppna av misstag
--
-- `storage.objects` har RLS pa och inga tillatande policyer, vilket redan ger
-- noll rader. Den restriktiva policyn nedan gor det till nagot mer an ett
-- nulage: en restriktiv policy AND:as med samtliga tillatande, sa den dag
-- nagon lagger till "authenticated far lasa bucketen X" slapper den anda inte
-- igenom nagot ur `filer`.
--
-- Service role bypassar RLS och paverkas inte. Signerade URL:er valideras av
-- Storage-API:t pa signaturen och inte via den har tabellen — provat skarpt,
-- se tests/rls.mjs.
-- -----------------------------------------------------------------------------

drop policy if exists filer_ar_stangd on storage.objects;
create policy filer_ar_stangd on storage.objects
  as restrictive
  for all
  to authenticated, anon
  using (bucket_id <> 'filer')
  with check (bucket_id <> 'filer');
