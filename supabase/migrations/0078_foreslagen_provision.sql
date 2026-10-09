-- 0078 · Provisionen som skrevs in på en fri order följer med till godkännandet
--        (beställaren 2026-10-09)
--
-- =============================================================================
-- FELET
--
-- Säljchefen la en fri order på sig själv (TLS Värmepumpar), kryssade "Ordern
-- följer inte paketreglerna", skrev 20 % i provisionsfältet — och kryssade INTE
-- "Godkänn direkt". Ordern skickades in. Vid godkännandet blev provisionen 40 %,
-- chefens sats för egen försäljning.
--
-- `skapaOrder` räknade bara provisionen när ordern godkändes i samma steg. På en
-- inskickad order fanns ingenstans att lägga talet: `commission_amount` får inte
-- finnas före `signerad` (`sales_order_provision_satt`, 0034) — med rätta, ett
-- belopp på en inskickad order ser ut som ett löfte. Fältet ritades alltså, tog
-- emot 20 och kastades. Godkännandet visste ingenting om det, och ett tomt fält
-- betyder "räkna fram det", alltså 40 %.
--
-- =============================================================================
-- RÄTTELSEN
--
-- Två kolumner som bär det som SKREVS, inte det som fryses: ett belopp eller en
-- procentsats, aldrig båda. Godkännandet läser dem när dess eget formulär inte
-- skickar någon provision, och "Godkänn utanför paketreglerna" förifyller
-- väljaren med dem. Det som fryses är fortfarande `commission_amount`.
--
-- Kolumnerna står kvar efter godkännandet — de säger vad som angavs när ordern
-- lades in, och loggen har resten.
--
-- Additiv: main läser och skriver inte kolumnerna, och båda är nullbara.
-- =============================================================================

alter table public.sales_order
  add column if not exists proposed_commission_amount numeric(12,2),
  add column if not exists proposed_commission_percent numeric(5,2);

-- Varje led ger true eller false, aldrig NULL — ett CHECK som ger NULL avvisar
-- ingenting.
alter table public.sales_order
  add constraint sales_order_foreslagen_provision check (
    (proposed_commission_amount is null or proposed_commission_amount >= 0)
    and (proposed_commission_percent is null
         or (proposed_commission_percent >= 0 and proposed_commission_percent <= 100))
    and (proposed_commission_amount is null or proposed_commission_percent is null)
  );

comment on column public.sales_order.proposed_commission_amount is
  '0078. Provision i kronor som angavs när en fri order skickades in. Fryses inte — commission_amount gör det vid godkännandet.';
comment on column public.sales_order.proposed_commission_percent is
  '0078. Provision i procent av nettot som angavs när en fri order skickades in. Utesluter proposed_commission_amount.';
