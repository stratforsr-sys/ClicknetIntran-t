-- =============================================================================
-- 0062_upprepning.sql — uppgifter och coachningsuppgifter som återkommer.
--
-- Beställningen 2026-09-17: "har du lagt till upprepade tasks i kalender och i
-- uppgifter?" — och efter genomgång: uppgifter OCH coachningsuppgifter, riktiga
-- kopior födda i förväg, mönstren dagligen/vardagar/veckovis med valda dagar,
-- Outlooks fråga "bara den här eller hela serien", bara närmaste förekomsten
-- notiserar, och ingen inblandning från ledigheten.
--
-- =============================================================================
-- SERIEN ÄR EN REGEL. FÖREKOMSTEN ÄR EN RIKTIG UPPGIFT.
--
-- Det fanns tre vägar att gå, och valet mellan dem är hela den här migrationen:
--
--   1. EN RAD MED EN REGEL, och kalendern räknar fram resten vid läsning.
--      Billigast i databasen och dyrast i allt annat: en bockad förekomst
--      måste bokföras i en undantagstabell, `task_event` får ingen rad att
--      hänga på, `uppgift_synlig()` ska svara om en uppgift som inte finns,
--      och registerutdraget kan inte läsa det som aldrig skrevs.
--
--   2. NÄSTA FÖDS NÄR DEN FÖRRA BOCKAS AV. Minst data, men kalendern kan bara
--      visa en enda förekomst — och en planeringsvy som inte kan säga att
--      fredagen om tre veckor redan är upptagen är inte en planeringsvy.
--
--   3. RIKTIGA KOPIOR, FÖDDA I FÖRVÄG. Vald.
--
-- Följden av (3) är att INGENTING ANNAT I NAVET BEHÖVER LÄRA SIG NÅGOT NYTT.
-- En förekomst är en rad i `task` eller `coaching_task` med allt det innebär:
-- sin egen krets, sin egen historik, sin egen plats i kalendern, i dagssumman,
-- i morgonbrevet, i iCal-flödet och i registerutdraget. Serien lägger till ett
-- ursprung — den tar inte över något.
--
-- Priset står i `src/lib/upprepning-server.ts`: någon måste föda dem, och det
-- får inte bli dubbelt. Se `series_on` nedan.
--
-- =============================================================================
-- EN TABELL FÖR BÅDA SLAGEN, INTE TVÅ
--
-- `task` och `coaching_task` är två tabeller med två kretsar och två moduler,
-- och det är rätt. Men REGELN är ordagrant densamma: ett mönster, en startdag,
-- ett valfritt slut och en mall att föda ur. Två tabeller hade betytt två
-- ställen att räkna fram nästa måndag på, och den dagen de räknar olika är det
-- ingen som ser det — förekomsterna hamnar bara en dag fel i den ena modulen.
--
-- Mallfälten som bara gäller det ena slaget står därför som nullbara kolumner
-- med ett villkor som håller dem tomma för det andra. Det är den billigaste
-- formen av "det här fältet betyder ingenting här" som databasen kan uttrycka.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Regeln
-- -----------------------------------------------------------------------------

