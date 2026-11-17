-- 0307_chatt_omskrivet
--
-- Chattens logg: om svaret skrevs om. Har Claudes svar ett tal utan källa
-- skickas det tillbaka en gång med talen uppräknade, och personen ser bara
-- det omskrivna. Andelen omskrivna svar är ett kvalitetsmått bredvid
-- obelagda tal: hur ofta modellen bröt regeln innan servern tog den.
--
-- Additiv och omkörbar. Ingenting slås på.

alter table public.nav_chatt_logg add column if not exists omskrivet boolean not null default false;
