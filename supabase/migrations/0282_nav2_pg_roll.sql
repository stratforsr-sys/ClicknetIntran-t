-- =============================================================================
-- 0282_nav2_pg_roll.sql — en egen inloggningsroll för Nav 2.0:s direkta
-- läsningar (NAV2_PG_URL)
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Produktionsprovet 2026-10-30, gul 4. NAV2_PG_URL loggade in som postgres,
-- som har BYPASSRLS, CREATEROLE och rätt till allt i auth, vault och cron. RLS
-- gällde bara tack vare `set local role` i pgrest.ts. En framtida fråga utan
-- roll hade fått all data, och en läckt adress hade gett hela databasen.
--
-- nav2_pg loggar in, men ärver ingenting (NOINHERIT): utan `set local role`
-- når den inga tabeller alls. Med `set local role authenticated` gäller RLS
-- som förut, och `service_role` är samma behörighet som navets service
-- role-nyckel redan har. Inget mer.
--
-- search_path är densamma som postgres har, så att frågorna hittar samma
-- funktioner (`extensions`).
--
-- Lösenordet står inte här. Det sätts för sig med `alter role … password`
-- och ligger bara i Vercel (NAV2_PG_URL) och i ~/.clicknet. Rollen skapades
-- 2026-11-02 före mergen (beställarens ja till gul 4); filen gör ingenting
-- mot produktionen, men en ny databas får samma roll.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'nav2_pg') then
    create role nav2_pg login noinherit nobypassrls nocreatedb nocreaterole;
  else
    alter role nav2_pg login noinherit nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

alter role nav2_pg set search_path = "$user", public, extensions;

grant authenticated, service_role to nav2_pg;
