-- 0306_chatt_reserv
--
-- Chattens logg: hur många gånger en reservmodell tog över i frågan. Avböjer
-- den valda modellen kan Anthropic låta en annan modell svara, och den
-- kostar mer (Opus 5 och Opus 4.8: 5 och 25 dollar per miljon token). Talet
-- visar hur ofta det händer, och kostnaden på raden räknas redan för varje
-- försök till sin egen modells pris.
--
-- Additiv och omkörbar. Ingenting slås på.

alter table public.nav_chatt_logg add column if not exists reserv integer not null default 0;
alter table public.nav_chatt_logg drop constraint if exists nav_chatt_logg_reserv;
alter table public.nav_chatt_logg add constraint nav_chatt_logg_reserv check (reserv >= 0);
