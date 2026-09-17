-- =============================================================================
-- 0063_kursovningar_och_skarpta_prov.sql — övningar mellan modulerna, och prov
-- som inte går att gissa sig igenom
--
-- Två beställningar, en migration:
--
--   1. EFTER VARJE LÄSMODUL SKA DET FINNAS EN UPPGIFT som görs på plats, på
--      högst fem minuter, och som måste bockas av innan nästa modul öppnas.
--   2. PROVEN VAR FÖR LÄTTA. "Alla kan förstå vilka svar man ska använda."
--
-- ETT NYTT SLAG AV MODUL: `ovning`
--
-- `course_module.kind` har hittills varit läsning, prov eller rollspel. En
-- uppgift som görs på plats är ingen av dem: den lämnas inte in, den rättas
-- inte, och den tar fem minuter. Alternativet hade varit att skriva "GÖR DET
-- HÄR NU" i slutet av en läsmodul — men det är skillnaden mellan ett steg man
-- ser i listan och en rubrik man skummar förbi. Nu står den som ett eget steg,
-- med egen etikett i modullistan och en knapp som säger "Jag har gjort
-- övningen" i stället för "Jag har läst".
--
-- Maskineriet är annars läsmodulens: `klarModul()` bockar av, och AC-6.1:s
-- ordningskrav gör resten — nästa modul öppnar sig inte förrän övningen är
-- avbockad. Det är hela mekaniken beställningen bad om.
--
-- Villkoret på `kind` utökas nedan. Listan speglas i `MODULTYPER` i
-- src/lib/utbildning.ts — ändras den ena måste den andra följa med.
--
-- VARFÖR PROVEN SKRIVS OM FRÅN GRUNDEN
--
-- Det gamla provet gick att klara utan att ha läst något, av tre skäl:
--
--   RÄTT SVAR LÅG ALLTID FÖRST. `quiz_option.sort` är ordningen de ritas i,
--   och vyn blandar dem inte. Varje fråga i 0061 hade stjärnan på första
--   raden. Det ensamt räckte för hundra procent.
--
--   TRE AV FYRA ALTERNATIV VAR UPPENBARA EXITER. Den som bara vet att "man ska
--   ställa en fråga" kunde stryka dem utan att förstå varför.
--
--   STRATEGIN "VÄLJ ALLTID FRÅGAN" FUNGERADE PÅ VARENDA FRÅGA. Det är precis
--   den vanan modul 12 finns för att bryta: ibland är rätt svar att avsluta.
--
-- De nya proven rättar alla tre. Rätt svar ligger utspritt, alternativen är
-- oftast fyra riktiga följdfrågor där skillnaden är vilken som för samtalet
-- framåt, och några frågor har ett avslut som facit. Flera frågor kräver att
-- man läst vad kunden faktiskt sa några repliker tidigare — en av de vanligaste
-- distraktorerna är en fråga kunden redan har besvarat.
--
-- Antalet frågor växer från 31 till 46, och proven går från 7–9 frågor till
-- 11–12. Med 80 % godkänt betyder det att man får ha två fel i stället för ett,
-- vilket är avsiktligt: frågorna är svårare, och gränsen ska mäta omdöme och
-- inte tur.
--
-- HELA KURSEN SKRIVS OM, INTE BARA DELARNA SOM ÄNDRATS
--
-- Övningarna skjuts in mellan de gamla modulerna, så varje `sort` efter den
-- första flyttar sig. Att flytta femton rader med ett unikt index på
-- (course_id, sort) är en dans i flera steg som ingen vill läsa; att skriva om
-- innehållet är en `delete` och femton `insert`. Modulerna kaskaderar till
-- frågor, alternativ, kriterier och progress, så det blir rent.
--
-- DÄRFÖR ÄR SPÄRREN HÅRD: kursen måste vara ETT UTKAST utan ett enda rättat
-- prov och utan en enda inlämnad inspelning. Finns det försök är någon mitt i
-- kursen, och då är det inte längre innehåll som skrivs om utan någons
-- historik. Migrationen KASTAR då i stället för att göra ingenting — en
-- migration som tyst avstår lämnar en databas man tror är uppdaterad.
--
-- Avbockade moduler (`module_progress`) får däremot försvinna. De enda som
-- finns är granskarens egna klick, och modulerna de pekar på existerar inte
-- längre efter det här.
-- =============================================================================

-- --- Nytt slag av modul ---------------------------------------------------

