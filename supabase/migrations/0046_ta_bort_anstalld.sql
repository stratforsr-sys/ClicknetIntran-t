-- =============================================================================
-- 0046_ta_bort_anstalld.sql
--
-- Navet har aldrig kunnat ta bort en anstalld. `offboarda` satter status,
-- aterkallar roller och bannlyser kontot — personen star kvar i /personal med
-- flit, eftersom historiken ska finnas kvar. Det ar ratt for nagon som slutat.
--
-- Det ar fel for nagon som lades upp av misstag eller aldrig borjade. Harris
-- Menduza lades upp 2026-08-27, loggade aldrig in en enda gang och
-- offboardades en vecka senare. Han star kvar i personallistan for alltid.
--
-- =============================================================================
-- TVA UTFALL, OCH DATABASEN AVGOR VILKET
--
-- 1. INGENTING PEKAR PA PERSONEN nar hens egna rader ar borta. Da raderas
--    raden helt. Personen har aldrig funnits i nagot annat an sin egen post.
--    Det ar Harris fall.
--
-- 2. NAGOT PEKAR PA PERSONEN — en signerad kundorder hen godkande, en
--    attesterad loneperiod, en provisionsperiod hen stangde. Da BEHALLS raden,
--    men toms: kvar star bara namnet, med tillagget "(borttagen anstalld)".
--
-- Utfall 2 ar inte en halvmesyr utan det enda mojliga. Femton CHECK-villkor
-- kopplar ihop "vem gjorde det" med en status:
--
--     sales_order_provision_satt:
--       status signerad/betald  =>  approved_by IS NOT NULL
--     payroll_period_attest:
--       status attested         =>  attested_by IS NOT NULL
--
-- Pekaren gar alltsa inte att nollstalla, och raden gar inte att radera utan
-- att ta med sig en hel manads lonekorning for alla andra. Att behalla en
-- namnskylt ar det enda som later BADE personens egna uppgifter forsvinna OCH
-- foretagets bokforing sta kvar giltig.
--
-- =============================================================================
-- SKYLTEN AR EN VANLIG `offboarded`-RAD, OCH DET AR AVSIKTLIGT
--
-- 99 stallen i koden laser ur `employee`. 26 av dem ar valjare och nattjobb
-- som redan filtrerar bort `offboarded`, och resten filtrerar positivt pa
-- `active` eller `onboarding`. En skylt med status `offboarded` ar darfor
-- osynlig i varenda valjare fran dag ett, utan att en rad kod rors.
--
-- TILLAGGET SKRIVS IN I `last_name` och inte i en vy eller en hjalpfunktion.
-- Bara en brakdel av de 99 stallena gar via `fullName()` — resten skarvar ihop
-- `first_name` och `last_name` for hand. Ett tillagg som bara syns i en
-- hjalpfunktion hade darfor synts pa vissa sidor och inte pa andra, vilket ar
-- varre an inget tillagg alls.
--
-- `removed_at` finns for logiken: den ar det maskinlasbara beskedet, och den
-- ar det `aktivera` och `aterstallLosenord` fragar for att vagra vacka en
-- skylt till liv.
-- =============================================================================

alter table employee add column if not exists removed_at timestamptz;

comment on column employee.removed_at is
  'Satt = raden ar en namnskylt efter en radering. Alla personuppgifter ar borta.';

-- -----------------------------------------------------------------------------
-- Vad som raderas med personen.
--
-- `on delete cascade` ar schemats EGEN markering av "den har raden dor med
-- personen" — roller, behorigheter, notiser, kursframsteg, guideframsteg,
-- dokumentkvittenser, kalenderfloden, certifikat. Den listan behover inte
-- skrivas for hand, den finns redan i pg_constraint.
--
-- Till den laggs arbetstiden. `time_event` och `work_time_journal` ar inte
-- kaskader — de ar orubbliga med flit, sa att ingen ska kunna redigera bort en
-- stampling i efterhand. Men de ar personens egna, och bestallaren har
-- uttryckligen sagt att de ska med.
--
-- ALLT ANNAT BEHALLS och pekar vidare pa skylten: order, loneperioder,
-- provision, lonerader, intakter, dokument, nyheter, arenden, coachning och
-- rekrytering ar foretagets rader, inte personens.
-- -----------------------------------------------------------------------------
create or replace function anstalld_raderingsmal()
returns table (tabell text, kolumn text)
language sql
stable
set search_path = public
as $$
  select c.conrelid::regclass::text, a.attname::text
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and c.confrelid = 'public.employee'::regclass
    and array_length(c.conkey, 1) = 1
    and c.confdeltype = 'c'
  union
  values ('time_event', 'employee_id'), ('work_time_journal', 'employee_id')
$$;

-- -----------------------------------------------------------------------------
-- Vad pekar pa personen, och vad hander med det?
--
-- Granssnittet visar den har listan innan chefen bekraftar. Den ar hela skalet
-- till att funktionen finns: valet ska vara ett val, inte en overraskning.
-- -----------------------------------------------------------------------------
create or replace function referenser_till_anstalld(p_employee uuid)
returns table (tabell text, kolumn text, antal bigint, atgard text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n bigint;
  mal boolean;
begin
  for r in
    select c.conrelid::regclass::text as tab, a.attname::text as kol
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.employee'::regclass
      and array_length(c.conkey, 1) = 1
    order by 1, 2
  loop
    execute format('select count(*) from %s where %I = $1', r.tab, r.kol)
      into n using p_employee;
    continue when n = 0;

    select exists (
      select 1 from anstalld_raderingsmal() m
      where m.tabell = r.tab and m.kolumn = r.kol
    ) into mal;

    tabell := r.tab;
    kolumn := r.kol;
    antal  := n;
    atgard := case when mal then 'raderas' else 'behalls' end;
    return next;
  end loop;
end;
$$;

comment on function referenser_till_anstalld(uuid) is
  'Vad pekar pa en anstalld och vad hander med det vid en radering. Lases ur pg_constraint.';

-- -----------------------------------------------------------------------------
-- Radera personen.
-- -----------------------------------------------------------------------------
create or replace function ta_bort_anstalld(p_employee uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fore    jsonb;
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
$$;

comment on function ta_bort_anstalld(uuid) is
  'Raderar en anstalld. Raden forsvinner helt om inget pekar pa den, annars blir den en namnskylt.';

-- -----------------------------------------------------------------------------
-- Granter.
--
-- Se 0027: `revoke ... from anon, authenticated` racker INTE, eftersom Postgres
-- ger EXECUTE till PUBLIC som standard och `authenticated` ar en del av PUBLIC.
-- Det ar PUBLIC som maste av.
--
-- Funktionerna ar security definer, gar forbi RLS och slar av sparrtriggrar.
-- Den som far anropa dem far radera vem som helst — behorighetsregeln ligger i
-- server action:en, och den ar bara vard nagot om vagen hit ar stangd for alla
-- andra.
-- -----------------------------------------------------------------------------
revoke all on function anstalld_raderingsmal()               from public, anon, authenticated;
revoke all on function referenser_till_anstalld(uuid)        from public, anon, authenticated;
revoke all on function ta_bort_anstalld(uuid)                from public, anon, authenticated;

grant execute on function anstalld_raderingsmal()            to service_role;
grant execute on function referenser_till_anstalld(uuid)     to service_role;
grant execute on function ta_bort_anstalld(uuid)             to service_role;
