-- =============================================================================
-- 0278_kundanteckning_om_order.sql — en anteckning från kundkortet kan gälla
-- en order, som i Inkio
--
-- -----------------------------------------------------------------------------
-- VARFÖR (beställaren 2026-11-02)
-- -----------------------------------------------------------------------------
--
-- Kundkortets flik Aktivitet byggs om efter Inkios historik ("så som det finns
-- i inkio … men följer såklart navet"). I Inkio skrivs en anteckning på kunden
-- eller på en av kundens order, och raden säger "om Order · Optimerad
-- Kampanjsida". En anteckning skriven i Nav gällde hittills alltid kunden.
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- kundanteckning.om_order  den Nav-order anteckningen gäller, eller null för
--                          kunden. Utkorgen skriver den på ordern i Inkio när
--                          ordern är kopplad dit (crm_order.crm_order_id),
--                          annars på kunden. Raderas ordern står anteckningen
--                          kvar och gäller kunden (on delete set null).
--
-- Additiv: koden på main läser och skriver inte kolumnen, och kortet läser
-- kundanteckning med `*`, så ordningen mellan migrationen och mergen spelar
-- ingen roll. Omkörbar.
-- =============================================================================

alter table public.kundanteckning
  add column if not exists om_order uuid references public.sales_order(id) on delete set null;

create index if not exists kundanteckning_om_order on public.kundanteckning (om_order) where om_order is not null;

comment on column public.kundanteckning.om_order is
  'Ordern anteckningen gäller (0278), eller null för kunden. Skrivs på ordern i Inkio när den är kopplad dit.';
