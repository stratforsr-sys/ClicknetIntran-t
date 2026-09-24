-- =============================================================================
-- 0067_skriftligt_prov.sql — provet med fritextsvar, rättat för hand
--
-- En femte modultyp i M6: `fritext`. Deltagaren skriver svar med egna ord, och
-- en chef sätter poäng fråga för fråga.
--
-- VARFÖR EN NY TYP OCH INTE ETT QUIZ MED LÅNGA ALTERNATIV
--
-- Quizet (0007) har ett facit i `quiz_option` och rättas av servern i samma
-- sekund knappen trycks. Det fungerar för frågor som HAR ett rätt svar. De
-- tjugo frågorna i kursen nedan har inte det: "Vad vill du uppnå med intro-
-- delen?" har svar som är mer eller mindre genomtänkta, och skillnaden mellan
-- dem är precis vad chefen behöver läsa. Fyra alternativ där ett är rätt hade
-- mätt om säljaren känner igen svaret, inte om hon kan formulera det.
--
-- VARFÖR RÄTTNINGEN ÄR EN MÄNNISKA OCH INTE EN MODELL
--
-- Det finns inget facit i den här tabellen, och det är med flit. Ett prov vars
-- svar rättas maskinellt mäter hur svaret är formulerat; det här mäter om
-- säljaren har förstått, och den bedömningen är chefens arbete. Rättarstödet i
-- `essay_question.guidance` är en minneslapp åt rättaren — inte ett facit att
-- jämföra mot.
--
-- TRE SAKER SOM INTE ÄR SJÄLVKLARA
--
--   FRÅGORNA ÄR STÄNGDA FÖR KLIENTEN, precis som `quiz_option` är det. Skälet
--   är `guidance`-kolumnen: den säger vad ett fullpoängssvar innehåller, och
--   det ÄR facit. Sidorna läser frågorna med service role och skickar vidare
--   bara det mottagaren ska se — prompten till den som skriver, prompten plus
--   stödet till den som rättar.
--
--   ALLA CHEFER SER ALLA PROV. Det är beställarens uttryckliga val, och det
--   skiljer modulen från rollspelet (0024), där man bara ser dem man leder. Ett
--   skriftligt prov är ett underlag för säljledningen som helhet — och en kö
--   som bara visar det egna laget hade betytt att en säljare vars chef är
--   sjukskriven aldrig får sitt prov rättat.
--
--   POÄNGEN LIGGER PÅ SVARET, INTE PÅ FÖRSÖKET. `essay_answer.points` är
--   delpoängen fråga för fråga (som `roleplay_score`), och SUMMAN blir ett
--   `course_attempt` med `score` i procent — samma beviskedja som quizet och
--   rollspelet delar sedan 0007. Ett försök får aldrig skrivas över.
-- =============================================================================

-- --- Modultypen -----------------------------------------------------------
-- Listan SPEGLAS av `MODULTYPER` i src/lib/utbildning.ts. Läggs en typ till på
-- ena stället utan det andra nekar databasen och gränssnittet ser ut att ha
-- gått sönder.

alter table course_module drop constraint if exists course_module_kind_check;
alter table course_module add constraint course_module_kind_check
  check (kind in ('reading', 'ovning', 'quiz', 'roleplay', 'fritext'));

-- --- Frågorna -------------------------------------------------------------

create table if not exists essay_question (
  id         uuid primary key default gen_random_uuid(),
  module_id  uuid not null references course_module(id) on delete cascade,
  sort       int  not null,
  prompt     text not null,

  -- Vad ett fullpoängssvar innehåller. Valfritt, och SYNS BARA FÖR RÄTTAREN.
  guidance   text,

  -- 0 fel, 1 delvis, 2 rätt är normalfallet. Taket är per fråga eftersom en
  -- fråga som ber om fyra saker rimligen är värd mer än en som ber om en.
  max_points int  not null default 2 check (max_points between 1 and 10),

  created_at timestamptz not null default now(),
  unique (module_id, sort)
);

create index if not exists essay_question_module_idx on essay_question (module_id, sort);

