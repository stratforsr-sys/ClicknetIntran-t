-- =============================================================================
-- 0051_personlig_malgrupp.sql — dokument riktade till utpekade personer
--
-- Malgruppen har hittills bara kunnat uttryckas som ROLLER och TEAM (0003). Det
-- racker for en rutin som galler alla saljare, men inte for ett MANUS som ar
-- skrivet at en enda person: den minsta malgrupp som gick att traffa var
-- "saljarna i team X". `audience_employees` ar den saknade precisionen.
--
-- ===========================================================================
-- UTPEKADE PERSONER ERSATTER ROLL- OCH TEAMVILLKORET. De skars inte ihop med
-- det.
--
-- Skalet ar att den som skrivit ett namn redan har svarat pa den fraga roller
-- finns for att svara pa. Med ett OCH mellan leden hade ett manus tilldelat
-- Anna forsvunnit ur hennes vy den dag hon bytte roll — utan att nagon rort
-- dokumentet, och utan att nagot syntes. Det ar den tystaste sortens fel:
-- ingenting gar sonder, en person slutar bara se sin egen text.
--
-- Foljden ar att `audience_roles` blir verkningslos sa lange nagon person star
-- utpekad. Redaktorn sager det rakt ut i formuläret i stallet for att lata
-- kryssen se ut att gora nagot de inte gor.
-- ===========================================================================
--
-- LEDNINGEN OCH AGAREN SER FORTFARANDE ALLT. Oforandrat och med flit:
-- granskningsansvaret i AC-5.1 gar inte att utova over dokument man inte far
-- se, och ett personligt manus ar inte en hemlighet mot den som ansvarar for
-- att innehallet stammer. "Bara en person" betyder alltsa "bara en person
-- utover dem som redan ser varje dokument i navet".
-- =============================================================================

alter table document
  add column if not exists audience_employees uuid[] not null default '{}';

comment on column document.audience_employees is
  'Utpekade mottagare. Tom = ingen personstyrning, da galler audience_roles/teams. Icke-tom ERSATTER dem.';

-- =============================================================================
-- Malgruppsstyrning med tre led
--
-- En OVERLAGRING och inte en andring av tvaargumentsversionen: den anvands ocksa
-- av `news_post` (0018) och `course` (0007), som inte har nagon personkolumn.
-- =============================================================================

create or replace function public.matches_audience(
  p_roles     text[],
  p_teams     uuid[],
  p_employees uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when cardinality(coalesce(p_employees, '{}'::uuid[])) > 0 then
      -- Tva tomma listor betyder "alla" i tvaargumentsversionen, sa anropet ar
      -- ingen formalitet: det ar DAR losenordssparren sitter (0017). Skrevs
      -- villkoret ut har i stallet hade sparren funnits pa tva stallen, och den
      -- ena hade forr eller senare slutat folja med den andra.
      public.matches_audience('{}'::text[], '{}'::uuid[])
      and public.current_employee_id() = any(p_employees)
    else
      public.matches_audience(p_roles, p_teams)
  end
$$;

-- Samma policy som i 0003, med tredje ledet inlagt. Skrivs om i sin helhet och
-- inte som ett tillagg: villkoret ska ga att lasa pa ett stalle.
drop policy if exists document_read on document;
create policy document_read on document for select
  to authenticated
  using (
    (status = 'published'
      and public.matches_audience(audience_roles, audience_teams, audience_employees))
    or owner_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager','admin','ceo'])
  );
