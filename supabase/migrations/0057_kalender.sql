-- =============================================================================
-- 0057_kalender.sql — kalendern, pass 2 av tre.
--
-- NUMRET ÄR 0057 OCH INTE 0056. `0056_samtal_pa_order` står i
-- `schema_migrations` sedan 2026-09-14 06:22 UTC och har lagt fyra kolumner på
-- `phone_call` — men filen finns inte i repot och ingen gren bär den. Numret är
-- taget när migrationen KÖRTS, inte när den mergats, så det går inte att
-- återanvända. Se NASTA_SESSION.md.
--
-- =============================================================================
-- KALENDERN BOKAR INGA MÖTEN, OCH DET ÄR ETT BESLUT OCH INTE EN AVGRÄNSNING
--
-- Beställarens beslut 2026-09-11: kalendern visar uppgifter plus det navet
-- redan vet — beviljad ledighet, coachningssamtal, kursfrister och månadens
-- orderfrist. Ingen inbjudan, inga ja/nej-svar, ingen ombokning.
--
-- Därför finns det ingen `calendar_event`-tabell här. En egen händelsetabell
-- hade varit det första steget mot en mötesmodul, och den andra halvan av en
-- mötesmodul sitter i Outlook hos motparten — alltså utanför navet. Det som
-- finns i den här migrationen är EN tabell (vem som får se vems kalender) och
-- TVÅ funktioner (vad en viss person får se av en annans dag).
--
-- =============================================================================
-- LEDIG/UPPTAGEN ÄR GRUNDLÄGE FÖR ALLA, OCH GRUNDLÄGET ÄR FRÅNVARON AV EN RAD
--
-- Beställarens beslut samma dag. Att alla ser varandras upptagenhet är hela
-- skälet att en delad kalender är värd något: den som ska fråga en kollega om
-- fem minuter vill veta om hon sitter i ett samtal, inte be om lov att få veta
-- det.
--
-- En rad i `calendar_share` betyder därför ALLTID mer än grundläget, aldrig
-- mindre. Att stänga av ledig/upptagen för en enskild kollega går inte, och det
-- är avsiktligt: en kalender där vissa är osynliga är en kalender man slutar
-- lita på, och den som vill dölja något gör det genom att inte lägga in det.
--
-- Med fjorton anställda hade det omvända — en rad per par — betytt 182 rader
-- att skriva vid varje anställning och städa vid varje avslut, och den dagen
-- någon glöms bort ser det ut som att hennes kalender är tom snarare än som
-- att något är fel.
--
-- =============================================================================
-- DET HÄR ÄR DEN ENDA DÖRREN IN I NÅGON ANNANS UPPGIFTER, OCH BARA ÄGAREN
-- KAN ÖPPNA DEN
--
-- 0054 skrev ut att `can_read_all_employees()` MED FLIT inte står i `task_read`:
-- ingen roll ger insyn i någons uppgiftslista, för den dagen listan är läsbar
-- för ledningen slutar folk skriva den andra sortens rad i den.
--
-- Den regeln står kvar oförändrad. `uppgift_synlig()` får nedan en gren till,
-- och skillnaden mot en chefsgren är hela poängen: den utlöses av en rad som
-- UPPGIFTENS ÄGARE själv har skrivit, om en namngiven person, och som hon kan
-- ta bort när som helst. Det är samma samtycke Outlook bygger på. En roll kan
-- ingen ta bort, och det är därför en roll aldrig får stå där.
--
-- TVÅ SPÄRRAR STÅR KVAR ÄVEN FÖR DEN SOM FÅTT ALLA DETALJER:
--
--   1. Nivåerna `upptagen` och `rubriker` öppnar INGENTING. De läses genom
--      `kalender_poster()` nedan, som lämnar ut en tidsrymd respektive en
--      rubrik — inte raden. Den som står på nivå ett eller två får noll rader
--      ur `task`, precis som i dag.
--
--   2. En uppgift med en DOLD personkoppling till läsaren själv släpps aldrig
--      igenom, oavsett nivå. Det är precis det fall `visible_to_subject` byggdes
--      för i 0054 — "fundera på om Erik ska ha en tillsägelse" ska inte nå Erik
--      för att chefen råkade ge honom sin kalender.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Delningen
--
-- Fem nivåer, Outlooks. Namnen är översatta till vad de betyder HÄR: nivå fyra
-- heter `redigera` som hos Outlook, men i navet ger den bara kalenderns eget
-- verb — att flytta något i tiden. Vad en uppgift HANDLAR om bestäms i
-- uppgiften, och den har sin egen krets sedan 0054.
-- -----------------------------------------------------------------------------