alter table course_module drop constraint if exists course_module_kind_check;
alter table course_module add constraint course_module_kind_check
  check (kind in ('reading', 'ovning', 'quiz', 'roleplay'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'course_module_kind_check'
      and lower(pg_get_constraintdef(oid)) like '%''ovning''%'
  ) then
    raise exception 'course_module_kind_check slapper inte igenom ovning';
  end if;
end $$;

-- --- Hjälpare -------------------------------------------------------------
-- Samma tre som i 0061, och av samma skäl: frågorna skrivs i exakt det format
-- redaktören använder (`tolkaFragor`, `tolkaKriterier`), så att en fråga går
-- att flytta mellan filen och gränssnittet utan att skrivas om.

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

-- Kravet på exakt ett rätt svar står kvar: vyn ritar radioknappar, så två
-- stjärnor hade gett en fråga där ett riktigt svar räknas som fel beroende på
-- vilket den svarande råkade välja.
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

-- --- Kursen skrivs om -----------------------------------------------------

do $seed$
declare
  v_kurs   uuid;
  v_status text;
  v_modul  uuid;
  v_antal  int;
begin
  select id, status into v_kurs, v_status
  from course where slug = 'slapp-inte-kunden-for-tidigt';

  if v_kurs is null then
    raise exception 'Kursen slapp-inte-kunden-for-tidigt finns inte. Kor 0061 forst.';
  end if;

  if v_status <> 'draft' then
    raise exception 'Kursen ar % och inte draft. Skriv om innehallet i redaktoren i stallet.', v_status;
  end if;

  select count(*) into v_antal from course_attempt where course_id = v_kurs;
  if v_antal > 0 then
    raise exception 'Kursen har % rattade forsok. Nagon ar mitt i den — skriv om i redaktoren.', v_antal;
  end if;

  select count(*) into v_antal from roleplay_submission where course_id = v_kurs;
  if v_antal > 0 then
    raise exception 'Kursen har % inlamnade inspelningar. Skriv om i redaktoren.', v_antal;
  end if;

  select count(*) into v_antal
  from module_progress p join course_module m on m.id = p.module_id
  where m.course_id = v_kurs;
  if v_antal > 0 then
    raise notice '% avbockade moduler forsvinner med omskrivningen (granskarens klick).', v_antal;
  end if;

  delete from course_module where course_id = v_kurs;

  update course set
    description_md = $md$Kunden säger "vi kör redan Bokadirekt" och samtalet tar slut. Inte för att
kunden sa nej — utan för att du hörde ett nej som inte fanns där.

Den här kursen tränar bort en enda reflex och lär in en enda i stället:
**motstånd betyder en fråga till.**

**Femton moduler.** Du läser något kort, gör en övning på fem minuter, och
skriver sedan ett prov på det. Tre gånger om, plus en dag om var gränsen går
och ett inspelat testsamtal som din chef bedömer mot en rubrik du får se i
förväg.

Räkna med 20–30 minuter per dag i tre dagar. Du behöver en telefon som spelar
in och en kollega som kan spela kund en av dagarna.

Övningarna görs på plats och tar högst fem minuter var. Nästa modul öppnar sig
inte förrän du bockat av den föregående — det är hela poängen: kursen går inte
att läsa igenom, den går bara att göra.$md$,
    updated_at = now()
  where id = v_kurs;

  -- ======================================================================
  -- 1. Läsning — reflexen
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
igen dem på dig själv — det är dem resten av kursen handlar om, och de
återkommer i varenda prov.

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

Femton moduler i fast ordning. Läsning, övning, prov — tre varv, plus gränsen
och sluttestet.

| Modul | | Tid |
|---|---|---|
| 1–2 | Reflexen, och en övning som visar vilken exit som är **din** | 10 min |
| 3–5 | Regeln, en omskrivningsövning och **prov 1** | 20 min |
| 6–8 | **Dag 1:** trettio motstånd, tio inspelade, **prov 2** | 20 min |
| 9–11 | **Dag 2:** tre lager, två kedjor, **prov 3** | 25 min |
| 12–14 | **Dag 3:** under press, var gränsen går, **prov 4** | 20 min |
| 15 | Sluttestet: ett inspelat samtal, bedömt mot rubrik | 15 min |

**Övningarna görs på plats.** Fem minuter var, ingenting att lämna in, och
nästa modul öppnar sig först när du bockat av den. Kursen går inte att läsa
igenom — den går bara att göra.

Du behöver:

- **en telefon som spelar in** — hela kursen bygger på att du hör dig själv
- **något att skriva på** — tre av övningarna görs med penna
- **en kollega** i cirka tjugo minuter på dag 2
- **tre dagar.** Inte tre timmar. Reflexen sitter i nattsömnen mellan passen

**Nästa modul:** en övning på fem minuter. Den är inte valfri.
$md$);

  -- ======================================================================
  -- 2. Övning — hitta din egen exit
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 2, 'Övning: hitta din egen exit', 'ovning', $md$
**Fem minuter. Penna och papper, eller anteckningar i mobilen.**

Du kan inte träna bort en reflex du inte har sett på dig själv. Den här
övningen letar upp den.

## Gör så här

**1. Ta fram tre samtal.** De senaste tre gångerna du la på efter det första
motståndet. Inte de värsta samtalen — de vanligaste. Har du en samtalslista i
navet, öppna den.

**2. Skriv tre rader per samtal:**

| | |
|---|---|
| **Kunden sa** | med kundens egna ord, så nära du minns |
| **Jag svarade** | ditt faktiska svar, inte det du önskar att du sagt |
| **Vilken exit** | avslutet, pitchen, försvaret eller artigheten |

**3. Skriv en sista mening:**

> "Min exit är ______."

Är det två olika är det två. Men de flesta har en, och den kommer tillbaka
varje gång.

## Ett exempel på hur det ser ut när det är gjort

> **Kunden sa:** "Vi har redan en som sköter hemsidan."
> **Jag svarade:** "Okej, vad bra. Då skickar jag lite information på mejl så
> kan ni titta om det är intressant."
> **Exit:** artigheten.

## Innan du klickar vidare

Titta på dina tre rader. Frågan du ska kunna svara på är inte "vad borde jag
sagt?" — det kommer i nästa modul. Frågan är:

> **Kände du igen dig?**

Gjorde du det har övningen gjort sitt. Spara anteckningen — du kommer att
behöva raden "min exit är…" i modul 4 och i sluttestet.
$md$);

  -- ======================================================================
  -- 3. Läsning — regeln
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 3, 'Regeln: motstånd → en fråga till', 'reading', $md$
## Regeln

> **När kunden säger något som inte är ett definitivt nej ställer du en fråga
> till.**

Det är hela regeln. Den har inga undantag den här veckan — inte för att undantag
saknas i verkligheten, utan för att en regel med undantag inte går att
automatisera, och det är automatiseringen som är målet. Undantaget kommer i
modul 12, när regeln sitter.

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
Testet har två delar, och **båda** måste stämma:

1. **Lämnar du över ordet?** Efter din mening ska det vara kundens tur, och han
   ska behöva säga mer än ja eller nej för att svara.
2. **Är svaret okänt för dig?** Frågar du något du redan vet svaret på ställer
   du inte en fråga — du gör **en poäng**.

Kör de här fyra genom testet:

