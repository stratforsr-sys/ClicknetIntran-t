-- =============================================================================
-- 0023_bilagor.sql — E2.12: bilagor pa dokument, och deras text i sokningen.
--
-- Filerna sjalva ligger redan i `file_object` med `purpose =
-- 'document_attachment'` (0022) och arver dokumentets egen behorighet. Det som
-- fattas ar att texten i en bifogad PDF gar att SOKA i. Utan det ar en
-- prislista som PDF osynlig for den som soker pa vad som star i den, och da ar
-- AC-5.7 uppfylld bara for det som rakar vara skrivet i markdown-rutan.
--
-- =============================================================================
-- TEXTEN LIGGER PA DOKUMENTET, ALDRIG PA FILEN. LAS DET HAR FORE NASTA IDE.
--
-- Den uppenbara losningen ar en kolumn `extracted_text` pa `file_object`: en
-- rad per fil, texten dar den hor hemma. Den ar utesluten, och skalet ar K35.
--
-- `file_object` bar ocksa lakarintyg. En textkolumn dar hade varit exakt det
-- fritextfalt som 0020 byggdes for att inte finnas — och till skillnad fran ett
-- filnamn, som nagon atminstone maste skriva, hade den fyllts AUTOMATISKT med
-- innehallet i ett lakarintyg. Diagnosen hade hamnat i databasen utan att
-- nagon bestamt det, och sedan i sokindexet.
--
-- Darfor: `document.attachment_text`. Kolumnen sitter pa dokumentet, och
-- dokument ar det enda andamal som over huvud taget lases ut. En sjukanmalan
-- har ingen sadan kolumn att skriva till, och koden som extraherar text
-- (src/lib/pdf.ts) anropas bara fran bilagevagen.
-- =============================================================================

alter table document add column if not exists attachment_text text;

comment on column document.attachment_text is
  'Text ur bifogade PDF:er, for sokningen. Fylls av src/lib/pdf.ts vid '
  'uppladdning. Ligger HAR och inte pa file_object eftersom den tabellen '
  'ocksa bar lakarintyg — se rubriken i 0023 och K35 i 0020.';

-- -----------------------------------------------------------------------------
-- Sokkolumnen byggs om
--
-- Genererad kolumn gar inte att andra pa plats, sa den fars slappas och laggas
-- tillbaka. Innehallet raknas om for varje befintlig rad i samma andetag —
-- ingen omindexering behover kommas ihag efterat.
--
-- Bilagans text far vikt 'D', den lagsta. Det ar inte en detalj: en trettio
-- sidor lang PDF innehaller fler ord an nagot dokument har i sin rubrik, och
-- utan viktningen hade varje sokning slutat med att bilagorna kom forst. Den
-- som soker "prislista" ska fa dokumentet som HETER prislista, inte det som
-- rakar namna ordet pa sidan nitton.
-- -----------------------------------------------------------------------------

drop index if exists document_search_idx;
alter table document drop column if exists search;

alter table document add column search tsvector generated always as (
  setweight(to_tsvector('swedish', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('swedish', coalesce(category_path, '')), 'B') ||
  setweight(to_tsvector('swedish', coalesce(body_md, '')), 'C') ||
  setweight(to_tsvector('swedish', coalesce(attachment_text, '')), 'D')
) stored;

create index if not exists document_search_idx on document using gin (search);

-- -----------------------------------------------------------------------------
-- En bilaga ar inte en ny version av dokumentet
--
-- AC-5.4 sager att varje sparning skapar en ny version och AC-5.5 att en ny
-- version kraver ny kvittens. En bifogad prislista ska INTE utlosa det: hade
-- den gjort det vore trettio kvittenser den enda foljden av att nagon bytte ut
-- en bilaga, och kvittensen hade snabbt slutat betyda nagot.
--
-- Uppladdningen ror darfor inte `version`. Det star har for att nasta person
-- som undrar varfor ska hitta svaret pa ratt stalle.
-- -----------------------------------------------------------------------------
