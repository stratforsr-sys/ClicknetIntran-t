-- =============================================================================
-- 0059 — DAGTIDSJOBBET: databasen ringer upp navet var kvart
--
-- =============================================================================
-- VARFÖR SCHEMAT LIGGER HÄR OCH INTE I `vercel.json`
--
-- Vercels Hobby-plan tar TVÅ cron-poster per projekt och kör var och en EN gång
-- per dygn. Båda är upptagna sedan tidigare: nattjobbet 02:30 och morgonbrevet
-- 05:30 UTC.
--
-- Det går alltså inte att lägga till en tredje post — och att försöka är värre
-- än att låta bli. Den 2026-09-08 deklarerades tre poster, och följden var inte
-- ett felmeddelande utan att INGEN AV DE TRE KÖRDES. En instämpling stod öppen
-- i två dygn innan någon märkte något, för ett schemalagt jobb som uteblir ser
-- exakt likadant ut som ett som inte hade något att göra. Rubriken i
-- `src/app/api/jobb/natt/route.ts` står kvar som varning.
--
-- En post som kör en gång per dygn hade dessutom inte räckt här. Påminnelsen
-- "du har inte stämplat in" måste komma en kvart efter att skiftet började, och
-- skiften börjar olika tider för olika personer och veckodagar.
--
-- LÖSNINGEN ÄR ATT DATABASEN RINGER UPP. `pg_cron` schemalägger, `pg_net`
-- ringer, och båda ligger i Supabase utan extra kostnad och utan att röra
-- Vercels kvot. Schemat hamnar dessutom i samma databas som datan det bevakar.
--
-- =============================================================================
-- HEMLIGHETEN STÅR INTE I DEN HÄR FILEN, OCH FÅR ALDRIG GÖRA DET
--
-- Jobbrutten kräver `Authorization: Bearer <CRON_SECRET>`. Skrevs värdet här
-- hade det legat i klartext i git för alltid — och en hemlighet som en gång
-- committats är läckt även efter att den tagits bort, eftersom historiken står
-- kvar.
--
-- Den ligger i stället i Supabase Vault, krypterad, och läses vid varje anrop.
-- Migrationen SÄTTER INTE värdet; den skapar bara maskineriet. Värdet läggs in
-- en gång för hand:
--
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret',
--                              'Bearer-token för /api/jobb/*');
--
-- Saknas hemligheten gör funktionen ingenting och skriver en rad i loggen. Det
-- är med flit: ett jobb som faller var kvart fyller loggen med brus, och ett
-- jobb som låtsas lyckas är värre än ett som säger att det inte kan köra.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- Navets adress. En tabell och inte en konstant i funktionen, så att previewen
-- eller en flyttad domän går att peka om utan en ny migration.
-- -----------------------------------------------------------------------------
create table if not exists job_target (
  id         boolean primary key default true check (id),
  base_url   text not null check (base_url ~ '^https://'),
  updated_at timestamptz not null default now()
);

comment on table job_target is
  'Adressen pg_cron ringer. En enda rad — `id` är låst till true av check-villkoret.';

insert into job_target (id, base_url)
values (true, 'https://clicknet-nav.vercel.app')
on conflict (id) do nothing;

-- Ingen RLS-policy, och tabellen är inte läsbar för vanliga roller: den anropas
-- bara av funktionen nedan, som kör security definer.
alter table job_target enable row level security;

-- -----------------------------------------------------------------------------
-- Uppringningen
-- -----------------------------------------------------------------------------
create or replace function public.kalla_jobb(p_sokvag text)
returns void
language plpgsql
security definer
set search_path = public, vault, net, pg_temp
as $$
declare
  v_secret text;
  v_bas    text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_secret is null or btrim(v_secret) = '' then
    raise warning 'kalla_jobb(%): hemligheten cron_secret saknas i vault — anropet hoppas över', p_sokvag;
    return;
  end if;

  select base_url into v_bas from job_target where id limit 1;

  if v_bas is null then
    raise warning 'kalla_jobb(%): ingen rad i job_target', p_sokvag;
    return;
  end if;

  -- `net.http_post` lägger anropet i en kö och återvänder direkt. Jobbet som
  -- svarar kan alltså ta minuter utan att blockera cron-körningen, och utan att
  -- två körningar hinner trampa på varandra — spärren mot dubbletter ligger i
  -- jobbet självt (`notification_event` för dagens påminnelser).
  perform net.http_post(
    url     := v_bas || p_sokvag,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_secret,
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

comment on function public.kalla_jobb(text) is
  'Ringer upp en jobbrutt i navet med CRON_SECRET ur Vault. Tyst no-op när hemligheten saknas.';

revoke all on function public.kalla_jobb(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Schemat
--
-- VAR FEMTONDE MINUT, inte varje minut. Påminnelsen har femton minuters
-- tolerans inbyggd (`TOLERANS_MINUTER` i `jobb/dagtid.ts`), så en upplösning
-- finare än så ger fler anrop utan att någon får veta något tidigare.
--
-- 05–19 UTC täcker svensk arbetsdag året om: 06–20 på vintern, 07–21 på
-- sommaren. Utanför det finns inga skift att påminna om, och ett anrop som
-- säkert inte har något att göra är ett anrop som inte behöver göras.
-- -----------------------------------------------------------------------------
select cron.unschedule('nav-dagtid')
where exists (select 1 from cron.job where jobname = 'nav-dagtid');

select cron.schedule(
  'nav-dagtid',
  '*/15 5-19 * * 1-5',
  $cron$select public.kalla_jobb('/api/jobb/dagtid')$cron$
);