| Mening | Räknas? | Varför |
|---|---|---|
| "Hur länge har ni kört med Bokadirekt?" | Ja | Du vet inte. Han måste svara med något. |
| "Vill ni inte ha fler kunder?" | Nej | Du vet svaret. Det är en poäng med frågetecken. |
| "Absolut, och vi hjälper ju många salonger — låter det intressant?" | Nej | En pitch med ett frågetecken efter. |
| "Är du nöjd med dem?" | Knappt | Ja eller nej tillbaka, och sen står du still igen. |

**Smygpåståendet** är den vanligaste varianten: du säger något om din tjänst
eller din bransch och sätter ett frågetecken sist. Det känns som en fråga när du
säger det, och det hörs som en pitch för den som lyssnar.

## Frågeorden

Fråga med **hur**, **vad**, **vilken**, **hur mycket**, **hur länge**. De kräver
ett svar med innehåll.

Var försiktig med **varför**. "Varför gjorde ni så?" låter som ett krav på en
förklaring, och kunden börjar försvara sig i stället för att berätta. Säg "vad
var det som gjorde att ni…" i stället — samma svar, utan försvarsställningen.

## Kvittera, sedan fråga

Frågan ska inte komma som ett åsneskutt. Kvittera först, med ett enda ord:

> "Okej. Hur länge har ni kört med dem?"
>
> "Aha. Hur stor del av kunderna kommer den vägen?"

**"Okej"**, **"aha"** och **"just det"** är kvitteringar. **"Jag förstår,
men…"** är det inte — ordet "men" tar tillbaka ordet och inleder ett försvar.
Det är exiten som klär ut sig till empati.

## Håll frågan kort

Under tolv ord. En lång fråga innehåller nästan alltid ett påstående någonstans
på vägen, och kunden svarar på den delen i stället.

Och **en** fråga, inte två. Ställer du två i rad svarar kunden på den lättaste.

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
$md$);

  -- ======================================================================
  -- 4. Övning — skriv om fem exits
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 4, 'Övning: skriv om fem exits', 'ovning', $md$
**Fem minuter. Skriv först, säg sedan högt.**

Nedan står fem repliker. Alla fem är exiter. Din uppgift är att skriva om varje
replik till **en följdfråga** — och sedan säga den högt.

## De fem

1. "Jag förstår, då skickar jag ett mejl."
2. "Absolut, och det vi gör är att vi hjälper företag som er att synas bättre."
3. "Okej, men vill ni inte ha fler kunder?"
4. "Ja, Bokadirekt är ju bra, men det löser inte hur ni syns på Google."
5. "Okej, då stör jag inte mer."

## Tre krav på varje omskrivning

- **under tolv ord**
- **börjar med hur, vad, vilken, hur mycket eller hur länge**
- **handlar om kunden — inte om dig, din tjänst eller din bransch**

Det tredje kravet är det som fäller folk. Testa varje fråga med:

> **"Hade jag kunnat ställa den här frågan utan att veta vad jag säljer?"**

Är svaret nej har du skrivit ett smygpåstående, inte en fråga.

## Ett exempel

**Exit:** "Absolut, och det vi gör är att vi hjälper företag som er att synas
bättre."

**Halvdant:** "Hur viktigt är det för er att synas bättre?"
*Fortfarande din fråga om din tjänst. Kunden hör pitchen.*

**Bra:** "Hur hittar nya kunder till er idag?"
*Samma ämne. Inget om dig. Går inte att svara på med ett ord.*

## Läs upp dem

Säg alla fem högt, en gång. Det som ser rätt ut på pappret avslöjar sig i
munnen: hör du dig själv göra en paus mitt i och lägga till "…för att vi brukar
se att…", då var det inte en fråga.

## Innan du klickar vidare

Räkna: **hur många av dina fem klarade alla tre kraven?**

Fem av fem — gå vidare till provet. Färre än fyra — skriv om de som föll innan
du går vidare. Provet på nästa sida mäter exakt det här, och det är svårare än
den här övningen.
$md$);

  -- ======================================================================
  -- 5. Prov 1
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 5, 'Prov 1: fråga eller exit?', 'quiz', $md$
Tolv frågor om regeln, de fyra exiterna och vad som faktiskt räknas som en
fråga.

**Läs alternativen noga.** I flera av frågorna är tre av fyra svar riktiga
frågor — det är vilken av dem som för samtalet framåt som skiljer dem åt. Och i
minst en fråga har kunden redan svarat på ett av alternativen.

