-- 0224 · Företagets underlag: bara avtal, orderbilagor och inspelningar till en order (2026-10-23)
--
-- Granskningen S09 (F1-5), beställarens beslut B5 (2026-10-22): "Företagets
-- underlag i 0170 är avtal, orderbilagor och inspelningar knutna till order,
-- men inte rollspel och coachningsfiler."
--
-- 0170 tog hela `file_object.subject_employee_id` ur `anstalld_raderingsmal()`.
-- Då stod personens inspelade röst i övningssamtal (`roleplay`) och bevisfilerna
-- i coachningen (`coaching`) kvar för alltid efter "Ta bort helt", fast 0170
-- bara motiverade undantaget med inspelningarna och avtalen.
--
-- `anstalld_raderingsmal()` svarar med (tabell, kolumn) och kan inte bära ett
-- villkor på ändamålet, så undantaget står kvar där. I stället väljer
-- `anstalld_filer_utan_underlag()` ut filerna som INTE är underlag, och
-- `ta_bort_anstalld()` raderar dem i ett steg 1b. Allt annat i funktionen är
-- oförändrat: kroppen är hämtad ur pg_proc 2026-10-23 (md5 53230a276602…).
--
-- Underlag, och står alltså kvar:
--   employment_contract                 avtalen
--   call_recording knuten till en order file_object.sales_order_id, samtalets
--                                       sales_order_id, eller ett nummer som står
--                                       på en order (samma hängslen som
--                                       gallraInspelningar() i inspelning-server.ts)
-- Följer med personen:
--   roleplay, coaching, sick_certificate och övriga inspelningar.
--
-- Lagringen: en rad som försvinner lämnar filen kvar i bucketen. `taBortAnstalld`
-- samlar personens filer före anropet och tar bort innehållet för raderna som
-- är borta efteråt (src/lib/personal-radering-server.ts, S09). Det gäller redan
-- utan den här filen för läkarintygen och ärendebilagorna, som går i kaskad.
--
-- KÖRS EFTER BESTÄLLARENS JA (GDPR.md uppgift 5 steg 3). Torrkörd 2026-10-23.

create or replace function public.anstalld_filer_utan_underlag(p_employee uuid)
returns setof uuid
language sql
stable
set search_path = public
as $$
  select f.id
    from file_object f
   where f.subject_employee_id = p_employee
     and f.purpose <> 'employment_contract'
     and not (
       f.purpose = 'call_recording'
       and (
         f.sales_order_id is not null
         or exists (
           select 1 from phone_call c
            where c.recording_file_id = f.id
              and (c.sales_order_id is not null
                   or exists (select 1 from sales_order o where o.contact_phone_e164 = c.counterpart_e164))
         )
       )
     )
$$;

