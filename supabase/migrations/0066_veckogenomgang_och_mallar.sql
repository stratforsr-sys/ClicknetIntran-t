-- =============================================================================
-- 0066_veckogenomgang_och_mallar.sql — kalenderns pass 3, det som återstod.
--
-- Beställningen 2026-09-22, efter genomgång av två alternativ vardera:
-- veckogenomgången ska vara EN GUIDAD GENOMGÅNG I FEM STEG med handlingar på
-- plats, och en mall ska vara EN NAMNGIVEN CHECKLISTA MED DAGSFÖRSKJUTNING som
-- föder riktiga uppgifter.
--
-- Migrationen bär tre tabeller och en kolumn. Ingenting annat i navet behöver
-- lära sig något nytt, och det är samma val som 0062 gjorde av samma skäl: en
-- uppgift som kom ur en mall är en rad i `task` med allt det innebär — sin egen
-- krets, sin egen historik, sin egen plats i kalendern och i dagssumman.
--
-- =============================================================================
-- INGET NYTT KALENDERSLAG, OCH DET ÄR AVSIKTEN
--
-- `KALENDERSLAG` i src/lib/kalender.ts har sju värden, och inget åttonde läggs
-- till här. En mall som tillämpats är uppgifter; en veckogenomgång är ingen
-- post i en dag utan en handling man utför. Hade endera blivit ett slag hade
-- `SLAG_ETIKETT`, `SLAG_TON` och `arAtagande()` behövt svara på frågor de inte
-- har svar på — vad väger en genomgång i dagssumman? — och kalenderns
-- projektion `kalender_poster()` hade vuxit med något RLS redan svarar på.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Mallen
--
-- SPEGLAR `coaching_template` FRÅN 0035, MEDVETET OCH NÄSTAN FÄLT FÖR FÄLT.
-- Coachningen har haft mallar i ett halvår, de fungerar, och formen är prövad:
-- ett namn, en rad per moment, och en förskjutning i dagar från startdagen.
-- Att uppfinna en andra form för samma sak hade gett två ställen att räkna fram
-- ett datum på, och den dagen de räknar olika är det ingen som ser det.
--
-- TVÅ TABELLER OCH INTE EN MED JSON. Momenten läses ett och ett av den som
-- använder mallen, de sorteras, och de ska gå att räkna. En jsonb-kolumn hade
-- varit billigare att skriva och omöjlig att fråga: "hur många mallar har ett
-- moment som pekar på ett projekt" är en fråga någon kommer att ställa.
-- -----------------------------------------------------------------------------

