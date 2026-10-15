-- 0084 · Kampanjsidornas läge, per kund (Nav 2.0, 2026-10-15)
--
-- Kundkortet visar för kampanjsidan: senaste svaret och svarstiden, när den
-- senast kollades, sedan när den inte svarat, och de sju senaste dagarna (uppe
-- hela dagen eller nere i perioder). Kontrollerna i `landing_page_check` (0083)
-- blir 144 rader per kund och dygn, och PostgREST lämnar ut högst 1 000 rader
-- per fråga. Därför räknas läget här, en rad per kund.
--
-- SECURITY INVOKER: läsregeln i 0083 gäller, så var och en får läget för de
-- kunder hon ser en order på — inget mer.

create function public.kampanjsidor_lage()
returns table (
  org_number text,
  url text,
  checked_at timestamptz,
  ok boolean,
  ms integer,
  status_code integer,
  error text,
  nere_sedan timestamptz,
  dagar jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.org_number, p.url, s.checked_at, s.ok, s.ms, s.status_code, s.error,
         case when s.ok = false then (
           select min(c.checked_at) from public.landing_page_check c
            where c.org_number = p.org_number
              and c.checked_at > coalesce((select max(c2.checked_at) from public.landing_page_check c2
                                            where c2.org_number = p.org_number and c2.ok), '-infinity'::timestamptz)
         ) end,
         coalesce((
           select jsonb_object_agg(d.dag, d.alla_ok)
             from (select (c.checked_at at time zone 'Europe/Stockholm')::date::text as dag, bool_and(c.ok) as alla_ok
                     from public.landing_page_check c
                    where c.org_number = p.org_number
                      and c.checked_at >= now() - interval '7 days'
                    group by 1) d
         ), '{}'::jsonb)
    from public.landing_page p
    left join lateral (
      select c.checked_at, c.ok, c.ms, c.status_code, c.error
        from public.landing_page_check c
       where c.org_number = p.org_number
       order by c.checked_at desc
       limit 1
    ) s on true
$$;
revoke all on function public.kampanjsidor_lage() from public;
grant execute on function public.kampanjsidor_lage() to authenticated;
