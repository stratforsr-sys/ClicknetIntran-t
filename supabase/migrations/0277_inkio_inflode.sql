-- Inkio in i Nav, och allt i Nav ut till Inkio (beställaren 2026-11-02).
--
-- Utlöst av att en säljare skrev "ringde, inget svar" på Hedboms i Inkio och
-- att ingen i Nav fick veta det. Nav läste Inkio bara när kundkortets flik
-- Aktivitet öppnades, sparade ingenting och notifierade ingen. Beställaren:
-- "allting som händer i inkio crmet med dem ordrarna som vi har i navet måste
-- jag och den personen som står på ordern få notis och det måste gå in i
-- navet, under anteckningar". Och: "Om något ändras i inkio så ska det ändras
-- i navet också".
--
-- INKIO HAR INGEN WEBHOOK FÖR ANTECKNINGAR (bara order, avtal, fakturor,
-- ärenden och nya kunder). Ryggraden är därför en bevakning: varje minut läses
-- historiken för varje kund som har en order i Nav (`get-customer-history`,
-- ett anrop per kund, ~130 ms). Webhooks är bara en knuff som läser en kund
-- direkt. Se `src/lib/crm/inflode-server.ts`.
--
-- FYRA SAKER:
--
--   crm_kund        en rad per kund (org.nr) som bevakas: Inkios id, när den
--                   lästes och om första läsningen är gjord. Första läsningen
--                   är TYST för det som är äldre än tolv timmar.
--   crm_handelse    en rad per post i kundens historik i Inkio, nycklad på
--                   Inkios id. Anteckningar, aktiviteter (kortflyttar m.m.)
--                   och posterna själva (order, avtal, ärenden, fakturor).
--                   Ändras en post i Inkio ändras raden; raderas den märks
--                   den `raderad` och står kvar.
--   kundanteckning  anteckningar skrivna i Nav. De sparas här FÖRST och går
--                   sedan via utkorgen till Inkio — fram till nu gick de
--                   direkt dit och försvann om Inkio inte svarade.
--   crm_webbkrok    det Inkios webhooks skickat, för felsökning. Nycklad på
--                   leveransens id, så ett omförsök sparas inte två gånger.
--
-- crm_order får `kopplad`: 'nav' när Nav lade ordern i Inkio, 'orgnr' när
-- bevakningen kopplade en äldre order (importerad till Inkio 2026-10-01) på
-- organisationsnummer och värde. Bara 'nav'-order rättas i Inkio med
-- correct-sales-order; de andra får en rad om vad som ändrats.
--
-- crm_installning får en brytare per del, så att en del går att stänga med en
-- rad SQL utan en deploy:
--   inflode       bevakningen läser Inkio
--   utflode       det som händer i Nav (betald, rättad, anteckning …) går till Inkio
--   styr_status   makulerad/betald/uppsagt i Inkio ändrar ordern i Nav
--   ratta_i_inkio en rättning i Nav rättar Inkio-ordern
--   larm_at       när superadmin senast fick larmet om att bevakningen står still
--   las_till      låset: ett varv i taget
--
-- STÄNGDA FÖR KLIENTEN: RLS på och ingen policy. Nav läser dem på servern
-- efter att ha prövat att personen ser en order på kunden (`serKunden`).

-- -----------------------------------------------------------------------------
-- 1. Bevakningen per kund
-- -----------------------------------------------------------------------------

create table if not exists public.crm_kund (
  org_number      text primary key check (org_number ~ '^\d{6}-\d{4}$'),
  system          text not null default 'inkio',
  customer_id     text,
  customer_number text,
  customer_name   text,
  forsta_klar     boolean not null default false,
  avtryck         text,
  senast_last     timestamptz,
  senast_ok       timestamptz,
  senast_sokt     timestamptz,
  fel             text check (fel is null or length(fel) <= 500),
  andrad_at       timestamptz not null default now()
);

create index if not exists crm_kund_kund on public.crm_kund (customer_id) where customer_id is not null;

alter table public.crm_kund enable row level security;
revoke all on public.crm_kund from anon, authenticated;

comment on table public.crm_kund is
  'Inkio-bevakningen per kund (0277): Inkios id, senaste läsning, och om den tysta första läsningen är gjord.';

-- -----------------------------------------------------------------------------
-- 2. Allt som hänt med kunden i Inkio
-- -----------------------------------------------------------------------------