Godkänt är 80 procent, alltså tio av tolv. Missar du kan du läsa om modul 3 och
göra ett nytt försök efter en timme.
$md$);

  perform pg_temp.lagg_fragor(v_modul, $q$
Kunden: "Vi kör Bokadirekt." Vilket svar följer regeln bäst?
- "Är ni nöjda med Bokadirekt?"
- "Vet du om ni får några nya kunder via dem, eller är det mest era gamla som bokar där?"
* "Hur länge har ni kört med dem?"
- "Har du hört att Bokadirekt inte syns för dem som söker på Google?"

Vilket av de fyra svaren är ett smygpåstående?
- "Hur brukar nya kunder hitta till er?"
- "Vad gör ni idag för att synas för dem som inte redan känner er?"
- "Hur ser det ut när någon söker efter er bransch här i stan?"
* "Många i er bransch tappar ju bokningar på att de inte syns — hur ser det ut hos er?"

Testet på om något räknas som en fråga har två delar. Vilka?
- Den börjar med ett frågeord, och den är under tolv ord.
* Du lämnar över ordet, och du vet inte själv svaret.
- Du kvitterar först, och frågan handlar om kunden.
- Den slutar med frågetecken, och den är öppen.

Kunden: "Vi har en byrå sedan tre år." Du: "Okej. Vad gör de åt er i månaden?" Kunden: "Ärligt talat vet jag inte riktigt. Vi får en rapport." Vilken fråga bygger bäst vidare?
- "Hur länge har ni haft dem?"
- "Skulle du vilja veta vad de faktiskt gör?"
* "Vad står det i rapporten som du brukar titta på?"
- "Vad kostar de er i månaden?"

Kunden: "Skicka ett mejl." Vilket svar följer regeln?
* "Absolut. Vad är det viktigaste att jag får med i det?"
- "Absolut. Vill du att jag ringer upp efteråt?"
- "Jag kan skicka, men det brukar säga mindre än ett samtal — har du två minuter?"
- "Vad har du för adress?"

Du säger: "Jag förstår, men det där brukar faktiskt lösa sig när man syns på rätt ställen." Vilken av de fyra exiterna är det?
- Pitchen
- Artigheten
- Avslutet
* Försvaret

Du säger: "Jag förstår. Jag skickar ett mejl så kan du titta när du hinner." Vilken exit är det?
- Avslutet
* Artigheten
- Försvaret
- Pitchen

Varför är "Vad var det som gjorde att ni gjorde så?" en bättre formulering än "Varför gjorde ni så?"
- Ingen skillnad i praktiken — båda är öppna frågor om samma sak.
- Den första är längre, och en längre fråga ger ett längre svar.
* "Varför" kräver en förklaring, och kunden går i försvarsställning i stället för att berätta.
- "Varför" räknas som en ledande fråga och är därför förbjuden i kursen.

Kunden har precis sagt "vi får kunder ändå". Vilken av frågorna bryter mot regeln?
- "Hur många nya kunder får ni en vanlig månad?"
* "Men ni skulle väl ändå vilja ha fler?"
- "Varifrån kommer de flesta av dem?"
- "Hur ser det ut jämfört med förra året?"

Vilket av de här är INTE en kvittering?
- "Okej."
- "Aha."
- "Just det."
* "Jag förstår, men…"

Kunden: "Vi annonserar redan." Vilket svar följer råden i modul 3 bäst?
* "Okej. Vad annonserar ni med idag?"
- "Annonserar ni på Google eller Facebook?"
- "Okej, vad bra. Många vi pratar med annonserar men tycker att det blivit dyrare — hur ser ni på det?"
- "Är det något som ger er kunder?"

Du ställer en fråga som du redan vet svaret på. Vad är den, enligt modulen?
- Ett smygpåstående.
- En ledande fråga, vilket går bra så länge tonen är nyfiken.
* En poäng — inte en fråga.
- En kontrollfråga, som visar kunden att du lyssnat.
$q$);

  -- ======================================================================
  -- 6. Läsning — dag 1
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 6, 'Dag 1: de trettio motstånden', 'reading', $md$
## Dagens enda uppgift

Trettio motstånd. Trettio följdfrågor. Ingen försäljning.

Du ska inte sälja, inte argumentera, inte förklara, inte övertyga. Du ska ställa
**en relevant fråga** och sedan vara tyst.

Det här är hela listan. Nästa modul är övningen där du kör de tio första
inspelat — läs listan nu, så att inget av dem kommer som en överraskning sen.

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

## Fyra av dem är fällor

**Nummer 11, "skicka ett mejl"**, är inte ett nej — det är kundens sätt att
avsluta artigt. Regeln gäller: "Absolut. Vad är det viktigaste att jag får med?"
Svaret berättar vad han faktiskt bryr sig om, och nu har du det i klartext.

**Nummer 20, "det gav ingenting"**, lockar dig att fråga vad som gick fel. Det
är att hoppa till slutet. Du vet ännu inte vad "ingenting" betyder för honom —
fråga först vad han hade hoppats på.

**Nummer 28, "jag litar inte på folk som ringer"**, är inte riktat mot dig. Det
är det ärligaste motstånd du kan få: "Okej. Vad är det som brukar gå fel när
folk ringer dig?"

**Nummer 30, "vad kostar det?"**, ser ut som intresse och är ett motstånd i
förklädnad. Svarar du med en siffra innan du vet något har du gett kunden allt
han behöver för att säga nej. Kvittera och fråga tillbaka: "Det beror på vad ni
behöver — hur ser det ut hos er idag?"

## Fyra sätt att missa, även när du ställer en fråga

| Felet | Hur det låter |
|---|---|
| **Tvåfrågan** | Du ställer två frågor i rad, och kunden svarar på den lättaste. |
| **Den ledande** | "Men ni vill väl ändå synas?" Ett påstående i frågekläder. |
| **Den långa** | Fjorton ord, varav sex är en pitch. Håll dig under tolv. |
| **Tystnadsflykten** | Du frågar, och fyller själv i svaret efter en halv sekunds tystnad. |

Den sista är den svåraste, och den enda du garanterat inte hör när du gör den.
Du hör den på inspelningen. **Tystnaden efter frågan är din, inte kundens.** Låt
den ligga.
$md$);

  -- ======================================================================
  -- 7. Övning — tio motstånd, inspelade
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 7, 'Övning: tio motstånd, inspelade', 'ovning', $md$
**Fem minuter. Telefonen på inspelning, högt uttalat.**

Det här är själva drillen. Allt annat i kursen finns för att den här övningen
ska gå att göra.

## Gör så här

1. **Starta inspelningen.**
2. Läs **motstånd 1** ur listan högt, som om kunden sa det.
3. **Pausa en sekund.** Räkna den.
4. Svara högt med **en enda fråga**.
5. Vidare till motstånd 2. Tio stycken, i rad, utan att stanna.

Pausen i steg 3 är inte utfyllnad — det är där reflexen bryts. Utan den kommer
det gamla svaret först, varje gång.

**Stanna inte för att en fråga blev dålig.** Kör klart alla tio. Rättningen
kommer efteråt, och den är hela poängen.

## Sedan: lyssna på dig själv

Spela upp inspelningen. Ett streck per fråga i tre kolumner:

| | |
|---|---|
| **Fråga** | Öppen, om kunden, under tolv ord. Räknas. |
| **Påstående** | Allt om dig, din tjänst eller din bransch. Räknas inte. |
| **Ingetdera** | Tystnadsflykt, tvåfråga, ledande fråga. Räknas inte. |

Fråga dig efter varje:

