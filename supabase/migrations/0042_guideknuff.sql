-- =============================================================================
-- 0042_guideknuff.sql — chefen kan säga till, och det syns hos den som får det
--
-- ===========================================================================
-- VARFÖR EN TABELL, NÄR KLOCKAN ANNARS INTE LAGRAR NÅGRA NOTISER
--
-- 0018 valde bort en `notification`-tabell där varje producent skriver sin rad,
-- och valet står kvar: posterna räknas fortfarande fram ur `document`,
-- `course`, `news_post`, `hr_case` och resten vid läsning. Det fungerar för att
-- varje sådan post HAR en rad någonstans som redan betyder något — en rutin som
-- ska kvitteras, en kurs som inte är gjord.
--
-- En knuff har ingen sådan rad. Att en chef klickade på en knapp är inte
-- härledbart ur någonting: guiderna såg likadana ut före och efter. Antingen
-- lagras handlingen, eller så händer ingenting.
--
-- DET ÄR OCKSÅ SKÄLET ATT DEN ÄR SÅ LITEN. Tabellen bär handlingen och inget
-- annat — vem, till vem, när. Texten i klockan byggs av `notiser-server.ts` ur
-- guiderna som faktiskt saknas just då, så en knuff från i förrgår säger rätt
-- sak i dag även om personen hunnit göra en av dem.
-- ===========================================================================
--
-- INGEN GUIDE PEKAS UT. Knuffen gäller onboardingen, inte en enskild tur. En
-- chef som pekar på "Registrera en order" har gissat vilken som fastnat; navet
-- vet det bättre och skriver ut det i notisen.
--
-- RADEN STÅR KVAR EFTER ATT DEN KLICKATS BORT. Avfärdningen bokförs som för
-- alla andra notiser, i `notification_dismissed` (0038) — det är personens egen
-- lista över vad hon tagit hand om, och den ska inte kunna sudda spåret av att
-- chefen sa till.
-- =============================================================================

create table if not exists guide_nudge (
  id          uuid primary key default gen_random_uuid(),

  -- Den som får knuffen.
  employee_id uuid not null references employee(id) on delete cascade,

  -- Den som gav den. Aldrig null: en knuff utan avsändare är en anonym
  -- tillsägelse, och sådana ska navet inte kunna skicka.
  nudged_by   uuid not null references employee(id) on delete cascade,

  nudged_at   timestamptz not null default now()
);

create index if not exists guide_nudge_mottagare on guide_nudge (employee_id, nudged_at desc);

alter table guide_nudge enable row level security;

-- -----------------------------------------------------------------------------
-- Mottagaren ser sina egna. Chefen ser dem hon leder, och ledningen alla —
-- samma krets som `guide_progress` fick i 0041, och av samma skäl: den som får
-- se att någon står still ska också kunna se om någon redan sagt till.
--
-- Skrivningen går via service role i `knuffa()`. `nudged_by` tas ur sessionen
-- och aldrig ur ett argument — annars vore fältet en plats att signera någon
-- annans namn på.
-- -----------------------------------------------------------------------------
drop policy if exists guide_nudge_read on guide_nudge;
create policy guide_nudge_read on guide_nudge for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.can_read_all_employees()
    or public.leads_employee(employee_id)
  );

do $$
declare
  skrivpolicyer int;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'guide_nudge' and c.relrowsecurity
  ) then
    raise exception 'guide_nudge saknar row level security';
  end if;

  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public' and tablename = 'guide_nudge' and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'guide_nudge har % skrivpolicy(er) — skrivning ska gå via service role', skrivpolicyer;
  end if;
end;
$$;
