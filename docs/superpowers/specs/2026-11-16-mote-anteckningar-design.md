# Möten: anteckningar som blir en tråd (PRD)

2026-11-16. Beställt: "I Nav när någon bokar ett möte så bokar de oftast åt någon annan. Det vore bra om vi
kan bygga in en chattfunktion som sparar historik, och att man först kan lägga till anteckningar i panelen.
Sedan blir anteckningen en chatt där alla som är med i mötet kan se och skriva och få notis om just den kunden
och mötet i mobilen och i notisklockan. Detta får aldrig gå till kund."

Beställaren bad om få frågor. Allt nedan som inte står i citatet är mina val, märkta **(mitt val)**.

## 1. Varför

Möten bokas oftast av en mötesbokare åt en säljare. Det bokaren vet om kunden (vad kunden sa, vem som
bestämmer, vad som är känsligt) har i dag ingen plats:

- Bokningsbladet har bara **Agenda**, och den går till kunden i inbjudan.
- Det gamla fältet **Mål** togs bort ur bladet 2026-11-13. 25 av 35 möten i produktionen har ett mål, och det
  står som "Mål, bara för er" i panelen på äldre möten. **Rättat 2026-11-16 (0311):** målet var inte internt. Före
  2026-11-13 blev `mal` kalenderinbjudans agenda (`kalAgenda = v.agenda ?? v.mal`), och alla 25 texterna stod
  ordagrant i inbjudan till kunden. Beställaren: "en agenda ska gå ut i kalenderinbjudan sen ska det finnas
  anteckningar utöver agendan."
- Frågor mellan bokare och säljare går i dag utanför Nav (sms, Teams), och de syns inte för nästa person som
  tar kortet.

## 2. Mål

1. Den som bokar kan skriva en anteckning till den som håller mötet, redan i bokningsbladet.
2. Anteckningen blir första inlägget i kortets tråd. Alla som är med på mötet läser och svarar där.
3. De får notis i klockan och i telefonen när någon annan skriver, med kunden i rubriken. Ett tryck öppnar
   kortet med tråden.
4. Tråden följer kunden: ombokningar och uppföljningsmöten ligger i samma tråd, med mötesdagen utsatt.
5. **Ingenting i tråden når någonsin kunden**, och det är säkrat i tekniken, inte i en text.

## 3. Icke-mål (inte nu)

- @-omnämnanden, bilagor, reaktioner, "skriver…"-indikator, realtid via websocket.
- Tråd på kort som lämnat tavlan (affär eller nej). Tråden finns kvar i databasen men visas inte. **(mitt val)**
- AI-sammanfattning av tråden.
- Mejl som standard. Klocka och telefon räcker; den som vill kan slå på mejl för sorten i Utskick, och då går
  det bara till interna adresser (befintlig regel i `notishandelse-server.ts`).

## 4. Anti-mål (det vore ett misslyckande även om det fungerar)