> **"Ställde jag en fråga, eller smög jag in ett påstående?"**

## Målet

**Minst nio av tio ska hamna i första kolumnen.**

Färre än nio: kör om de tio, en gång till, nu. Det tar två minuter och är
billigare än att göra provet två gånger.

## Innan du klickar vidare

Skriv ner **vilka nummer som föll** och vad de blev i stället. Den listan är
värd mer än de nio som gick bra — det är de motstånden som kommer att fälla dig
i sluttestet.

Behåll inspelningen. Du ska jämföra med den på dag 3.
$md$);

  -- ======================================================================
  -- 8. Prov 2
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 8, 'Prov 2: välj följdfrågan', 'quiz', $md$
Tolv motstånd. Välj den följdfråga som ger dig mest att gå vidare på.

**Här är nästan varje alternativ en riktig fråga.** Det som skiljer dem åt är om
frågan hämtar det du saknar, eller om den hoppar över ett lager, antar något
kunden inte sagt, eller frågar om något han redan har svarat på.

Godkänt är 80 procent — tio av tolv.
$md$);

  perform pg_temp.lagg_fragor(v_modul, $q$
"Vi får kunder genom rekommendationer."
- "Är det bara därifrån ni får kunder?"
* "Hur stor del av era nya kunder kommer därifrån?"
- "Vad gör ni för att få fler rekommendationer?"
- "Och när de tar slut, vad gör ni då?"

"Vi har testat SEO tidigare."
- "Vad var det som inte fungerade?"
- "Vem var det som gjorde det åt er?"
* "Vad var det ni ville få ut av det?"
- "Hur länge höll ni på med det?"

"Jag har inte tid nu."
- "Det tar bara två minuter, jag lovar."
- "När har du tid?"
* "Absolut. När på dagen brukar det passa bättre?"
- "Har du tid imorgon klockan tio?"

Kunden: "Vi ligger redan högt på Google." Du: "Okej. På vad då?" Kunden: "På vårt namn. Vi ligger etta." Vilken fråga tar dig vidare?
- "Ligger ni högt på andra sökningar också?"
- "Har ni tittat på vad folk faktiskt söker på?"
- "Vet du hur många som söker på ert namn i månaden?"
* "Hur hittar de som inte känner till ert namn er?"

"Det är för dyrt." Kunden har inte fått höra något pris.
- "Jag har inte nämnt något pris än — vad har du hört?"
- "Vad hade du tänkt dig att det skulle kosta?"
- "Är det priset som är problemet, eller något annat?"
* "Okej. Vad jämför du med?"

"Det där har vi testat. Det gav ingenting."
* "Okej. Vad hade ni hoppats skulle hända?"
- "Vad var det som gick fel?"
- "Hur länge gav ni det?"
- "Vem var det som skötte det?"

Kunden: "Vi är tre stycken och vi har fullt upp till efter jul." Vilken fråga visar att du lyssnade?
- "Hur många är ni på företaget?"
* "Vad händer efter jul?"
- "Är ni fullbokade hela hösten?"
- "Vill ni växa, eller är ni nöjda med att vara tre?"

"Vi har någon som sköter det."
- "Är det någon i huset eller en byrå?"
- "Hur nöjda är ni med dem?"
- "Vad hade ni velat att de gjorde mer av?"
* "Vad är det de gör åt er?"

"Vad kostar det?"
* "Det beror på vad ni behöver — hur ser det ut hos er idag?"
- "Vi ligger mellan fem och femton tusen i månaden."
- "Har ni en summa ni tänkt er?"
- "Innan jag svarar på det, får jag ställa två frågor?"

"Jag litar inte på folk som ringer."
- "Det förstår jag, det ringer mycket skräp. Får jag bara ställa en fråga?"
- "Vad skulle få dig att lita på någon som ringer?"
* "Okej. Vad är det som brukar gå fel när folk ringer dig?"
- "Vill du hellre att jag mejlar?"

Vad är den enda uppgiften på dag 1?
- Kvittera, ställa en fråga och sedan föreslå ett nästa steg.
- Ställa en fråga och följa upp med ett kort argument.
* Ställa en relevant fråga, och sedan vara tyst.
- Ställa tre frågor i rad tills kunden öppnar sig.

Du lyssnar på inspelningen och hör att du fyllde i svaret själv efter en halv sekunds tystnad. Vad heter felet?
- Tvåfrågan.
- Den ledande.
- Den långa.
* Tystnadsflykten.
$q$);

  -- ======================================================================
  -- 9. Läsning — dag 2
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 9, 'Dag 2: tre lager djupt', 'reading', $md$
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

**Lagren tas i ordning.** Hoppar du till lager 3 direkt frågar du om följderna
av något du ännu inte vet vad det är, och kunden hör det.

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
> **Du:** "Okej. Hur många kommer in via **gruppen** i månaden?"

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

## Nästa modul

Övningen gör du med penna först och kollega sedan. Femton av dagens tjugofem
minuter går åt där.
$md$);

  -- ======================================================================
  -- 10. Övning — två kedjor
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 10, 'Övning: två kedjor på papper', 'ovning', $md$
**Fem minuter. Penna, papper, och rösten till sist.**

## Gör så här

Välj **två motstånd** ur listan i modul 6. Ta två du fumlade med i övningen på
dag 1 — de står redan på din lapp.

För varje motstånd, skriv sex rader:

```
Kunden:   "Vi har testat SEO tidigare."
Fråga 1:  ______________________  (lager 1 — vad menar han?)
Han svarar: ____________________  (hitta på ett rimligt svar)
Fråga 2:  ______________________  (lager 2 — vad har de gjort?)
Han svarar: ____________________
Fråga 3:  ______________________  (lager 3 — varför spelar det roll?)
```

Du hittar på kundens svar själv. Det gör ingenting att de är påhittade — det du
tränar är att **ta emot ett svar och bygga på det**, och det går att träna på ett
påhittat svar.

## Sedan: stryk under

