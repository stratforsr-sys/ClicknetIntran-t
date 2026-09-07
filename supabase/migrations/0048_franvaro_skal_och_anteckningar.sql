-- =============================================================================
-- 0048 · SKAL PA LEDIGHETSANSOKAN, ANTECKNINGAR PA SJUKPERIOD
--
-- Bestallt 2026-09-07 efter att bestallaren tittat pa en pagaende sjukanmalan
-- och fragat "varfor ar han ledig, och fran nar till nar". Ingen av de tva
-- fragorna gick att besvara i navet.
--
-- =============================================================================
-- K35 / AC-3.21 ar OMPROVAD HAR, INTE OVERKORD. LAS DET HAR FORE ANDRING.
--
-- 0019 och `franvaro/ny/Ansokningsformular.tsx` bar bada en versal rubrik om
-- att det ALDRIG far finnas ett skalfalt. Argumentet var, och ar fortfarande,
-- riktigt: samma falt som bar "brollop" i september bar "cellprov" i november,
-- och da ligger en halsouppgift i ett fritextfalt.
--
-- Bestallaren tog stallning 2026-09-07 och valde skalfaltet anda. Beslutet star
-- i DECISIONS.md som D-E7.10. Det som byggs har ar darfor inte "K35 glomdes"
-- utan "K35 provades mot ett verksamhetsbehov och forlorade" — och tre av dess
-- skyddsatgarder star kvar:
--
--   1. SKALET LAMNAR ALDRIG BESLUTSKRETSEN. `absence_request_read` slapper in
--      den sokande sjalv, den som leder hen, och ledningen. Ingen annan. Kolumnen
--      ligger i den tabellen och arver den gransen — men VARJE VY som inte ar
--      beslutsvy maste sluta be om kolumnen. Bemanningsvyn, planeringsvyn och
--      dagsbilden gor det inte, och far inte borja.
--
--   2. SKALET STAR ALDRIG I EN NOTIS. Notistexten ar oforanderlig sedan 0047
--      och gar till en klocka som kan lasas over en axel. Perioden racker dit.
--
--   3. SJUKVAGEN FICK INGET ORSAKSFALT. Den fragan stalldes separat samma dag
--      och besvarades med chefens anteckning i stallet — se nedan. `sick_report`
--      har alltjamt ingen kolumn som kan bara en diagnos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Skalet pa ansokan
--
-- Kolumnen ar nullbar, och det ar inte slarv. Den enda ansokan som fanns nar
-- migrationen kordes skickades in innan faltet existerade, och en `not null`
-- hade kravt att navet hittade pa ett skal at nagon i efterhand. Kravet ligger
-- i stallet pa INSERT, dar det galler allt som skickas in fran och med nu.
-- -----------------------------------------------------------------------------

alter table absence_request add column if not exists reason text;

comment on column absence_request.reason is
  'Skalet den sokande angav. Obligatoriskt vid nya inskick (se triggern nedan). Lases bara av den sokande, den som leder hen och ledningen — aldrig i bemannings-, planerings- eller dagsvyn, och aldrig i en notis.';

alter table absence_request drop constraint if exists absence_request_skal_form;
alter table absence_request add constraint absence_request_skal_form
  check (reason is null or (length(btrim(reason)) > 0 and length(reason) <= 600));

-- Kravet galler bara det som gar att ANSOKA om. Sjukfranvaro registreras och
-- soks aldrig (AC-3.6), sa villkoret far inte hanga i vagen den dagen en
-- sjukperiod laggs upp som en rad har.
create or replace function public.absence_request_kraver_skal()
returns trigger
language plpgsql
as $$
declare
  ansokbar boolean;
begin
  select requestable into ansokbar from absence_type where id = new.type_id;

  if coalesce(ansokbar, false)
     and (new.reason is null or length(btrim(new.reason)) = 0) then
    raise exception 'En ledighetsansokan kraver ett skal (D-E7.10).';
  end if;

  return new;
end;
$$;

drop trigger if exists absence_request_skal on absence_request;
create trigger absence_request_skal
  before insert on absence_request
  for each row execute function public.absence_request_kraver_skal();

