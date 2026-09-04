-- =============================================================================
-- 0047_notishandelser.sql — det som HANDE far en rad, det som VANTAR har ingen
--
-- ===========================================================================
-- DEN HAR TABELLEN UPPHAVER INTE 0018. DEN DELAR FRAGAN I TVA.
--
-- 0018 valde bort en notistabell med ett argument som fortfarande haller: en
-- tabell dar varje producent skriver sin rad ger en TYST LUCKA nar nagon
-- glommer, och en kurs som lagts upp utan att nagon fick veta ser precis ut som
-- en kurs ingen brydde sig om. Darfor raknas klockans poster fram ur `document`,
-- `course`, `news_post`, `absence_request` och resten vid lasning, och darfor
-- fortsatter de gora det.
--
-- Men det argumentet galler bara den ena sortens post. Klockan bar tva:
--
--   1. "NAGOT VANTAR PA DIG."  En okvitterad rutin, en ogjord kurs, en
--      obeslutad ansokan. Tillstandet FINNS KVAR i raden sa lange saken ar
--      ogjord, sa posten gar att rakna fram — och en producent som glommer kan
--      inte skapa en lucka, eftersom det ar sjalva tillstandet som utloser
--      posten. Harledning ar ratt svar, och 0018 star.
--
--   2. "NAGOT HANDE DIG."  Din uppgift blev godkand, din order returnerad,
--      ditt arende tilldelat nagon annan, din rattelse avslagen. De posterna
--      gar INTE att rakna fram, for tillstandet skrivs over av handelsen: en
--      returnerad order far status `utkast` igen och ar da omojlig att skilja
--      fran ett utkast som aldrig skickats in, och en godkand coachningsuppgift
--      ar bara `klar`.
--
-- Fram till i dag saknade navet den andra sorten helt. Foljden var att den som
-- godkande en ledighetsansokan fick ett besked (`absence_request.decided_at`
-- finns kvar och gar att harleda) medan den som godkande en coachningsuppgift
-- inte gav nagot besked alls — inte for att nagon valt det, utan for att raden
-- inte bar spar av handelsen efterat.
--
-- ===========================================================================
-- VARFOR INTE `audit_log`
--
-- Loggen bar redan varje handelse med aktor, objekt och tidpunkt, och det var
-- forsta forslaget. Det faller pa tva saker, och den forsta ar avgorande:
--
--   - `audit_log_read` slapper in sales_manager, ceo och admin. PRD §5.2 sager
--     uttryckligen "aldrig av salesperson". En klocka byggd pa loggen hade
--     krävt att den policyn oppnades for alla — alltsa att hela handelseloggen
--     lastes upp for att kunna saga "din order godkandes".
--   - Loggen sager VEM SOM GJORDE NAGOT, inte VEM SOM BEHOVER VETA. `actor_id`
--     ar den som tryckte; mottagaren star ibland i `meta`, ibland i objektet,
--     ibland ingenstans. Att harleda mottagaren ur loggen hade blivit ett andra
--     regelverk vid sidan av det som redan avgor vem som far se raden.
--
-- Den har tabellen bar MOTTAGAREN i en kolumn, och RLS pa den kolumnen. Det ar
-- hela skillnaden.
-- ===========================================================================