Gå tillbaka till fråga 2 och fråga 3. **Stryk under varje ord som kommer från
kundens svar precis innan.**

- Kan du stryka under något i båda — det är en kedja.
- Kan du inte stryka under någonting — det är ett förhör. Skriv om frågan.

Det här är hela övningen. Understrykningen är testet, inte en utsmyckning.

## Sist: säg den högt

Läs upp hela kedjan, båda rollerna, en gång. Kedjor som ser bra ut på pappret
låter ofta som ett förhör i munnen — det hör du direkt, och det är billigare att
höra det nu.

## Om du har en kollega tillgänglig

Kör samma sak muntligt i tjugo minuter, med riktiga svar i stället för
påhittade. Partnern säger ett motstånd, du ställer tre frågor, han hittar på
svar efter varje.

**Ett enda påstående från dig och kedjan börjar om från noll.** Partnern säger
till. Var hård — det är billigare att vara hård här än i ett riktigt samtal.
Målet är **tio kedjor i rad**.

## Innan du klickar vidare

Två kedjor på papper, understrukna, upplästa. Har du haft en kollega: hur många
kedjor i rad klarade du utan påstående?
$md$);

  -- ======================================================================
  -- 11. Prov 3
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 11, 'Prov 3: kedjan', 'quiz', $md$
Elva frågor om kedjan.

Här räcker det inte att veta att man ska ställa en fråga. Frågorna handlar om
**vilken** fråga som hör hemma efter just det svar kunden gav — och i två av dem
är rätt svar att sluta fråga.

Godkänt är 80 procent, alltså nio av elva.
$md$);

  perform pg_temp.lagg_fragor(v_modul, $q$
Du frågade hur stor del av kunderna som kommer via rekommendationer. Kunden: "Kanske sextio procent." Vilken fråga bygger på svaret?
- "Är du nöjd med de sextio procenten?"
- "Vad har ni testat tidigare?"
* "Vad gör ni idag för att få in de andra fyrtio?"
- "Hur länge har det sett ut så?"

Vilket lager är frågan "Vad har ni testat tidigare?"
- Lager 1 — precisering
* Lager 2 — fördjupning
- Lager 3 — konsekvens eller mål
- Inget av dem — det är en ledande fråga

Vilket lager är frågan "Vad hade det betytt för er om ni fick in tio kunder till i månaden?"
- Inget av dem — det är ett smygpåstående
- Lager 1 — precisering
- Lager 2 — fördjupning
* Lager 3 — konsekvens eller mål

Du: "Hur ser det ut idag?" Kunden: "Vi får väl in fem, sex nya i månaden." Du: "Okej. Vad gör ni för att få in dem?" Kunden: "Ingenting särskilt, de bara dyker upp." Vilken är fråga 3?
- "Hade ni velat ha fler än fem, sex?"
- "Har ni provat att annonsera?"
* "Vad tror du gör att de hittar just er?"
- "Vad skulle hända om de slutade dyka upp?"

Kunden svarar bara "ja", "nej" och "vet inte". Vad gör du enligt modulen?
* Backar ett steg och frågar efter något konkret som går att räkna.
- Ställer samma fråga igen med andra ord.
- Frågar rakt ut varför han är så kortfattad.
- Går över till att berätta om tjänsten, eftersom frågorna inte ger något.

Mitt i lager 1 säger kunden: "Ärligt talat hinner vi inte svara i telefon, så det är nog en del som ringer förgäves." Vad gör du?
- Ställer fråga 2 och 3 ändå — kedjan ska vara tre lager.
- Byter till nästa motstånd för att se om det finns fler problem.
* Slutar fråga för att förstå läget — kunden har satt ord på ett problem, och nu börjar samtalet.
- Sammanfattar allt han sagt hittills innan du går vidare.

Varför är tre frågor ett tak och inte en kvot?
* Tre frågor du inte behöver blir ett förhör, och kunden slutar svara.
- Fler än tre frågor tar för lång tid i ett kallt samtal.
- Det tredje lagret fungerar bara på kunder som redan visat intresse.
- Kunden brukar avbryta efter tre frågor ändå.

Vad är det praktiska testet på om din nästa fråga bygger på svaret?
- Frågan är kortare än tolv ord.
* Frågan innehåller minst ett ord som kunden nyss använde.
- Frågan börjar med "hur" eller "vad".
- Frågan är en av de tre du förberedde före samtalet.

Under parövningen säger du: "Ja, det där är ju ganska vanligt." och därefter en fråga. Vad händer?
- Ingenting — det var en kvittering.
- Ingenting — påståendet handlade inte om tjänsten.
* Kedjan börjar om från noll. Det var ett påstående.
- Partnern får ge dig ett lättare motstånd att öva på.

Du: "Vad var det ni ville få ut av SEO?" Kunden: "Vi ville synas när folk söker på takläggare i Örebro." Du: "Och hur länge har ni haft er nuvarande hemsida?" Vad är felet?
* Frågan bygger inte på svaret — den hoppar till ett nytt ämne.
- Frågan är för lång.
- Frågan är ledande.
- Frågan är ett smygpåstående.

Kunden: "Det är mest folk som hittar oss på Google." Vilken fråga använder kundens egna ord?
- "Vad gör ni för att synas bättre?"
- "Hur nöjd är du med antalet nya kunder?"
- "Har ni tittat på hur ni ligger till där?"
* "Hur många av dem som hittar er på Google hör faktiskt av sig?"
$q$);

  -- ======================================================================
  -- 12. Läsning — dag 3
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 12, 'Dag 3: under press — och var gränsen går', 'reading', $md$
## Inga förberedda svar

Dag 1 och 2 var förutsägbara: du visste vilket motstånd som kom. Idag gör du
inte det.

Din uppgift är exakt densamma som på dag 1. **Finns det fortfarande en dörr? Då
ställer du en fråga till.**

## Frågan du ställer till dig själv

Varje gång du får ett motstånd, innan du svarar:

> **"Är det här faktiskt ett nej — eller finns det något jag fortfarande inte
> förstått?"**

Nästan alltid är det det andra.

## Men ibland är det ett nej

Den här kursen tränar dig att inte släppa för tidigt. Den tränar dig inte att
aldrig släppa. Skillnaden är viktig, både för kunden och för dig: **den som inte
hör ett nej bränner listan, får klagomål och lär sig ingenting av samtalet.**

**Det här är ett nej. Avsluta.**

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

**Ingen sista fråga. Ingen liten pitch på väg ut.** Det är det som gör avslutet
rent.

**Ett rent avslut är en av två godkända utgångar ur ett samtal** — den andra är
ett nästa steg. Den enda utgång som inte är godkänd är den där du släppte utan
att veta varför.

## Det som INTE är ett nej

Alla de här har fått folk att lägga på i onödan:

| Det låter som ett nej | Det är egentligen |
|---|---|
| "Vi är inte intresserade." | Ett reflexsvar på de första tio sekunderna. |
| "Vi har redan någon." | Ett faktum om idag. Säger ingenting om imorgon. |
| "Skicka ett mejl." | Ett artigt sätt att avsluta. Fråga vad som ska stå i det. |
| "Det är för dyrt." | En åsikt om ett pris du inte nämnt. |
| "Ring efter sommaren." | En tidpunkt. Fråga vad som händer till dess. |
| "Jag måste vidare." | En klocka, inte ett beslut. Föreslå ett nästa steg. |

## Frasbank

Till när du fastnar. Memorera inte replikerna — memorera principen från modul 3.

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

Och när kunden säger "ring inte hit igen" ska det komma lika automatiskt att
tacka och lägga på.
$md$);

  -- ======================================================================
  -- 13. Övning — slumpa och svara
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 13, 'Övning: slumpa och svara', 'ovning', $md$
**Fem minuter. Inspelning på. Tre sekunders betänketid, inte mer.**

Nu ska det gå fort, och du ska inte veta vad som kommer.

## Med kollega — bäst

Ge henne listan i modul 6 och den här instruktionen:

> *"Kasta tio motstånd på mig i slumpmässig ordning, med några sekunders
> mellanrum. Blanda in tre av de här: 'nej, jag vill inte prata om det här',
> 'ring inte hit igen', och en där du säger att du inte har med saken att göra
> och inte vet vem som har det."*

## Utan kollega — går lika bra

Blunda och peka i listan, eller ta sekundvisaren på klockan och räkna
motståndets nummer ur den. Tio stycken. Lägg själv in de tre nejen på tre av
platserna innan du börjar, utan att titta på var.

## Regeln under övningen

Du får **tre sekunder**. Sedan svarar du högt:

- är det ett **motstånd** → en fråga
- är det ett **nej** → ett rent avslut, utan sista fråga och utan pitch

Stanna inte, rätta inte, kör klart alla tio.

## Rättningen

Lyssna igenom. Tre frågor till dig själv:

1. **Hur många av motstånden fick en riktig fråga?** Målet är alla.
2. **Hörde du de tre nejen?** Ett nej som fick en följdfråga är ett fel — och
   det är det dyraste felet i kursen, eftersom det är det enda som skapar en
   arg kund.
3. **Blev något avslut "orent"?** En sista liten fråga på vägen ut, ett "men
   får jag bara säga en sak". Räkna det som ett fel.

## Jämför med dag 1

Ta fram inspelningen från övningen i modul 7 och spela tjugo sekunder av den.

Hör du skillnad? Det du lyssnar efter är inte bättre formuleringar — det är hur
snabbt frågan kommer. På dag 1 kom den efter en tankepaus. Nu ska den komma
med en gång.

## Innan du klickar vidare

**Tio motstånd. Rätt behandling på minst nio.** Det räknar både frågorna och
nejen.

Nästa modul är sista provet, och det handlar mest om skillnaden mellan de två.
$md$);

  -- ======================================================================
  -- 14. Prov 4
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 14, 'Prov 4: dörr eller nej?', 'quiz', $md$
Elva lägen. Är det ett motstånd du ska fråga vidare på, eller ett nej du ska
respektera?

**Strategin "välj alltid frågan" ger underkänt här.** Båda felen kostar: släpper
du för tidigt tappar du affären, och släpper du för sent tappar du numret.

