-- =============================================================================
-- 0061_kurs_slapp_inte_kunden.sql — kursen "Släpp inte kunden för tidigt"
--
-- En färdig kurs i `course`: tio moduler, fyra quiz och ett rollspel som
-- chefen bedömer mot en rubrik. Innehållet är säljdrillen "en fråga till",
-- skriven som en kurs i stället för som ett dokument någon får mejlat.
--
-- VARFÖR INNEHÅLLET LIGGER I EN MIGRATION OCH INTE SKRIVS I REDAKTÖREN
--
-- Kursen är tiotusen tecken text, trettioen frågor med facit och åtta
-- bedömningskriterier. Skrivet för hand i redigeringsvyn är det ett par
-- timmars klistrande som ingen gör om när databasen någon gång sätts upp på
-- nytt, och som inte går att granska innan den ligger ute. Här går den att
-- läsa i en diff.
--
-- MIGRATIONEN ÄR ETT UTSÄDE, INTE SANNINGEN. Så fort kursen ligger ute är det
-- redaktören i /utbildning som gäller: ändra en formulering där, inte här.
-- Den här filen körs en gång, och satserna nedan gör ingenting alls om slugen
-- redan finns — annars hade en omkörning skrivit över chefens rättelser med
-- originaltexten och nollställt frågorna mitt i en pågående kurs.
--
-- FRÅGORNA SKRIVS I SAMMA FORMAT SOM I REDAKTÖREN. `tolkaFragor()` i
-- src/lib/utbildning.ts läser en fråga per stycke, ett svar per rad, stjärna
-- för rätt svar. Hjälparen `pg_temp.lagg_fragor()` nedan läser exakt samma
-- text. Det är med flit: den som vill flytta en fråga hit eller dit kan
-- kopiera den rakt av åt båda hållen, och formatet behöver inte läras in två
-- gånger. Samma sak för rollspelsrubriken och `tolkaKriterier()`.
--
-- HJÄLPARNA LIGGER I pg_temp och försvinner när sessionen tar slut. De är
-- till för den här filen och ska inte bli ett API som nästa kurs bygger på —
-- nästa kurs skrivs i redaktören, som alla andra.
--
-- GODKÄNTGRÄNSEN ÄR 80 % OCH SPÄRRTIDEN EN TIMME, inte det vanliga dygnet.
-- Drillen går över tre dagar, och ett dygns spärr mitt i dag 1 skjuter hela
-- upplägget en dag framåt — vilket i praktiken betyder att det inte blir gjort.
-- En timme räcker för att läsa om modulen och komma tillbaka, och är för lång
-- för att gissa sig igenom provet en gång till på studs.
--
-- KURSEN LÄGGS SOM UTKAST OCH PUBLICERAS I REDAKTÖREN. En publicerad kurs
-- syns i klockan hos varje säljare i samma sekund raden finns — och raden
-- finns så fort migrationen körts, alltså innan grenen är godkänd och mergad.
-- Ett klick på Publicera när kursen är granskad är billigare än ett utskick
-- som gick ut för tidigt.
--
-- `due_days` LÄMNAS TOM MED FLIT. Fristen räknas från personens
-- ANSTÄLLNINGSDATUM och inte från publiceringen (se `kursLage()` i
-- src/lib/utbildning.ts, som matas med `employee.start_date`). En frist på
-- fjorton dagar hade därför gjort kursen försenad — röd, redan första dagen —
-- för varenda säljare som varit anställd längre än så. Fältet hör hemma på en
-- onboardingkurs; det här är en drill för dem som redan är på plats. Behövs en
-- deadline sätts den som en uppgift.
--
-- CERTIFIKATET GÅR UT EFTER TOLV MÅNADER. Det här är ett beteende och inte ett
-- faktum: den som inte drillat på ett år har reflexen tillbaka. Ett certifikat
-- som står kvar för evigt hade sagt att hon kan något hon inte längre gör.
-- =============================================================================

-- --- Hjälpare -------------------------------------------------------------

-- Lägger en modul och ger tillbaka id:t. `sort` är ordningen modulerna tas i,
-- och den är unik per kurs (0007).
create function pg_temp.lagg_modul(
  p_kurs  uuid,
  p_sort  int,
  p_titel text,
  p_kind  text,
  p_body  text
) returns uuid language plpgsql as $f$
declare
  v_id uuid;