-- --- Inlämningen ----------------------------------------------------------
--
-- EN RAD ÄR ETT FÖRSÖK, från första tecknet i utkastet till betyget. Statusen
-- går bara framåt:
--
--   utkast  ->  inlamnad  ->  rattad
--                  ^   |
--                  |   v
--                 retur
--
-- `retur` är chefens begäran om komplettering — se `essay_return` nedan, som
-- bär vad som stod i svaren när hon skickade tillbaka det. Ett UNDERKÄNT prov
-- går däremot inte tillbaka till samma rad: då är försöket slut, och ett omtag
-- är en ny rad. Samma regel som rollspelets inlämningar följer (0024), och den
-- är hela skälet till att historiken går att lita på.

create table if not exists essay_submission (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid not null references course_module(id) on delete cascade,
  course_id   uuid not null references course(id) on delete cascade,
  employee_id uuid not null references employee(id) on delete cascade,

  status      text not null default 'utkast'
                check (status in ('utkast', 'inlamnad', 'retur', 'rattad')),

  submitted_at timestamptz,
  graded_at    timestamptz,
  graded_by    uuid references employee(id),

  -- Betyget bor i `course_attempt` och inte här. Två fält att hålla i takt är
  -- två sanningar om samma sak — se `roleplay_submission`, som gör likadant.
  attempt_id   uuid references course_attempt(id) on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Ett rättat försök saknar aldrig sitt betyg, och ett obetygsatt har inget.
  check ((status = 'rattad') = (graded_at is not null))
);

-- HÖGST ETT ÖPPET FÖRSÖK per person och modul. Utan det här indexet ger två
-- flikar två utkast, och den som lämnar in det ena undrar vart det andra tog
-- vägen. Rättade rader är historik och räknas inte.
create unique index if not exists essay_submission_oppen_idx
  on essay_submission (module_id, employee_id)
  where status <> 'rattad';

create index if not exists essay_submission_ko_idx
  on essay_submission (status, submitted_at);

create index if not exists essay_submission_person_idx
  on essay_submission (employee_id, module_id, created_at desc);

-- --- Svaren ---------------------------------------------------------------
--
-- En rad per fråga och försök. Bär BÅDE svaret och rättningen: texten skrivs av
-- säljaren, poängen och kommentaren av chefen. Att lägga rättningen i en egen
-- tabell hade krävt en join för att svara på "vad fick jag på fråga 4", och
-- ingen av de två raderna hade kunnat finnas utan den andra.

create table if not exists essay_answer (
  submission_id uuid not null references essay_submission(id) on delete cascade,
  question_id   uuid not null references essay_question(id) on delete cascade,

  body    text not null default '',

  -- Null = inte rättad än. Taket kontrolleras i server actionen, som har
  -- frågans `max_points` framme — ett CHECK-villkor här hade behövt läsa en
  -- annan tabell, vilket inte går.
  points  int check (points >= 0),
  comment text,

  updated_at timestamptz not null default now(),
  primary key (submission_id, question_id)
);

-- --- Returen --------------------------------------------------------------
--
-- Vad som stod i svaren NÄR chefen skickade tillbaka provet.
--
-- Utan den här tabellen vore returen det enda stället i modulen där ett svar
-- skrivs över: säljaren öppnar sitt prov igen och ändrar i texten, och det hon
-- först skrev finns inte längre någonstans. `answers` är en ögonblicksbild av
-- `essay_answer` — svar, poäng och kommentarer — tagen i samma sekund som
-- returen.

create table if not exists essay_return (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references essay_submission(id) on delete cascade,
  returned_by   uuid references employee(id),
  returned_at   timestamptz not null default now(),
  note          text not null,
  answers       jsonb not null,
  unique (submission_id, returned_at)
);

create index if not exists essay_return_submission_idx
  on essay_return (submission_id, returned_at desc);

-- === Behörighet ============================================================
-- Samma modell som resten av M6: läsning styrs av policy, skrivning sker
-- uteslutande via server actions med service role.

alter table essay_question   enable row level security;
alter table essay_submission enable row level security;
alter table essay_answer     enable row level security;
alter table essay_return     enable row level security;

-- Frågorna syns inte för någon inloggad roll — `guidance` är facit, och en
-- kolumn som inte får läsas skyddas inte av att vyn låter bli att visa den.
-- Ingen policy = noll rader, precis som för `quiz_option` (0007).
revoke select on essay_question from anon, authenticated;

-- ALLA CHEFER SER ALLA PROV, plus var och en sina egna. Skiljer sig från
-- rollspelet med flit — se rubriken överst.
drop policy if exists essay_submission_read on essay_submission;
create policy essay_submission_read on essay_submission for select
  to authenticated
  using (
    employee_id = public.current_employee_id()
    or public.has_any_role(array['sales_manager', 'team_lead', 'admin', 'ceo'])
  );