Godkänt är 80 procent, alltså nio av elva.
$md$);

  perform pg_temp.lagg_fragor(v_modul, $q$
Kunden: "Ta bort mig ur ert register och ring inte hit igen." Vad gör du?
- Frågar en sista gång vad det är som gör att han reagerar så.
- Avslutar samtalet, men lämnar numret som det är — han kan ändra sig.
* Bekräftar, avslutar vänligt och noterar direkt i systemet att han inte vill bli kontaktad.
- Frågar om du får återkomma om ett halvår i stället.

Åtta sekunder in i samtalet: "Vi är inte intresserade." Vad är det?
- Ett nej. Tacka och lägg på.
- Ett nej, men du får ställa en sista fråga först.
- Ett tecken på att du talar med fel person.
* Ett reflexsvar på de första sekunderna — fråga vidare.

Kunden: "Nej, jag vill faktiskt inte prata om det här." Vad är det?
* Ett nej till själva samtalet — avsluta rent.
- Ett motstånd — han har inte sagt nej till tjänsten.
- En invit att fråga när det passar bättre.
- Ett nej till ämnet, men inte till samtalet — byt ämne.

Kunden har inte svarat på dina tre senaste frågor annat än med "mm". Vad gör du?
- Ställer en fjärde och tydligare fråga.
- Frågar om han hör dig.
* Avslutar rent — det är inte längre ett samtal.
- Går över till att presentera tjänsten, eftersom frågorna inte ger något.

Kvinnan du talar med säger att hon inte har med saken att göra och inte vet vem som har det. Vad gör du?
- Frågar tre lager djupt om hur de brukar fatta sådana beslut.
* Tackar och avslutar — det finns ingen dörr här.
- Ber henne koppla dig till chefen ändå.
- Frågar om hon vill ta emot ett mejl att skicka vidare.

Vilka två utgångar ur ett samtal är godkända enligt modulen?
- Ett nästa steg, eller ett mejl som skickas efteråt.
- Ett avslut, eller ett löfte om att ringa igen efter sommaren.
- Bara ett nästa steg — ett samtal utan nästa steg är alltid ett misslyckande.
* Ett nästa steg, eller ett rent avslut.

Kunden: "Ring efter sommaren." Vad är den bästa fortsättningen?
- "Okej, jag lägger in en påminnelse i augusti. Ha en fin sommar!"
- "Efter sommaren är det ofta för sent att hinna med hösten."
- "Passar första veckan i augusti?"
* "Absolut. Vad är det som händer till dess?"

Vad gör ett rent avslut rent?
- Att du tackar för tiden och lovar att aldrig ringa igen.
- Att du erbjuder ett mejl i stället för ett samtal.
* Att det varken innehåller en sista fråga eller en liten pitch på vägen ut.
- Att du frågar om det finns någon annan på företaget du kan tala med.

Kunden har svarat på dina frågor i fyra minuter och säger sedan: "Jag måste vidare nu." Vad gör du?
- Avslutar rent — "jag måste vidare" är ett nej.
- Frågar om du får skicka ett mejl.
- Klämmer in en sista fråga medan han är kvar.
* Föreslår ett konkret nästa steg — dörren fanns, den är bara tidsbegränsad.

Varför finns gränsen mot ett nej överhuvudtaget, enligt modulen?
- För att ett nej ändå aldrig går att vända.
* För att den som inte hör ett nej bränner listan, får klagomål och lär sig ingenting av samtalet.
- För att det annars blir svårt att komma tillbaka till samma kund om ett år.
- För att chefen lyssnar på inspelningarna.

Du är mitt i en kedja när kunden säger "det är inget vi prioriterar just nu". Vad är det?
- Ett nej — han har uttalat att frågan inte är aktuell.
- Ett nej till tidpunkten, så boka ett nytt samtal om ett halvår.
* Ett motstånd — fråga vad som prioriteras i stället.
- Ett tecken på att du gått för många lager och tröttat ut honom.
$q$);

  -- ======================================================================
  -- 15. Rollspel
  -- ======================================================================
  v_modul := pg_temp.lagg_modul(v_kurs, 15, 'Sluttest: jag släpper inte', 'roleplay', $md$
## Uppgiften

Ett **fem minuter långt samtal** med din chef eller en kollega som spelar kund.
Du spelar in det och laddar upp inspelningen här nedanför. Din chef lyssnar och
bedömer mot rubriken längre ner på sidan — den du ser nu, innan du börjar.

## Så här går det till

1. Be din chef eller en kollega spela kund. Hon vet vad hon ska göra: **ge dig
   minst tio tillfällen att släppa henne** — och minst ett riktigt nej.
2. Spela in. Fem minuter.
3. Ladda upp filen här.
4. Du får ett betyg och en skriftlig återkoppling. Godkänt är 80 procent, alltså
   24 av 30 poäng.

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
  -- ett fel — den ger en halv kurs.

  select count(*) into v_antal from course_module where course_id = v_kurs;
  if v_antal <> 15 then
    raise exception 'Kursen fick % moduler, forvantade 15.', v_antal;
  end if;

  select count(*) into v_antal from course_module
  where course_id = v_kurs and kind = 'ovning';
  if v_antal <> 5 then
    raise exception 'Kursen fick % ovningar, forvantade 5.', v_antal;
  end if;

  select count(*) into v_antal
  from quiz_question q join course_module m on m.id = q.module_id
  where m.course_id = v_kurs;
  if v_antal <> 46 then
    raise exception 'Kursen fick % fragor, forvantade 46.', v_antal;
  end if;

  select count(*) into v_antal
  from quiz_option o
  join quiz_question q on q.id = o.question_id
  join course_module m on m.id = q.module_id
  where m.course_id = v_kurs;
  if v_antal <> 184 then
    raise exception 'Kursen fick % svarsalternativ, forvantade 184.', v_antal;
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
    raise exception 'En quizmodul saknar fragor, eller en annan modul har fatt nagra.';
  end if;

  -- Varje läsmodul ska följas av en övning. Det var hela beställningen, och
  -- det är den sortens krav som tyst slutar gälla när någon lägger till en
  -- modul senare — därför står det som ett villkor och inte bara i texten.
  if exists (
    select 1 from course_module m
    where m.course_id = v_kurs
      and m.kind = 'reading'
      and not exists (
        select 1 from course_module n
        where n.course_id = v_kurs and n.sort = m.sort + 1 and n.kind = 'ovning'
      )
  ) then
    raise exception 'En lasmodul foljs inte av en ovning.';
  end if;

  -- RÄTT SVAR FÅR INTE LIGGA PÅ SAMMA PLATS VARJE GÅNG. Det var felet i 0061:
  -- stjärnan stod först i varenda fråga, och provet gick att klara utan att ha
  -- läst något. Villkoret är trubbigt med flit — det fångar inte ett snett
  -- mönster, men det fångar det mönster som faktiskt uppstår när någon skriver
  -- trettio frågor i rad och alltid sätter rätt svar överst.
  if exists (
    select 1
    from quiz_option o
    join quiz_question q on q.id = o.question_id
    join course_module m on m.id = q.module_id
    where m.course_id = v_kurs and o.is_correct
    group by o.sort
    having count(*) > (select count(*) * 0.45
                       from quiz_question q2 join course_module m2 on m2.id = q2.module_id
                       where m2.course_id = v_kurs)
  ) then
    raise exception 'Ratt svar ligger pa samma plats i for manga fragor.';
  end if;

  raise notice 'Kursen ar omskriven: 15 moduler, 5 ovningar, 46 fragor. Fortfarande UTKAST.';
end;
$seed$;