begin
  insert into course_module (course_id, sort, title, kind, body_md)
  values (p_kurs, p_sort, p_titel, p_kind, btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$f$;

-- Samma textformat som redaktören: en fråga per stycke, första raden är
-- frågan, varje följande rad ett svarsalternativ som inleds med * (rätt) eller
-- - (fel). Kraven är hårdare här än i gränssnittet på en punkt: exakt ETT rätt
-- svar. Vyn ritar radioknappar, så två stjärnor hade gett en fråga där ett
-- riktigt svar räknas som fel beroende på vilket den svarande råkade välja.
create function pg_temp.lagg_fragor(p_modul uuid, p_text text)
returns int language plpgsql as $f$
declare
  v_block  text;
  v_rader  text[];
  v_fraga  uuid;
  v_sort   int := 0;
  v_ratta  int;
  i        int;
begin
  for v_block in
    select btrim(b) from regexp_split_to_table(btrim(p_text), '\n[ \t]*\n') b
    where btrim(b) <> ''
  loop
    v_rader := array(
      select btrim(r) from regexp_split_to_table(v_block, '\n') r where btrim(r) <> ''
    );

    if array_length(v_rader, 1) < 3 then
      raise exception 'Fraga "%" behover minst tva svarsalternativ.', v_rader[1];
    end if;

    v_sort := v_sort + 1;
    insert into quiz_question (module_id, sort, prompt)
    values (p_modul, v_sort, v_rader[1])
    returning id into v_fraga;

    v_ratta := 0;
    for i in 2 .. array_length(v_rader, 1) loop
      if left(v_rader[i], 1) not in ('*', '-') then
        raise exception 'Svarsalternativ maste inledas med * eller -: "%"', v_rader[i];
      end if;
      if left(v_rader[i], 1) = '*' then
        v_ratta := v_ratta + 1;
      end if;

      insert into quiz_option (question_id, sort, label, is_correct)
      values (v_fraga, i - 1, btrim(substr(v_rader[i], 2)), left(v_rader[i], 1) = '*');
    end loop;

    if v_ratta <> 1 then
      raise exception 'Fraga "%" har % ratta svar. Det ska vara exakt ett.',
        v_rader[1], v_ratta;
    end if;
  end loop;

  return v_sort;
end;
$f$;

-- Rollspelsrubriken, samma format som `tolkaKriterier()`:
--   Rubrik | poängtak | vägledning
create function pg_temp.lagg_kriterier(p_modul uuid, p_text text)
returns int language plpgsql as $f$
declare
  v_rad   text;
  v_delar text[];
  v_sort  int := 0;
begin
  for v_rad in
    select btrim(r) from regexp_split_to_table(btrim(p_text), '\n') r where btrim(r) <> ''
  loop
    v_delar := regexp_split_to_array(v_rad, '\s*\|\s*');
    if v_delar[1] is null or btrim(v_delar[1]) = '' then
      raise exception 'Kriterium utan rubrik: "%"', v_rad;
    end if;

    v_sort := v_sort + 1;
    insert into roleplay_criterion (module_id, sort, label, guidance, max_points)
    values (
      p_modul,
      v_sort,
      btrim(v_delar[1]),
      nullif(btrim(coalesce(v_delar[3], '')), ''),
      coalesce(nullif(btrim(coalesce(v_delar[2], '')), '')::int, 5)
    );
  end loop;

  return v_sort;
end;
$f$;

-- --- Kursen ---------------------------------------------------------------

do $seed$
declare
  v_agare uuid;
  v_kurs  uuid;
  v_modul uuid;
  v_antal int;
begin
  if exists (select 1 from course where slug = 'slapp-inte-kunden-for-tidigt') then
    raise notice 'Kursen finns redan — migrationen gor ingenting.';
    return;
  end if;

  -- Ägaren är den som svarar för innehållet, inte den som råkade köra
  -- migrationen. Säljchefen först, VD som andrahandsval. Finns ingendera är
  -- databasen inte satt upp än, och då ska det synas som ett fel.
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
    owner_id, created_by, published_at
  ) values (
    'slapp-inte-kunden-for-tidigt',
    'Släpp inte kunden för tidigt',
    $md$Kunden säger "vi kör redan Bokadirekt" och samtalet tar slut. Inte för att
kunden sa nej — utan för att du hörde ett nej som inte fanns där.

Den här kursen tränar bort en enda reflex och lär in en enda i stället:
**motstånd betyder en fråga till.** Tre dagars drill, fyra kunskapsprov och ett
inspelat testsamtal som din chef bedömer mot en rubrik du får se i förväg.

Räkna med 20–30 minuter per dag i tre dagar. Du behöver en telefon som spelar
in och en kollega som kan spela kund en av dagarna.$md$,
    array['salesperson', 'team_lead']::text[],
    'draft',
    80,
    1,
    12,
    null,
    v_agare,
    v_agare,
    null
  ) returning id into v_kurs;

  -- ======================================================================
  -- 1. Reflexen
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 1, 'Reflexen du ska träna bort', 'reading', $md$
## Det som händer

Du ringer. Du kommer förbi de första sekunderna. Och så säger kunden:

> "Vi kör Bokadirekt."

Och någonting i dig svarar, innan du hunnit tänka:

> "Okej, då är det kört."

Ibland säger du det högt. Oftare säger du det inte alls — du säger något annat
som betyder samma sak:

> "Jag förstår. Jag skickar ett mejl så kan du titta när du hinner."

Samtalet är slut. Kunden har inte sagt nej. Du har sagt det åt honom.

## Fyra sätt att släppa

Nästan allt som går fel efter ett motstånd är en av de här fyra. Lär dig känna
igen dem på dig själv — det är dem resten av kursen handlar om.

| Exiten | Hur den låter | Vad den egentligen är |
|---|---|---|
| **Avslutet** | "Okej, då stör jag inte mer." | Du drar tillbaka dig själv innan kunden hunnit ta ställning. |
| **Pitchen** | "Absolut, och det vi gör är…" | Du börjar sälja på information du inte har. |
| **Försvaret** | "Jag förstår, men det där brukar faktiskt…" | Du gör kunden till motståndare i stället för uppgiftslämnare. |
| **Artigheten** | "Jag förstår, jag skickar ett mejl." | Ett artigt sätt att lämna samtalet. Mejlet öppnas inte. |

Tre av fyra låter dessutom som att du gör något. Det är därför de är svåra att
se på sig själv: pitchen känns som att sälja, försvaret känns som att stå upp
för tjänsten, och mejlet känns som ett nästa steg. Ingen av dem är det.

## Motstånd är inte ett nej

Det här är hela kursen i en tabell:

| | Vad det är | Vad du gör |
|---|---|---|
| **Motstånd** | Information om kundens läge. "Vi kör Bokadirekt" berättar vad kunden har, inte vad kunden vill. | Ställer en fråga till. |
| **Nej** | Ett beslut. "Nej, jag vill inte prata om det här." | Tackar, noterar, lägger på. |

Ett motstånd är det första kunden råkar säga för att slippa ta i frågan. Det är
sällan hela sanningen och nästan aldrig ett beslut. "Vi har någon som sköter
det" kan betyda att svågern gjorde hemsidan 2019. "Vi har fullt" kan betyda att
de har fullt på tisdagar.

