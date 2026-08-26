-- =============================================================================
-- 0038_notisavfardning.sql — en notis som klickats forsvinner ur klockan
--
-- KLOCKAN LAGRAR FORTFARANDE INGA NOTISER.
--
-- 0018 valde bort en `notification`-tabell dar varje producent skriver sin rad,
-- och det valet star kvar: posterna raknas fortfarande fram ur `document`,
-- `course`, `news_post`, `case_message`, `absence_request` och resten vid
-- lasning. Den har tabellen ar inte notiserna — den ar en lista over de poster
-- personen redan tagit hand om, och den ar det MINSTA som gar att lagra for att
-- svara pa fragan "har du klickat pa den har?".
--
-- VARFOR `notification_seen` INTE RACKTE
--
-- `notification_seen` bar en enda tidpunkt per person: nar klockan senast
-- oppnades. Den slacker PRICKEN pa allt samtidigt, men raden star kvar i listan
-- tills det som gjorde att den fanns ar ur vagen — kursen certifierad, rutinen
-- kvitterad, arendet obesvarat. En kurs man redan bestamt sig for att gora pa
-- fredag ligger alltsa kvar och tranger ut allt annat i fjorton dagar.
--
-- Det ar tva olika fragor. "Har du sett att det fanns nagot nytt?" besvaras av
-- en tidpunkt. "Har du tagit hand om just den har?" kan bara besvaras per post,
-- och darav en rad per post.
--
-- ID:T ar strangen som `src/lib/notiser.ts` bygger, till exempel
-- `rutin-<dokumentid>-3` eller `arende-<arendeid>-<meddelandeid>`. Att det bar
-- versionen och meddelandets id ar inte en slump utan hela ateruppstandelsen:
-- en NY version av en rutin far ett nytt id och dyker upp igen, aven for den
-- som avfardade version 2. Samma sak med nasta svar i ett arende.
--
-- VAD SOM INTE FORSVINNER
--
-- Ingenting utom raden i klockan. Den okvitterade rutinen star kvar pa
-- `/rutiner`, den ogjorda kursen pa `/utbildning`, den obeslutade ansokan pa
-- `/franvaro` och pa startsidans "Att gora". Klockan har aldrig varit stallet
-- dar arbete bokfors — den ar pafarten. 0018 skrev det som "inget forsvinner,
-- det slutar bara tranga sig fram", och avfardningen ar den meningen gjord till
-- en knapp.
-- =============================================================================

create table if not exists notification_dismissed (
  employee_id  uuid not null references employee(id) on delete cascade,

  -- Fritext med flit. Id:t byggs i TypeScript ur rader i sex olika tabeller och
  -- gar darfor inte att uttrycka som en frammande nyckel. En check pa formen
  -- hade bara varit en andra kopia av listan i notiser.ts, som glider isar.
  -- Det varsta ett paitat id kan stalla till ar att dolja en notis som inte
  -- finns.
  notice_id    text not null check (length(btrim(notice_id)) between 1 and 200),

  dismissed_at timestamptz not null default now(),

  primary key (employee_id, notice_id)
);

create index if not exists notification_dismissed_person
  on notification_dismissed (employee_id);

alter table notification_dismissed enable row level security;

-- Bara sina egna, och bara lasning. Skrivningen gar genom `avfardaNotis()` med
-- service role, precis som `markeraSedd()` — annars hade vem som helst kunnat
-- tysta nagon annans klocka genom att skriva rader i deras namn.
drop policy if exists notification_dismissed_read on notification_dismissed;
create policy notification_dismissed_read on notification_dismissed for select
  to authenticated
  using (employee_id = public.current_employee_id());

-- -----------------------------------------------------------------------------
-- Sjalvkontroll — samma sort som 0032, 0034, 0035 och 0036 avslutades med.
--
-- Har galler den RLS och inte funktionsgranter: tabellen bar en lista over vad
-- en enskild person klickat bort, vilket ar en uppgift om henne. Utan RLS hade
-- vilken inloggad som helst kunnat lasa den.
-- -----------------------------------------------------------------------------

do $$
declare
  skrivpolicyer int;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'notification_dismissed' and c.relrowsecurity
  ) then
    raise exception 'notification_dismissed saknar row level security';
  end if;

  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public'
    and tablename = 'notification_dismissed'
    and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'notification_dismissed har % skrivpolicy(er) — skrivning ska ga via service role', skrivpolicyer;
  end if;
end;
$$;
