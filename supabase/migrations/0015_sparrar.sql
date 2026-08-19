-- =============================================================================
-- 0015_sparrar.sql — spärrarna flyttar från en kodkonstant till databasen
--
-- Fram till nu har K12 varit en kommentar i `src/lib/tid.ts` och en konstant
-- någon måste komma ihåg att ändra. Det fungerar precis så länge personen som
-- skrev kommentaren finns kvar och läser den.
--
-- Nu är spärren en spärr. `compliance_gate` bär läget, och en trigger vägrar
-- slå på raststämplingen förrän tre saker FAKTISKT finns i databasen:
--
--   K12  ett publicerat dokument av typen `interest_assessment` med ett datum
--        i `decided_on` — "skriven och daterad", inte "påbörjad"
--   K14  ett publicerat dokument av typen `staff_information` som varje aktiv
--        anställd har kvitterat. Förhandsinformation som ingen läst är ingen
--        förhandsinformation
--   K29  minst ett rastschema upplagt — det dokumenterade rastschemat enligt
--        ATL 15 §
--
-- Villkoren ligger här och inte i koden av samma skäl som AC-2.3: navets alla
-- skrivningar sker med service role, som går förbi varje rättighet. En regel
-- som bara finns i en server action är en regel som gäller tills någon skriver
-- en annan server action.
--
-- In- och utstämpling har inga sådana villkor. Den vilar på anställningsavtalet
-- och arbetstidslagen, slogs på 2026-08-17, och seedas därför som påslagen.
-- =============================================================================

alter table document add column if not exists decided_on date;

comment on column document.decided_on is
  'Datum då dokumentet beslutades och undertecknades. Krävs för K12: en '
  'intresseavvägning utan datum går inte att åberopa i efterhand.';

alter table document drop constraint if exists document_doc_type_check;
alter table document add constraint document_doc_type_check check (
  doc_type in ('routine','policy','work_env_policy','risk_assessment',
               'task_allocation','script','price_list','case',
               'interest_assessment','staff_information')
);

create table if not exists compliance_gate (
  key         text primary key check (key in ('stampling','raststampling')),
  title       text not null,
  enabled     boolean not null default false,
  enabled_at  timestamptz,
  enabled_by  uuid references employee(id),

  -- Bevisen. Null tills dokumenten finns.
  interest_assessment_id uuid references document(id),
  staff_information_id   uuid references document(id),

  note        text,
  updated_at  timestamptz not null default now(),

  -- Tidpunkten kravs alltid. `enabled_by` far vara null i exakt ett fall: den
  -- rad som seedas har i migrationen, dar det inte finns nagon inloggad att
  -- tillskriva. Null betyder darfor "satt vid driftsattningen", och att det
  -- syns ar battre an att peka ut en godtycklig person.
  constraint compliance_gate_paslag check (
    (enabled = false) or (enabled_at is not null)
  )
);

insert into compliance_gate (key, title, enabled, enabled_at, note)
select * from (values
  ('stampling', 'In- och utstämpling', true, now(),
   'Vilar på anställningsavtalet och arbetstidslagens krav på förda anteckningar. Påslagen 2026-08-17.'),
  ('raststampling', 'Raststämpling och rastavvikelser', false, null::timestamptz,
   'Kräver K12 daterad, K14 kvitterad av alla aktiva och minst ett rastschema (K29).')
) as v(key, title, enabled, enabled_at, note)
where not exists (select 1 from compliance_gate);

-- -----------------------------------------------------------------------------
-- Vad som saknas, som data. Samma funktion driver både triggern och vyn, så
-- att listan chefen läser är exakt den lista som spärren dömer efter — inte en
-- kopia som hinner glida isär.
-- -----------------------------------------------------------------------------
create or replace function public.sparr_saknas(p_key text)
returns text[]
language plpgsql
stable
as $$
declare
  rad       compliance_gate%rowtype;
  saknas    text[] := '{}';
  okvitterade int;
  raster    int;
begin
  select * into rad from compliance_gate where key = p_key;
  if not found then
    return array['Spärren finns inte.'];
  end if;

  if p_key <> 'raststampling' then
    return saknas;
  end if;

  -- K12
  if rad.interest_assessment_id is null then
    saknas := saknas || 'K12: ingen intresseavvägning är kopplad.';
  else
    if not exists (
      select 1 from document d
       where d.id = rad.interest_assessment_id
         and d.status = 'published'
         and d.doc_type = 'interest_assessment'
    ) then
      saknas := saknas || 'K12: intresseavvägningen är inte publicerad.';
    end if;

    if not exists (
      select 1 from document d
       where d.id = rad.interest_assessment_id and d.decided_on is not null
    ) then
      saknas := saknas || 'K12: intresseavvägningen saknar beslutsdatum.';
    end if;
  end if;

  -- K14
  if rad.staff_information_id is null then
    saknas := saknas || 'K14: ingen förhandsinformation är kopplad.';
  else
    if not exists (
      select 1 from document d
       where d.id = rad.staff_information_id
         and d.status = 'published'
         and d.doc_type = 'staff_information'
    ) then
      saknas := saknas || 'K14: förhandsinformationen är inte publicerad.';
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
        saknas := saknas || format('K14: %s anställda har inte kvitterat informationen.', okvitterade);
      end if;
    end if;
  end if;

  -- K29
  select count(*) into raster from scheduled_break;
  if raster = 0 then
    saknas := saknas || 'K29: inget rastschema är upplagt.';
  end if;

  return saknas;
end;
$$;

create or replace function public.compliance_gate_far_slas_pa()
returns trigger
language plpgsql
as $$
declare
  saknas text[];
begin
  if tg_op = 'DELETE' then
    raise exception 'En spärr tas inte bort. Slå av den i stället.';
  end if;

  new.updated_at := now();

  -- Att slå AV går alltid. En spärr ska aldrig vara svårare att stänga än att
  -- öppna: den dag något visar sig fel ska vägen tillbaka vara ett klick.
  if new.enabled = false or old.enabled = true then
    return new;
  end if;

  -- Ett paslag i drift ar alltid nagons beslut. Undantaget ovan galler bara
  -- raden som redan foddes pasla­gen i migrationen.
  if new.enabled_by is null or new.enabled_at is null then
    raise exception 'Ett påslag kräver både vem och när.';
  end if;

  saknas := public.sparr_saknas(new.key);
  if array_length(saknas, 1) > 0 then
    raise exception 'Spärren kan inte slås på. Detta saknas: %', array_to_string(saknas, ' ');
  end if;

  return new;
end;
$$;

drop trigger if exists compliance_gate_paslag on compliance_gate;
create trigger compliance_gate_paslag
  before update or delete on compliance_gate
  for each row execute function public.compliance_gate_far_slas_pa();

-- -----------------------------------------------------------------------------
-- Behörighet. Läget är inte hemligt — tvärtom: att alla kan se vad som är
-- påslaget och på vilken grund är själva poängen med öppenhet kring
-- övervakning. Att ÄNDRA det gör bara servern, med service role.
-- -----------------------------------------------------------------------------
alter table compliance_gate enable row level security;

drop policy if exists compliance_gate_read on compliance_gate;
create policy compliance_gate_read on compliance_gate for select
  to authenticated using (true);