Du vet inte vilket. Det är just det som är poängen: **du släppte innan du visste
någonting.**

## Varför reflexen finns

Den är inte ett kunskapsproblem. Du vet redan att man ska ställa följdfrågor.

Reflexen handlar om obehag. Motstånd känns som avvisande, och avvisande vill man
bort ifrån. Att avsluta, pitcha eller lova ett mejl gör alla tre samma sak: de
tar bort obehaget på en sekund.

Därför går den inte att läsa bort. Den måste tränas bort, tillräckligt många
gånger för att det nya svaret ska komma före det gamla.

## Så här ser kursen ut

| Del | Vad du gör | Tid |
|---|---|---|
| Modul 2–3 | Regeln, och ett prov på om du kan skilja en fråga från en exit | 15 min |
| Modul 4–5 | **Dag 1:** trettio motstånd, trettio följdfrågor | 20 min |
| Modul 6–7 | **Dag 2:** tre lager djupt, med en kollega | 25 min |
| Modul 8–9 | **Dag 3:** motstånd under press — och var gränsen går | 20 min |
| Modul 10 | Sluttestet: ett inspelat samtal, bedömt mot rubrik | 15 min |

Du behöver:

- **en telefon som spelar in** — hela kursen bygger på att du hör dig själv
- **en kollega** i cirka tjugo minuter på dag 2
- **tre dagar.** Inte tre timmar. Reflexen sitter i nattsömnen mellan passen

Modulerna tas i ordning och går inte att hoppa över. Fristen är fjorton dagar.

**Nästa modul:** regeln. Den är en mening lång.
$md$);

  -- ======================================================================
  -- 2. Regeln
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 2, 'Regeln: motstånd → en fråga till', 'reading', $md$
## Regeln

> **När kunden säger något som inte är ett definitivt nej ställer du en fråga
> till.**

Det är hela regeln. Den har inga undantag den här veckan — inte för att undantag
saknas i verkligheten, utan för att en regel med undantag inte går att
automatisera, och det är automatiseringen som är målet.

## Det du inte får göra

När du hört ett motstånd får du **inte**:

- avsluta samtalet
- börja pitcha
- försvara tjänsten
- förklara varför kunden har fel
- säga "jag förstår, jag skickar…"
- byta ämne

Du får göra **en** sak: ställa en relevant följdfråga.

## Vad som räknas som en fråga

Här faller de flesta. En mening med frågetecken är inte automatiskt en fråga.
Testet har två delar, och båda måste stämma:

1. **Lämnar du över ordet?** Efter din mening ska det vara kundens tur, och han
   ska behöva säga mer än ja eller nej för att svara.
2. **Är svaret okänt för dig?** Frågar du något du redan vet svaret på ställer
   du inte en fråga — du gör en poäng.

Kör de här fyra genom testet:

| Mening | Räknas? | Varför |
|---|---|---|
| "Hur länge har ni kört med Bokadirekt?" | Ja | Du vet inte. Han måste svara med något. |
| "Vill ni inte ha fler kunder?" | Nej | Du vet svaret. Det är en poäng med frågetecken. |
| "Absolut, och vi hjälper ju många salonger — låter det intressant?" | Nej | En pitch med ett frågetecken efter. |
| "Är du nöjd med dem?" | Knappt | Ja eller nej tillbaka, och sen står du still igen. |

**Smygpåståendet** är den vanligaste varianten: du säger något om din tjänst och
sätter ett frågetecken sist. Det känns som en fråga när du säger det, och det
hörs som en pitch för den som lyssnar.

## Frågeorden

Fråga med **hur**, **vad**, **vilken**, **hur mycket**, **hur länge**. De kräver
ett svar med innehåll.

Var försiktig med **varför**. "Varför gjorde ni så?" låter som ett krav på en
förklaring. Säg "vad var det som gjorde att ni…" i stället — samma svar, utan
att kunden måste försvara sig.

## Kvittera, sedan fråga

Frågan ska inte komma som ett åsneskutt. Kvittera först, med ett enda ord:

> "Okej. Hur länge har ni kört med dem?"
>
> "Aha. Hur stor del av kunderna kommer den vägen?"

**"Okej"** och **"aha"** är kvitteringar. **"Jag förstår, men…"** är det inte —
ordet "men" tar tillbaka ordet och inleder ett försvar. Det är exiten som
klär ut sig till empati.

## Håll frågan kort

Under tolv ord. En lång fråga innehåller nästan alltid ett påstående någonstans
på vägen, och kunden svarar på den delen i stället.

## STOPP

De här tre ska utlösa ett stopp mitt i meningen, varje gång du hör dig själv
börja:

- "Absolut, och det vi…" → **STOPP**
- "Jag förstår, men…" → **STOPP**
- en förklaring av tjänsten → **STOPP**

Du går tillbaka till det kunden senast sa och ställer en fråga om det.

## Principen bakom regeln

Memorera inte replikerna. Memorera det här:

> **Jag behöver inte övertyga kunden ännu. Jag behöver förstå varför kunden
> säger det han säger.**

**Nästa modul:** ett prov på om du kan skilja de fyra åt i skarpt läge.
$md$);

  -- ======================================================================
  -- 3. Quiz: fråga eller exit
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 3, 'Prov: fråga eller exit?', 'quiz', $md$
Nio repliker. För varje: vilket svar följer regeln?