-- -----------------------------------------------------------------------------
-- 2. Chefens anteckning pa en sjukperiod
--
-- Det bestallaren egentligen saknade framfor Micks rad: inte en diagnos, utan
-- ett svar pa "vet vi nagot om laget". "Pratat med Mick 5/9, tillbaka tidigast
-- mandag" ar den anteckningen. Den skrivs av CHEFEN och aldrig av den sjuke —
-- den som ar sjuk ska inte behova motivera sin sjukdom for att navet ska ha en
-- rad om den.
--
-- ANTECKNINGEN AR INTERN MEN INTE HEMLIG. `sick_note_read` slapper in chefen
-- och ledningen, inte den anteckningen handlar om. Men `employee_id` star i
-- tabellen just for att raden ska folja med i personens REGISTERUTDRAG
-- (dataskyddsforordningen art. 15) och i raderingen — den som fragar far lasa
-- vad som skrivits om hen. Skillnaden mellan "inte i granssnittet" och "inte
-- utlamnad" ar hela poangen, och den forsvinner om nagon tar bort kolumnen for
-- att den ser overflodig ut bredvid `sick_report_id`.
--
-- ANTECKNINGEN SKRIVS EN GANG. Samma regel som notistexterna i 0047: det som
-- antecknades den 5:e ska sta kvar aven sedan Mick kommit tillbaka, for det VAR
-- vad chefen visste da. Triggern nedan blockerar UPDATE men inte DELETE —
-- raderingen av en anstalld (0046) och kaskaden fran `sick_report` maste ga
-- igenom, och bada gar via service role.
-- -----------------------------------------------------------------------------

create table if not exists sick_note (
  id             uuid primary key default gen_random_uuid(),
  sick_report_id uuid not null references sick_report(id) on delete cascade,

  -- Fylls av triggern nedan ur rapporten, aldrig av anroparen. Tva stallen som
  -- kan saga emot varandra ar ett stalle for mycket.
  employee_id    uuid not null references employee(id) on delete cascade,

  author_id      uuid references employee(id),
  body           text not null check (length(btrim(body)) > 0 and length(body) <= 1000),
  created_at     timestamptz not null default now()
);

create index if not exists sick_note_rapport_idx on sick_note (sick_report_id, created_at desc);
create index if not exists sick_note_person_idx  on sick_note (employee_id, created_at desc);

create or replace function public.sick_note_agaren()
returns trigger
language plpgsql
as $$
begin
  select employee_id into new.employee_id from sick_report where id = new.sick_report_id;
  if new.employee_id is null then
    raise exception 'Sjukanmalan finns inte.';
  end if;
  return new;
end;
$$;

drop trigger if exists sick_note_agare on sick_note;
create trigger sick_note_agare
  before insert on sick_note
  for each row execute function public.sick_note_agaren();

create or replace function public.sick_note_ar_orubblig()
returns trigger
language plpgsql
as $$
begin
  raise exception 'En anteckning skrivs en gang. Skriv en ny i stallet.';
end;
$$;

drop trigger if exists sick_note_orubblig on sick_note;
create trigger sick_note_orubblig
  before update on sick_note
  for each row execute function public.sick_note_ar_orubblig();

-- -----------------------------------------------------------------------------
-- 3. Behorighet
--
-- Bara SELECT far en policy. Skrivningen gar genom server actionen med service
-- role, precis som resten av franvaromodulen — och utan insert-policy kan ingen
-- inloggad skriva en anteckning forbi den vagen.
--
-- Kretsen ar SNAVARE an `sick_report_read`, som ocksa slapper in den sjuke
-- sjalv. Det ar med flit: anteckningen ar chefens arbetsmaterial, och den som
-- vill lasa vad som skrivits om hen far det genom registerutdraget. `admin` ar
-- utelamnad av samma skal som i 0020 — rollen ar teknisk.
-- -----------------------------------------------------------------------------

alter table sick_note enable row level security;

drop policy if exists sick_note_read on sick_note;
create policy sick_note_read on sick_note for select
  to authenticated
  using (
    public.leads_employee(employee_id)
    or public.has_any_role(array['sales_manager','ceo'])
  );
