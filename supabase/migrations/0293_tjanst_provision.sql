-- Provision på en orders tilläggstjänster (beställaren 2026-11-13).
--
-- "När vi lägger till en till tjänst i order så måste vi sätta provision på det också. Låt en chef, admin eller
-- superadmin kunna gå in och sätta provision när det finns extra tjänster … antingen procent eller fast."
-- Godkännandet kräver ett val per tjänst (0 kr är ett val); se `saljarensProvision` och `tjansteprovision.ts`.
--
-- Tre kolumner per tjänst:
--   commission_form    'belopp' (kronor) eller 'procent' (av tjänstens värde: engång = beloppet, månad = belopp × månader)
--   commission_value   talet som valdes. Null tillsammans med formen = inget val ännu, aldrig "noll kronor".
--   commission_amount  kronorna valet gav, FRYSTA vid godkännandet (och vid en rättelse). Null före det, och när
--                      matrisen inte är orderns grund — då ingår tjänsterna redan i provisionen (12 % av det som blir
--                      kvar, chefens egen sats eller en handsatt provision på hela affären).
--
-- Summan står redan i `sales_order.commission_amount`, som huvudboken, övertäcket och lönen räknar på. Raderna här
-- bär uppdelningen, så att säljaren och chefen ser vad varje tjänst gav.
--
-- Bara tillägg, alla kolumner nullbara: koden på main före den här ändringen läser och skriver dem inte.
-- Villkoren är skrivna så att de aldrig blir NULL (ett CHECK som ger NULL avvisar ingenting).

alter table public.sales_order_service add column if not exists commission_form text;
alter table public.sales_order_service add column if not exists commission_value numeric;
alter table public.sales_order_service add column if not exists commission_amount numeric;

alter table public.sales_order_service drop constraint if exists sales_order_service_provision_form;
alter table public.sales_order_service add constraint sales_order_service_provision_form
  check (commission_form is null or commission_form in ('belopp', 'procent'));

-- Formen och talet hör ihop: båda eller ingen.
alter table public.sales_order_service drop constraint if exists sales_order_service_provision_par;
alter table public.sales_order_service add constraint sales_order_service_provision_par
  check ((commission_form is null) = (commission_value is null));

-- Aldrig negativt, och en procent högst 100. (Villkoret ovan gör att formen finns när talet gör det.)
alter table public.sales_order_service drop constraint if exists sales_order_service_provision_varde;
alter table public.sales_order_service add constraint sales_order_service_provision_varde
  check (commission_value is null or (commission_value >= 0 and (commission_form = 'belopp' or commission_value <= 100)));

-- Frysta kronor: aldrig negativa, och aldrig utan ett val bakom sig.
alter table public.sales_order_service drop constraint if exists sales_order_service_provision_kr;
alter table public.sales_order_service add constraint sales_order_service_provision_kr
  check (commission_amount is null or (commission_amount >= 0 and commission_form is not null));

comment on column public.sales_order_service.commission_form is
  '0293: hur tjänstens provision valdes, ''belopp'' eller ''procent''. Null = inget val ännu.';
comment on column public.sales_order_service.commission_value is
  '0293: talet som valdes (kronor, eller procent av tjänstens värde). Null tillsammans med formen.';
comment on column public.sales_order_service.commission_amount is
  '0293: kronorna valet gav, frysta vid godkännandet. Ingår i sales_order.commission_amount. Null när matrisen inte är grunden.';