Gränsen är 80 procent. Missar du den kan du läsa om modul 2 och göra ett nytt
försök efter en timme — spärren finns för att du ska läsa om modulen, inte för att
straffa dig.
$md$);

  perform pg_temp.lagg_fragor(v_modul, $q$
Kunden: "Vi kör Bokadirekt." Vilket svar följer regeln?
* "Okej. Hur länge har ni kört med dem?"
- "Okej, då är det kört. Tack för din tid."
- "Absolut, och det vi gör är något helt annat än Bokadirekt."
- "Jag förstår. Jag skickar ett mejl så kan du titta när du hinner."

Vilken av de här är ett smygpåstående?
* "Vi hjälper faktiskt många salonger att få fler bokningar — låter det intressant?"
- "Hur ser bokningsflödet ut hos er idag?"
- "Hur stor del av kunderna kommer via Bokadirekt?"
- "Vad var det som gjorde att ni valde Bokadirekt från början?"

Kunden: "Vi har redan någon som sköter det." Vilken fråga ger dig mest att gå på?
* "Okej. Vad är det de gör åt er idag?"
- "Är du nöjd med dem?"
- "Gör de även teknisk SEO och länkbygge?"
- "Vi brukar vara ett bra komplement till en befintlig byrå — hur ser ni på det?"

Vad är skillnaden mellan motstånd och ett nej?
* Motstånd är information om kundens läge; ett nej är ett uttalat beslut.
- Ingen — båda betyder att du ska gå vidare till nästa nummer.
- Motstånd är ett nej som kunden inte vågar säga rakt ut.
- Motstånd betyder att du pratar med fel person.

Vad är problemet med "Jag förstår, men…"?
* "Men" tar tillbaka ordet och inleder ett försvar i stället för en fråga.
- Ingenting, det visar empati innan man går vidare.
- Meningen är för lång för ett telefonsamtal.
- Kunden hinner inte uppfatta att du lyssnat.

Kunden: "Vi har fullt just nu." Vilken följdfråga håller dörren öppen utan att argumentera?
* "Okej. Är målet att ligga kvar på den nivån, eller vill ni växa mer?"
- "Men vill ni inte tjäna mer pengar?"
- "Det brukar ändå löna sig att ligga före nästa svacka."
- "Okej, jag hör av mig om ett halvår då."

Vilken av de här räknas INTE som en följdfråga, trots frågetecknet?
* "Vill ni inte ha fler kunder?"
- "Hur ser det ut idag?"
- "Vad har ni testat tidigare?"
- "Hur länge har det varit så?"

Kunden: "Skicka ett mejl." Vilket svar följer regeln?
* "Absolut. Vad är det viktigaste att jag får med i det?"
- "Okej, jag mejlar dig idag. Ha en fin dag!"
- "Mejl brukar tyvärr inte ge så mycket — kan vi inte ta det nu?"
- "Vad har du för mejladress?"

Du hör dig själv säga "Absolut, och det vi gör är…". Vad gör du?
* Stoppar mitt i meningen och ställer en fråga om det kunden senast sa.
- Avslutar meningen och ställer en fråga efteråt.
- Ber om ursäkt och börjar om från början.
- Fortsätter — pitchen är redan påbörjad och avbryter du blir det konstigt.
$q$);

  -- ======================================================================
  -- 4. Dag 1
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 4, 'Dag 1: trettio motstånd, trettio följdfrågor', 'reading', $md$
## Dagens enda uppgift

Trettio motstånd. Trettio följdfrågor. Ingen försäljning.

Du ska inte sälja, inte argumentera, inte förklara, inte övertyga. Du ska ställa
**en relevant fråga** och sedan vara tyst.

## Så här gör du — 15 minuter, ensam

1. Starta inspelningen på telefonen.
2. Läs motstånd nummer 1 högt, som om kunden sa det.
3. **Pausa en sekund.**
4. Svara högt med **en enda fråga**.
5. Fråga dig själv: *ställde jag en fråga eller smög jag in ett påstående?*
6. Vidare till nästa.

Kör de tio första motstånden tre varv, eller hela listan en gång. Pausen i steg
3 är inte att fylla ut tid — det är där reflexen bryts. Utan den kommer det
gamla svaret först.

Lyssna sedan igenom inspelningen. Räkna. **Minst 27 av 30 ska vara riktiga
frågor.**

## De trettio

1. "Vi har redan en hemsida."
2. "Vi kör Bokadirekt."
3. "Vi har Instagram."
4. "Vi får kunder genom rekommendationer."
5. "Vi har någon som sköter det."
6. "Vi har redan mycket kunder."
7. "Vi behöver inte fler."
8. "Vi är ganska fullbokade."
9. "Vi har testat SEO tidigare."
10. "Vi får kunder ändå."
11. "Skicka ett mejl."
12. "Jag har inte tid nu."
13. "Vi har ingen budget."
14. "Det är inget vi prioriterar just nu."
15. "Jag är inte så intresserad."
16. "Vi har en byrå sedan flera år."
17. "Min son sköter hemsidan."
18. "Vi ligger redan högt på Google."
19. "Vi annonserar redan."
20. "Det där har vi testat. Det gav ingenting."
21. "Vi är för små för sånt."
22. "Jag måste prata med min kollega."
23. "Ring efter sommaren."
24. "Vi håller på att byta system."
25. "Vi vet inte om vi ska fortsätta med verksamheten."
26. "Vi får för många förfrågningar redan."
27. "Det är för dyrt."
28. "Jag litar inte på folk som ringer."
29. "Jag vet inte riktigt vad du menar."
30. "Vad kostar det?"

## Tre av dem är fällor

**Nummer 11, "skicka ett mejl"**, är inte ett nej — det är kundens sätt att
avsluta artigt. Regeln gäller: "Absolut. Vad är det viktigaste att jag får med?"
Svaret berättar vad han faktiskt bryr sig om, och nu har du det i klartext.

**Nummer 28, "jag litar inte på folk som ringer"**, är inte riktat mot dig. Det
är det ärligaste motstånd du kan få: "Okej. Vad är det som brukar gå fel när
folk ringer dig?"

