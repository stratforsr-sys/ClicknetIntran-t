-- =============================================================================
-- 0005_steg2_via_epost.sql — steg tva byts fran TOTP till kod via e-post
--
-- Beslutet ar verksamhetens, inte teknikens: en app att skanna var for
-- omstandligt. Konsekvensen ar att aterstallningskoderna forlorar sin mening.
-- De fanns for det enda fall som e-post inte har — en tappad telefon. Den som
-- tappar tillgangen till sin brevlada aterstaller den hos e-postleverantoren,
-- inte har.
--
-- Tabellen togs i bruk samma dag och innehaller darfor inga koder som nagon
-- forlitar sig pa. Hade den varit i drift langre hade den fatt sta kvar tom
-- tills sista listan gatt ut.
-- =============================================================================

drop table if exists mfa_recovery_code;
