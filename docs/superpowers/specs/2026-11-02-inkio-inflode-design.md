# Inkio in i Nav, och Nav ut till Inkio (0277)

**Beställaren 2026-11-02.** En säljare ringde en kund utan svar och skrev det i Inkio. Det kom inte in i
Nav, och ingen fick en notis. Beställaren: "allting som händer i inkio crmet med dem ordrarna som vi har i navet
måste jag och den personen som står på ordern få notis och det måste gå in i navet, under anteckningar … vi får
aldrig missa något … allting som händer i navet går in i crmet på dem ordrarna som finns i crmet. Superadmin ska
alltid få alla notiser … Admin ska få det bara på dem ordrana som tillhör antingen han eller personer i sitt
team." Och efter genomgången: "Om något ändras i inkio så ska det ändras i navet också såklart — eller läggs till
i inkio så ska det läggas till i navet." Hen sa "Fixa hela bygget nu"; valen som inte står ovan är mina och
listas sist.

## Läget före

- Nav läste Inkio bara när kundkortets flik **Aktivitet** öppnades (`kundaktivitet`). Ingenting sparades,
  ingenting bevakades och ingen fick någon notis.
- En anteckning skriven i Nav gick direkt till Inkio (`skrivKundanteckning`), utan utkorg och utan kopia i Nav.
- 22 av 30 kunder hade ingen koppling till sin Inkio-order (importerade till Inkio 2026-10-01).
- Nav skickade inte `X-Inkio-Company`. Anropen hamnade därför i det bolag som kontot senast hade öppet.

## Vad Inkio ger

- **Webhooks**: bara 11 händelser (order, avtal, fakturor, ärenden, ny kund). Det finns **ingen** för anteckning,
  samtal, fil eller kortflytt, så webhooks räcker aldrig ensamma.
- **`GET /api/customers/get-customer-history?id=&with_deleted=1`**: allt om kunden i ett anrop (~130 ms):
  - anteckningar och aktiviteter på kunden, ordern, avtalet, ärendet och leveranskortet (Task);
  - posterna själva: ordern med värde, status och `cancelled`, avtalet och ärendet;
  - raderade poster (`with_deleted`).

  Varje post har ett stabilt id. Navs egna skrivningar är märkta `created_by_is_service_account`.
- `correct-sales-order` rättar en inskickad order (rader, värde, längd, fakturering, skäl), samma anrop som
  Inkios "Rätta order".

## Hur det byggdes

**Bevakningen är ryggraden, och webhooken är en knuff.** Det följer best practice: avstämning mot källan,
idempotens på källans id, inget eko och en utkorg för det som går ut.

1. **`nav-inkio` (pg_cron, varje minut) → `/api/jobb/inkio` → `bevaka()`** (`src/lib/crm/inflode-server.ts`).
   - Varje kund med en order i Nav (inte utkast) läses med ett anrop, fyra i taget.
   - Är hela svarets avtryck oförändrat skrivs bara tiden, i en skrivning för alla kunder.
   - Annars jämförs varje post med `crm_handelse` (`jamfor`) och skrivs: ny, ändrad eller raderad.
   - Ett lås (`crm_installning.las_till`) gör att två varv aldrig notifierar samma sak.
2. **Notisen** (`notisFor`, `kretsen` i `src/lib/crm/inflode.ts`):
   - En ny post ger notis om den är högst **tolv timmar** gammal. Kundens första läsning är därför tyst för det
     gamla, och en bevakning som stått still en natt säger ändå till om det som hände då.
   - En ändrad order, ett ändrat avtal eller ärende ger alltid notis. En ändrad eller raderad anteckning är tyst
     och märks "ändrad" eller "raderad i Inkio".
   - Navs eget eko är tyst, och det är också den order och det avtal som dyker upp de två första timmarna efter
     att Nav lagt ordern.
   - Mottagare: alla superadmin, säljaren på varje order på kunden och den admin som leder säljaren (chef eller
     teamledare). Aldrig den som skrev; Inkios författare paras med Nav på mejladressen.
   - Länken går till `/order/kund/<org.nr>`, som öppnar kundkortet på Aktivitet.
3. **Ändringar i Inkio som ändrar Nav** (`statusFranInkio`, `tillampa`, `lk_inkio_andra_order`):
   - En order som makuleras i Inkio makuleras i Nav. Säljaren får den vanliga notisen med avdraget.
   - En betald faktura i Inkio markerar ordern betald i Nav. Det är ren information; provisionen ändras inte.
   - Ett avtal som sägs upp i Inkio avslutar avtalsbevakningen.

   Det gäller bara en **övergång** som Nav ser hända. Ett gammalt läge Nav ser för första gången rör ingenting,
   annars hade en makulering från september dragit provisionen i november. Ändringen sätter `nav.fran_inkio`,
   så den skrivs inte tillbaka till Inkio. En makulering i Inkio inom 30 minuter efter en rättning från Nav
   makuleras inte; superadmin får frågan i stället.
