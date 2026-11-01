-- Utskicksloggen och notisernas öppning (beställaren 2026-11-01, notiströttheten).
--
-- Fram till nu visste Nav vad som stod i klockan (`notification_event`) men
-- inte vad som faktiskt GICK UT: mejlen gick direkt till Resend och pushen
-- direkt till Google och Apple, utan något spår här. Resend-nyckeln är
-- send-only, så deras logg går inte heller att läsa i efterhand. Utan spår går
-- det inte att mäta om en ändring av utskicken hjälpte, och det var just det
-- undersökningen om notiströtthet kom fram till: logga först.
--
-- TVÅ SAKER:
--
--   notification_delivery  en rad per utskick som försökte gå ut: varje mejl
--                          (händelsemejl, morgonbrev, inloggningskod, utkorg,
--                          rekrytering, välkomstbrev) och varje push till en
--                          enhet. Skrivs av `epost.ts` och `nav2/push.ts`, där
--                          ALLT passerar, så att ett nytt utskick inte kan
--                          glömma loggen.
--
--     kanal            'mejl' eller 'push'.
--     sort             notiskällan ('order-returnerad'), eller utskickets namn
--                      när det inte är en notis ('morgonbrev', 'kvallsnotis',
--                      'inloggningskod', 'utkorg', 'rekrytering', 'valkomst').
--     employee_id      mottagaren när det är en anställd. Null när brevet går
--                      till en kund eller kandidat; deras adress sparas inte.
--     notification_id  notisen utskicket gällde, när det finns en.
--     ok, status, fel  utfallet: Resends eller pushtjänstens svar.
--     extern_id        Resends id för ett mejl (det enda spåret i deras logg),
--                      enhetens id (`push_subscription`) för en push.
--
--   notification_event.opened_at / opened_via
--                          när notisen ÖPPNADES, och var: i klockan, från
--                          telefonen eller från mejlet. Första gången räknas.
--                          `notification_seen` säger bara när klockan senast
--                          öppnades, inte vilka notiser som lästes.
--
-- STÄNGD FÖR KLIENTEN, som utskicksreglerna (0255): RLS på och ingen policy,
-- så bara service role når tabellen. Den läses med SQL tills vidare.
--
-- Gallras efter 90 dagar av nattjobbet, samma gräns som notiserna
-- (`rensaGamlaNotiser`). Följer med i registerutdraget och raderas med
-- personen (kaskad).

create table if not exists public.notification_delivery (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  kanal            text not null check (kanal in ('mejl', 'push')),
  sort             text not null check (length(sort) between 1 and 60),
  employee_id      uuid references public.employee(id) on delete cascade,
  notification_id  bigint references public.notification_event(id) on delete set null,
  ok               boolean not null,
  status           integer,
  fel              text check (fel is null or length(fel) <= 300),
  extern_id        text check (extern_id is null or length(extern_id) <= 100)
);

create index if not exists notification_delivery_tid on public.notification_delivery (created_at desc);
create index if not exists notification_delivery_person on public.notification_delivery (employee_id, created_at desc)
  where employee_id is not null;
create index if not exists notification_delivery_notis on public.notification_delivery (notification_id)
  where notification_id is not null;

alter table public.notification_delivery enable row level security;
revoke all on public.notification_delivery from anon, authenticated;

comment on table public.notification_delivery is
  'Utskicksloggen (0271): varje mejl och varje push som Nav försökte skicka, med utfallet. Bara service role.';

alter table public.notification_event
  add column if not exists opened_at  timestamptz,
  add column if not exists opened_via text check (opened_via in ('klocka', 'push', 'mejl'));

comment on column public.notification_event.opened_at is
  'När mottagaren öppnade notisen första gången (0271). Null = inte öppnad.';

-- -----------------------------------------------------------------------------
-- DE NOTISER SOM REDAN STÅR I KLOCKAN LÄNKAR OCKSÅ EXAKT
-- -----------------------------------------------------------------------------
--
-- Samma dag gick varje notissort över till en länk till sin post i stället för
-- listan (`/order` → `/order/<id>`). Raderna som redan finns får samma länk när
-- posten de gäller fortfarande finns. Resten står kvar som de var.

update public.notification_event e
   set href = '/order/' || e.object_id
 where e.kalla in ('order-inskickad', 'order-godkand', 'order-rattad', 'order-returnerad', 'order-makulerad', 'order-betald', 'order-overtack', 'order-grattis')
   and e.object_type = 'sales_order'
   and e.href in ('/order', '/provision', '/')
   and exists (select 1 from public.sales_order o where o.id::text = e.object_id);

update public.notification_event e
   set href = '/kalender?ko=1&order=' || e.object_id
 where e.kalla in ('leverans-ny', 'leverans-frist')
   and e.object_type = 'sales_order'
   and e.href = '/kalender?ko=1'
   and exists (select 1 from public.sales_order o where o.id::text = e.object_id);

update public.notification_event e
   set href = '/franvaro/sjuk/' || e.object_id
 where e.kalla in ('sjuk-bekraftad', 'sjuk-avslutad', 'sjuk-anteckning')
   and e.object_type = 'sick_report'
   and exists (select 1 from public.sick_report s where s.id::text = e.object_id);

update public.notification_event e
   set href = '/franvaro/' || e.object_id
 where e.kalla = 'franvaro-tillbakadragen'
   and e.object_type = 'absence_request'
   and exists (select 1 from public.absence_request a where a.id::text = e.object_id);

-- Besked om ens eget konto: profilen, där behörighet, team och chef står.
-- Anställda är chefens vy och visar ingenting för någon annan.
update public.notification_event e
   set href = '/profil'
 where e.kalla in ('konto-roll', 'konto-organisation', 'konto-behorighet')
   and e.object_type = 'employee'
   and e.object_id = e.employee_id::text;