create table if not exists notification_event (
  id bigserial primary key,

  -- MOTTAGAREN, inte objektet. En handelse som ror tre personer blir tre rader,
  -- och det ar med flit: en rad per mottagare gor RLS till ett likhetstecken i
  -- stallet for en uppslagning genom det objekt raden pekar pa. Det senare hade
  -- betytt att var och en av de tolv tabeller som skriver hit behovde sin egen
  -- gren i policyn nedan.
  employee_id uuid not null references employee(id) on delete cascade,

  -- Kallan, som den heter i `NOTIS_KALLOR` i src/lib/notiser.ts. Fritext med
  -- samma motivering som `notification_dismissed.notice_id` i 0038: en check
  -- hade bara varit en andra kopia av listan i TypeScript, och tva listor
  -- glider isar. Provet i tests/notiser.mjs haller efter dem i stallet.
  kalla text not null check (length(btrim(kalla)) between 1 and 40),

  -- Notistypen: styr ikon och etikett i klockan. Samma resonemang som ovan.
  typ text not null check (length(btrim(typ)) between 1 and 40),

  -- TEXTEN SKRIVS VID HANDELSEN, INTE VID LASNINGEN.
  --
  -- Det ar den ena verkliga kostnaden med den har tabellen, och den ar betald
  -- med flit. En rubrik som raknas fram vid lasning foljer med nar objektet
  -- andras — och det ar precis fel har. "Din order pa 12 000 kr godkandes"
  -- ska sta kvar oforandrad aven sedan ordern makulerats, for det VAR vad som
  -- hande. En harledd text hade skrivit om historien varje gang raden rordes.
  rubrik text not null check (length(btrim(rubrik)) between 1 and 200),
  detalj text not null default '' check (length(detalj) <= 300),

  -- Dit klicket gar. Alltid en intern sokvag; `check` nedan haller ute allt som
  -- ser ut som en annan vard, eftersom strangen hamnar i ett `href`.
  href text not null check (href ~ '^/[^\s]*$' and length(href) <= 300),

  -- Vem som utloste den. Nollbar: nattjobbet har ingen aktor, precis som i
  -- `audit_log`. Fältet ar till for att KUNNA saga "Anna godkande" och for att
  -- notishjalparen ska kunna vagra skicka en notis till den som sjalv tryckte.
  actor_id uuid references employee(id) on delete set null,

  -- Vad handelsen gallde. Bara for felsokning och for nattjobbets rensning —
  -- klockan laser dem inte. Textkolumn och inte uuid: `object_id` i `audit_log`
  -- ar ocksa text, och nagra objekt (jobbsteg, perioder) har inga uuid:n.
  object_type text,
  object_id   text,

  created_at timestamptz not null default now()
);

-- Klockan laser "mina senaste, nyast forst" och ingenting annat.
create index if not exists notification_event_person
  on notification_event (employee_id, created_at desc);

-- Nattjobbets rensning gar pa aldern ensam.
create index if not exists notification_event_alder
  on notification_event (created_at);

alter table notification_event enable row level security;

-- Bara sina egna, och bara lasning — exakt som `notification_dismissed` i 0038.
-- Skrivningen gar genom `notifiera()` med service role. Fick klienten skriva
-- har kunde vem som helst lagga en rad i nagon annans klocka, och till skillnad
-- fran en harledd post finns det ingen underliggande rad som motsager den.
drop policy if exists notification_event_read on notification_event;
create policy notification_event_read on notification_event for select
  to authenticated
  using (employee_id = public.current_employee_id());

-- -----------------------------------------------------------------------------
-- Sjalvkontroll — samma sort som 0032, 0034, 0035, 0036 och 0038 avslutades med.
-- -----------------------------------------------------------------------------

do $$
declare
  skrivpolicyer int;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'notification_event' and c.relrowsecurity
  ) then
    raise exception 'notification_event saknar row level security';
  end if;

  select count(*) into skrivpolicyer
  from pg_policies
  where schemaname = 'public'
    and tablename = 'notification_event'
    and cmd <> 'SELECT';

  if skrivpolicyer > 0 then
    raise exception 'notification_event har % skrivpolicy(er) — skrivning ska ga via service role', skrivpolicyer;
  end if;

  -- Kolumnen som BAR hela behorighetsresonemanget. Faller indexet bort blir
  -- klockan langsam; faller kolumnen bort blir den fel.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_event'
      and column_name = 'employee_id' and is_nullable = 'NO'
  ) then
    raise exception 'notification_event.employee_id maste finnas och vara not null';
  end if;
end;
$$;

comment on table notification_event is
  'Punkthandelser i klockan: det som HANDE nagon. Vantelagen ("nagot vantar pa dig") harleds fortfarande ur sina egna tabeller vid lasning, se 0018. En rad per MOTTAGARE. Rensas av nattjobbet efter 90 dagar.';
comment on column notification_event.rubrik is
  'Skrivs vid handelsen och andras aldrig. En harledd text hade skrivit om historien nar objektet andrades.';
