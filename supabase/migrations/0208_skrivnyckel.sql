-- =============================================================================
-- 0208_skrivnyckel.sql — Nav 2.0: en skrivning som skickas två gånger görs en
-- gång
--
-- -----------------------------------------------------------------------------
-- VARFÖR
-- -----------------------------------------------------------------------------
--
-- Granskningen 2026-10-22 (G1, G2, F2-3). Ett dubbelklick, en Enter som
-- repeteras eller ett nät som skickar om gav två övriga bonusar, två möten med
-- två kundinbjudningar och två publicerade nyheter. Klienten låser nu medan en
-- begäran pågår, men en begäran som hänger och skickas igen efter tidsgränsen
-- når servern två gånger ändå.
--
-- Därför skickar klienten en slumpad nyckel i huvudet X-Nav-Nyckel, och samma
-- nyckel igen vid nästa försök. medNyckel (src/lib/nav2/nyckel.ts) tar raden
-- här med `on conflict (nyckel) do nothing returning`: första gången körs
-- handlingen och svaret sparas (klar, status, svar), nästa gång kommer samma
-- svar tillbaka, och medan den första pågår får den andra 409.
--
-- En nyckel lever ett dygn. medNyckel raderar äldre rader före varje ny, så
-- tabellen gallrar sig själv (indexet på skapad). Raden försvinner med den
-- anställde.
--
-- -----------------------------------------------------------------------------
-- VEM SER VAD
-- -----------------------------------------------------------------------------
--
-- Ingen utom service role. RLS är påslagen utan policyer, och anon och
-- authenticated har inga rättigheter alls (Supabase ger dem annars allt på en
-- ny tabell i public).
-- =============================================================================

create table public.nav_skrivnyckel (
  nyckel text primary key,
  aktor  uuid not null references public.employee(id) on delete cascade,
  skapad timestamptz not null default now(),
  klar   boolean not null default false,
  status int,
  svar   jsonb
);

create index nav_skrivnyckel_skapad on public.nav_skrivnyckel (skapad);

alter table public.nav_skrivnyckel enable row level security;

revoke all on table public.nav_skrivnyckel from public, anon, authenticated;
grant all on table public.nav_skrivnyckel to service_role;