**Nummer 30, "vad kostar det?"**, ser ut som intresse och är ett motstånd i
förklädnad. Svarar du med en siffra innan du vet något har du gett kunden allt
han behöver för att säga nej. Kvittera och fråga tillbaka: "Det beror på vad ni
behöver — hur ser det ut hos er idag?"

## Vanliga fel på dag 1

| Felet | Hur det låter |
|---|---|
| Tvåfrågan | Du ställer två frågor i rad och kunden svarar på den lättaste. |
| Den ledande | "Men ni vill väl ändå synas?" Ett påstående i fråge-kläder. |
| Den långa | Fjorton ord, varav sex är en pitch. Håll dig under tolv. |
| Tystnadsflykten | Du frågar och fyller själv i svaret efter en halv sekunds tystnad. |

Den sista är den svåraste. **Tystnaden efter frågan är din, inte kundens.** Låt
den ligga.

## Målet för dagen

**30 motstånd → 30 följdfrågor. Minst 27 av 30 ska vara riktiga frågor.**

Klarar du inte det: kör listan en gång till imorgon innan du går vidare. Det är
ingen förlust — dag 2 bygger på att det här sitter.

**Nästa modul:** ett prov på urvalet. Åtta motstånd, fyra svar vardera.
$md$);

  -- ======================================================================
  -- 5. Quiz dag 1
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 5, 'Prov: välj följdfrågan', 'quiz', $md$
Åtta motstånd ur listan. Välj den följdfråga som ger dig mest att gå vidare på —
utan att sälja, argumentera eller förklara.

Flera svar är frågor. Bara ett av dem är en **bra** fråga.
$md$);

  perform pg_temp.lagg_fragor(v_modul, $q$
"Vi får kunder genom rekommendationer."
* "Okej. Hur stor del av era nya kunder skulle du säga kommer därifrån?"
- "Och hur går det när rekommendationerna tar slut?"
- "Rekommendationer är guld. Har ni tänkt på att komplettera med Google?"
- "Är det bara därifrån ni får kunder?"

"Vi har testat SEO tidigare."
* "Okej. Vad var det framför allt ni ville få ut av det?"
- "Vem var det ni testade med?"
- "Det är många som testat fel sorts SEO. Vad gjorde de?"
- "Så ni är öppna för att testa igen?"

"Jag har inte tid nu."
* "Absolut. När på dagen brukar det passa bättre?"
- "Det tar bara två minuter, jag lovar."
- "Okej, jag ringer en annan gång. Ha det bra!"
- "Har du tid imorgon klockan tio?"

"Vi ligger redan högt på Google."
* "Okej. På vad då, om jag får fråga?"
- "Högt på vad, om man söker efter något annat än ert namn?"
- "Det är bra! Men syns ni på de sökningar där kunderna faktiskt köper?"
- "Vem har hjälpt er med det?"

"Min son sköter hemsidan."
* "Aha. Vad är det han hinner göra åt den?"
- "Är han utbildad inom det?"
- "Det är vanligt. Problemet brukar bli att det inte blir gjort — stämmer det?"
- "Okej, då hälsar jag honom lycka till."

"Det där har vi testat. Det gav ingenting."
* "Okej. Vad hade ni hoppats skulle hända?"
- "Vad var det som gick fel?"
- "Då gjorde de nog fel. Hur lade de upp det?"
- "Skulle du säga att ni gav det tillräckligt lång tid?"

"Vi har ingen budget."
* "Okej. Hur brukar ni göra när något ändå behöver lösas?"
- "Det handlar inte om så mycket pengar faktiskt."
- "Ingen budget alls, eller ingen budget just nu?"
- "När sätter ni budget för nästa år?"

"Vad kostar det?"
* "Det beror på vad ni behöver — hur ser det ut hos er idag?"
- "Vi ligger mellan fem och femton tusen i månaden."
- "Billigare än du tror. Ska jag berätta hur det funkar?"
- "Har ni en summa ni tänkt er?"
$q$);

  -- ======================================================================
  -- 6. Dag 2
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 6, 'Dag 2: tre lager djupt', 'reading', $md$
## Nu räcker det inte med en fråga

Dag 1 handlade om att inte släppa vid det första motståndet. Dag 2 handlar om
att inte släppa vid **kundens svar på din fråga** heller.

Det är där de flesta tappar det. Du ställer en bra fråga, kunden svarar — och så
tar du svaret som ett kvitto på att du fått veta tillräckligt, och börjar sälja.

Du ska kunna gå tre lager.

## Kedjan

### Lager 1 — precisering

*Vad menar kunden faktiskt?*

> "Hur menar du?"
>
> "Hur ser det ut idag?"
>
> "Hur länge har ni kört med Bokadirekt?"

### Lager 2 — fördjupning

*Vad har kunden gjort?*

> "Hur har ni gjort kring det?"
>
> "Vad har ni testat tidigare?"
>
> "Hur många förfrågningar får ni därifrån?"

### Lager 3 — konsekvens eller mål

*Varför spelar det roll?*

> "Vad hade ni velat få ut av det?"
>
> "Vad tror du att det beror på?"
>
> "Har ni något mål som gör att ni behöver fler kunder?"

## Ett färdigt exempel

**Kund:** "Vi har testat SEO tidigare."

**Lager 1:** "Okej. Vad var det framför allt ni ville få ut av SEO?"

*Kunden svarar.*

**Lager 2:** "Och vad gjorde ni tillsammans med den leverantören?"

*Kunden svarar.*

**Lager 3:** "Vad tror du gjorde att det inte gav det ni hoppats på?"

Du har gått från fem ord — "vi har testat SEO tidigare" — till vad de ville
uppnå, vad de faktiskt gjorde och varför det inte fungerade.

Det är tre saker du inte visste för en minut sedan. Och alla tre kom från
kunden, inte från dig.

## En kedja, inte ett förhör

Det här är hela skillnaden, och den är lätt att missa:

> **Fråga 2 ska bygga på svaret på fråga 1. Fråga 3 ska bygga på svaret på
> fråga 2.**

Tre frågor i rad ur en lista är ett förhör. Kunden märker det direkt, och slutar
svara med mer än ett ord.

**Praktiskt test:** innehåller din nästa fråga minst ett ord som kunden nyss
använde? Gör den det bygger du på svaret. Gör den det inte läser du ur ett
manus.

> **Kund:** "Vi får mest kunder via en Facebookgrupp här i stan."
>
> **Du:** "Okej. Hur många skulle du säga kommer in via **gruppen** i månaden?"

## Tre är ett tak, inte en kvot

Du ska inte ställa tre frågor för att komma till tre frågor. Räcker två för att
du ska förstå läget är det två som gäller.

Och om kunden mitt i lager 1 själv säger vad han saknar — då är du klar med
frågorna. Det är där samtalet börjar på riktigt.

## När kunden svarar enstavigt

Det händer. "Ja." "Nej." "Vet inte."

Fråga inte samma sak igen. Backa ett steg och gör frågan konkretare:

| I stället för | Fråga |
|---|---|
| "Är du nöjd med dem?" | "Vad är det de gör åt er i månaden?" |
| "Fungerar det bra?" | "Hur många bokningar kommer in den vägen en vanlig vecka?" |
| "Vet inte" på ett mål | "Hur såg det ut förra året jämfört med i år?" |

Siffror är lättare att svara på än åsikter. Är kunden fåordig: fråga efter något
som går att räkna.

## Parövning — 20 minuter

Du behöver en kollega.

1. Partnern säger ett motstånd ur listan i modul 4.
2. Du ställer **fråga 1**. Partnern hittar på ett svar.
3. Du ställer **fråga 2** — byggd på det svaret.
4. Partnern svarar igen.
5. Du ställer **fråga 3** — byggd på det svaret.

Det är en kedja. Sedan nästa motstånd.

**Ett enda påstående från dig och kedjan börjar om från noll.** Partnern säger
till. Var hård — det är billigare att vara hård här än i ett riktigt samtal.

> **Kund:** "Vi får kunder via rekommendationer."
>
> **Du:** "Hur stor del av era nya kunder kommer därifrån?"
>
> **Kund:** "Kanske sextio procent."
>
> **Du:** "Vad gör ni idag för att få in de andra fyrtio?"
>
> **Kund:** "Det är mest folk som hittar oss på Google."
>
> **Du:** "Hur nöjd är du med mängden kunder ni får den vägen?"

Tre frågor. Noll påståenden.

## Målet för dagen

**Tio kedjor i rad.** En kedja = tre relevanta frågor som bygger på varandra.

**Nästa modul:** ett prov på kedjan.
$md$);

  -- ======================================================================
  -- 7. Quiz dag 2
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 7, 'Prov: bygger frågan på svaret?', 'quiz', $md$
Sju frågor om kedjan. Här är det inte bara "är det en fråga" som räknas — det är
om frågan bygger vidare på det kunden faktiskt sa.
$md$);

  perform pg_temp.lagg_fragor(v_modul, $q$
Kunden svarade "kanske sextio procent" på hur stor del av kunderna som kommer via rekommendationer. Vilken fråga bygger på svaret?
* "Vad gör ni idag för att få in de andra fyrtio?"
- "Och hur länge har ni jobbat så?"
- "Vad har ni testat tidigare?"
- "Skulle du vilja att den siffran var högre?"

Vad kännetecknar lager 2 i kedjan?
* Du tar reda på vad kunden faktiskt har gjort.
- Du tar reda på vad kunden vill uppnå.
- Du föreslår en lösning på det kunden nyss berättade.
- Du sammanfattar det kunden sagt hittills.

Vilket är det praktiska testet på om din nästa fråga bygger på svaret?
* Frågan innehåller minst ett ord som kunden nyss använde.
- Frågan är kortare än tolv ord.
- Frågan börjar med "hur" eller "vad".
- Frågan är en av de tre du förberedde innan samtalet.

Kunden svarar bara "ja", "nej" och "vet inte". Vad gör du?
* Backar ett steg och frågar efter något konkret som går att räkna.
- Ställer samma fråga igen med andra ord.
- Går över till att berätta om tjänsten, eftersom frågorna inte ger något.
- Tackar för samtalet — han vill uppenbarligen inte prata.

Kunden har i lager 1 själv sagt att de tappar bokningar på att telefonen inte hinns med. Vad gör du?
* Slutar fråga för att förstå läget — kunden har satt ord på ett problem, och nu börjar samtalet.
- Ställer fråga 2 och 3 ändå, för kedjan ska vara tre lager.
- Byter till ett annat motstånd för att se om det finns fler problem.
- Avslutar med att skicka ett mejl om just det problemet.

Under parövningen råkar du säga "det brukar ju vara så att…". Vad händer?
* Kedjan börjar om från noll.
- Inget — det var ett påstående om kunden, inte om tjänsten.
- Du fortsätter men noterar det i efterhand.
- Partnern får ge dig ett lättare motstånd i stället.

Varför är tre frågor ett tak och inte en kvot?
* För att tre frågor du inte behöver blir ett förhör, och kunden slutar svara.
- För att fler än tre frågor tar för lång tid på ett kallt samtal.
- För att det tredje lagret bara fungerar på kunder som redan är intresserade.
- För att kunden brukar avbryta efter tre frågor ändå.
$q$);

  -- ======================================================================
  -- 8. Dag 3
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 8, 'Dag 3: under press — och var gränsen går', 'reading', $md$
## Inga förberedda svar

Dag 1 och 2 var förutsägbara: du visste vilket motstånd som kom. Idag gör du
inte det.

Be en kollega blanda motstånden ur listan i modul 4 och slänga dem på dig i
slumpmässig ordning, med några sekunders mellanrum. Du får inte förbereda.