revoke all on function public.anstalld_filer_utan_underlag(uuid) from public, anon, authenticated;
grant execute on function public.anstalld_filer_utan_underlag(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.ta_bort_anstalld(p_employee uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fore    jsonb;
  filer   uuid[];
  namn    text;
  kvar    bigint;
  r       record;
  t       record;
  varv    int;
  rorda   bigint;
  denna   bigint;
begin
  select last_name into namn from employee where id = p_employee;
  if not found then
    raise exception 'Personen finns inte.';
  end if;

  if exists (select 1 from employee where id = p_employee and removed_at is not null) then
    raise exception 'Personen ar redan borttagen.';
  end if;

  -- Vad fanns innan? Efterat gar det inte langre att ta reda pa.
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    into fore
    from referenser_till_anstalld(p_employee) x;

  -- S09 (0224, B5): filerna om personen som inte är företagets underlag.
  -- Räknas ut innan något raderas, eftersom urvalet frågar samtalen och ordrarna.
  filer := array(select public.anstalld_filer_utan_underlag(p_employee));

  -- ---------------------------------------------------------------------------
  -- Sla av sparrtriggrarna.
  --
  -- 29 triggrar gor stamplingar, lonerader, provisionsposter, kundorder,
  -- sjukanmalningar och arendemeddelanden ORUBBLIGA: `time_event_orubblig`,
  -- `payroll_row_last`, `case_message_orubblig` och sallskap. Forsta
  -- provkorningen av den har funktionen dog pa "Ett meddelande kan varken
  -- andras eller tas bort".
  --
  -- DE HAR RATT I ALLT UTOM DET HAR FALLET. Deras arende ar att ingen ska
  -- kunna skriva om historien i efterhand. En radering av en hel person ar
  -- inte en omskrivning — det ar ett medvetet, loggat och namnbekraftat
  -- beslut. Skillnaden ar avsikten, och den kan en trigger inte se.
  --
  -- `disable trigger user` och INTE `session_replication_role = replica`: den
  -- senare slar av aven de frammande nycklarnas egna triggrar, och da skulle
  -- steg 3 kunna radera raden med rader kvar som pekar pa hen. Det ar precis
  -- den kontrollen hela funktionen vilar pa.
  --
  -- DDL ar transaktionell i Postgres. Faller nagot har nedanfor rullas bade
  -- raderingen och avstangningen tillbaka — det finns inget lage dar
  -- triggrarna blir kvar avslagna.
  -- ---------------------------------------------------------------------------
  for t in
    select distinct conrelid::regclass::text as tab
    from pg_constraint
    where contype = 'f' and confrelid = 'public.employee'::regclass
    union select 'employee'
  loop
    execute format('alter table %s disable trigger user', t.tab);
  end loop;

  -- 1 · Personens egna rader.
  --
  -- Snurran gar flera varv for `time_event`, som pekar pa SIG SJALV: en
  -- rattelse pekar pa stampeln den rattar, och kedjan kan vara langre an ett
  -- steg. Varje radering ligger i ett eget block som slukar en nyckelkrock och
  -- later nasta varv forsoka igen, sa att ordningen mellan tabellerna inte
  -- spelar nagon roll — och sa att en framtida tabell som beror pa en annan
  -- loser sig sjalv i stallet for att falla pa att den har filen ar aldre.
  for varv in 1..10 loop
    rorda := 0;
    for r in select tabell, kolumn from anstalld_raderingsmal() loop
      begin
        execute format('delete from %s where %I = $1', r.tabell, r.kolumn)
          using p_employee;
        get diagnostics denna = row_count;
        rorda := rorda + denna;
      exception when foreign_key_violation then
        null;  -- nasta varv
      end;
    end loop;
    exit when rorda = 0;
  end loop;

  -- 1b · S09 (0224, B5): rollspel, coachningsfiler, läkarintyg och inspelningar
  -- som inte hör till en order följer med personen. Avtal och inspelningar till
  -- en order står kvar (0170). Innehållet i lagringen tas bort av anroparen
  -- efteråt (personal-radering-server.ts), för databasen når inte lagringen.
  delete from file_object where id = any(filer);

  -- 2 · Star nagot kvar som pekar pa hen?
  select count(*) into kvar from referenser_till_anstalld(p_employee);

  if kvar = 0 then
    -- 3a · Ingenting. Personen kan forsvinna helt.
    delete from employee where id = p_employee;
  else
    -- 3b · Foretaget behover raden. Kvar star namnet, ingenting annat.
    --
    -- `email` ar not null och unik, sa den kan inte nollstallas. `.invalid` ar
    -- reserverat av RFC 2606 och kan aldrig sla upp mot en riktig adress —
    -- ingen kan av misstag mejla en skylt.
    update employee
       set last_name           = namn || ' (borttagen anställd)',
           email               = 'borttagen-' || p_employee || '@clicknet.invalid',
           auth_user_id        = null,
           team_id             = null,
           manager_id          = null,
           employee_number     = null,
           birth_year          = null,
           last_sign_in_at     = null,
           start_date          = null,
           inactive_flagged_at = null,
           status              = 'offboarded',
           removed_at          = now()
     where id = p_employee;
  end if;

  -- 4 · Sparrtriggrarna tillbaka pa.
  for t in
    select distinct conrelid::regclass::text as tab
    from pg_constraint
    where contype = 'f' and confrelid = 'public.employee'::regclass
    union select 'employee'
  loop
    execute format('alter table %s enable trigger user', t.tab);
  end loop;

  return jsonb_build_object(
    'raderades_helt', kvar = 0,
    'kvarvarande',    kvar,
    'fore',           fore
  );
end;
$function$;

revoke all on function public.ta_bort_anstalld(uuid) from public, anon, authenticated;
grant execute on function public.ta_bort_anstalld(uuid) to service_role;
