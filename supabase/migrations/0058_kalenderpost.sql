-- =============================================================================
-- 0058_kalenderpost.sql — en coachningsuppgift kan bära ett klockslag.
--
-- Beställningen 2026-09-14: "kan du göra som Outlook, att man kan lägga till en
-- kalenderhändelse som man då antingen kan skapa till en uppgift eller en
-- coachningsuppgift som man kan välja, och så läggs den automatiskt".
--
-- =============================================================================
-- DET HÄR ÄR HELA MIGRATIONEN, OCH DET ÄR MED FLIT
--
-- Kalendern får INGEN egen posttabell. Beslutet från 0057 står kvar oförändrat:
-- kalendern visar det navet redan vet, och den bokar inga möten. Det nya är en
-- VÄG IN till två moduler som redan finns — posten som skapas ÄR en uppgift
-- (`task`, 0054) eller en coachningsuppgift (`coaching_task`, 0043), och den
-- bor i sin egen modul med sin egen krets, sin egen historik och sin egen RLS.
--
-- Den dag "kalenderhändelse" blir en egen rad som varken är uppgift eller
-- coachning har kalendern fått ett tredje slags innehåll som ingen modul äger,
-- och då är den inte längre en vy utan en femte plats att leta på.
--
-- =============================================================================
-- VARFÖR TABELLEN ÄNDÅ MÅSTE ÄNDRAS
--
-- `task` fick `due_time` och `estimate_minutes` i 0054, just för att pass 2
-- skulle kunna lägga en uppgift på ett klockslag. `coaching_task` fick aldrig
-- motsvarande — den bär `starts_on` och `due_date`, båda `date`, och ingenting
-- annat om tid.
--
-- En coachningsuppgift som skapas klockan 14 hade alltså tyst tappat sitt
-- klockslag på vägen till databasen, och sedan ritats som en heldagspost. Det
-- är precis den sortens tysta dataförlust regeln bakom `planera()` finns för:
-- ett fält som försvinner utan att någon får veta det upptäcks först när någon
-- undrar varför hon missade något hon trodde stod i kalendern.
--
-- VILLKOREN ÄR ORDAGRANT `task`:S. Ett klockslag utan datum är ingen tidpunkt,
-- och en uppskattning på noll minuter eller på mer än ett dygn är inte en
-- uppskattning. Att de två tabellerna säger samma sak om samma sak är inte en
-- upprepning — det är det som gör att kalendern kan rita dem i samma rutnät
-- utan att ha två regler för vad en post är.
-- =============================================================================

alter table coaching_task add column if not exists due_time time;
alter table coaching_task add column if not exists estimate_minutes integer;

-- `add constraint if not exists` finns inte i Postgres, och ett blint `add`
-- gör migrationen omöjlig att köra om. Namnen frågas därför fram.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'coaching_task_tid_kraver_datum'
  ) then
    alter table coaching_task
      add constraint coaching_task_tid_kraver_datum
      check (due_time is null or due_date is not null);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'coaching_task_uppskattning'
  ) then
    alter table coaching_task
      add constraint coaching_task_uppskattning
      check (estimate_minutes is null or (estimate_minutes > 0 and estimate_minutes <= 1440));
  end if;
end $$;

comment on column coaching_task.due_time is
  'Svensk väggtid, som task.due_time (0054). Null = posten gäller hela dagen.';

comment on column coaching_task.estimate_minutes is
  'Minuter. Räknas in i kalenderns "Planerat 4 h av 6 h" precis som en uppgifts.';