-- Svaren och returerna ärver inlämningens behörighet. EN fråga besvaras på ett
-- ställe: den dag kretsen ändras ändras den i policyn ovan och ingen annanstans.
drop policy if exists essay_answer_read on essay_answer;
create policy essay_answer_read on essay_answer for select
  to authenticated
  using (exists (select 1 from public.essay_submission s where s.id = submission_id));

drop policy if exists essay_return_read on essay_return;
create policy essay_return_read on essay_return for select
  to authenticated
  using (exists (select 1 from public.essay_submission s where s.id = submission_id));

-- =============================================================================
-- Kursen "Säljstruktur"
--
-- Ett utsäde, inte sanningen: så fort kursen ligger ute är det redaktören i
-- /utbildning som gäller. Satserna nedan gör ingenting alls om slugen redan
-- finns — annars hade en omkörning nollställt frågorna mitt i ett pågående prov.
--
-- KURSEN LÄGGS SOM UTKAST och publiceras i redaktören när grenen är godkänd. En
-- publicerad kurs syns i klockan hos varje säljare i samma sekund raden finns,
-- och raden finns så fort migrationen körts.
--
-- GODKÄNT ÄR 70 % — alltså 28 av 40 poäng. Lägre än quizets 80 med flit: där är
-- varje fråga rätt eller fel, här kostar varje halvbra formulering en poäng, och
-- 80 % på en tvågradig skala över tjugo frågor betyder i praktiken att bara
-- sexton får vara delvis rätt. Gränsen står i `course` och ändras i redaktören.
--
-- INGEN SPÄRRTID (`retry_wait_hours = 0`). Ett underkänt skriftligt prov får
-- ändå sin väntetid av verkligheten: det ska rättas av en människa, och den
-- rundan tar längre än något dygn en tabell kan lova.
-- =============================================================================

create function pg_temp.lagg_provfragor(p_modul uuid, p_text text)
returns int language plpgsql as $f$
declare
  v_rad   text;
  v_delar text[];
  v_sort  int := 0;
begin
  -- Samma textformat som redaktören och `tolkaProvfragor()` i src/lib/prov.ts:
  --   fråga | poängtak | rättarstöd
  for v_rad in
    select btrim(r) from regexp_split_to_table(btrim(p_text), '\n') r where btrim(r) <> ''
  loop
    v_delar := regexp_split_to_array(v_rad, '\s*\|\s*');
    if v_delar[1] is null or btrim(v_delar[1]) = '' then
      raise exception 'Fraga utan text: "%"', v_rad;
    end if;

    v_sort := v_sort + 1;
    insert into essay_question (module_id, sort, prompt, guidance, max_points)
    values (
      p_modul,
      v_sort,
      btrim(v_delar[1]),
      nullif(btrim(coalesce(v_delar[3], '')), ''),
      coalesce(nullif(btrim(coalesce(v_delar[2], '')), '')::int, 2)
    );
  end loop;

  return v_sort;
end;
$f$;

do $seed$
declare
  v_agare uuid;
  v_kurs  uuid;
  v_modul uuid;
  v_antal int;
