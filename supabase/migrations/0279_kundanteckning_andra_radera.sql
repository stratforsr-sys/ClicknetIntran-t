-- =============================================================================
-- 0279_kundanteckning_andra_radera.sql — ändra och ta bort sin egen anteckning,
-- som i Inkio
--
-- -----------------------------------------------------------------------------
-- VARFÖR (beställaren 2026-11-02)
-- -----------------------------------------------------------------------------
--
-- Kundkortets historik byggdes efter Inkios (0278). I Inkio går den egna
-- anteckningen att ändra (versionerna sparas, `get-comment-versions`) och ta
-- bort. Beställaren: "Ändra eller ta bort sin egen anteckning … Bygg det."
--
-- -----------------------------------------------------------------------------
-- VAD FILEN GÖR
-- -----------------------------------------------------------------------------
--
-- kundanteckning.andrad_at   när texten senast ändrades, eller null.
-- kundanteckning.versioner   det anteckningen sagt förut, äldst först:
--                            [{ "text": …, "at": … }], där `at` är när den
--                            versionen skrevs. Texten nu står i `text`.
-- kundanteckning.raderad_at  när den togs bort. Raden står kvar: superadmin
--                            ser den, märkt borttagen, som Inkios raderade.
-- kundanteckning.raderad_av  vem som tog bort den (författaren, eller
--                            superadmin).
--
-- Utkorgen skriver ändringen och borttagningen till Inkio (`edit-comment`,
-- `delete-comment`) när anteckningen redan står där (`crm_id`).
--
-- Additiv och omkörbar. Koden läser `kundanteckning` med `*`, så kortet
-- fungerar före migrationen; att ändra och ta bort kräver den.
-- =============================================================================

alter table public.kundanteckning
  add column if not exists andrad_at timestamptz,
  add column if not exists versioner jsonb not null default '[]'::jsonb,
  add column if not exists raderad_at timestamptz,
  add column if not exists raderad_av uuid references public.employee(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kundanteckning_versioner_lista') then
    alter table public.kundanteckning add constraint kundanteckning_versioner_lista check (jsonb_typeof(versioner) = 'array');
  end if;
end $$;

create index if not exists kundanteckning_raderad_av on public.kundanteckning (raderad_av) where raderad_av is not null;

comment on column public.kundanteckning.andrad_at is 'När texten senast ändrades (0279), eller null.';
comment on column public.kundanteckning.versioner is 'Det anteckningen sagt förut, äldst först: [{text, at}] (0279). Texten nu står i text.';
comment on column public.kundanteckning.raderad_at is 'När anteckningen togs bort (0279). Raden står kvar; bara superadmin ser den.';
comment on column public.kundanteckning.raderad_av is 'Vem som tog bort anteckningen (0279): författaren eller superadmin.';