4. **Ett ändrat belopp i Inkio ändrar inte Nav.** Det ger en notis ("Ordervärdet ändrades i Inkio: 167 880 kr
   → 150 000 kr") med länk till kundkortet. Beloppet styr provisionen och lönen, och Inkios rader motsvarar inte
   Navs paket ett till ett, så en människa rättar i Nav.
5. **Kopplingen på organisationsnummer** (`kopplaPaOrgnr`). En godkänd Nav-order utan koppling kopplas till en
   Inkio-order med **samma värde** (på kronan), när värdet är unikt på båda sidor. Kopplingen blir
   `crm_order.kopplad = 'orgnr'`. Torrkörningen 2026-11-02 gav 20 kopplingar. Strajv AB (11 940 kr i Nav,
   5 970 kr i Inkio) kopplas inte.
6. **Kundkortet** läser Navs kopia (`kundaktivitetForKortet`) i samma form som förut, så gränssnittet ändras
   inte. Har bevakningen inte läst kunden än läses Inkio direkt som förut. Superadmin ser det som raderats i
   Inkio.
7. **En anteckning i Nav**:
   - Den sparas i `kundanteckning`, köas i utkorgen (`anteckning`) och skrivs till kunden i Inkio med namnet
     först ("**Namn** (via Nav): …").
   - Kretsen får notisen `order-anteckning`.
   - Ekot läses tillbaka, känns igen på Inkios id och visas inte två gånger.
   - En anteckning som inte kom fram köas om: efter fem minuter, och efter ett fel en gång i timmen.
8. **Allt annat i Nav → Inkio** (triggrarna i 0277 → utkorgen `nav-handelse` → `navHandelseICrm`):
   - betald, rättad, förlängningens utfall, ny bilaga efter godkännandet, kopplat säljsamtal och kampanjsidan
     nere eller uppe;
   - raden skrivs på Inkio-ordern när den är kopplad, annars på kunden;
   - **rättad**: en order som Nav själv lagt och som är inskickad i Inkio rättas med `correct-sales-order`. En
     importerad order får en rad om vad som ändrats;
   - provision står aldrig i Inkio, eftersom EffektivMedias personal ser det.
9. **Webhooken** `POST /api/inkio` läser bara om en kund direkt.
   - Den kräver `INKIO_WEBHOOK_SECRET`, som egen rubrik `X-Nav-Nyckel` eller som HMAC i `X-Inkio-Signature`.
   - Kroppen sparas i `crm_webbkrok`; ingenting i den skrivs in i Nav.
10. **Larmet**: utkorgens minutjobb (ett annat jobb) larmar superadmin om ingen kund lästs på 15 minuter, högst
    var sjätte timme (`inkio-bevakning`).
11. **`X-Inkio-Company`** skickas i varje anrop (`INKIO_CLICKNET`, bytbart med `INKIO_COMPANY_ID`).

## Brytare (`crm_installning`, en rad SQL, ingen deploy)

| Kolumn | Vad | Från början |
|---|---|---|
| `inflode` | bevakningen läser Inkio | av, slås på vid mergen |
| `utflode` | Nav → Inkio (triggrarna, anteckningarna) | av, slås på vid mergen |
| `styr_status` | makulerad, betald och uppsagt i Inkio ändrar Nav | på |
| `ratta_i_inkio` | en rättning rättar Inkio-ordern | på |

## Prov

- `tests/inkio-inflode.mjs` (`npm run test:inkio-inflode`): tolkningen, jämförelsen, notisen, kretsen,
  statusen, kopplingen, kundkortets rader och rättningens form.
- `scripts/inkio-torrkor.mjs`: ett varv som torrkörning mot riktig data. Den läser Inkio bara med GET och Navs
  databas `read only`, och skriver ut rader, notiser med mottagare, statusändringar och kopplingar.
- Previewen notifierar ingen utom personerna i `NOTIS_PROV_TILL` (`provfilter`), och den skriver aldrig i
  Inkio (`inkioFarSkriva`, utkorgen lämnar tillbaka CRM-raderna).

## Mina val (beställaren har inte sagt dem)

- "Personen som står på ordern" är säljaren.
- Klockan och telefonen är på för de nya sorterna. Mejl är av och kan slås på i Utskick.
- Tolv timmar avgör om en ny post ger notis.
- En ändrad eller raderad anteckning ger ingen ny notis.
- Ett ändrat belopp i Inkio ändrar inte Nav. Det ger en notis.
- Koppling på org.nr kräver samma värde.
- Rättning med `correct-sales-order` görs bara på order som Nav själv lagt i Inkio.
- Lucas Pohl (rollen admin) räknas som superadmin, som `nivaFor` säger.
