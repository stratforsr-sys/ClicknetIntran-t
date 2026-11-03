-- =============================================================================
-- 0280_saljsamtal_utan_lynes.sql — säljsamtalet när Lynes inte har det:
-- en uppladdad inspelning, eller en chef som godkänner ordern utan
--
-- -----------------------------------------------------------------------------
-- VARFÖR (beställaren 2026-11-01 och 2026-11-02)
-- -----------------------------------------------------------------------------
--
-- Spärren (2026-10-08) släpper ingen order utan säljarens eget samtal från
-- Lynes, minst fem minuter. Städservice Ale fastnade fyra gånger: samtalet
-- fanns inte där. Beställaren: "mp3, vissa samtal har vi över telefon och då
-- går det inte att ladda upp en inspelning. Låt en chef godkänna att en order
-- kan laddas upp utan inspelning." Och 2026-11-02: "Fixa allting".
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- 1. phone_call.source får värdet 'uppladdad'. En mp3 som säljaren laddar upp
--    blir ett samtal som alla andra: samma lista i kortet, samma spelare, samma
--    behörighet (phone_call_read, file_object_read) och samma spärr — säljarens
--    eget, minst fem minuter, senast på signeringsdagen. Längden läser servern
--    ur filen. Ett uppladdat samtal har ingen motpart i växeln (external_ref,
--    ingest_id) och inget kundnummer (counterpart_e164), så svepningen på
--    numret rör det aldrig. Riktningen är 'okand', så Mötens samtal per vecka
--    (direction = 'ut') räknar det inte.
--
-- 2. file_object_uppladdare: en inspelning FÅR nu ha en uppladdare — den
--    uppladdade har det, den från växeln har det inte. Allt annat kräver
--    fortfarande en uppladdare.
--
-- 3. saljsamtal_undantag: en rad per order som får gå utan inspelning. Skälet
--    och vem som bad om det, och vem som godkände. Säljaren ber om det när
--    ordern skickas in, och chefens godkännande av ordern är godkännandet av
--    undantaget. Chefen som själv lägger in och godkänner ordern godkänner det
--    i samma steg. Raden skrivs bara av servern (service role); läsrätten är
--    orderns egen, som för filerna på ordern.
--
-- Additiv: main läser inte tabellen och skriver aldrig source = 'uppladdad',
-- och de ändrade villkoren är svagare än de gamla, så ordningen mellan
-- migrationen och mergen spelar ingen roll. Omkörbar.
-- =============================================================================

alter table public.phone_call drop constraint if exists phone_call_source_check;
alter table public.phone_call add constraint phone_call_source_check
  check (source = any (array['lynes'::text, 'uppladdad'::text]));

alter table public.phone_call drop constraint if exists phone_call_uppladdad;
alter table public.phone_call add constraint phone_call_uppladdad
  check (source <> 'uppladdad' or (external_ref is null and ingest_id is null and counterpart_e164 is null));

alter table public.file_object drop constraint if exists file_object_uppladdare;
alter table public.file_object add constraint file_object_uppladdare
  check (purpose = 'call_recording' or uploaded_by is not null);

create table if not exists public.saljsamtal_undantag (
  order_id    uuid primary key references public.sales_order(id) on delete cascade,
  skal        text not null check (length(btrim(skal)) between 3 and 500),
  begart_av   uuid not null references public.employee(id),
  begart_at   timestamptz not null default now(),
  godkant_av  uuid references public.employee(id),
  godkant_at  timestamptz,
  constraint saljsamtal_undantag_godkant check ((godkant_av is null) = (godkant_at is null))
);

alter table public.saljsamtal_undantag enable row level security;

drop policy if exists saljsamtal_undantag_read on public.saljsamtal_undantag;
create policy saljsamtal_undantag_read on public.saljsamtal_undantag for select to authenticated
  using (exists (select 1 from public.sales_order o where o.id = saljsamtal_undantag.order_id));

revoke all on public.saljsamtal_undantag from public, anon;
grant select on public.saljsamtal_undantag to authenticated;

comment on table public.saljsamtal_undantag is
  'Order som får gå utan inspelat säljsamtal (0280). Säljaren ber om det med ett skäl; chefens godkännande av ordern godkänner undantaget.';
comment on column public.phone_call.source is
  'lynes = från växeln. uppladdad = en mp3 som säljaren laddat upp när Lynes saknar samtalet (0280).';
