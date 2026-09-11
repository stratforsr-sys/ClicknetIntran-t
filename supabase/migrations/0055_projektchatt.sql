-- =============================================================================
-- 0055_projektchatt.sql — samtalet i projektet.
--
-- Beställningen 2026-09-11: "ändra den här delen i en uppgift till en riktig
-- chatt, fast chatten ska vara i projektet när man går in i projektet".
--
-- =============================================================================
-- VARFÖR CHATTEN INTE ÄR EN RAD I `task_event`
--
-- Uppgiftens kommentarer bor i historiken (0054), och det är riktigt där: en
-- kommentar på en uppgift är en anteckning i ärendets gång, den ska stå kvar
-- bredvid "Returnerad" och "Godkänd", och den ingår i registerutdraget via
-- uppgiften.
--
-- ETT PROJEKTSAMTAL ÄR NÅGOT ANNAT. Det hör inte till ett beslut utan till en
-- grupp människor, det har inget "läge" att flytta, och det som gör det
-- användbart — vem som skrivit sedan jag var här sist — kräver att navet minns
-- att jag VARIT här. Det minnet finns inte i en händelselogg och hör inte
-- hemma i en heller: `task_event` är bevis, och bevis skrivs inte om för att
-- någon råkade läsa dem.
--
-- =============================================================================
-- OLÄST RÄKNAS FRAM, DEN LAGRAS INTE PER MEDDELANDE
--
-- Alternativet — en rad per mottagare och meddelande — hade gett en tabell som
-- växer med antalet deltagare gånger antalet repliker, och en notis per replik
-- i klockan. Tio meddelanden i ett projekt hade blivit tio poster, och då
-- stänger folk av klockan.
--
-- `project_message_read` bär i stället EN tidpunkt per person och projekt:
-- när du senast öppnade chatten. Antalet olästa är då en räkning, och notisen
-- blir "3 nya i Mässan" i stället för tre rader. Exakt samma val som
-- `notification_seen` gjorde i 0018, och av exakt samma skäl.
-- =============================================================================

create table if not exists project_message (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null references project(id) on delete cascade,

  -- Aldrig null. Ett anonymt inlägg i ett arbetslags samtal är inte ett
  -- samtal — samma linje som `coaching_task.created_by` och `guide_nudge`.
  author_id uuid not null references employee(id),

  /**
   * Taket är 4000 tecken.
   *
   * Inte för att spara plats utan för att en chattruta som tar emot en hel
   * rapport blir stället man klistrar in rapporten i — och då är det ingen som
   * hittar den igen. Det som är längre hör hemma i uppgiftens beskrivning
   * eller i en rutin.
   */
  body text not null check (length(btrim(body)) between 1 and 4000),

  created_at timestamptz not null default now()
);

create index if not exists project_message_idx on project_message (project_id, created_at);
create index if not exists project_message_forfattare_idx on project_message (author_id, created_at desc);

comment on table project_message is
  'Samtalet i ett projekt. Skilt från task_event med flit — se rubriken i 0055.';

-- -----------------------------------------------------------------------------
-- Läsmarkeringen
--
-- EN RAD PER PERSON OCH PROJEKT, inte per meddelande. Se rubriken ovan.
--
-- Raden skapas först när någon öppnat chatten. Saknas den har personen aldrig
-- varit inne, och då är ALLT oläst — vilket är rätt svar och inte ett
-- specialfall som koden behöver komma ihåg.
-- -----------------------------------------------------------------------------

create table if not exists project_message_read (
  project_id  uuid not null references project(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,

  seen_at timestamptz not null default now(),

  primary key (project_id, employee_id)
);

-- -----------------------------------------------------------------------------
-- Behörighet
--
-- Samma krets som projektet självt: `projekt_synligt()` från 0054 svarar redan
-- på frågan, och att skriva om den här hade varit ett andra svar att hålla lika.
-- -----------------------------------------------------------------------------

alter table project_message      enable row level security;
alter table project_message_read enable row level security;

drop policy if exists project_message_read_policy on project_message;
create policy project_message_read_policy on project_message for select
  to authenticated
  using (public.projekt_synligt(project_id, public.current_employee_id()));

-- Din egen läsmarkering, och ingen annans. Att se när en kollega senast läste
-- är en uppgift om henne och inte om projektet.
drop policy if exists project_message_read_egen on project_message_read;
create policy project_message_read_egen on project_message_read for select
  to authenticated
  using (employee_id = public.current_employee_id());

-- -----------------------------------------------------------------------------
-- Kvittot. Samma avläsning som 0043 och 0054.
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  skrivpolicyer int;
begin
  foreach t in array array['project_message', 'project_message_read'] loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      raise exception '% saknar row level security', t;
    end if;

    select count(*) into skrivpolicyer
    from pg_policies
    where schemaname = 'public' and tablename = t and cmd <> 'SELECT';

    if skrivpolicyer > 0 then
      raise exception '% har % skrivpolicy(er) — skrivning ska gå via service role', t, skrivpolicyer;
    end if;
  end loop;
end;
$$;
