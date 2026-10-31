-- Introfilmen i Nav 2.0 (beställaren 2026-10-31).
--
-- Den som går in i navet och inte har sett filmen får den före första vyn.
-- Nästa gång går man direkt in. "Sedd" ligger här, per person, och inte i
-- webbläsaren, så att den följer med mellan dator, telefon och appen.
--
--   sedd_at         första gången filmen spelades till minst 95 % (spolning
--                   räknas inte, se moduler/nditf.js). Null = inte sedd.
--   senast_sedd_at  senaste gången, och `ganger` hur många gånger.
--   film            vilken film som sågs senast ('nav2-intro-v7').
--   varje_gang      visa filmen vid varje nytt besök (ny flik, nytt fönster,
--                   appstart), också efter att den är sedd. Beställaren:
--                   Zen får den "varje gång tills jag säger till".
--
-- Ingen rad = inte sedd. Det gäller befintliga konton, nya konton och de
-- spärrade när de öppnas, utan att något behöver läggas in för dem.
--
-- SLÅ AV ZENS "VARJE GÅNG" (en rad):
--   update public.introfilm set varje_gang = false
--    where employee_id = (select id from public.employee where email = 'zen@clicknet.se');
--
-- Visa filmen för alla igen (t.ex. en ny film):
--   update public.introfilm set sedd_at = null;
--
-- Läsningen går med den inloggades egen klient i /nav2:s data (RLS: bara den
-- egna raden). Skrivningen går med service role genom POST /nav2/introfilm,
-- bakom SKRIVLAGE.introfilm. Ingen annan roll får skriva.
--
-- `varje_gang` är tänkt att bli en inställning för superadmin per person
-- (anpassningsbarheten): den sätts i dag med SQL.

create table public.introfilm (
  employee_id    uuid primary key references public.employee (id) on delete cascade,
  sedd_at        timestamptz,
  senast_sedd_at timestamptz,
  ganger         integer not null default 0 check (ganger >= 0),
  film           text check (film is null or film ~ '^[a-z0-9-]{1,40}$'),
  varje_gang     boolean not null default false,
  andrad_at      timestamptz not null default now()
);

alter table public.introfilm enable row level security;

revoke all on public.introfilm from anon, authenticated;
grant select on public.introfilm to authenticated;

create policy introfilm_read on public.introfilm for select to authenticated
  using (employee_id = (select public.current_employee_id()));

comment on table public.introfilm is
  'Introfilmen i Nav 2.0 (0270): om och när personen sett den, och om den ska visas vid varje nytt besök (varje_gang). Ingen rad = inte sedd. Läses av den egna personen, skrivs bara med service role.';

-- Zen: varje gång tills beställaren säger till.
insert into public.introfilm (employee_id, varje_gang)
select id, true from public.employee where email = 'zen@clicknet.se'
on conflict (employee_id) do update set varje_gang = true, andrad_at = now();
