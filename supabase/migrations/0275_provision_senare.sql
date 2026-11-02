-- 0275 · En order kan läggas upp utan provision, och provisionen läggs till senare
--        (beställaren 2026-11-02)
--
-- =============================================================================
-- VARFÖR EN EGEN KOLUMN
--
-- Från och med `signerad` MÅSTE provisionen vara satt (`sales_order_provision_satt`,
-- 0034), och det villkoret står kvar: en godkänd order utan belopp vore en order
-- som ingen summering vet vad den ska göra med. En order "utan provision" godkänns
-- därför med 0 kr, `commission_source = 'manual'`.
--
-- Men 0 kr säger inte samma sak som "läggs till senare". En nolla kan vara ett
-- beslut (ingen provision på den här affären), och den här kolumnen är skillnaden:
-- den säger att någon ska tillbaka till ordern. Navet visar den i orderlistan, på
-- kundkortet och i provisionsvyn, och varnar när månaden ska fastställas.
--
-- Provisionen läggs till med Rätta (`redigeraOrder`), som redan räknar om
-- affären, skriver övertäcket och — är månaden fastställd — bokför skillnaden i
-- den öppna månaden. Då blir kolumnen false.
--
-- ÖVERTÄCKET VÄNTAR OCKSÅ. Det räknas på det som blir kvar efter säljarens
-- provision, och med 0 kr hade det räknats på hela affären. Det skrivs först när
-- provisionen läggs till.
--
-- Additiv: main läser och skriver inte kolumnen, och den har ett förval.
-- =============================================================================

alter table public.sales_order
  add column if not exists commission_pending boolean not null default false;

-- Varje led ger true eller false, aldrig NULL (kolumnen är NOT NULL och
-- coalesce tar resten) — ett CHECK som ger NULL avvisar ingenting.
alter table public.sales_order drop constraint if exists sales_order_provision_senare;
alter table public.sales_order
  add constraint sales_order_provision_senare check (
    not commission_pending
    or (coalesce(commission_amount, 0) = 0
        and proposed_commission_amount is null
        and proposed_commission_percent is null)
  );

comment on column public.sales_order.commission_pending is
  '0275. Ordern lades upp utan provision, och provisionen läggs till senare med Rätta. Godkänd står den på 0 kr (manual) och utan övertäck tills dess.';
