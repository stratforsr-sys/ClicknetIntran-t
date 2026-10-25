-- 0241 · Granskningen S16 (B13, beställaren 2026-10-23): Adoption är bara Superadmins.
--
-- Superadmin i Nav 2.0 är VD eller administratör (nivaFor i src/lib/nav2/forma.ts).
-- Funktionerna från 0029 släppte också in säljchefen. Bara rollvillkoret ändras;
-- kropparna är i övrigt de som gäller i databasen 2026-10-25 (pg_get_functiondef).
-- Fel roll får noll rader, som förut. Händelseloggen spärras i vyerna (data.ts och
-- /logg), inte i audit_log:s RLS, eftersom Admins egna vyer läser samma tabell.

-- adoption_aktivitet(integer)
CREATE OR REPLACE FUNCTION public.adoption_aktivitet(p_dagar integer DEFAULT 30)
 RETURNS TABLE(dag date, dau integer, wau integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select g.d::date as dag,
         (select count(distinct a.employee_id)::int
            from activity_day a where a.day = g.d::date) as dau,
         (select count(distinct a.employee_id)::int
            from activity_day a
           where a.day <= g.d::date and a.day > g.d::date - 7) as wau
    from generate_series(
           current_date - (greatest(1, least(coalesce(p_dagar, 30), 365)) - 1),
           current_date,
           interval '1 day'
         ) as g(d)
   where public.has_any_role(array['ceo','admin'])
   order by 1
$function$;

-- adoption_glomda_dokument(integer)
CREATE OR REPLACE FUNCTION public.adoption_glomda_dokument(p_dagar integer DEFAULT 90)
 RETURNS TABLE(id uuid, slug text, title text, senast timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select d.id, d.slug, d.title, max(v.last_seen) as senast
    from document d
    left join document_view v on v.document_id = d.id
   where public.has_any_role(array['ceo','admin'])
     and d.status = 'published'
   group by d.id, d.slug, d.title
  having max(v.last_seen) is null
      or max(v.last_seen) < now() - make_interval(days => greatest(1, least(coalesce(p_dagar, 90), 3650)))
   order by senast asc nulls first, d.title
$function$;

-- adoption_sokmissar(integer)
CREATE OR REPLACE FUNCTION public.adoption_sokmissar(p_antal integer DEFAULT 20)
 RETURNS TABLE(q text, antal integer, senast timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select m.q, m.occurrences, m.last_seen
    from search_miss m
   where public.has_any_role(array['ceo','admin'])
   order by m.occurrences desc, m.last_seen desc
   limit greatest(1, least(coalesce(p_antal, 20), 100))
$function$;

-- Rättigheterna som förut: den inloggade anropar dem med sin egen klient.
revoke all on function public.adoption_aktivitet(integer) from public, anon, authenticated;
revoke all on function public.adoption_glomda_dokument(integer) from public, anon, authenticated;
revoke all on function public.adoption_sokmissar(integer) from public, anon, authenticated;
grant execute on function public.adoption_aktivitet(integer) to authenticated, service_role;
grant execute on function public.adoption_glomda_dokument(integer) to authenticated, service_role;
grant execute on function public.adoption_sokmissar(integer) to authenticated, service_role;
