# Kundkortets tidslinje i Inkios form — byggplan

> Beställaren 2026-11-02: "bygga ut anteckningar och tidslinjen … så som det finns i inkio … närmare så i order panelen … men följer såklart navet". Planen godkändes i chatten ("okej starta bygget"). Byggs på grenen `kund-tidslinje`, en commit, och mergas till main först efter ja.

**Mål:** kundkortets flik Aktivitet visar kundens hela historik som Inkios History-sida: skrivruta med verktygsrad, Tidslinje / Per roll, filter med antal, sök, dagrubriker och tre sorters rader (post, anteckning, systemrad), i Navs formspråk.

**Arkitektur:** datan finns redan i `crm_handelse` (0277) men plattas till av `aktivitetsrader()`. Raden får fler fält (bakåtkompatibelt), reservvägen läser samma `get-customer-history`, och Navs egna händelser läggs in i kortet. Gränssnittet patchas i mains `src/nav2/utkast.html` med ett idempotent skript (`~/nav2-utkast/delar/kund-tidslinje/patch.py`).

## Globala villkor
- Ingen funktion försvinner: kampanjsidan, snabbvalen, Fäst överst, Uppdatera, Öppna i Inkio, fliken Historik och kortkommandona står kvar.
- Formspråk: minimalistiskt men levande; livet ur funktionen (avtalsmätaren, statusen), aldrig dekor.
- Inkio skrivs bara via utkorgen och bara när `utflode` är på (av tills provet i produktionen).
- En commit, ingen lokal build; `npm run test:inkio-inflode` och huvudlöst prov i Chrome.

## Uppgifter
1. **Datan** (`src/lib/crm/inflode.ts`): `tolkaPost(p, roller?)` sparar `omrade` (Inkios area) och `roll` (Inkios roll för författaren) i `data`. `Aktivitetsrad` får `sort`, `omrade`, `om`, `post`, `roll`, `niva`, `nav`, `andrad`, `raderad`, `order`. Prov i `tests/inkio-inflode.mjs` med Hedbloms riktiga historik.
2. **Servern** (`inflode-server.ts`, `inkio.ts`): `kundhistorik` lämnar `roles`; `kundaktivitetUrNav` ger Navs nivå per författare (e-post → anställd); reservvägen = `get-customer-history` + `tolkaPost` + `aktivitetsrader`.
3. **Anteckningen om en order** (0278): `kundanteckning.om_order` (uuid → sales_order, on delete set null). Rutten tar `order`; utkorgen skriver på ordern i Inkio när den är kopplad (`crm_order.crm_order_id`), annars på kunden.
4. **Gränssnittet** (patch.py): ND-varianten av `kkAktivitet` byggs om; `kkData` för över de nya fälten; Navs händelser (lades upp, godkänd, skrevs till Inkio, makulerad, förlängd, samtal) i samma tidslinje, "skrevs till Inkio" slås ihop med Inkios orderpost på ordernumret; Markdown-tolk utan HTML-inmatning.
5. **Prov och papper:** huvudlöst prov (ljust, mörkt, mobil) med Hedbloms riktiga data; `NASTA_SESSION.md`, `ARBETSLOGG.md`, `src/navnyheter/poster.ts`.

## Granskningsfokus
- En anteckning med `<script>`, `javascript:`-länk eller `<img onerror>` ska visas som text, aldrig köras.
- En kund utan något i Inkio (ny kund, Inkio ej kopplat) ska visa Navs egna händelser och skrivrutan, inte en tom ruta.
- En raderad anteckning syns bara för superadmin, märkt raderad.
- Ett avtal med startdag framåt visar "startar …", inte en mätare som gått.
- Sökningen ska träffa namn, text och ordernummer, och tom sökning visar allt.