create table if not exists public.crm_handelse (
  id               bigint generated always as identity primary key,
  system           text not null default 'inkio',
  extern_id        text not null check (length(extern_id) between 1 and 200),
  org_number       text not null,
  slag             text not null check (slag in ('anteckning', 'aktivitet', 'post')),
  sort             text,
  om_typ           text,
  om_id            text,
  om_titel         text,
  om_nummer        text,
  text             text not null default '',
  data             jsonb,
  forfattare       text,
  forfattare_epost text,
  forfattare_id    uuid references public.employee(id) on delete set null,
  fran_nav         boolean not null default false,
  skapad           timestamptz not null,
  andrad           timestamptz,
  raderad          timestamptz,
  avtryck          text not null,
  hamtad_at        timestamptz not null default now(),
  uppdaterad_at    timestamptz not null default now(),
  notifierad_at    timestamptz,
  unique (system, extern_id)
);

create index if not exists crm_handelse_kund on public.crm_handelse (org_number, skapad desc);
create index if not exists crm_handelse_forfattare on public.crm_handelse (forfattare_id) where forfattare_id is not null;

alter table public.crm_handelse enable row level security;
revoke all on public.crm_handelse from anon, authenticated;

comment on table public.crm_handelse is
  'Varje post i kundens historik i Inkio (0277), nycklad på Inkios id. Ändrad i Inkio = ändrad här; raderad = märkt raderad.';

-- -----------------------------------------------------------------------------
-- 3. Anteckningar skrivna i Nav
-- -----------------------------------------------------------------------------

create table if not exists public.kundanteckning (
  id          uuid primary key default gen_random_uuid(),
  org_number  text not null check (org_number ~ '^\d{6}-\d{4}$'),
  text        text not null check (length(text) between 1 and 2000),
  skriven_av  uuid references public.employee(id) on delete set null,
  skriven_namn text not null,
  skriven_at  timestamptz not null default now(),
  crm_id      text,
  crm_state   text not null default 'ko' check (crm_state in ('ko', 'skickad', 'fel', 'ingen-kund')),
  crm_fel     text check (crm_fel is null or length(crm_fel) <= 500)
);

create index if not exists kundanteckning_kund on public.kundanteckning (org_number, skriven_at desc);
create index if not exists kundanteckning_person on public.kundanteckning (skriven_av) where skriven_av is not null;

alter table public.kundanteckning enable row level security;
revoke all on public.kundanteckning from anon, authenticated;

comment on table public.kundanteckning is
  'Anteckningar om en kund skrivna i Nav (0277). Sparas här först och går via utkorgen till kunden i Inkio.';

-- -----------------------------------------------------------------------------
-- 4. Webhooks från Inkio
-- -----------------------------------------------------------------------------

create table if not exists public.crm_webbkrok (
  id           bigint generated always as identity primary key,
  leverans_id  text unique,
  handelse     text,
  kund_id      text,
  signatur_ok  boolean not null default false,
  mottagen_at  timestamptz not null default now(),
  body         jsonb
);

create index if not exists crm_webbkrok_tid on public.crm_webbkrok (mottagen_at desc);

alter table public.crm_webbkrok enable row level security;
revoke all on public.crm_webbkrok from anon, authenticated;

comment on table public.crm_webbkrok is
  'Det Inkios webhooks skickat (0277). Bara en knuff: kunden läses om direkt; bevakningen är sanningen.';

-- -----------------------------------------------------------------------------
-- 5. Kopplingen och brytarna
-- -----------------------------------------------------------------------------

alter table public.crm_order
  add column if not exists kopplad text not null default 'nav';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_order_kopplad_check') then
    alter table public.crm_order add constraint crm_order_kopplad_check check (kopplad in ('nav', 'orgnr', 'hand'));
  end if;
end $$;

comment on column public.crm_order.kopplad is
  'nav = Nav lade ordern i Inkio; orgnr = bevakningen kopplade en äldre Inkio-order på org.nr och värde (0277).';

-- BÅDA AV TILLS MERGEN: produktionens kod känner inte raderna förrän då, och
-- previewen delar databas med produktionen. Slås på samma dag som mergen:
--   update crm_installning set inflode = true, utflode = true where id;
alter table public.crm_installning
  add column if not exists inflode        boolean not null default false,
  add column if not exists utflode        boolean not null default false,
  add column if not exists styr_status    boolean not null default true,
  add column if not exists ratta_i_inkio  boolean not null default true,
  add column if not exists larm_at        timestamptz,
  add column if not exists las_till       timestamptz;