begin
  if exists (select 1 from course where slug = 'saljstruktur') then
    raise notice 'Kursen saljstruktur finns redan — migrationen gor ingenting.';
    return;
  end if;

  -- Ägaren är den som svarar för innehållet, inte den som råkade köra
  -- migrationen. Säljchefen först, VD som andrahandsval.
  select e.id into v_agare
  from employee e
  join employee_role r on r.employee_id = e.id
  where r.role in ('sales_manager', 'ceo')
  order by (r.role = 'sales_manager') desc, e.created_at
  limit 1;

  if v_agare is null then
    raise exception 'Ingen med rollen sales_manager eller ceo — kursen far ingen agare.';
  end if;

  insert into course (
    slug, title, description_md, audience_roles, status,
    pass_threshold, retry_wait_hours, valid_months, due_days,
    owner_id, created_by
  ) values (
    'saljstruktur',
    'Säljstruktur',
    btrim($md$
Tjugo frågor om strukturen i ett säljsamtal — intro, intresseväckare,
behovsanalys, ROI, presentation och avslut — och om vad du själv behöver bli
bättre på.

**Du skriver med egna ord.** Det finns inga svarsalternativ att välja mellan och
ingen maskin som rättar. Din chef läser varje svar, sätter poäng på det och
skriver tillbaka.

Svaren sparas medan du skriver, så du kan gå ifrån provet och komma tillbaka.
Det lämnas in när du själv säger till.
$md$),
    array['salesperson', 'team_lead']::text[],
    'draft',
    70,   -- godkänt
    0,    -- ingen spärrtid
    12,   -- certifikatet går ut efter ett år
    null, -- ingen frist; den räknas från anställningsdatum och hör hemma på en onboardingkurs
    v_agare,
    v_agare
  )
  returning id into v_kurs;

  insert into course_module (course_id, sort, title, kind, body_md)
  values (
    v_kurs,
    1,
    'Skriftligt prov: säljstrukturen',
    'fritext',
    btrim($md$
Skriv som du skulle sagt det. Det här är inte ett stavningsprov — det är ett
prov på om du kan formulera vad du gör i ett samtal och varför.

**Räkna med fyrtio minuter.** Några frågor ber om ett begrepp, andra om tre
eller fyra alternativ du faktiskt kan säga. De sista två frågorna handlar om dig
själv, och där finns inget rätt svar alls — bara ett konkret och ett luddigt.

**Varje fråga ger noll, en eller två poäng.** Två för ett svar som håller, en
för ett halvt, noll för ett som inte svarar på frågan. Godkänt är 70 procent.

Din chef ser hela provet när du lämnat in det. Hon kan skicka tillbaka det med
frågor om något behöver kompletteras — då ligger dina svar kvar och du fyller på
där hon bett om det.
$md$)
  )
  returning id into v_modul;

  -- Frågorna. Rättarstöd står bara på de två självskattningsfrågorna, och det
  -- stödet handlar om FORMEN och inte om innehållet: vad säljaren ska bli bättre
  -- på är hennes svar, inte kursens. Övriga frågor lämnas utan stöd med flit —
  -- de svaren äger säljledningen, och ett påhittat facit i en migration hade
  -- blivit den norm alla rättar mot utan att någon valt den. Fyll på i
  -- redaktören.
  select pg_temp.lagg_provfragor(v_modul, $q$
Vad är en säljstruktur?
Varför är det så viktigt med en säljstruktur?
Vad vill jag uppnå med ett säljsamtal?
Vad är en behovsanalys?
Vad är viktigare, behovsanalysen eller avslutet?
Hur kommer det sig att behovsanalysen egentligen inte är så viktig?
Vad vill jag uppnå med intresseväckaren?
Vilka är de fyra viktigaste delarna i ROI:n, och vad ska de leda till?
Vilken är den allra viktigaste delen som leder till fler signs?
Vad vill jag uppnå med en presentation?
Jag får något i presentationen — vad är det jag får?
Vad är det viktigaste du behöver förbättra för att sälja mer? | 2 | Inget rätt svar på VAD. Full poäng kräver att hon pekar ut EN sak och att den går att bli bättre på — inte "allt" och inte "mer motivation".
Vad KONKRET kan du göra dagligen för att bli bättre på det du skrev i förra frågan? | 2 | Bedöm om det går att göra i morgon: en handling, en tidpunkt, ett mått. "Träna mer" är noll poäng även om föregående svar var bra.
Ge mig två alternativ som du kan säga i ROI-delen.
Ge mig tre alternativ som du kan säga i introt.
Ge mig alternativa frågor som du kan ställa i behovsanalysen.
Ge mig den allra viktigaste aspekten i behovsanalysen.
Ge mig tre olika intresseväckare. De behöver inte vara topp notch.
Ge mig två olika håll att ge en presentation på.
Ge mig fyra olika avslut, på fyra olika scenarion.
$q$) into v_antal;

  if v_antal <> 20 then
    raise exception 'Provet fick % fragor, inte 20.', v_antal;
  end if;

  -- Självkontroll: taket ska bli fyrtio poäng, alltså 28 för godkänt.
  select sum(max_points) into v_antal from essay_question where module_id = v_modul;
  if v_antal <> 40 then
    raise exception 'Poangtaket ar %, inte 40.', v_antal;
  end if;

  raise notice 'Kursen Saljstruktur skapad som UTKAST med 20 fritextfragor (40 poang).';
end $seed$;