create table if not exists calendar_share (
  -- Den som delar. Raden är hennes, och hon är den enda som kan skriva den.
  owner_id  uuid not null references employee(id) on delete cascade,
  -- Den som får se.
  viewer_id uuid not null references employee(id) on delete cascade,

  level text not null check (level in ('upptagen','rubriker','detaljer','redigera','delegat')),

  -- `created_by` är alltid ägaren i dag. Kolumnen står ändå, av samma skäl som
  -- `phone_identity.created_by` i 0053: den dag en administratör sätter upp en
  -- delning åt någon ska det gå att se att navet inte gissade det självt.
  created_by uuid not null references employee(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (owner_id, viewer_id),

  -- En rad på nivå `upptagen` är grundläget skrivet en gång till. Den hade sett
  -- ut som en inställning och inte gjort någonting, och den sortens rad är den
  -- någon senare tror betyder "bara upptagen, till skillnad från alla andra".
  constraint calendar_share_over_grundlaget check (level <> 'upptagen'),

  -- Att dela sin kalender med sig själv är en ifylld ruta, inte en delning.
  constraint calendar_share_inte_sig_sjalv check (owner_id <> viewer_id)
);

create index if not exists calendar_share_viewer_idx on calendar_share (viewer_id, level);

comment on table calendar_share is
  'Vem som ser mer än ledig/upptagen av vems kalender. Grundläget är frånvaron av en rad — se rubriken i 0057.';

comment on column calendar_share.level is
  'upptagen (grundläge, aldrig lagrad), rubriker, detaljer, redigera, delegat. Nivå fyra ger kalenderns verb, inte uppgiftens.';

-- -----------------------------------------------------------------------------
-- 2. Nivån mellan två personer
--
-- EN FUNKTION OCH INTE EN VY, och `security definer` av samma skäl som
-- `uppgift_synlig()` i 0054: den anropas INIFRÅN policyn på `task`, och en
-- vanlig underfråga mot `calendar_share` hade utlöst dess egen policy i sin
-- tur. Funktionen svarar på exakt en fråga och kringgår RLS bara för att kunna
-- göra det.
--
-- OFFBOARDADE FÅR NOLL, och det behöver ingen annan del av systemet komma ihåg.
-- Samma resonemang som kalenderflödet i 0021: en spärr som kräver att
-- offboardingkoden minns att stänga den är en spärr som en dag står öppen.
-- -----------------------------------------------------------------------------

create or replace function public.kalender_niva(p_owner uuid, p_viewer uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_owner is null or p_viewer is null then null
    when p_owner = p_viewer then 'delegat'
    when not exists (
      select 1 from employee e
      where e.id = p_owner and e.status <> 'offboarded'
    ) then null
    when not exists (
      select 1 from employee e
      where e.id = p_viewer and e.status <> 'offboarded'
    ) then null
    else coalesce(
      (select s.level from calendar_share s
        where s.owner_id = p_owner and s.viewer_id = p_viewer),
      'upptagen'
    )
  end;
$$;

revoke all on function public.kalender_niva(uuid, uuid) from public, anon;
grant execute on function public.kalender_niva(uuid, uuid) to authenticated;

comment on function public.kalender_niva(uuid, uuid) is
  'Vilken nivå p_viewer har på p_owners kalender. Sig själv är alltid delegat; utan rad är svaret grundläget upptagen.';

-- -----------------------------------------------------------------------------
-- 3. En annans dag, projicerad till läsarens nivå
--
-- =============================================================================
-- PROJEKTIONEN LIGGER I DATABASEN OCH INTE I TYPESCRIPT
--
-- Alternativet var att läsa kollegans uppgifter med service role och filtrera
-- bort rubrikerna i `kalender-server.ts`. Det hade fungerat, och det hade
-- betytt att det enda som står mellan en säljares anteckningar och hela huset
-- är en `if`-sats i en renderingsfil. Här är rubriken BORTA redan när raden
-- lämnar Postgres, och en glömd kolumn i vyn kan inte läcka något som aldrig
-- kom med.
--
-- Funktionen lämnar därför ut noll rader om `p_owner` inte alls delar med
-- läsaren, `rubrik = null` på grundläget, och `ref = null` på allt under
-- "alla detaljer" — så att gränssnittet inte ens kan bygga en länk in.
--
-- VAD SOM INTE FINNS I FUNKTIONEN: `sick_report`. Samma absoluta rad som
-- `src/lib/ical.ts` drog 2026-08-20 och 0021 skrev ut: sjukfrånvaro går aldrig
-- ut ur navet, och en kollegas kalender är ut ur navet i den meningen som
-- räknas. Den som är sjuk syns som upptagen — genom sin frånvaroansökan om det
-- finns en, annars inte alls.
--
-- LEDIGHETENS TYP FÖLJER INTE HELLER MED. Posterna heter "Ledig", precis som i
-- iCal-flödet, och av samma skäl: att någon är föräldraledig eller vabbar är en
-- upplysning om varför.
--
-- COACHNINGSSAMTAL, KURSFRISTER OCH ORDERFRISTEN STÅR MEDVETET INTE HÄR. De
-- ritas i den EGNA kalendern och projiceras aldrig till någon annan. Ett
-- coachningssamtal är ett samtal mellan två personer och står i deras två
-- kalendrar; en kursfrist är min egen läxa. Att lägga dem i en kollegas vy hade
-- varit att låta kalendern berätta något `coaching_session`-policyn i 0043 med
-- flit inte berättar.
-- =============================================================================
-- -----------------------------------------------------------------------------

create or replace function public.kalender_poster(p_owner uuid, p_fran date, p_till date)
returns table (
  slag  text,
  ref   uuid,
  dag   date,
  tid   time,
  minuter int,
  rubrik  text,
  klar    boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := public.current_employee_id();
  v_niva   text := public.kalender_niva(p_owner, v_viewer);
begin
  if v_niva is null then
    return;
  end if;

  -- Uppgifter med datum. Deluppgifter står inte i kalendern: de hör till sin
  -- rubrik och har ingen egen plats i en dag.
  return query
  select
    'uppgift'::text,
    case when v_niva in ('detaljer','redigera','delegat') then t.id else null::uuid end,
    t.due_date,
    t.due_time,
    t.estimate_minutes,
    case when v_niva = 'upptagen' then null::text else t.title end,
    exists (
      select 1 from task_event e
      where e.task_id = t.id and e.type in ('klar','godkand','avbruten')
    )
  from task t
  where t.assignee_id = p_owner
    and t.parent_id is null
    and t.due_date between p_fran and p_till
    -- Den dolda personkopplingen står kvar även för en delegat. Se rubriken.
    and not exists (
      select 1 from task_link l
      where l.task_id = t.id
        and l.employee_id = v_viewer
        and l.visible_to_subject = false
    );

  -- Beviljad ledighet, en rad per dag i perioden. Heldag: `tid` är null.
  --
  -- `part_day_minutes` följer med som längd även om posten saknar klockslag —
  -- en halv dags ledighet är fyra timmar någon gång under dagen, och VILKA
  -- fyra vet navet inte. Att gissa ett klockslag hade gjort en okänd sak till
  -- en påstådd.
  return query
  select
    'franvaro'::text,
    null::uuid,
    d::date,
    null::time,
    a.part_day_minutes,
    case when v_niva = 'upptagen' then null::text else 'Ledig'::text end,
    false
  from absence_request a
  cross join lateral generate_series(
    greatest(a.starts_on, p_fran)::timestamp,
    least(a.ends_on, p_till)::timestamp,
    interval '1 day'
  ) as d
  where a.employee_id = p_owner
    and a.status = 'approved'
    and a.starts_on <= p_till
    and a.ends_on >= p_fran;
end;
$$;

revoke all on function public.kalender_poster(uuid, date, date) from public, anon;
grant execute on function public.kalender_poster(uuid, date, date) to authenticated;

comment on function public.kalender_poster(uuid, date, date) is
  'En persons dagar projicerade till läsarens delningsnivå. Bär aldrig sjukfrånvaro, aldrig frånvarotyp — se rubriken i 0057.';

-- -----------------------------------------------------------------------------
-- 4. Delningen öppnar uppgiften — men bara från "alla detaljer" och uppåt
--
-- `uppgift_synlig()` ersätts med samma funktion plus EN gren. Kretsen i 0054
-- står kvar ord för ord; det som tillkommer är den delning ägaren själv skrivit.
--
-- Villkoret `t.assignee_id = <ägaren>` är avgörande: delningen gäller ÄGARENS
-- KALENDER, alltså de uppgifter som ligger på henne. En uppgift hon bara skapat
-- åt någon annan står i den andras kalender och omfattas inte — annars hade en
-- delning läckt en tredje persons rad, och den tredje personen har inte sagt ja
-- till någonting.
-- -----------------------------------------------------------------------------

create or replace function public.uppgift_synlig(p_task uuid, p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_employee is not null and exists (
    select 1
    from task t
    where t.id = p_task
      and (
        t.assignee_id = p_employee
        or t.created_by = p_employee
        or exists (
          select 1 from task_member m
          where m.task_id = t.id and m.employee_id = p_employee
        )
        or exists (
          select 1 from task_link l
          where l.task_id = t.id
            and l.employee_id = p_employee
            and l.visible_to_subject
        )
        -- 0057. Ägaren av kalendern har delat den på "alla detaljer" eller mer.
        or (
          t.assignee_id is not null
          and public.kalender_niva(t.assignee_id, p_employee)
                in ('detaljer','redigera','delegat')
          -- Den dolda personkopplingen bryter igenom delningen, inte tvärtom.
          and not exists (
            select 1 from task_link l2
            where l2.task_id = t.id
              and l2.employee_id = p_employee
              and l2.visible_to_subject = false
          )
        )
      )
  );
$$;

revoke all on function public.uppgift_synlig(uuid, uuid) from public, anon;
grant execute on function public.uppgift_synlig(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Behörighet på tabellen
--
-- Läsning: min egen delning, och den andra har gett mig. Skrivning uteslutande
-- via server action med service role (D-T1), som resten av navet.
--
-- LEDNINGEN SER INTE TABELLEN. `calendar_feed_read` i 0021 släpper in säljchef
-- och VD, och det var riktigt där: frågan "vilka flöden är öppna mot internet"
-- är en driftfråga. Den här tabellen svarar på något annat — vem jag litar på
-- med min dag — och det är ingen chefs sak. Att veta att Anna gett Bertil
-- delegatbehörighet är en upplysning om Anna och Bertil.
-- -----------------------------------------------------------------------------

alter table calendar_share enable row level security;

drop policy if exists calendar_share_read on calendar_share;
create policy calendar_share_read on calendar_share for select
  to authenticated
  using (
    owner_id = public.current_employee_id()
    or viewer_id = public.current_employee_id()
  );

-- -----------------------------------------------------------------------------
-- 6. Kvittot
--
-- Samma avläsning som 0043 och 0054 gör, och den fångar det som är lätt att
-- missa: en tabell utan RLS, eller en skrivpolicy som smugit in och öppnat en
-- väg förbi server action.
-- -----------------------------------------------------------------------------

do $$
declare
  skrivpolicyer int;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'calendar_share' and c.relrowsecurity
  ) then
    raise exception 'calendar_share saknar row level security';
  end if;

  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public' and tablename = 'calendar_share' and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'calendar_share har % skrivpolicy(er) — skrivning ska gå via service role', skrivpolicyer;
  end if;
end;
$$;

-- Projektionen är hela skyddet för nivå ett och två, och en funktion som
-- tappat sin `security definer` ser ut precis som en som aldrig behövde den.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'kalender_poster' and p.prosecdef
  ) then
    raise exception 'kalender_poster är inte security definer';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'kalender_niva' and p.prosecdef
  ) then
    raise exception 'kalender_niva är inte security definer';
  end if;
end;
$$;

-- Grundläget MÅSTE vara oåtkomligt som lagrad rad, annars betyder en tom tabell
-- två olika saker beroende på vem som frågar. Kontrollen läser villkoret i
-- stället för att prova en insert: ett kvitto som SKRIVER i produktionsdatan är
-- ett kvitto som en dag lämnar en rad efter sig.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'calendar_share_over_grundlaget'
      and conrelid = 'public.calendar_share'::regclass
  ) then
    raise exception 'calendar_share_over_grundlaget saknas — nivån upptagen går att lagra';
  end if;
end;
$$;
