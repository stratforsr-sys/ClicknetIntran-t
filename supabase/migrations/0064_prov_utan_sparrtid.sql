-- =============================================================================
-- 0064_prov_utan_sparrtid.sql — omtaget sker direkt, och texterna säger det
--
-- Kursen "Släpp inte kunden för tidigt" hade en spärrtid på en timme efter ett
-- underkänt prov. Den tas bort: `retry_wait_hours = 0`.
--
-- VARFÖR SPÄRREN FANNS, OCH VARFÖR DEN ÄNDÅ GÅR BORT
--
-- Spärren är AC-6.2 och finns för att den som underkänts ska läsa om modulen i
-- stället för att gissa vidare. Det är rätt tanke för ett säkerhetsprov, som
-- man gör en gång om året och har hela dagen på sig med.
--
-- Här är det fel verktyg. Kursen är en drill över tre dagar med tjugo minuter
-- per dag, och provet ligger sist i dagens pass. En timmes spärr mitt i det
-- betyder i praktiken inte "läs om modulen" utan "kom tillbaka i morgon", och
-- morgondagen har redan ett eget pass. Beställarens ord: man ska få sitt
-- resultat, göra om provet och gå vidare.
--
-- DET SOM ERSÄTTER SPÄRREN är att rättningen nu visar VILKA frågor som blev
-- fel — men inte vilket svar som var rätt. Facit lämnar servern först när
-- provet är klarat (se `lamnaQuiz` i src/app/(app)/utbildning/actions.ts). Ett
-- omtag kräver alltså fortfarande att man vet svaret; det enda man fått gratis
-- är vilka frågor man ska läsa om. Utan den regeln hade ett borttaget dygn
-- gjort godkäntgränsen till en formsak.
--
-- Spärren står kvar i modellen och gäller varje annan kurs. Det här är en rad i
-- `course`, inte en ändrad regel.
--
-- TEXTERNA I PROVMODULERNA lovade en timme, och en kurs som säger en sak medan
-- knappen gör en annan är värre än båda alternativen. De fyra provens
-- ingresser skrivs om i samma svep, så att beskedet och beteendet säger samma
-- sak.
-- =============================================================================

do $$
declare
  v_kurs  uuid;
  v_antal int;
begin
  select id into v_kurs from course where slug = 'slapp-inte-kunden-for-tidigt';
  if v_kurs is null then
    raise exception 'Kursen slapp-inte-kunden-for-tidigt finns inte.';
  end if;

  update course
  set retry_wait_hours = 0,
      updated_at = now()
  where id = v_kurs;

  -- Prov 1 är det enda som nämner spärren i klartext. De tre andra får samma
  -- besked tillagt, så att alla fyra säger vad som händer när man missar.
  update course_module
  set body_md = btrim($md$
Tolv frågor om regeln, de fyra exiterna och vad som faktiskt räknas som en
fråga.

**Läs alternativen noga.** I flera av frågorna är tre av fyra svar riktiga
frågor — det är vilken av dem som för samtalet framåt som skiljer dem åt. Och i
minst en fråga har kunden redan svarat på ett av alternativen.

Godkänt är 80 procent, alltså tio av tolv. **Missar du får du se exakt vilka
frågor som blev fel**, och kan göra om provet direkt. Vilket svar som var det
rätta visas först när du klarat provet — annars vore omtaget en avskrivning.
$md$)
  where course_id = v_kurs and sort = 5;

  update course_module
  set body_md = btrim($md$
Tolv motstånd. Välj den följdfråga som ger dig mest att gå vidare på.

**Här är nästan varje alternativ en riktig fråga.** Det som skiljer dem åt är om
frågan hämtar det du saknar, eller om den hoppar över ett lager, antar något
kunden inte sagt, eller frågar om något han redan har svarat på.

Godkänt är 80 procent — tio av tolv. Missar du ser du vilka frågor som blev
fel, och gör om provet direkt.
$md$)
  where course_id = v_kurs and sort = 8;

  update course_module
  set body_md = btrim($md$
Elva frågor om kedjan.

Här räcker det inte att veta att man ska ställa en fråga. Frågorna handlar om
**vilken** fråga som hör hemma efter just det svar kunden gav — och i två av dem
är rätt svar att sluta fråga.

Godkänt är 80 procent, alltså nio av elva. Missar du ser du vilka frågor som
blev fel, och gör om provet direkt.
$md$)
  where course_id = v_kurs and sort = 11;

  update course_module
  set body_md = btrim($md$
Elva lägen. Är det ett motstånd du ska fråga vidare på, eller ett nej du ska
respektera?

**Strategin "välj alltid frågan" ger underkänt här.** Båda felen kostar: släpper
du för tidigt tappar du affären, och släpper du för sent tappar du numret.

Godkänt är 80 procent, alltså nio av elva. Missar du ser du vilka frågor som
blev fel, och gör om provet direkt.
$md$)
  where course_id = v_kurs and sort = 14;

  -- Självkontroll: ingen text får lova en väntetid som inte längre finns.
  select count(*) into v_antal
  from course_module
  where course_id = v_kurs and body_md like '%efter en timme%';
  if v_antal > 0 then
    raise exception '% moduler lovar fortfarande en timmes vantetid.', v_antal;
  end if;

  select retry_wait_hours into v_antal from course where id = v_kurs;
  if v_antal <> 0 then
    raise exception 'Sparrtiden ar fortfarande % timmar.', v_antal;
  end if;

  raise notice 'Sparrtiden borttagen och de fyra provtexterna omskrivna.';
end $$;
