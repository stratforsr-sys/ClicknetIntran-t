-- =============================================================================
-- 0016_sparr_saknas_ratta.sql — `saknas || 'text'` var tvetydigt
--
-- I 0015 byggdes listan med `saknas := saknas || 'K12: ...'`. Postgres har både
-- array_cat(text[], text[]) och array_append(text[], text), och en naken
-- strängliteral är av typen `unknown` — så planeraren valde array_cat och
-- försökte tolka meningen som en arrayliteral:
--
--   malformed array literal: "K12: ingen intresseavvägning är kopplad."
--
-- Följden var värre än ett fel i en vy: funktionen kastade i stället för att
-- svara, och den anropas från triggern som ska hålla raststämplingen stängd.
-- En spärr som kraschar är en spärr som ingen vet läget på.
--
-- Rättat med array_append och uttrycklig ::text. Funnet av provkörningen som
-- försökte slå på spärren utan underlag — vilket är precis vad den skulle göra.
-- =============================================================================

create or replace function public.sparr_saknas(p_key text)
returns text[]
language plpgsql
stable
as $$
declare
  rad         compliance_gate%rowtype;
  saknas      text[] := '{}';
  okvitterade int;
  raster      int;
begin
  select * into rad from compliance_gate where key = p_key;
  if not found then
    return array['Spärren finns inte.'::text];
  end if;

  if p_key <> 'raststampling' then
    return saknas;
  end if;

  -- K12: skriven OCH daterad. Ett utkast är inte en avvägning.
  if rad.interest_assessment_id is null then
    saknas := array_append(saknas, 'K12: ingen intresseavvägning är kopplad.'::text);
  else
    if not exists (
      select 1 from document d
       where d.id = rad.interest_assessment_id
         and d.status = 'published'
         and d.doc_type = 'interest_assessment'
    ) then
      saknas := array_append(saknas, 'K12: intresseavvägningen är inte publicerad.'::text);
    end if;

    if not exists (
      select 1 from document d
       where d.id = rad.interest_assessment_id and d.decided_on is not null
    ) then
      saknas := array_append(saknas, 'K12: intresseavvägningen saknar beslutsdatum.'::text);
    end if;
  end if;

  -- K14: förhandsinformation som ingen läst är ingen förhandsinformation.
  if rad.staff_information_id is null then
    saknas := array_append(saknas, 'K14: ingen förhandsinformation är kopplad.'::text);
  else
    if not exists (
      select 1 from document d
       where d.id = rad.staff_information_id
         and d.status = 'published'
         and d.doc_type = 'staff_information'
    ) then
      saknas := array_append(saknas, 'K14: förhandsinformationen är inte publicerad.'::text);
    else
      select count(*) into okvitterade
        from employee e
       where e.status = 'active'
         and not exists (
           select 1 from document_ack a
            where a.document_id = rad.staff_information_id
              and a.employee_id = e.id
              and a.version = (select version from document where id = rad.staff_information_id)
         );

      if okvitterade > 0 then
        saknas := array_append(
          saknas,
          format('K14: %s anställda har inte kvitterat informationen.', okvitterade)::text
        );
      end if;
    end if;
  end if;

  -- K29: dokumenterat rastschema enligt ATL 15 §.
  select count(*) into raster from scheduled_break;
  if raster = 0 then
    saknas := array_append(saknas, 'K29: inget rastschema är upplagt.'::text);
  end if;

  return saknas;
end;
$$;
