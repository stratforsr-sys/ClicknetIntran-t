-- VÄNTAR · Fel: förekomsterna (hör till 0082, körs när beställaren sagt ja för Fel)
--
-- `registrera_fel` gör exakt det den gjort sedan 0026 och skriver dessutom en
-- rad i `error_occurrence`: vilken rapport, vem (om någon var inloggad) och
-- när. Det ger Nav 2.0:s staplar med träffar per dag och "N personer".
--
-- FÖREKOMSTEN FÅR ALDRIG FÄLLA RAPPORTEN. Raden skrivs i ett eget block som
-- sväljer sitt fel, av samma skäl som `skrivFel()` aldrig kastar: ett fel i
-- felrapporteringen är det värsta stället att ha en bugg på.
--
-- Signaturen är oförändrad, så `skrivFel()` och nattjobbet anropar den som
-- förut. Kör med apply-sql.mjs som en vanlig migration (ge den nästa lediga
-- nummer ur schema_migrations när den körs).

create or replace function public.registrera_fel(
  p_digest text,
  p_path text,
  p_message text default null,
  p_stack text default null,
  p_reporter uuid default null,
  p_user_agent text default null,
  p_release text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.error_report
    (kind, digest, path, message, stack, reporter_id, user_agent, release)
  values
    ('automatic', p_digest, p_path, p_message, p_stack, p_reporter, p_user_agent, p_release)
  on conflict (digest, path) where kind = 'automatic'
  do update set
    occurrences  = error_report.occurrences + 1,
    last_seen_at = now(),
    message      = coalesce(error_report.message, excluded.message),
    stack        = coalesce(error_report.stack, excluded.stack),
    release      = coalesce(excluded.release, error_report.release)
  returning id into v_id;

  begin
    insert into public.error_occurrence (error_id, employee_id) values (v_id, p_reporter);
  exception when others then
    null;
  end;
end;
$$;