Din uppgift är exakt densamma som på dag 1. **Finns det fortfarande en dörr? Då
ställer du en fråga till.**

## Frågan du ställer till dig själv

Varje gång du får ett motstånd, innan du svarar:

> **"Är det här faktiskt ett nej — eller finns det något jag fortfarande inte
> förstått?"**

Nästan alltid är det det andra.

## Men ibland är det ett nej

Den här kursen tränar dig att inte släppa för tidigt. Den tränar dig inte att
aldrig släppa. Skillnaden är viktig, både för kunden och för dig: den som inte
hör ett nej bränner listan, får klagomål och lär sig ingenting av samtalet.

**Det här är ett nej. Lägg på.**

- **Ett uttalat nej på själva samtalet.** "Nej, jag vill inte prata om det här."
  Inte "nej, vi behöver inget" — utan ett nej till samtalet.
- **En begäran om att inte bli kontaktad.** "Ring inte hit igen", "ta bort mig
  ur ert register". Det är ett besked, inte ett motstånd. Bekräfta, avsluta
  vänligt och **notera det direkt i systemet** — nästa person som ringer samma
  nummer ska veta.
- **Fel person, utan mandat och utan hänvisning.** Har du fått veta att hon inte
  har med saken att göra och inte vet vem som har det, finns ingen dörr att gå
  igenom här.
- **Tre frågor obesvarade i rad.** När kunden slutat svara är det inte längre ett
  samtal, och en fjärde fråga gör det inte till ett.

Så här låter ett rent avslut:

> "Det är helt okej. Tack för att du tog samtalet — jag noterar att du inte vill
> bli kontaktad. Ha en bra dag."

Ingen sista fråga. Ingen liten pitch på väg ut. **Ett rent avslut är en av två
godkända utgångar ur ett samtal** — den andra är ett nästa steg. Den enda utgång
som inte är godkänd är den där du släppte utan att veta varför.

## Det som INTE är ett nej

Alla de här har fått folk att lägga på i onödan:

| Det låter som ett nej | Det är egentligen |
|---|---|
| "Vi är inte intresserade." | Ett reflexsvar på de första tio sekunderna. |
| "Vi har redan någon." | Ett faktum om idag. Säger ingenting om imorgon. |
| "Skicka ett mejl." | Ett artigt sätt att avsluta. Fråga vad som ska stå i det. |
| "Det är för dyrt." | En åsikt om ett pris du inte nämnt. |
| "Ring efter sommaren." | En tidpunkt. Fråga vad som händer till dess. |

## Frasbank

Till när du fastnar. Memorera inte replikerna — memorera principen från modul 2.

**Precisering**

> "Aha. Hur menar du?"
>
> "Berätta mer."
>
> "Hur ser det ut idag?"

**Fördjupning**

> "Hur har ni gjort kring det?"
>
> "Vad har ni testat tidigare?"
>
> "Hur länge har det varit så?"
>
> "Vad gör ni idag i stället?"

**Konsekvens och mål**

> "Vad tror du att det beror på?"
>
> "Vad hade ni egentligen velat uppnå?"
>
> "Vad hade det betytt för er?"

## Det här ska sitta nu

När kunden säger:

> "Vi kör Bokadirekt."

ska du inte längre behöva tänka "vad säger jag nu?". Det ska komma automatiskt:

> **"Okej. En fråga till."**

**Nästa modul:** ett prov på gränsdragningen. Sedan sluttestet.
$md$);

  -- ======================================================================
  -- 9. Quiz dag 3
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 9, 'Prov: dörr eller nej?', 'quiz', $md$
Sju lägen. Är det ett motstånd du ska fråga vidare på, eller ett nej du ska
respektera?

Båda felen kostar: släpper du för tidigt tappar du affären, och släpper du för
sent tappar du numret.
$md$);

  perform pg_temp.lagg_fragor(v_modul, $q$
Kunden: "Ta bort mig ur ert register och ring inte hit igen." Vad gör du?
* Bekräftar, avslutar vänligt och noterar direkt i systemet att han inte vill bli kontaktad.
- Frågar en sista gång vad det är som gör att han reagerar så.
- Avslutar samtalet men lämnar numret som det är — han kanske ändrar sig.
- Frågar om du får återkomma om ett halvår i stället.

Kunden: "Vi är inte intresserade." Vad är det?
* Ett reflexsvar på de första sekunderna — fråga vidare.
- Ett nej. Tacka och lägg på.
- Ett köpsignal förklätt till motstånd.
- Ett tecken på att du ringt fel person.

Kunden har inte svarat på dina tre senaste frågor annat än med "mm". Vad gör du?
* Avslutar rent — det är inte längre ett samtal.
- Ställer en fjärde och tydligare fråga.
- Byter till att presentera tjänsten, eftersom frågorna inte ger något.
- Frågar om han hör dig.

Kunden: "Det är för dyrt." Du har inte nämnt något pris. Vad är det?
* Ett motstånd — en åsikt om ett pris som inte finns än.
- Ett nej som handlar om budget.
- Ett tecken på att du ska sänka priset innan du nämner det.
- En fråga om priset, ställd som ett påstående.

Kvinnan du talar med säger att hon inte har med saken att göra och inte vet vem som har det. Vad gör du?
* Tackar och avslutar — det finns ingen dörr här.
- Frågar tre lager djupt om hur de brukar fatta sådana beslut.
- Ber henne koppla dig till chefen ändå.
- Frågar om hon vill ta emot ett mejl att skicka vidare.

Vilka två utgångar ur ett samtal är godkända?
* Ett nästa steg, eller ett rent avslut.
- Ett nästa steg, eller ett mejl som skickas efteråt.
- Ett avslut, eller ett löfte om att ringa igen efter sommaren.
- Ett nästa steg — ett samtal som slutar utan ett sådant är alltid ett misslyckande.

Kunden: "Ring efter sommaren." Vad är den bästa fortsättningen?
* "Absolut. Vad är det som händer till dess?"
- "Okej, jag lägger in en påminnelse i augusti. Ha en fin sommar!"
- "Efter sommaren är det ofta för sent att hinna med hösten."
- "Passar första veckan i augusti?"
$q$);

  -- ======================================================================
  -- 10. Rollspel
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 10, 'Sluttest: jag släpper inte', 'roleplay', $md$
## Uppgiften

