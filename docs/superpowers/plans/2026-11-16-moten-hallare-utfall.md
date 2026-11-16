# Möten: vem som höll mötet, utfallet och nästa steg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den som höll mötet kan sättas före och efter mötet och sätter då utfall, kvalificering och nästa steg i ett flöde; ett möte efter det första räknas aldrig som ett nytt bokat möte.

**Architecture:** Reglerna som rena funktioner i `src/lib/nav2/motenforma.ts` (prövas utan databas). Rutten `src/app/nav2/moten/route.ts` får handlingen `hallare` och fältet `holl` i `utfall`; Ändra tar `hallsAv`. Migration 0313 ger `lk_byt_organisator` (kalendern före mötet) och `mote_foregaende` (artregeln). Klienten är `src/nav2/utkast.html`.

**Tech Stack:** Next.js route handlers, Supabase (service role i rutten, plpgsql SECURITY DEFINER i kalendern), en-fils-klienten utkast.html, node-prov (`tests/*.mjs`), klickprov i `~/nav2-utkast/delar/`.

**Spec:** `docs/superpowers/specs/2026-11-16-moten-hallare-utfall-design.md` (godkänd 2026-11-16: kunden rörs inte vid byte före mötet; samma kund på nytt kort = ombokning inom 90 dagar; bygg på grenen `moten-hallare`).

## Global Constraints

- Kunden får inget av ett hållarbyte: ingen ICS, ingen `ics_sequence`-ökning, inget i utkorgen till externa adresser.
- Ingen kan ändra sin egen mötesprovision: neka när mottagarna (`provisionsmottagare`) skiljer sig före/efter och aktören finns i någon av listorna. Text: "Bytet ändrar din mötesprovision. Den som höll mötet eller en annan admin byter."
- Bedömt möte (`niva` eller `provision_last_nar` satt): hållaren byts bara av `UTFALL_ROLLER`, och provisionen räknas om med `andraProvision`.
- Fönstret för samma kund: inställningen `moten.ny-kund-dagar`, standard 90, heltal 0–365 (0 = av), en penganyckel (`PENGANYCKLAR`).
- Nya SQL-funktioner: `revoke execute ... from public, anon, authenticated` (minnet: public får EXECUTE på varje ny funktion), `grant` bara till `service_role`.
- Migrationen körs först efter beställarens ja. Main först efter ja.
- En push, en commit; hela sviten en gång före pushen.

## Review Focus

1. Dubbelklick på "Det var jag som höll mötet" av två personer samtidigt: bara den första vinner, den andra får "Mötet har redan en ny hållare" (villkorad update på `halls_av`).
2. Byte till en person som slutat eller inte får hålla möten: 400 före något skrivs.
3. Byte före mötet när kalenderhändelsen saknas eller är inställd: mötesraden ändras inte (allt eller inget), begripligt fel.
4. Bokning efter Uteblev på samma kort när det tidigare mötet är Avbokat: arten blir `ombokning`, inte `ny`.
5. Uppföljning efter ett hållet möte på ett annat kort längre bak än 90 dagar: fortfarande `uppfoljning` (regel 1 har inget fönster), aldrig `ny`.

---

### Task 1: Reglerna för hållarbytet och artregeln (rena)

**Files:**
- Modify: `src/lib/nav2/motenforma.ts` (efter `farRattaUtfall`, rad ~317)
- Modify: `src/lib/nav2/motesflode.ts` (`MotenInst`, `INST_FORVAL`, `INST_NYCKLAR`, validerare; `PENGANYCKLAR` i motenforma.ts)
- Test: `tests/moten-hallare.mjs` (ny), `package.json` (`test:moten-hallare` + i `test:alla`)

**Interfaces:**
- Produces:
  - `hallareByte(i: { aktor: Aktor; m: MoteParter & { mote_tid: string; niva: string | null; provision_last_nar: string | null }; ny: string; nyKanHalla: boolean; fore: readonly string[]; efter: readonly string[] }): { ok: true } | { fel: string; status: 400 | 403 | 409 }`
  - `HALLARE_EGEN_PROVISION = "Bytet ändrar din mötesprovision. Den som höll mötet eller en annan admin byter."`
  - `sammaMottagare(a: readonly string[], b: readonly string[]): boolean`
  - `MotenInst.nyKundDagar: number` (nyckel `moten.ny-kund-dagar`, förval 90)

