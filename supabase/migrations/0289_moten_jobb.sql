-- Möten: jobbet för påminnelserna efter mötet och reparationen av mötesprovisionens låsning.
--
-- `kalla_jobb()` (0059) ringer /api/jobb/moten med hemligheten ur Vault. Rutten skickar notiserna "Utfall saknas"
-- och "Väntar på bedömning" (hållaren samma dag efter påminnelsetiden, admins två kalenderdagar efter) och låser
-- mötesprovisionen för möten vars utfall sattes men vars låsning aldrig gick igenom. Bara notiser, aldrig mejl.
--
-- VAR FEMTONDE MINUT, dygnet runt: påminnelsetiden (`moten.utfall-paminnelse`) är en inställning per företag och
-- tidszonen likaså, så ett fast klockfönster hade bara passat en installation. Spärren mot dubbla notiser ligger i
-- jobbet (en notis per källa, möte, kalenderdag och mottagare), inte i schemat.
--
-- KÖRS EFTER att rutten är deployad: ett anrop mot en rutt som inte finns ger 404 i pg_net och inget annat.

select cron.unschedule('nav-moten')
where exists (select 1 from cron.job where jobname = 'nav-moten');

select cron.schedule(
  'nav-moten',
  '*/15 * * * *',
  $cron$select public.kalla_jobb('/api/jobb/moten')$cron$
);
