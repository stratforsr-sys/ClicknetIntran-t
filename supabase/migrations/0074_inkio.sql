-- =============================================================================
-- 0074_inkio.sql — en godkänd order läggs in i Inkio, CRM:et
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Beställaren 2026-10-07: "integrera vårt nuvarande CRM som vi har utvecklat
-- själva till intranätet", och på frågan åt vilket håll: Nav skriver till
-- Inkio. Samma dag hade alla 22 signerade order i Nav redan sin kund i Inkio
-- (matchat på organisationsnummer) — affären registrerades två gånger.
--
-- Nu gör godkännandet i Nav det: kunden slås upp på organisationsnumret i
-- Inkio och skapas om den saknas (adressen från Bolagsverket, via Inkio), och
-- ordern läggs in på kunden. Makuleras ordern i Nav makuleras den i Inkio.
--
-- -----------------------------------------------------------------------------
-- GENOM UTKORGEN, INTE I GODKÄNNANDET
-- -----------------------------------------------------------------------------
--
-- Triggern nedan skriver en rad i `outbox` (0069) i samma transaktion som
-- godkännandet, och `tomUtkorgen()` skickar den. Det ger tre saker gratis:
-- ett godkännande står aldrig och väntar på Inkio, ett Inkio som ligger nere
-- försöks igen, och tre misslyckade försök blir en notis till admin.
-- Samma `kind = 'crm'` som leveranskalenderns statusrader, med
-- `payload.handling` som skiljer dem åt.
--
-- -----------------------------------------------------------------------------
-- AVSTÄNGD TILLS DEN SLÅS PÅ
-- -----------------------------------------------------------------------------
--
-- `crm_installning.aktiv` är falsk när migrationen körts. Triggern skriver
-- ingenting förrän den slås på — och den slås på när koden som förstår
-- raderna är mergad, inte förut. Produktionens gamla `crm()` hade annars tagit
-- en `skapa`-rad, inte hittat någon leverans och markerat den som skickad.
-- Samma skäl som `nav-utkorg` skapades avstängt i 0069.
--
--   update crm_installning set aktiv = true, andrad_at = now();
--
-- Det är också strömbrytaren om Inkio skulle börja ta emot fel saker.
-- =============================================================================

create table if not exists crm_installning (
  id        boolean primary key default true check (id),
  aktiv     boolean not null default false,
  andrad_at timestamptz not null default now()
);
insert into crm_installning (id) values (true) on conflict (id) do nothing;

-- Ingen policy: bara service role läser och skriver den.
alter table crm_installning enable row level security;

-- -----------------------------------------------------------------------------
-- Kopplingen: en Nav-order och vad den blev i Inkio
-- -----------------------------------------------------------------------------
--
-- En egen tabell och inte kolumner på `sales_order`: en godkänd order är låst
-- av sina triggrar, och kopplingen skrivs EFTER godkännandet. Den hör inte
-- heller till `delivery`, som bara finns för order som går till leverans —
-- en tilläggsorder läggs in i Inkio också.

create table if not exists crm_order (
  order_id        uuid primary key references sales_order(id) on delete cascade,
  system          text not null default 'inkio' check (system in ('inkio')),
  customer_id     text check (customer_id is null or length(customer_id) between 1 and 80),
  customer_number text,
  crm_order_id    text check (crm_order_id is null or length(crm_order_id) between 1 and 80),
  crm_order_number text,
  -- utkast    = ordern ligger i Inkio men är inte inskickad (inget bevis att skicka med)
  -- inskickad = inskickad i Inkio
  -- makulerad = makulerad i Inkio (eller utkastet raderat)
  -- fel       = senaste försöket misslyckades; `error` säger varför
  state           text not null check (state in ('utkast','inskickad','makulerad','fel')),
  error           text,
  synced_at       timestamptz not null default now(),
  check ((state = 'fel') = (error is not null))
);

alter table crm_order enable row level security;

-- Den som ser ordern ser vad den blev i Inkio. Underfrågan går genom
-- `sales_order`s egen RLS, så kopplingen kan aldrig synas på en order som inte
-- gör det.
drop policy if exists crm_order_read on crm_order;
create policy crm_order_read on crm_order for select to authenticated
  using (exists (select 1 from sales_order o where o.id = crm_order.order_id));

grant select on crm_order to authenticated;

-- -----------------------------------------------------------------------------
-- Triggern: godkänd eller makulerad → en rad i utkorgen
-- -----------------------------------------------------------------------------

create or replace function public.crm_order_till_utkorg()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if not coalesce((select aktiv from crm_installning where id), false) then
      return null;
    end if;

    -- Godkänd nu, och inte förut. Tilläggsorder också — de är affärer i Inkio.
    if new.approved_at is not null
       and (tg_op = 'INSERT' or old.approved_at is null)
       and new.status in ('signerad','betald') then
      insert into outbox (kind, payload, idempotency_key, not_before)
      values ('crm', jsonb_build_object('handling','skapa','order_id',new.id),
              'crm-skapa:' || new.id::text, now() + interval '10 seconds')
      on conflict (idempotency_key) do nothing;
    end if;

    if tg_op = 'UPDATE' and new.status = 'makulerad' and old.status <> 'makulerad' then
      insert into outbox (kind, payload, idempotency_key, not_before)
      values ('crm', jsonb_build_object('handling','makulera','order_id',new.id),
              'crm-makulera:' || new.id::text, now() + interval '10 seconds')
      on conflict (idempotency_key) do nothing;
    end if;
  exception when others then
    -- Ett godkännande får aldrig falla på Inkio.
    raise warning 'crm_order_till_utkorg(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.crm_order_till_utkorg() from public, anon, authenticated;

drop trigger if exists sales_order_till_crm on sales_order;
create trigger sales_order_till_crm
  after insert or update of approved_at, status on sales_order
  for each row execute function public.crm_order_till_utkorg();