create table if not exists task_template (
  id uuid primary key default gen_random_uuid(),

  name text not null check (length(btrim(name)) > 0 and length(name) <= 80),
  description_md text not null default '',

  created_by uuid not null references employee(id),

  /**
   * DELAD MED ALLA, OCH DET ÄR FÖRVALET.
   *
   * ==========================================================================
   * VARFÖR EN MALL FÅR VARA SYNLIG NÄR EN UPPGIFT INTE ÄR DET
   *
   * 0054 drog en hård linje: en uppgiftslista är en anteckningsbok, ingen roll
   * ger insyn, och kretsen är fyra personer per rad. Den linjen gäller
   * fortfarande — och den gäller RADEN, inte regeln om hur man brukar göra.
   *
   * En mall är en arbetsbeskrivning. Den skrivs inte i förbifarten; vägen dit
   * går via en egen sida där man medvetet skriver ner hur ett återkommande
   * arbete brukar se ut, och poängen med att skriva ner det är att någon annan
   * ska slippa göra om det. Snabbraden på `/uppgifter` är platsen för den
   * privata anteckningen, och den har inte ändrats.
   *
   * MEN FÖRVALET FÅR INTE KUNNA ÖVERRASKA. Kryssrutan i formuläret står
   * ikryssad med texten utskriven — "Alla i navet kan använda mallen" — så att
   * den som vill ha sin checklista för sig själv ser valet innan hon sparar,
   * inte efteråt. Ett förval som läcker är ett förval man inte får ha.
   * ==========================================================================
   */
  shared boolean not null default true,

  /**
   * Arkiverad, inte raderad. Samma val som `task_series.ended_at` i 0062: de
   * uppgifter mallen redan fött pekar på den via `task.template_id`, och en
   * `on delete cascade` hade tagit med sig svaret på "varför står det här i min
   * lista". En arkiverad mall går inte att använda och syns inte i väljaren.
   */
  archived_at timestamptz,
  archived_by uuid references employee(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_template_item (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references task_template(id) on delete cascade,

  /** Ordningen mallen skrevs i. Unik per mall — se indexet nedan. */
  sort smallint not null check (sort between 1 and 50),

  title text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  description_md text not null default '',

  /**
   * DAGAR FRÅN STARTDAGEN, INTE ETT DATUM.
   *
   * Hela skälet att en mall är en mall. "Stäm av att avtalet kom fram" ska
   * infalla tre dagar efter uppstarten vare sig den sker i mars eller i
   * november, och den som lägger upp en kund i efterhand ska få samma kedja
   * räknad från den dag kunden faktiskt blev kund.
   *
   * NOLL ÄR TILLÅTET och betyder startdagen själv. Taket är ett år: en mall som
   * sträcker sig längre är inte en checklista utan ett projekt, och projekt har
   * en egen sida sedan 0054.
   */
  offset_days smallint not null default 0 check (offset_days between 0 and 365),

  /** Klockslag, om momentet hör till en bestämd tid på dagen. */
  due_time time,

  estimate_minutes integer
    check (estimate_minutes is null or (estimate_minutes > 0 and estimate_minutes <= 1440)),

  priority smallint not null default 3 check (priority between 1 and 4),

  created_at timestamptz not null default now()
);

/**
 * ETT MOMENT PER PLATS I MALLEN.
 *
 * Indexet är inte prydnad: `anvandUppgiftsmall()` läser momenten sorterade på
 * `sort` och skriver uppgifterna i den ordningen. Två moment med samma nummer
 * hade gett en ordning som avgörs av vilken rad databasen råkar lämna först —
 * alltså en checklista som ser olika ut varje gång den används.
 */
create unique index if not exists task_template_item_plats
  on task_template_item (template_id, sort);

create index if not exists task_template_levande_idx
  on task_template (created_by)
  where archived_at is null;

-- -----------------------------------------------------------------------------
-- 2. Uppgiften pekar tillbaka
--
-- EN KOLUMN OCH INTE TRE, till skillnad från serien i 0062.
--
-- Serien behövde `series_on` för att veta VILKEN förekomst raden var, och
-- `series_losgjord` för att veta vem som bestämde över fälten. Ingen av de
-- frågorna finns här: en mall föder EN GÅNG och släpper sedan taget. Det som
-- skapats är vanliga uppgifter, och den som ändrar en av dem ändrar inte mallen
-- — precis som den som ändrar mallen inte rör det som redan skapats.
--
-- Kolumnen finns alltså bara för att kunna svara på varifrån raden kom. Samma
-- `template_id` som `coaching_task` fick i 0035, och samma `on delete set null`.
-- -----------------------------------------------------------------------------

alter table task add column if not exists template_id uuid
  references task_template(id) on delete set null;

create index if not exists task_mall_idx on task (template_id) where template_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Veckogenomgången
--
-- =============================================================================
-- TABELLEN LAGRAR ATT GENOMGÅNGEN ÄR GJORD. INGENTING ANNAT.
--
-- Första utkastet bar ett steg-för-steg-tillstånd — vilket steg man var på,
-- vilka rader man betat av — så att en avbruten genomgång skulle gå att
-- återuppta. Det ströks, och skälet är värt att stå kvar:
--
-- STEGEN ÄR RÄKNADE UR UPPGIFTERNA, INTE LAGRADE. "Sex uppgifter utan dag" är
-- en fråga till `task`, ställd i det ögonblick sidan öppnas. Ett lagrat
-- tillstånd hade varit ett andra svar på samma fråga — och det andra svaret
-- blir fel så fort någon ger en av raderna ett datum i en annan flik, vilket är
-- precis vad man gör under en genomgång. Följden hade varit en genomgång som
-- säger "två kvar" när listan är tom.
--
-- Det som INTE går att räkna fram är om jag har gjort veckans genomgång. En
-- vecka utan förfallna uppgifter och en vecka man betat av ser likadana ut i
-- datan, och skillnaden är hela poängen med påminnelsen. Därför en rad.
-- =============================================================================
-- -----------------------------------------------------------------------------

create table if not exists weekly_review (
  id uuid primary key default gen_random_uuid(),

  employee_id uuid not null references employee(id) on delete cascade,

  /**
   * MÅNDAGEN I VECKAN GENOMGÅNGEN GÄLLER, inte dagen den gjordes.
   *
   * Nyckeln är `(employee_id, week_start)`, och det är det som gör "gjord den
   * här veckan" till en fråga med ett svar. Hade dagen lagrats rått hade
   * frågan blivit ett intervall att räkna fram, och ett intervall räknat över
   * ett årsskifte är den sortens fel som syns en gång om året.
   *
   * ISO-veckan börjar på måndag. `veckostart()` i src/lib/kalender.ts räknar
   * fram den och används av både sidan och provet — talet kommer aldrig ur
   * databasen, för `date_trunc('week')` och JavaScript skulle vara två
   * räknesätt för samma sak.
   */
  week_start date not null,

  completed_at timestamptz not null default now(),

  /**
   * HUR MYCKET SOM STOD KVAR NÄR GENOMGÅNGEN AVSLUTADES.
   *
   * ==========================================================================
   * "KVAR" OCH INTE "AVBETAT", OCH SKILLNADEN ÄR ATT DET GÅR ATT KONTROLLERA
   *
   * Första utkastet lagrade hur många rader genomgången uträttade något med.
   * Det talet finns bara i webbläsaren — det är en räknare över klick — och ett
   * tal som klienten skickar in och servern inte kan kontrollera är ett tal som
   * ser ut som en mätning utan att vara det.
   *
   * Det som däremot går att räkna på servern i samma ögonblick knappen trycks
   * är hur många rader de fem stegen fortfarande har. Noll betyder en vecka man
   * betat av; tre betyder tre man medvetet lät ligga, vilket är ett fullt
   * giltigt slut på en genomgång och något helt annat än att inte ha gjort den.
   *
   * `stegantal()` i src/lib/genomgang.ts räknar fram det, ur samma filter som
   * ritade stegen. Ett andra räknesätt hade gett ett kvitto som motsäger sidan
   * det kvitterar.
   * ==========================================================================
   */
  remaining integer not null default 0 check (remaining >= 0),

  constraint weekly_review_en_per_vecka unique (employee_id, week_start)
);

create index if not exists weekly_review_person_idx
  on weekly_review (employee_id, week_start desc);

-- -----------------------------------------------------------------------------
-- 4. Läsningen
--
-- TRE POLICYER, OCH BARA DEN SISTA ÄR SJÄLVKLAR.
-- -----------------------------------------------------------------------------

alter table task_template enable row level security;
alter table task_template_item enable row level security;
alter table weekly_review enable row level security;

/**
 * Mallen: min egen, eller någons som delat den.
 *
 * INGEN CHEFSKRETS, av gammal vana som är värd att upprepa: `task_read` i 0054
 * har ingen, och en privat mall är lika mycket en anteckning som en uppgift.
 * Den som vill att chefen ska se checklistan kryssar i rutan.
 */
drop policy if exists task_template_read on task_template;
create policy task_template_read on task_template for select
  to authenticated
  using (
    public.current_employee_id() is not null
    and (shared or created_by = public.current_employee_id())
  );

/**
 * Momentet ärver mallens krets.
 *
 * `exists` OCH INTE EN JOIN, och underfrågan går mot `task_template` som själv
 * har RLS på. Det är avsiktligt: policyn behöver inte upprepa villkoret ovan,
 * och den dag mallens krets ändras följer momenten med utan att någon behöver
 * komma ihåg att ändra på två ställen.
 */
drop policy if exists task_template_item_read on task_template_item;
create policy task_template_item_read on task_template_item for select
  to authenticated
  using (
    exists (select 1 from task_template t where t.id = task_template_item.template_id)
  );

/**
 * Genomgången: min egen och ingen annans.
 *
 * ATT NÅGON ANNAN INTE HAR GJORT SIN VECKOGENOMGÅNG ÄR INTE CHEFENS SAK, och
 * det är ett beslut och inte en glömska. En lista över vilka i laget som betat
 * av sin vecka hade gjort genomgången till något man gör FÖR ATT DEN MÄTS —
 * och den dagen slutar den vara ett verktyg och blir en närvarolista. Hela
 * konstruktionen bygger på att man är ärlig mot sin egen lista.
 */
drop policy if exists weekly_review_read on weekly_review;
create policy weekly_review_read on weekly_review for select
  to authenticated
  using (employee_id = public.current_employee_id());

-- -----------------------------------------------------------------------------
-- 5. Registerutdraget
--
-- `weekly_review.employee_id` är en personuppgift: den säger när en namngiven
-- anställd gick igenom sin vecka, och det är en tidsstämplad uppgift om henne.
-- Den läggs till i KALLOR i src/lib/registerutdrag.ts.
--
-- `task_template.created_by` och `archived_by` säger vem som skrev respektive
-- lade undan en arbetsbeskrivning. De svarar inte på "vad har navet registrerat
-- om mig" utan på "vem gjorde något", och står därför i UNDANTAG — samma linje
-- som `task_series.created_by` drog i 0062.
--
-- `task_template_item` har ingen kolumn som pekar på `employee` alls. En mall
-- bär ingen ansvarig: den som använder den väljer vem uppgifterna hamnar på,
-- och en mall med en inbakad person hade varit fel så fort någon slutar.
-- -----------------------------------------------------------------------------
