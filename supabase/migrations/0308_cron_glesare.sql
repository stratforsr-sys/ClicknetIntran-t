-- 0308: bakgrundsjobben glesare, och pg_crons logg städas.
--
-- VARFÖR. Supabase mejlade 2026-11-15 att Disk IO-budgeten håller på att ta
-- slut. Databasen ligger på Nano (428 MB minne) och har nästan inget ledigt
-- minne. Postgres egna frågor läser nästan ingenting från disk, men varje gång
-- något vaknar läses programfiler in igen som trängts ut ur minnet. En lördag
-- utan användare läste servern 5,4 MB/s, ungefär 460 GB per dygn. Två jobb
-- väckte kedjan pg_cron → pg_net → Vercel → PostgREST varje minut, dygnet
-- runt: 2 880 körningar per dygn av totalt ~3 100.
--
-- NYA TIDER (pg_cron räknar i UTC; 04–20 UTC är 05/06–21/22 svensk tid):
--
--   nav-utkorg       var 2:a minut 04–20 UTC          510 körningar/dygn
--   nav-utkorg-natt  var 10:e minut 21–03 UTC          42 körningar/dygn
--   nav-inkio        var 5:e minut dygnet runt        288 körningar/dygn
--
-- Totalt 840 i stället för 2 880.
--
-- Det här tål tiderna:
--   * Uppgifternas påminnelser (`lk_uppgiftspaminnelser`) har ett fönster på
--     15 minuter (10 före till 5 efter), så både 2 och 10 minuter träffar.
--   * Mötenas påminnelser (`motespaminnelser`) gäller från påminnelsetiden
--     till starten, och 2 minuter efter starten för "när mötet börjar". Dagtid
--     träffas alla. Nattetid kan en påminnelse kortare än 10 minuter missas.
--   * Utkorgen är reserven. Den vanliga vägen är `after()` i den action som
--     skrev raderna.
--   * Inkio-larmet (`STILLA_MS`, 15 min) går efter tre missade körningar i rad
--     i stället för femton. Därför går Inkio var 5:e minut också på natten.
--     Varma kunder läses var 5:e minut, kalla ungefär var 20:e (en fjärdedel
--     av de förfallna per varv, `attLasa`). Det finns ingen webhook för
--     anteckningar, så en kommentar i Inkio kan nå Nav upp till ~20 min senare.
--
-- LOGGEN. `cron.job_run_details` hade 86 000 rader (16 MB) och städades
-- aldrig. Nu tas rader äldre än sju dagar bort varje natt 03:17 UTC.

-- Utkorgen dagtid: samma jobb, nytt schema.
select cron.alter_job(jobid, schedule := '*/2 4-20 * * *')
from cron.job where jobname = 'nav-utkorg';

-- Utkorgen nattetid: en egen rad med samma kommando.
select cron.unschedule('nav-utkorg-natt')
where exists (select 1 from cron.job where jobname = 'nav-utkorg-natt');
select cron.schedule(
  'nav-utkorg-natt',
  '*/10 0-3,21-23 * * *',
  $$select public.kalla_jobb('/api/jobb/utkorg')$$
);

-- Inkio-bevakningen.
select cron.alter_job(jobid, schedule := '*/5 * * * *')
from cron.job where jobname = 'nav-inkio';

-- Loggen: städa nu och sedan varje natt.
delete from cron.job_run_details where end_time < now() - interval '7 days';

select cron.unschedule('nav-cronlogg')
where exists (select 1 from cron.job where jobname = 'nav-cronlogg');
select cron.schedule(
  'nav-cronlogg',
  '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
