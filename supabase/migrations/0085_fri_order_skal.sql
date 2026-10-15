-- 0085 · Skälet till en fri order (Nav 2.0, 2026-10-15)
--
-- Nav 2.0:s orderformulär frågar "Varför utanför paketen?" när en order inte
-- följer paketreglerna, och den som godkänner ser svaret. Navet hade ingen
-- plats för det. Beställaren 2026-10-15: utkastets fält gäller, och en säljare
-- får lägga en fri order som säljchef, VD eller ekonomi sedan godkänner.
--
-- Additiv och nullbar. Mains kod listar sina kolumner och skriver aldrig den.

alter table public.sales_order
  add column free_order_reason text check (free_order_reason is null or length(btrim(free_order_reason)) between 1 and 500);