create table if not exists task_series (
  id uuid primary key default gen_random_uuid(),

  -- Vad serien föder. Avgör vilken tabell förekomsten hamnar i.
  slag text not null check (slag in ('uppgift', 'coachningsuppgift')),

  /**
   * Mönstret.
   *
   * TRE OCH INTE TIO. Beställarens ord 2026-09-17: "om man kan välja en dag, så
   * tex måndag, då upprepas ju den varje måndag, så dagligen, vardagar, eller
   * veckovis där man kan välja en dag". Månadsvis, "första måndagen" och
   * årligen står medvetet utanför — de efterfrågades inte, och varje mönster
   * som finns är ett mönster som måste räknas rätt över årsskiften och
   * skottdagar.
   *
   * `vardagar` är inte samma sak som `veckovis` med fem dagar ikryssade, även
   * om de föder samma datum. Skillnaden syns när någon läser regeln: "varje
   * vardag" är en avsikt, "måndag, tisdag, onsdag, torsdag och fredag" är en
   * uppräkning som ser ut att ha valts dag för dag.
   */
  monster text not null check (monster in ('dagligen', 'vardagar', 'veckovis')),

  /**
   * Veckodagarna, 1 = måndag … 7 = söndag. Samma numrering som
   * `veckodag()` i src/lib/uppgifter.ts och som `work_schedule.weekday` i 0010.
   *
   * TOM FÖR ALLA MÖNSTER UTOM `veckovis`, och det är ett villkor och inte en
   * vana: en dagligserie som bär `{1,3}` i fältet är en regel som säger två
   * saker samtidigt, och den dag någon skriver om beräkningen är det ren tur
   * vilken av dem som vinner.
   */
  veckodagar smallint[] not null default '{}',

  starts_on date not null,

  /**
   * Null = serien löper vidare. Beställarens val: ett slutdatum ska gå att
   * sätta, men inte krävas.
   */
  ends_on date,

  -- --- Mallen: det varje förekomst föds med -----------------------------------

  title          text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  description_md text not null default '',

  /**
   * Klockslaget är gemensamt för hela serien, och det är hela poängen med en
   * serie: "varje måndag 09:00". Den som flyttar EN förekomst till 10:00 får
   * göra det på förekomsten — se `series_losgjord` nedan.
   */
  due_time         time,
  estimate_minutes integer
    check (estimate_minutes is null or (estimate_minutes > 0 and estimate_minutes <= 1440)),

  /**
   * Den som förekomsterna hamnar på.
   *
   * INTE NULLBAR, till skillnad från `task.assignee_id`. En uppgift utan
   * ansvarig är inkorgen, och det är ett fullt rimligt läge för en enskild
   * tanke. En SERIE utan ansvarig hade fött åtta veckors rader in i en inkorg
   * ingen äger — det är inte en inkorg längre, det är en läcka.
   */
  assignee_id uuid not null references employee(id) on delete cascade,
  created_by  uuid not null references employee(id),

  -- Bara `uppgift`.
  priority   smallint check (priority is null or priority between 1 and 4),
  project_id uuid references project(id) on delete set null,

  -- Bara `coachningsuppgift`. Speglar 0043:s kolumner med samma namn.
  kind        text,
  verify_by   text,
  evidence    text,
  partner_id  uuid references employee(id) on delete set null,
  course_id   uuid references course(id) on delete set null,
  module_id   uuid references course_module(id) on delete set null,
  document_id uuid references document(id) on delete set null,

  /**
   * HUR LÅNGT FRAM SERIEN ÄR FÖDD. Jobbets kvitto, och spärren som gör att en
   * borttagen förekomst stannar borttagen.
   *
   * Utan den hade nattjobbet räknat fram alla datum i fönstret varje natt och
   * skrivit dem som inte fanns — vilket är exakt samma sak som att återuppliva
   * den förekomst användaren tog bort i går. Unikindexet på `(series_id,
   * series_on)` hade stoppat dubbletten bara så länge raden fanns kvar.
   *
   * Fältet flyttas därför bara FRAMÅT, och jobbet föder aldrig ett datum som
   * ligger bakom det.
   */
  materialized_to date,

  /**
   * Serien avslutad. Raden RADERAS INTE, och det är ett val.
   *
   * De förekomster som redan hunnit bli gjorda pekar på serien, och en
   * `on delete set null` hade tyst klippt bandet mellan tolv gjorda måndagar
   * och regeln som la dem där. "Varför står det här i min historik" är en
   * fråga någon kommer att ställa, och den ska gå att svara på.
   */
  ended_at timestamptz,
  ended_by uuid references employee(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_series_frist check (ends_on is null or ends_on >= starts_on),

  /**
   * ===========================================================================
   * `coalesce` RUNT `array_length` ÄR INTE PRYDNAD. LÄS DET HÄR INNAN DU TAR
   * BORT DET.
   *
   * `array_length('{}', 1)` är **NULL**, inte 0. Ett villkor skrivet som
   * `array_length(veckodagar, 1) between 1 and 7` blir därför NULL för en tom
   * array — och ett CHECK-villkor avvisar bara FALSE. NULL SLÄPPS IGENOM.
   *
   * Följden var att "varje vecka, inga dagar valda" gick rakt in i databasen.
   * Den regeln infaller aldrig, föder noll uppgifter, och ser fullkomligt
   * riktig ut i listan. Det upptäcktes av provet mot riktiga databasen
   * (`scratchpad/prov-0062`), inte av att någon läste villkoret — det SER rätt
   * ut, och det är precis vad som gör fällan farlig.
   *
   * Samma fälla finns i `task_series_coachningstyp` nedan, där ett NULL `kind`
   * gjorde `kind in (...)` till NULL. Båda är rättade på samma sätt.
   * ===========================================================================
   */
  constraint task_series_veckodagar check (
    case
      when monster = 'veckovis'
        then coalesce(array_length(veckodagar, 1), 0) between 1 and 7
             and veckodagar <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      else coalesce(array_length(veckodagar, 1), 0) = 0
    end
  ),

  -- Mallfälten hör till sitt slag och till inget annat.
  constraint task_series_uppgiftsfalt check (
    slag = 'uppgift' or (priority is null and project_id is null)
  ),
  constraint task_series_coachningsfalt check (
    slag = 'coachningsuppgift'
    or (kind is null and verify_by is null and evidence is null
        and partner_id is null and course_id is null
        and module_id is null and document_id is null)
  ),

  /**
   * Coachningens egna regler, ordagrant från 0043. De står HÄR OCKSÅ och inte
   * bara där, för serien är det som skriver raden — en serie som bär en
   * motpart lika med den coachade hade fällt varje födsel i åtta veckor, och
   * felet hade dykt upp i ett nattjobbskvitto klockan halv tre på natten i
   * stället för i formuläret där någon kunde rätta det.
   */
  /**
   * `coalesce(..., '')` OCH INTE BARA `in (...)`, av exakt samma skäl som
   * `coalesce` runt `array_length` ovan: `null in ('a','b')` är NULL, inte
   * falskt, och ett CHECK-villkor avvisar bara FALSE.
   *
   * En coachningsserie utan `kind` gick därför rakt in — och skulle ha fött
   * åtta `coaching_task`-rader som faller på 0043:s egna villkor, en efter en,
   * i ett nattjobbskvitto klockan halv tre.
   */
  constraint task_series_coachningstyp check (
    slag <> 'coachningsuppgift'
    or (coalesce(kind, '') in ('kurs', 'rollspel_inspelat', 'lasning', 'rollspel_live',
                               'manus', 'medlyssning', 'uppgift')
        and coalesce(verify_by, '') in ('sjalv', 'motpart', 'skapare', 'chef')
        and coalesce(evidence, '') in ('ingen', 'kommentar', 'fil'))
  ),
  constraint task_series_motpart check (
    partner_id is null or partner_id <> assignee_id
  ),
  constraint task_series_motpart_kravs check (
    verify_by is distinct from 'motpart' or partner_id is not null
  ),
  constraint task_series_kalla check (
    slag <> 'coachningsuppgift'
    or (kind = 'kurs'              and course_id   is not null)
    or (kind = 'rollspel_inspelat' and module_id   is not null)
    or (kind = 'rollspel_live'     and module_id   is not null)
    or (kind = 'lasning'           and document_id is not null)
    or (kind in ('manus', 'medlyssning', 'uppgift'))
  )
);

/**
 * OMKÖRBARHETEN, och varför den behövs för just de här två villkoren.
 *
 * `create table if not exists` gör ingenting alls mot en tabell som redan
 * finns — inte heller mot dess villkor. Migrationen kördes en gång med den
 * NULL-fälla som beskrivs ovan, upptäcktes av provet mot riktiga databasen, och
 * måste kunna köras om med rätt villkor på plats.
 *
 * De två satserna nedan är därför inte en dubblering av villkoren ovan utan
 * deras enda väg in i en databas som redan har tabellen. På en tom databas är
 * de en no-op som genast ersätter sig själva med samma text.
 */
alter table task_series drop constraint if exists task_series_veckodagar;
alter table task_series add constraint task_series_veckodagar check (
  case
    when monster = 'veckovis'
      then coalesce(array_length(veckodagar, 1), 0) between 1 and 7
           and veckodagar <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    else coalesce(array_length(veckodagar, 1), 0) = 0
  end
);

alter table task_series drop constraint if exists task_series_coachningstyp;
alter table task_series add constraint task_series_coachningstyp check (
  slag <> 'coachningsuppgift'
  or (coalesce(kind, '') in ('kurs', 'rollspel_inspelat', 'lasning', 'rollspel_live',
                             'manus', 'medlyssning', 'uppgift')
      and coalesce(verify_by, '') in ('sjalv', 'motpart', 'skapare', 'chef')
      and coalesce(evidence, '') in ('ingen', 'kommentar', 'fil'))
);

/**
 * Jobbets fråga: vilka serier har något ogjort framför sig?
 *
 * Villkoret står i indexet och inte bara i frågan, för det är ett litet urval
 * ur en tabell som växer med varje rutin någon lägger upp och aldrig krymper
 * — avslutade serier ligger kvar som historik.
 */
create index if not exists task_series_levande_idx
  on task_series (materialized_to)
  where ended_at is null;

create index if not exists task_series_ansvarig_idx
  on task_series (assignee_id)
  where ended_at is null;

-- -----------------------------------------------------------------------------
-- 2. Förekomsten pekar tillbaka
--
-- TRE KOLUMNER PÅ VARDERA TABELLEN, och de gör tre olika saker.
-- -----------------------------------------------------------------------------

alter table task add column if not exists series_id uuid
  references task_series(id) on delete set null;

/**
 * VILKEN FÖREKOMST RADEN ÄR, alltså vilket datum i mönstret som födde den.
 *
 * SKILD FRÅN `due_date`, och det är den viktigaste kolumnen i migrationen. Den
 * som drar måndagsförekomsten till onsdagen har ändrat `due_date` — men raden
 * är fortfarande måndagens förekomst, och nästa natt ska jobbet inte se en
 * ofödd måndag och skriva en till. Var `due_date` både frist och identitet
 * hade varje omplanering fött en dubblett.
 */
alter table task add column if not exists series_on date;

/**
 * "BARA DEN HÄR" — förekomsten är lösgjord ur serien.
 *
 * Sätts när någon ändrar en enskild förekomst och väljer att ändringen bara
 * gäller den. Serieändringar skriver aldrig över en lösgjord rad; den är inte
 * längre ett avtryck av mallen utan ett eget beslut.
 *
 * Bandet till serien klipps INTE — raden hör fortfarande till måndagsrutinen,
 * och den som läser historiken ska se det. Det som ändras är vem som bestämmer
 * över fälten.
 */
alter table task add column if not exists series_losgjord boolean not null default false;

alter table coaching_task add column if not exists series_id uuid
  references task_series(id) on delete set null;
alter table coaching_task add column if not exists series_on date;
alter table coaching_task add column if not exists series_losgjord boolean not null default false;

/**
 * SPÄRREN MOT DUBBELFÖDSEL.
 *
 * Nattjobbet är inte ensamt om att skriva: `skapaSerie()` föder det första
 * fönstret direkt, så att den som lägger upp en rutin ser den i kalendern
 * innan hon hunnit stänga formuläret. Två skribenter på samma rad är två
 * chanser att skriva den två gånger, och en uppgift som står dubbelt i
 * kalendern ser ut som en bugg långt innan någon förstår att den är det.
 *
 * INDEXET ÄR HELT OCH INTE PARTIELLT, och det är ett beslut och inte slarv.
 *
 * Ett partiellt index (`where series_id is not null`) hade varit den
 * uppenbara formen — men det går inte att peka ut som konfliktmål från
 * PostgREST, som bara kan skicka kolumnnamn och inte indexets villkor. Utan
 * konfliktmål finns ingen `on conflict do nothing`, och utan den är födseln
 * inte idempotent: den läser vad som finns och skriver resten, med ett glapp
 * emellan där nattjobbet och en människa kan skriva samma måndag.
 *
 * Helt index fungerar ändå, eftersom två NULL inte är lika i ett unikindex.
 * Navets tolv uppgifter utan serie har båda kolumnerna tomma och kolliderar
 * därför inte med varandra — en egenskap hos SQL som här råkar vara precis
 * den man vill ha.
 */
create unique index if not exists task_serieforekomst_unik
  on task (series_id, series_on);

create unique index if not exists coaching_task_serieforekomst_unik
  on coaching_task (series_id, series_on);

create index if not exists task_serie_idx on task (series_id) where series_id is not null;
create index if not exists coaching_task_serie_idx
  on coaching_task (series_id) where series_id is not null;

-- -----------------------------------------------------------------------------
-- 3. Läsningen
--
-- SAMMA KRETS SOM 0054 DROG, OCH INGEN CHEFSKRETS. Rubriken i 0054 gäller
-- ordagrant här: en uppgiftslista är en anteckningsbok, och en RUTIN är om
-- möjligt ännu mer avslöjande än en enskild rad — "varje fredag: gå igenom
-- Eriks siffror" säger något om Erik varje vecka i ett halvår.
--
-- Två personer ser regeln: den förekomsterna hamnar på, och den som la upp
-- den. För en egen rutin är det samma person. För en coachningsrutin är det
-- den coachade och hens chef, vilket är exakt den krets coachningsuppgiften
-- själv har.
--
-- DE INBJUDNA STÅR UTANFÖR. `task_member` gäller en uppgift, inte en regel:
-- den som bjudits in att hjälpa till med fredagens genomgång har fått se
-- fredagens genomgång, inte beskedet att den återkommer varje vecka till jul.
-- -----------------------------------------------------------------------------

alter table task_series enable row level security;

drop policy if exists task_series_read on task_series;
create policy task_series_read on task_series for select
  to authenticated
  using (
    public.current_employee_id() is not null
    and (assignee_id = public.current_employee_id()
         or created_by = public.current_employee_id())
  );

-- -----------------------------------------------------------------------------
-- 4. Registerutdraget
--
-- EN SERIE OM EN NAMNGIVEN ANSTÄLLD ÄR EN PERSONUPPGIFT, av precis samma skäl
-- som `task_link` är det (rubriken i 0054). Skillnaden är att serien lever
-- längre än raderna den föder: den som tar bort tolv förekomster har inte tagit
-- bort regeln som säger att det ska ske varje vecka.
--
-- INGEN VY OCH INGEN KOD HÄR. Utdraget bärs av registret i
-- `src/lib/registerutdrag.ts`, där `task_series.assignee_id` läggs till som
-- källa och `created_by` som en kolumn som pekar på någon annan. Navet har inte
-- en enda vy i sextiotvå migrationer, och en vy hade dessutom kringgått RLS:
-- `security_invoker` är av som förval, så `task_series_read` ovan hade slutat
-- gälla för den som läste genom vyn i stället för genom tabellen.
-- -----------------------------------------------------------------------------
