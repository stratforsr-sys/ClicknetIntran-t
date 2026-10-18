-- Väntar till mergen av nav2-utkast (startsidan, E5.8). KÖR INTE FÖRE MERGEN.
--
-- pg_cron ringer produktionens adress. `nav-dagtid` går bara vardagar
-- ('*/15 5-19 * * 1-5'), så söndagens kvällsnotis 18:00 behöver ett eget anrop.
-- Dagtidsjobbet själv avgör om det är dags (söndag 18:00–21:00 svensk tid) och
-- skickar bara en gång per person och dag (`push_sent`). 15–19 UTC täcker
-- 18:00 svensk tid både sommar och vinter.
select cron.unschedule('nav-dagtid-sondag')
where exists (select 1 from cron.job where jobname = 'nav-dagtid-sondag');

select cron.schedule(
  'nav-dagtid-sondag',
  '*/15 15-19 * * 0',
  $cron$select public.kalla_jobb('/api/jobb/dagtid')$cron$
);