- En anteckning hamnar i en inbjudan, ett ICS-fält, ett kundbrev eller något annat som lämnar Nav mot kunden.
- Samma ruta kan skriva både internt och till kunden (Zendesks klassiska fel: "intern anteckning" och "svar
  till kund" i samma fält, skilda åt med en färg som syns dåligt). Här finns ingen väg till kunden alls.
- Ett inlägg dubbleras när nätet hackar, eller försvinner tyst.
- Notiströtthet: varje tecken pingar alla, eller den som skrev får notis om sitt eget inlägg.
- Panelen blir trång och rörig.

## 5. Undersökningen i korthet

- **Zendesk**: det vanligaste felet är en intern anteckning som skickas publikt, eftersom rutan förvalt är
  "publikt svar" och den gula färgen syns dåligt. Lösningen är inte en tydligare färg utan att inte ha ett
  publikt läge i samma ruta. ([eesel](https://www.eesel.ai/blog/zendesk-private-comment-to-requester),
  [Zendesk community](https://community.zendesk.com/ideas/internal-notes-vs-public-4700))
- **HubSpot**: kommentarer på en aktivitet notifierar den som äger den, den som kommenterat och den som nämnts,
  aldrig författaren själv. ([HubSpot](https://knowledge.hubspot.com/campaigns/comment-notification-emails))
- **Driftsäkra chattar**: webbläsaren sätter inläggets id innan det skickas och återanvänder det vid nytt
  försök; servern sparar id:t och svarar med samma inlägg igen i stället för att skapa ett nytt. Inlägget
  visas direkt som "skickas" och byter läge när servern svarat, utan att byta nyckel i vyn.
  ([Ably](https://ably.com/docs/ai-transport/features/optimistic-updates),
  [Pleroma](https://git.pleroma.social/pleroma/pleroma-fe/-/merge_requests/1228))
- **I Nav själv**: felrapporternas tråd (`error_report_message`), Uppgifternas "nytt sedan sist"
  (`task_seen`, 0301) och klockans "bara det du inte sett" är mönstren att följa.

## 6. Hur det ser ut

### Bokningsbladet

Under **Agenda** ett nytt fält:

```
Anteckning till Mick                         (rubriken säger vem; bokar man åt sig själv: "Anteckning")
┌──────────────────────────────────────────┐
│ Det Mick behöver veta inför mötet        │
└──────────────────────────────────────────┘
Bara för er. Kunden ser den aldrig. Den blir första inlägget i kortets anteckningar.
```

Fältet finns bara i Boka, inte i Ändra (där är tråden i panelen rätt ställe). Rubriken följer valet av hållare
och kollegor: "Anteckning till Mick", "Anteckning till Mick och Carl", eller bara "Anteckning" när man bokar åt sig
själv. **(mitt val)**

### Panelen (kortet)

Ny sektion **Anteckningar** direkt efter **Mötet**, före Bolaget. **(mitt val: det är där samarbetet sker)**

```
ANTECKNINGAR                                         Tysta
Mick, Carl och du · kunden ser aldrig det här

  ── Inför mötet tis 17 nov ──
  (C) Carl · i går 14:10
      Ägaren heter Lena, hon bestämmer. Vill inte ha
      bindningstid. Ring inte före 10.
  ── Nytt ──
  (M) Mick · 09:12
      Tack! Ska jag ta med offerten från förra året?

┌───────────────────────────────────────────── ┐
│ Skriv till Mick och Carl…                     │
└──────────────────────────────────────────────┘
Enter skickar · Skift+Enter ny rad
```

- Kommentarstil (som Linear och GitHub), inte bubblor: lugnare i en smal panel, och lätt att läsa längre text.
- Raden under rubriken säger vilka som ser tråden och att kunden aldrig gör det. Den ersätter en varningsfärg.
- Rutan säger vem man skriver till ("Skriv till Mick och Carl…"). Ensam på kortet: "Skriv en anteckning…".
- **Nytt**-strecket står före det första inlägget man inte sett, som i Slack. Det försvinner nästa gång.
  Den som inte är med på kortet och aldrig läst tråden (en chef som ser alla kort) får varken streck eller
  markering på tavlan. **(mitt val: annars lyser varje kort för chefen)**
- Mötesdagen står som en tunn avdelare när tråden går över till ett nytt möte i kedjan.
- Fler än fyra inlägg: de fyra senaste visas, "Visa N äldre" fäller ut resten. **(mitt val)**
- Det egna inlägget: **Ändra** och **Ta bort** i en liten rad vid tiden. Ändrat inlägg säger "ändrad".
  Borttaget säger "Anteckningen togs bort" (raden står kvar, texten raderas).
- Ett inlägg som inte gått fram står kvar i tråden som "Skickades inte. Försök igen", med samma id.
- Det man skrivit men inte skickat ligger kvar om panelen stängs (per kort, i den här fliken). **(mitt val)**
- **Tysta**: inga notiser från just den här tråden för mig. Står som "Tystad" och går att slå på igen.
- ~~De gamla mötesmålen flyttas in i tråden som bokarens första inlägg.~~ **Fel, rättat i 0311:** de var
  kundens agenda. Ett äldre mötes `mal` visas som **Agenda** under "Inför mötet", oavsett om kortet har en tråd,
  och tråden börjar tom på de gamla korten.

### Tavlan

Ett kort med inlägg jag inte sett får en liten markering vid namnet på kortets nedre rad: en pratbubbla med
antalet nya ("2") i navets gröna. Inga nya: ingen markering. **(mitt val: syns bara när den betyder något)**

### Notisen

- Rubrik: `Carl om Nordic Grön AB`. Detalj: inläggets första 140 tecken, kortat på ett ord.
- Ett tryck (klocka eller telefon) öppnar Möten, kortets panel, och rullar till tråden.
- När jag läser tråden försvinner trådens notiser ur min klocka. **(mitt val)**
- Inlägget i bokningsbladet ger ingen egen notis: hållaren får redan "Zen bokade ett möte åt dig", och
  anteckningens början följer med i den notisens detalj. En notis i stället för två.

## 7. Vem som ser, skriver och får notis

| | Regel |
|---|---|
| Ser och skriver | De som är med på kortet (`mote_kedja.deltagare`: bokare, hållare, kollegor i kalendern) och cheferna (`CHEF_ROLLER`). Samma regel som kortet självt (`farAndraKedja`, RLS `mote_kedja_read`). |
| Får notis | Deltagarna och alla som skrivit i tråden (en chef som svarat följer tråden), utom den som skrev, de som tystat tråden och de som slutat. |
| Ändrar och tar bort | Bara sitt eget inlägg. |

## 8. Backend

### Tabeller (migration 0310)

```
mote_anteckning
  id          uuid primary key            -- satt av webbläsaren: samma id = samma inlägg
  kedja_id    uuid not null → mote_kedja on delete cascade
  mote_id     uuid → mote on delete set null   -- mötet som var aktuellt när det skrevs
  av          uuid not null → employee
  text        text                        -- null när borttagen
  skapad      timestamptz not null default clock_timestamp()
  andrad      timestamptz
  borttagen   timestamptz
  CHECK: text satt och 1–4000 tecken, eller borttagen och text null (skrivet så att NULL aldrig släpper igenom)
  index (kedja_id, skapad)

mote_anteckning_sett
  kedja_id, employee_id   primary key
  sett_till   timestamptz not null        -- allt till och med detta är sett
  tyst        boolean not null default false
```

- RLS: `mote_anteckning` select med exakt samma villkor som `mote_kedja_read`. `mote_anteckning_sett` bara
  egna rader. Inga skrivpolicyer: allt skrivs med service role genom rutten, efter rättighetsprövning.
- Startläge: ~~de 25 målen in som inlägg~~ (togs bort igen i 0311, de var agendan), och en `sett`-rad per deltagare och kedja
  satt till nu, så att ingenting står som nytt när funktionen slås på.
- `anon` får ingenting.

### Rutten `POST /nav2/moten/anteckningar`

| handling | Vad |
|---|---|
| `las` | Hela tråden (högst 300 senaste), vilka som är med, mitt `sett_till` och `tyst`. |
| `skriv` | `{id, kedja, text}`. `insert … on conflict (id) do nothing`. Fanns id:t redan: samma svar om det är mitt inlägg i samma kedja, annars 409. Notis bara när raden faktiskt skrevs. |
| `andra` | `{id, text, fore}`. Bara eget, villkorat på `andrad` som klienten såg (409 annars). Ingen notis. |
| `ta_bort` | `{id}`. Bara eget. Texten blir null, `borttagen` sätts. |
| `sett` | `{kedja, till}`. Flyttar `sett_till` framåt (aldrig bakåt) och avfärdar trådens notiser i min klocka. |
| `tyst` | `{kedja, tyst}`. |

- Samma ursprung, inloggad, `SKRIVLAGE.moten` för skrivningarna (423 i läsläge), och `farAndraKedja` på varje
  handling. Aktören är alltid den inloggade, aldrig något ur anropet.
- Notisraden i klockan skrivs innan svaret (en insert), pushen till telefonen går efter svaret (`after` i
  `notifieraFlera`), så att ett långsamt push-anrop inte gör att inlägget känns segt. Notisen får aldrig fälla
  inlägget: ett fel där ger noll notiser, inte ett fel till den som skrev.
- Varje skrivning loggas i händelseloggen (`mote.anteckning_skriven/andrad/borttagen`), utan texten.

### Bokningen

`boka` tar `anteckning` (högst 4000 tecken) och `anteckningId`. Inlägget skrivs efter att mötet sparats, med
bokaren som författare. Går det inte att skriva står mötet ändå, och kvittot säger att anteckningen inte
sparades. **(mitt val: mötet är viktigare än anteckningen)**

### Uppdatering

Panelen läser tråden när den öppnas, och sedan var tionde sekund medan den är öppen och fliken syns. Hela
tråden varje gång (den är liten), så att inget missas när två skriver samtidigt. Vyn ritas bara om när
något ändrats, och rutan man skriver i rörs aldrig. Tavlans markeringar kommer med den vanliga läsningen.

### Aldrig till kund: spärren i tekniken

1. Tråden ligger i en egen tabell. Inget i utkorgen, kalenderns ICS, kundbreven eller inbjudningarna läser den.
2. Ett prov (`tests/mote-anteckning-aldrig-kund.mjs`) fäller bygget om `mote_anteckning` nämns i någon fil
   utanför en kort tillåten lista (rutten, laddaren, registerutdraget, migrationen, proven), och om någon
   fil som bygger kundutskick nämner den.
3. Notisen skrivs bara till anställda (`notification_event.employee_id` → `employee`), och mejl går bara till
   interna adresser (befintlig regel).
4. Rutan i panelen har inget läge för att skriva till kunden.

## 9. Fel och kantfall

| Fall | Vad händer |
|---|---|
| Dubbelklick på Skicka, eller nätet bryts efter att servern sparat | Samma id: servern svarar med det sparade inlägget. Ett inlägg. |
| Nätet borta | Inlägget står kvar som "Skickades inte. Försök igen". Texten försvinner aldrig. |
| Två skriver samtidigt | Båda sparas. Ordningen är serverns tid (`clock_timestamp`), sedan id. |
| Jag ändrar medan någon annan läser | Nästa läsning visar "ändrad". |
| Jag tas bort som deltagare | Jag ser inte längre kortet eller tråden (RLS). |
| Kortet raderas | Tråden raderas med kedjan (`on delete cascade`). |
| Läsläge | Tråden går att läsa, rutan säger att Nav är i läsläge. |
| Den som skrev har slutat | Namnet står kvar på inlägget; hen får inga notiser. |

## 10. Prov

- `tests/motesanteckning.mjs` (rent): textregler, mottagarna, notisens text, ordningen, "nytt"-strecket.
- `tests/motesanteckning-db.mjs` (mot databasen, i en transaktion som rullas tillbaka): RLS för deltagare,
  icke-deltagare, chef och anon; CHECK-villkoren mot rader som ska avvisas; `on conflict` ger ett inlägg.
- `tests/mote-anteckning-aldrig-kund.mjs`: spärren ovan.
- Klickprov i huvudlös Chrome mot utkastet: skriva, dubbeltryck, nätfel och nytt försök, ändra, ta bort,
  visa äldre, tysta, "Nytt"-strecket, bokningsbladets fält, tavlans markering.
- Skarpt prov i produktionen som Zen på ett märkt PROV-kort, och med en kollega för notisen i telefonen.

## 11. Ordning

1. Migration 0310 (tabeller, RLS, startläge). Provas i en transaktion först; körs efter ja.
2. Ren logik `src/lib/nav2/motesanteckning.ts` med prov.
3. Rutten `src/app/nav2/moten/anteckningar/route.ts`, `boka` tar anteckningen.
4. Laddaren: `trad: {antal, nya}` per kort.
5. Notiskällan `mote-anteckning` (klocka och telefon som förval), djuplänken.
6. Utkastet: bladets fält, panelens sektion, tavlans markering.
7. Registren: navnyheter, registerutdraget, händelseloggens modul, dokumenten.
8. Prov, gren, preview, och merge till `main` efter beställarens ja.