Ett **fem minuter långt samtal** med din chef eller en kollega som spelar kund.
Du spelar in det och laddar upp inspelningen här nedanför. Din chef lyssnar och
bedömer mot rubriken längre ner på sidan — den du ser nu, innan du börjar.

## Så här går det till

1. Be din chef eller en kollega spela kund. Hon vet vad hon ska göra: **ge dig
   minst tio tillfällen att släppa henne.**
2. Spela in. Fem minuter.
3. Ladda upp filen här.
4. Du får ett betyg och en skriftlig återkoppling. Godkänt är 80 procent.

Motstånden du kommer att få är kända, men inte i vilken ordning:

> "Vi har redan en leverantör." · "Det funkar bra." · "Vi har fullt." · "Vi får
> kunder via rekommendationer." · "Vi har testat SEO." · "Skicka ett mejl." ·
> "Jag vet inte." · "Det är inget vi prioriterar." · "Vi behöver inte växa." ·
> "Jag måste vidare."

## Godkänt betyder

- du släpper inte vid första motståndet
- du ställer relevanta följdfrågor
- frågorna bygger på kundens svar
- du argumenterar inte
- du pitchar inte för tidigt
- du använder inte "jag förstår" som en väg ut
- du ger inte upp för att kunden inte direkt visar intresse
- **och du hör ett riktigt nej när det kommer**

## Underkänt betyder

Kunden säger:

> "Vi har redan någon."

och du svarar:

> "Okej, jag förstår. Då skickar jag ett mejl."

Det är underkänt. Inte för att formuleringen var fel, utan för att du gav upp
innan du förstått kunden — exakt det kursen tränar bort.

## Det här går inte att komma runt

Läser du frågorna innanför ur ett manus hörs det. Rubriken mäter om fråga två
och tre hämtar ord ur det kunden precis sa, och ett manus kan inte göra det.

## Om du blir underkänd

En ny inlämning skriver aldrig över den gamla — båda står kvar. Du får en
skriftlig återkoppling, går tillbaka till den modul som svartnade, och lämnar in
igen. Det är inte ett bakslag; det är hur drillen är tänkt att fungera.

## Rubriken du bedöms mot

Kriterierna står nedan, med poängtak och vägledning. Läs dem **före**
inspelningen — det är hela poängen med att de ligger här.
$md$);

  perform pg_temp.lagg_kriterier(v_modul, $r$
Släpper inte vid första motståndet | 5 | Minst åtta av tio motstånd besvaras med en följdfråga i stället för en exit
Frågorna bygger på svaret | 5 | Fråga två och tre hämtar ord ur det kunden precis sa, inte ur ett manus
Går tre lager | 4 | Minst två gånger under samtalet: precisering, fördjupning, konsekvens eller mål
Inga smygpåståenden | 4 | "Absolut, och det vi gör är..." räknas som ett påstående även med frågetecken efter
Pitchar inte för tidigt | 3 | Tjänsten nämns först när kunden själv satt ord på ett problem
Tonen håller | 3 | Nyfiken, inte förhörande — kunden ska vilja svara på den tredje frågan också
Hör ett riktigt nej | 3 | Ett uttalat nej eller en begäran om att slippa bli kontaktad respekteras direkt, utan sista fråga
Avslutar rent | 3 | Samtalet landar i ett nästa steg eller ett rent avslut, inte i att det rinner ut
$r$);

  -- --- Självkontroll ------------------------------------------------------
  -- Innehållet skrivs av en textparser, och en parser som tolkat fel ger inte
  -- ett fel — den ger en halv kurs. Räkningen nedan är billigare än att
  -- upptäcka det när första säljaren står i en modul utan frågor.

  select count(*) into v_antal from course_module where course_id = v_kurs;
  if v_antal <> 10 then
    raise exception 'Kursen fick % moduler, forvantade 10.', v_antal;
  end if;

  select count(*) into v_antal
  from quiz_question q join course_module m on m.id = q.module_id
  where m.course_id = v_kurs;
  if v_antal <> 31 then
    raise exception 'Kursen fick % fragor, forvantade 31.', v_antal;
  end if;

  select count(*) into v_antal
  from quiz_option o
  join quiz_question q on q.id = o.question_id
  join course_module m on m.id = q.module_id
  where m.course_id = v_kurs;
  if v_antal <> 124 then
    raise exception 'Kursen fick % svarsalternativ, forvantade 124.', v_antal;
  end if;

  select count(*) into v_antal
  from roleplay_criterion c join course_module m on m.id = c.module_id
  where m.course_id = v_kurs;
  if v_antal <> 8 then
    raise exception 'Rollspelet fick % kriterier, forvantade 8.', v_antal;
  end if;

  -- Varje quizmodul ska ha frågor, och ingen annan modultyp ska ha det.
  if exists (
    select 1 from course_module m
    where m.course_id = v_kurs
      and (m.kind = 'quiz') <> exists (select 1 from quiz_question q where q.module_id = m.id)
  ) then
    raise exception 'En quizmodul saknar fragor, eller en lasmodul har fatt nagra.';
  end if;

  raise notice 'Kursen "Slapp inte kunden for tidigt" ar upplagd som UTKAST med 10 moduler. Publicera den i /utbildning.';
end;
$seed$;