- [ ] **Step 1: Failing tests** i `tests/moten-hallare.mjs`: (a) kollega på kortet byter till sig själv, mottagarna oförändrade → ok; (b) utanför kortet, ingen admin → 403; (c) `ny === m.halls_av` → 409 "Det är redan hen som håller mötet."; (d) `nyKanHalla` false → 400; (e) bokaren byter bort sig själv som hållare så att hen blir mottagare (fore `[]`, efter `[bokaren]`) → 403 med `HALLARE_EGEN_PROVISION`; (f) admin som inte är mottagare byter samma fall → ok; (g) `niva` satt, aktör kollega → 403 "Mötet är redan bedömt. En admin byter hållare via Rätta."; (h) `niva` satt, aktör admin utan provision → ok; (i) `nyKundDagar` läses: saknas → 90, 30 → 30, 400 → 90, -1 → 90.
- [ ] **Step 2:** `node --experimental-strip-types tests/moten-hallare.mjs` → FAIL (exporten saknas).
- [ ] **Step 3:** Implementera; ordning på prövningarna: rätt (`farSattaUtfall`) → samma → kan hålla → bedömt (kräver `farRattaUtfall`) → pengaspärren.
- [ ] **Step 4:** Provet grönt; `test:moten` och `test:motesflode` gröna.

### Task 2: Migration 0313 — kalendern före mötet och artregeln

**Files:**
- Create: `supabase/migrations/0313_moten_hallare.sql`
- Test: `tests/moten-hallare-db.mjs` (ny, i en transaktion, kör filen två gånger, rullar tillbaka)

**Interfaces:**
- Produces:
  - `lk_byt_organisator(p_aktor uuid, p_event uuid, p_ny uuid, p_behall uuid[], p_utfort_av uuid default null) returns jsonb` — rätten som `lk_spara_mote` (`lk_far_andra(p_aktor, organizer_id)`), `lk:installd`/`lk:finns_inte`/`lk:ogiltig` som där; sätter `organizer_id = p_ny`; tar bort `p_ny` ur `calendar_attendee` (organisatören är ingen deltagare); den gamla organisatören blir deltagare om hen finns i `p_behall`, annars tas hen bort; externa rader och `ics_sequence` rörs inte; notis till den nya (`lk_notis`, mall `organisator`) och den gamla. Svarar `{ "ok": true }`.
  - `mote_foregaende(p_kedja uuid, p_fore timestamptz, p_dagar int) returns uuid` — kortets senaste möte före `p_fore`; annars, om `p_dagar > 0`, samma kunds (`mote_kundens_bolag`) senaste möte på ett annat kort med `mote_tid` inom `p_dagar` dagar före `p_fore`; annars null.
  - Båda: `security definer`, `set search_path = public, pg_temp`, EXECUTE bara `service_role`.

- [ ] **Step 1: Failing db-test**: kedja A med ett Uteblev-möte → `mote_foregaende(A, …, 90)` = det mötet; ny kedja B för samma bolag (samma telefon), A stängd, mötet 30 dagar bakåt → A:s möte; 120 dagar bakåt → null; `p_dagar = 0` → null; `lk_byt_organisator` på en PROV-händelse: organisatören byts, gamla tas bort utan `p_behall`, finns kvar med; inställd händelse → `lk:installd`; `authenticated` saknar EXECUTE på båda.
- [ ] **Step 2:** Kör → FAIL (funktionerna finns inte).
- [ ] **Step 3:** Skriv migrationen (fråga `pg_proc` efter `lk_spara_mote`/`lk_notis` innan, filen är inte sanningen).
- [ ] **Step 4:** db-provet grönt två körningar i rad; `select tgname from pg_trigger where tgenabled='D'` tom.

### Task 3: Rutten — byt hållare, vem som höll mötet, artregeln och provisionen över kort

**Files:**
- Modify: `src/app/nav2/moten/route.ts` (ny `case "hallare"`; `utfallHandling` tar `holl`; `andra` tar `hallsAv`; `laggMote` steg 4 sätter `foregaende` med `mote_foregaende`; kontrollen "hör till kedjan" bara för klientens `foregaende`)
- Modify: `src/lib/nav2/motenforma.ts` (`utfallIndata`: `holl?: string`; `andraIndata`: `hallsAv?: string`; `hallareIndata(body): Resultat<{ mote: string; ny: string }>`)
- Modify: `src/lib/nav2/motesprovision-server.ts` (`ursprungligBokare` följer `foregaende_id` till ett annat kort: läs saknade id:n, högst 20 steg) och `src/lib/nav2/moten.ts:620-630` (samma karta)
- Test: `tests/moten-rutt-behorighet.mjs` (utöka), `tests/moten-hallare.mjs` (indata)

