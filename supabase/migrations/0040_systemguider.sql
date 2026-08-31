-- =============================================================================
-- 0040_systemguider.sql — var någon står i en guidad tur
--
-- GUIDERNA SJÄLVA LIGGER INTE HÄR, OCH SKA INTE GÖRA DET.
--
-- En guide är en lista steg som pekar på element i gränssnittet: "knappen med
-- data-guide="topp.sok"". Den listan hör ihop med koden som ritar knappen, och
-- måste ändras i samma commit som den. Lägger man stegen i databasen kan navet
-- byggas om utan att guiden märker det, och nästa person som kör turen får en
-- pil som pekar på tomma luften.
--
-- Därför bor guiderna i `src/guider/*.ts`, och `npm run test:guider` failar
-- bygget om ett ankare försvunnit. Den här tabellen bär bara det databasen är
-- ensam om att veta: hur långt en viss person kommit.
--
-- VARFÖR EN RAD PER PERSON OCH GUIDE, INTE PER STEG
--
-- Frågan navet ställer är alltid "var är hon nu?", aldrig "vilka steg har hon
-- gjort?". En tur går framåt; man hoppar inte in i mitten. En rad per steg hade
-- gett en tabell som växer med varje sidvisning för att kunna svara på en fråga
-- ingen ställer.
--
-- VERSIONEN STÅR PÅ RADEN med flit. Ändras ett moment på riktigt höjs guidens
-- version i koden, och då är en rad med lägre version inte längre ett bevis på
-- att personen kan det som gäller nu. Se `arKlar()` i src/lib/guider.ts. Utan
-- kolumnen hade omtaget krävt att man raderade folks historik för att be dem
-- göra om något.
--
-- STEG ÄR ETT INDEX I DEN SYNLIGA LISTAN och kan inte vara en främmande nyckel
-- mot något. Det får därför vara fel: en guide som krympt från nio steg till
-- sex lämnar rader som pekar på steg åtta. Läsningen klämmer värdet mot listans
-- längd i stället för att kasta — se `startSteg()`. Ett trasigt tal ska inte
-- kunna låsa någon ute ur sin egen onboarding.
-- =============================================================================

create table if not exists guide_progress (
  employee_id  uuid not null references employee(id) on delete cascade,

  -- Fritext av samma skäl som `notification_dismissed.notice_id` i 0038: värdet
  -- byggs i TypeScript och går inte att uttrycka som en främmande nyckel. En
  -- check på formen hade bara varit en andra kopia av registret i
  -- `src/guider/index.ts`, som glider isär från originalet.
  guide_slug   text not null check (length(btrim(guide_slug)) between 1 and 80),

  version      int  not null default 1 check (version >= 1),
  steg         int  not null default 0 check (steg >= 0),

  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Null så länge turen pågår. Sätts när sista steget är gjort, och det är den
  -- enda kolumnen som betyder "klar".
  completed_at timestamptz,

  primary key (employee_id, guide_slug)
);

-- Personens egna rader hämtas vid varje sidvisning i navet — se GuideVard.
create index if not exists guide_progress_person on guide_progress (employee_id);

-- Chefsöversikten (G5) frågar efter de som inte blivit klara. Partiellt index:
-- den som ÄR klar är den stora och ointressanta högen.
create index if not exists guide_progress_oppna
  on guide_progress (guide_slug) where completed_at is null;

alter table guide_progress enable row level security;

-- -----------------------------------------------------------------------------
-- Bara sina egna, och bara läsning.
--
-- Skrivningen går genom server actions med service role, precis som
-- `avfardaNotis()` i 0038. Skälet är detsamma: allt som exporteras ur en
-- "use server"-fil är en publik slutpunkt, och en skrivpolicy hade låtit vem
-- som helst bokföra en avklarad onboarding i någon annans namn.
--
-- CHEFENS LÄSNING FINNS INTE ÄN. Den kommer med översiktsvyn i G5, och lägger
-- till en egen select-policy då. Att öppna läsningen för chefer innan det finns
-- en vy som visar den vore att dela ut en uppgift om personalen som ingen
-- frågat efter.
-- -----------------------------------------------------------------------------
drop policy if exists guide_progress_read on guide_progress;
create policy guide_progress_read on guide_progress for select
  to authenticated
  using (employee_id = public.current_employee_id());

-- -----------------------------------------------------------------------------
-- Självkontroll — samma sort som 0032, 0034, 0035, 0036 och 0038 avslutas med.
--
-- Raden säger hur långt en namngiven person kommit i sin onboarding. Det är en
-- uppgift om henne, och utan RLS hade vilken inloggad som helst kunnat läsa
-- hela personalens.
-- -----------------------------------------------------------------------------
do $$
declare
  skrivpolicyer int;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'guide_progress' and c.relrowsecurity
  ) then
    raise exception 'guide_progress saknar row level security';
  end if;

  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public'
    and tablename = 'guide_progress'
    and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'guide_progress har % skrivpolicy(er) — skrivning ska gå via service role', skrivpolicyer;
  end if;
end;
$$;
