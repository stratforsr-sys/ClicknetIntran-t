-- =============================================================================
-- 0221 · Rabatterat paketpris på en order (granskningen S08, K5; beslut B2)
--
-- Nav 2.0:s orderformulär har "Kunden betalar per månad" för en paketorder och
-- lovar att priset fryses på ordern. Före den här migrationen skickades det
-- aldrig: godkännandet räknade och frös listpriset, och Inkio fick listpriset.
--
-- Beställaren 2026-10-22 (B2): säljarens matrisprovision är OFÖRÄNDRAD vid
-- rabatt. Ordervärdet, chefens egen försäljning, övertäcket och priset till
-- Inkio räknas på det verkliga priset.
--
-- VARFÖR EN EGEN KOLUMN OCH INTE monthly_amount: på en ogodkänd order betyder
-- ett månadsbelopp FRI ORDER — för `raknaFramProvision`, `godkannOrder`,
-- /orders redigering och Nav 2.0. Rabatten står därför här tills godkännandet
-- fryser `monthly_amount` = rabattpriset (som för varje godkänd order), med
-- `order_value_source = 'package'` och matrisens belopp. Kolumnen står kvar
-- efter godkännandet, så att en rättelse (`redigeraOrder`) behåller rabatten.
--
-- NULL = listpris, alltså alla order som finns i dag. Additiv: main läser den
-- inte, och ingen befintlig rad ändras.
-- =============================================================================

alter table sales_order add column if not exists discounted_monthly_amount numeric(10,2);

alter table sales_order drop constraint if exists sales_order_rabatt_positiv;
alter table sales_order add constraint sales_order_rabatt_positiv
  check (discounted_monthly_amount is null or discounted_monthly_amount > 0);

comment on column sales_order.discounted_monthly_amount is
  'Rabatterat månadspris på en paketorder (0221, B2). NULL = listpris. Godkännandet fryser monthly_amount = detta; matrisprovisionen rörs inte.';