comment on column public.crm_installning.las_till is
  'Bevakningens lås (0277): ett varv i taget, så att minutjobbet och en webhook inte notifierar samma sak två gånger.';

-- -----------------------------------------------------------------------------
-- 6. En ändring som kom FRÅN Inkio går inte tillbaka dit
-- -----------------------------------------------------------------------------
--
-- Bevakningen makulerar, markerar betald och avslutar avtalsbevakningen genom
-- den här funktionen. Den sätter `nav.fran_inkio` för transaktionen, och
-- triggern nedan skriver då ingen rad till Inkio om samma sak.

create or replace function public.lk_inkio_andra_order(
  p_order  uuid,
  p_vad    text,
  p_skal   text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  perform set_config('nav.fran_inkio', 'ja', true);

  if p_vad = 'makulerad' then
    update sales_order
       set status = 'makulerad',
           cancelled_on = (now() at time zone 'Europe/Stockholm')::date,
           cancelled_by = null,
           cancel_reason = left(p_skal, 500)
     where id = p_order and status in ('signerad', 'betald');
  elsif p_vad = 'betald' then
    update sales_order set status = 'betald' where id = p_order and status = 'signerad';
  elsif p_vad = 'uppsagt' then
    update sales_order
       set renewal_outcome = 'avslutad',
           renewal_at = now(),
           renewal_by = null,
           renewal_reason = left(p_skal, 500)
     where id = p_order and renewal_outcome is null and status in ('signerad', 'betald');
  else
    raise exception 'Okänd ändring: %', p_vad;
  end if;

  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.lk_inkio_andra_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lk_inkio_andra_order(uuid, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 7. Det som händer med en order i Nav → en rad i utkorgen till Inkio
-- -----------------------------------------------------------------------------
--
-- Betald, rättad (värde, paket, bindningstid, månadsbelopp, säljare, start),
-- förlängningens utfall. Bara för order som finns i Inkio (`crm_order` med
-- kund) och bara när kopplingen är påslagen. Texten skrivs när raden skickas
-- (`navHandelseICrm`), så att den säger det som gäller då.
--
-- Bilagor, säljsamtal och kampanjsidan har egna triggrar nedan.

create or replace function public.sales_order_till_inkio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_typ text;
begin
  begin
    if coalesce(current_setting('nav.fran_inkio', true), '') = 'ja' then
      return null;
    end if;
    if not exists (select 1 from crm_installning where id and aktiv and utflode) then
      return null;
    end if;
    if not exists (select 1 from crm_order where order_id = new.id and customer_id is not null) then
      return null;
    end if;

    if new.status = 'betald' and old.status = 'signerad' then
      v_typ := 'betald';
    elsif new.status in ('signerad', 'betald') and old.status in ('signerad', 'betald')
      and (new.order_value is distinct from old.order_value
        or new.monthly_amount is distinct from old.monthly_amount
        or new.term_months is distinct from old.term_months
        or new.package_id is distinct from old.package_id
        or new.salesperson_id is distinct from old.salesperson_id
        or new.starts_on is distinct from old.starts_on
        or new.buyout_amount is distinct from old.buyout_amount
        or new.finance_amount is distinct from old.finance_amount) then
      v_typ := 'rattad';
    elsif new.renewal_outcome is distinct from old.renewal_outcome then
      v_typ := 'forlangning';
    else
      return null;
    end if;

    insert into outbox (kind, payload, idempotency_key, not_before)
    values ('crm',
            jsonb_build_object('handling', 'nav-handelse', 'typ', v_typ, 'order_id', new.id),
            -- Betald en gång per order. En rättning skriver ofta ordern flera gånger i
            -- samma handling: en rad per minut räcker, och texten läses när den skickas.
            case when v_typ = 'betald' then 'crm-betald:' || new.id::text
                 else 'crm-' || v_typ || ':' || new.id::text || ':' || to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI') end,
            now() + interval '20 seconds')
    on conflict (idempotency_key) do nothing;
  exception when others then
    raise warning 'sales_order_till_inkio(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.sales_order_till_inkio() from public, anon, authenticated;
grant execute on function public.sales_order_till_inkio() to service_role;

drop trigger if exists sales_order_till_inkio on public.sales_order;
create trigger sales_order_till_inkio
  after update on public.sales_order
  for each row execute function public.sales_order_till_inkio();

-- En bilaga på en order som finns i Inkio, och ett säljsamtal som kopplas.
create or replace function public.order_bilaga_till_inkio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order uuid;
  v_typ text;
begin
  begin
    if not exists (select 1 from crm_installning where id and aktiv and utflode) then
      return null;
    end if;

    if tg_table_name = 'file_object' then
      if new.sales_order_id is null or new.purpose is distinct from 'sales_order' then
        return null;
      end if;
      v_order := new.sales_order_id;
      v_typ := 'bilaga';
    else
      if new.sales_order_id is null or new.sales_order_id is not distinct from old.sales_order_id then
        return null;
      end if;
      v_order := new.sales_order_id;
      v_typ := 'samtal';
    end if;

    if not exists (select 1 from crm_order where order_id = v_order and customer_id is not null) then
      return null;
    end if;

    insert into outbox (kind, payload, idempotency_key, not_before)
    values ('crm',
            jsonb_build_object('handling', 'nav-handelse', 'typ', v_typ, 'order_id', v_order, 'id', new.id),
            'crm-' || v_typ || ':' || new.id::text,
            now() + interval '20 seconds')
    on conflict (idempotency_key) do nothing;
  exception when others then
    raise warning 'order_bilaga_till_inkio(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.order_bilaga_till_inkio() from public, anon, authenticated;
grant execute on function public.order_bilaga_till_inkio() to service_role;

drop trigger if exists file_object_till_inkio on public.file_object;
create trigger file_object_till_inkio
  after insert on public.file_object
  for each row execute function public.order_bilaga_till_inkio();

drop trigger if exists phone_call_till_inkio on public.phone_call;
create trigger phone_call_till_inkio
  after update of sales_order_id on public.phone_call
  for each row execute function public.order_bilaga_till_inkio();

-- Kampanjsidan anmäld nere, och uppe igen.
create or replace function public.kampanjsida_till_inkio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_typ text;
begin
  begin
    if not exists (select 1 from crm_installning where id and aktiv and utflode) then
      return null;
    end if;
    if tg_op = 'INSERT' then
      v_typ := 'sida-nere';
    elsif new.resolved_at is not null and old.resolved_at is null then
      v_typ := 'sida-uppe';
    else
      return null;
    end if;
    if not exists (select 1 from crm_kund where org_number = new.org_number and customer_id is not null) then
      return null;
    end if;

    insert into outbox (kind, payload, idempotency_key, not_before)
    values ('crm',
            jsonb_build_object('handling', 'nav-handelse', 'typ', v_typ, 'org', new.org_number, 'id', new.id),
            'crm-' || v_typ || ':' || new.id::text,
            now() + interval '20 seconds')
    on conflict (idempotency_key) do nothing;
  exception when others then
    raise warning 'kampanjsida_till_inkio(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.kampanjsida_till_inkio() from public, anon, authenticated;
grant execute on function public.kampanjsida_till_inkio() to service_role;

drop trigger if exists landing_page_report_till_inkio on public.landing_page_report;
create trigger landing_page_report_till_inkio
  after insert or update of resolved_at on public.landing_page_report
  for each row execute function public.kampanjsida_till_inkio();

-- -----------------------------------------------------------------------------
-- 8. Minutjobbet
-- -----------------------------------------------------------------------------
--
-- SKAPAS AVSTÄNGT, som `nav-utkorg` i 0069: `job_target` pekar på
-- produktionen, och där finns /api/jobb/inkio först efter mergen. Slås på
-- samma dag som mergen:
--   select cron.alter_job(jobid, active := true) from cron.job where jobname = 'nav-inkio';
-- OBS: körs migrationen om efter det stängs jobbet igen.

select cron.unschedule('nav-inkio')
where exists (select 1 from cron.job where jobname = 'nav-inkio');

select cron.schedule(
  'nav-inkio',
  '* * * * *',
  $cron$select public.kalla_jobb('/api/jobb/inkio')$cron$
);

select cron.alter_job(jobid, active := false) from cron.job where jobname = 'nav-inkio';
