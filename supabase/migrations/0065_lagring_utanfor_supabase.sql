-- =============================================================================
-- 0065_lagring_utanfor_supabase.sql — filen far veta VAR den ligger
--
-- Supabases fria plan ger 1 GB fillagring. Den passerades 2026-09-21:
-- 1 529 MB pa 1 693 filer, och takten ar 218 MB per arbetsdag. Gallringen pa
-- 30 dygn (0056) gor att det planar ut — men vid ungefar 5 GB, alltsa fem
-- ganger taket. Det planar alltsa ut pa fel sida om gransen.
--
-- DATABASEN AR INTE FULL. Den ar 39 MB av 500, och `public` ar 21 MB av det.
-- Darfor flyttas ingen tabell nagonstans, och ingen andra databas kopplas in.
-- Det som flyttar ut ar ljudet, och bara ljudet.
--
-- Det ar ocksa hela lagringen: varenda fil i bucketen ar en samtalsinspelning.
-- Inga lakarintyg, inga orderbilagor, inga dokumentbilagor — de tillsammans ar
-- noll byte. Flyttas inspelningarna ut ar lagringen i praktiken tom.
--
-- =============================================================================
-- VARFOR EN KOLUMN OCH INTE EN NY TABELL
--
-- `file_object` ar redan den enda vagen till innehallet i en fil: raden bar
-- `bucket` och `path`, signeringen (`signeraOchLogga`) gar genom den, och sa
-- gor gallringen. Det enda som saknas ar svaret pa fragan VILKEN LAGRING
-- bucketen ska slas upp i.
--
-- Med `store` pa raden behover ingenting migreras. De 1 693 filer som redan
-- ligger i Supabase behaller `store = 'supabase'` och hittas dar de ligger;
-- nya inspelningar skrivs med `store = 'r2'`. Gallringen raderar i ratt lagring
-- for var och en — och DET ar poangen: de gamla filerna tommer sig sjalva inom
-- 30 dygn utan att en enda byte behover flyttas for hand.
--
-- En ny tabell hade gett samma svar till priset av en join i varje last som
-- ror en fil, och en rad som kan saknas. En kolumn med ett default kan inte
-- saknas.
--
-- =============================================================================
-- DEFAULTEN AR 'supabase', OCH DET AR INTE SLARV
--
-- Varje rad som redan finns ligger i Supabase, sa defaultet ar sant for dem.
-- Men det gor ocksa att en skrivning som INTE kanner till kolumnen — en aldre
-- deploy som hinner koras mot den nya databasen under ett bygge — lagger sin
-- fil i Supabase och far en rad som pekar ratt. Fel lagring vore en fil som
-- aldrig gick att oppna igen.
--
-- =============================================================================
-- VAGEN TILLBAKA ETT UPPGRADERAT SUPABASE AR SAMMA KOLUMN
--
-- Nar planen uppgraderats gar en backfill att skriva som laser ur R2, lagger
-- upp i Supabase och byter `store` pa raden — en fil i taget, avbrytbar, utan
-- att en rad kod i appen ror sig. Det ar darfor kolumnen sitter pa filen och
-- inte i en miljovariabel: en miljovariabel kan bara ha ett varde at gangen,
-- och under en flytt ligger filerna pa bada stallena.
-- =============================================================================

alter table file_object
  add column if not exists store text not null default 'supabase';

alter table file_object drop constraint if exists file_object_store;
alter table file_object add constraint file_object_store
  check (store in ('supabase', 'r2'));

comment on column file_object.store is
  'Vilken lagring bucket/path slas upp i: supabase = Supabase Storage, r2 = Cloudflare R2. Se 0065.';

-- -----------------------------------------------------------------------------
-- Gallringen och backfillen fragar bada "vad ligger utanfor Supabase, och hur
-- mycket?". Utan index ar det en seq scan over hela `file_object` varje natt.
-- Partiellt, for raden som ar kvar i Supabase ar uppslagsbar pa annat satt och
-- kommer anda att bli farre for varje dygn som gar.
-- -----------------------------------------------------------------------------
create index if not exists file_object_store_idx
  on file_object (store)
  where store <> 'supabase';
