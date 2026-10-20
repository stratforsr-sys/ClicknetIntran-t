-- 0107 · Profilen i Nav 2.0: tilltalsnamn och profilbild (2026-10-20)
--
-- =============================================================================
-- VARFÖR
--
-- Utkastets Inställningar har Profilbild och Mina uppgifter (tilltalsnamn,
-- telefon, privat mejl). Utkastet sparade dem i webbläsaren. Beställaren
-- 2026-10-20: profilbilden ska finnas i Nav och synas för alla som är inne,
-- på alla enheter, och resten ska sparas "som är bäst".
--
-- Telefonen och det privata mejlet finns redan i `employee_onboarding` (0105):
-- det är dem Anställda visar och välkomstbrevet går till. Tilltalsnamnet läggs
-- bredvid dem. Den anställda skriver sin egen rad genom /nav2/profil (service
-- role, bakom SKRIVLAGE.profil); läsrätten i 0105 ändras inte.
--
-- Bilden är en 256 × 256 JPEG, 10–40 kB, som utkastet beskär i webbläsaren.
-- Den ligger i databasen och inte i fillagringen: en fil i `file_object`
-- loggar en rad per visning (K36), och en avatar visas på varje sida.
-- `previous` är bilden före, för Ångra. Alla inloggade läser bilderna;
-- bara rutten skriver (ingen skrivpolicy).
-- =============================================================================

alter table public.employee_onboarding
  add column if not exists preferred_name text
    check (preferred_name is null or (char_length(btrim(preferred_name)) between 1 and 30 and preferred_name !~ '\d{6}[-+]?\d{4}'));

create table public.employee_photo (
  employee_id uuid primary key references public.employee (id) on delete cascade,
  image bytea check (image is null or octet_length(image) between 100 and 200000),
  previous bytea check (previous is null or octet_length(previous) between 100 and 200000),
  updated_by uuid references public.employee (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.employee_photo enable row level security;

create policy employee_photo_read on public.employee_photo for select to authenticated
  using (public.current_employee_id() is not null);