**Interfaces:**
- Consumes: `hallareByte`, `HALLARE_EGEN_PROVISION` (Task 1); `lk_byt_organisator`, `mote_foregaende` (Task 2); `provisionsmottagare(db, m, inst)` (finns).
- Produces: POST `{ handling: "hallare", mote, ny }` → `{ ok, mote, hallsAv }`; `utfall` med `holl` gör först bytet (samma prövning) och sedan utfallet, och bedömningen sker som den nya hållaren; notiskällan `mote-bedom` när mötet väntar på bedömning (till hållaren) och `mote-hallare` vid byte (till gamla och nya hållaren).

- [ ] **Step 1: Failing tests**: indata (`holl`/`hallsAv`/`hallareIndata` avvisar icke-uuid); behörighetsprovet: `hallare` utan inloggning 401, fel ursprung 403.
- [ ] **Step 2:** Kör → FAIL.
- [ ] **Step 3:** Implementera. `hallare`: läs mötet (`moteForSe`), prövning med `hallareByte` (mottagarna före = `provisionsmottagare(db, m, inst)`, efter = samma med `halls_av: ny`), före mötets tid `lk_byt_organisator` (som gamla hållaren, `p_utfort_av = mig`, `p_behall` = kollegorna), sedan `update mote set halls_av = ny where id = m and halls_av = gamla` (0 rader → 409 "Mötet har redan en ny hållare."; kalendern tillbaka med ett nytt `lk_byt_organisator`). Bedömt + admin: `andraProvision`. Händelselogg `mote.hallare_bytt` (före, efter). Notiser.
- [ ] **Step 4:** Proven gröna; `test:moten-rutt`, `test:moten`, `test:kalender-push`, `test:notiser-tackning`, `test:notislankar`, `test:utskick` gröna.

### Task 4: Notiskällorna

**Files:**
- Modify: `src/lib/notiser.ts`, `src/lib/utskick.ts`, `src/lib/nav2/kalender-push.ts` (PUSHKALLOR), `src/lib/nav2/loggforma.ts` (händelsenamn), `tests/notislankar.mjs`
- (Viks in i Task 3:s commit; ett eget steg för att inget register glöms.)

- [ ] Registrera `mote-bedom` ("Ett möte väntar på din bedömning", klocka + telefon) och `mote-hallare` ("Du håller ett möte", klocka + telefon), länk `/moten/<kedja>`; händelserna `mote.hallare_bytt`: "Möte: ny hållare".

### Task 5: Klienten

**Files:**
- Modify: `src/nav2/utkast.html` (utfallsdialogen ~39770–39840, kortets knappar ~40300, Ändra-fältet `hallsAv` ~39890, Boka-raden om arten)
- Test: `~/nav2-utkast/delar/moten-hallare/klick-hallare.mjs` (ny, rigg från `delar/mote-anteckning/klick-ant.mjs`)

- [ ] **Step 1: Failing klickprov**: (a) utfallsdialogen börjar med "Vem höll mötet?", förvald hållaren, kollegorna som val; (b) väljer jag mig själv syns frågorna och POST har `holl = jag`; (c) väntande kort visar "Det var jag som höll mötet" för en kollega, inte för hållaren; (d) Ändra före mötet har "Vem håller" och skickar `hallsAv` bara när den ändrats; (e) Boka från ett kort med hållet möte visar "Uppföljning: räknas inte som ett nytt bokat möte"; efter bara Uteblev "Nytt försök efter Uteblev: räknas som <bokarens förnamn>s bokning, inte som en ny"; (f) dator och 400 px, inga konsolfel.
- [ ] **Step 2:** Kör mot nuvarande utkast → FAIL.
- [ ] **Step 3:** Implementera i utkastets stil (`moFalt`, `ndMo…`, ingen omladdning: `ndOmlas`).
- [ ] **Step 4:** Klickprovet grönt; `klick-ant.mjs`, `moten-bokning/prov.mjs` och `moten-utfall-fel/klick-fel.mjs` utan nya röda.

### Task 6: Dokument, nyhet, hela sviten, push

- [ ] `src/navnyheter/poster.ts` (överst), `docs/NASTA_SESSION.md`, `docs/ARBETSLOGG.md`.
- [ ] Hela sviten (`alla.mjs` förbi de kända röda), en commit, push grenen, Vercels bygge grönt, previewen klickad.
- [ ] Fråga om ja till 0313 och till main.
