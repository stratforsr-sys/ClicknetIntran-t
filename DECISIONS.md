# Beslutslogg

Definition of Done p. 5: beslut med konsekvens antecknas här, inte i marginalen.

---

## D-U1 · Varumärkesfärgen avläst från clicknet.se
**2026-08-16.** PRD:n listade B4/B5 som blockerande. Sajtens stilmall använder
`#17BAA2` för aktiva menyval och kantlinjer, och `Plus Jakarta Sans` som
typsnitt — det senare stod redan på UI-PRD §4.4:s kandidatlista.

**Konsekvens:** B4 och B6 är inte längre blockerande. B1 (logotyp för ljus
bakgrund) och B3 (symbolmärke) saknas fortfarande; tills vidare används ett
sättet C-märke i sidopanelen.

## D-U2 · `#17BAA2` får aldrig bära vit text
**2026-08-16.** Mätt kontrast: vit text på `#17BAA2` ger **2,45:1**, mot kravet
4,5:1 i AC-U5.1. UI-PRD förutspådde det ("turkosa toner mot vitt underkänns
nästan alltid").

**Beslut:** `--color-brand-600: #0B7F6E` (**4,91:1** mot vit) är den enda tonen
som får användas till fyllda knappar och till text på ljus bakgrund.
`--color-brand-500: #17BAA2` behålls som varumärkeston men endast på mörka ytor,
där den ger 6,2:1 mot sidopanelen.

**Konsekvens:** knappar ser något djupare ut än referensbilderna. Det är ett
medvetet byte av utseende mot läsbarhet.

## D-U3 · Statuspiller använder tonad platta med mörk text
**2026-08-16.** Alla fem kombinationer mätta till mellan 5,8:1 och 7,3:1.
Mättad färg med vit text drar för mycket uppmärksamhet i en tabell (UI-PRD §5.5).

## D-U4 · Mörkt läge byggs inte nu
**2026-08-16.** Beställarbeslut. Alla värden ligger som CSS-variabler, så det kan
slås på utan ombyggnad. Ingen växlare visas i toppraden förrän det finns.

## D-U5 · Sidopanelen visar bara byggda moduler
**2026-08-16.** Alternativet — hela menyn med "kommer snart" — lär användaren att
menyn ljuger, och det är svårt att ta tillbaka. Menyn växer per levererad modul.

---

## D-T1 · Skrivningar går via service role, inte via RLS
**2026-08-16.** Läsning sker alltid med den inloggades rättigheter, så RLS är det
som avgör vad som syns. Skrivning sker i server actions med service role, efter
en explicit behörighetskontroll.

**Skäl:** varje skrivning ska loggas i `audit_log` i samma svep, och
behörighetsregeln för "får lägga upp anställda" är mer än en radnivåkontroll.

**Konsekvens:** en glömd kontroll i en server action är allvarligare än en glömd
RLS-policy. Varje ny action ska börja med `kravChef()` eller motsvarande.

## D-T2 · Hjälpfunktioner i Postgres är `security definer` med låst `search_path`
**2026-08-16.** Utan `set search_path = public, pg_temp` kan en användare skapa en
egen `employee`-tabell i sitt eget schema och få funktionen att läsa den.

## D-T3 · Offboarding stänger sessioner på två sätt
**2026-08-16.** AC-1.4 kräver att sessioner invalideras omedelbart. Admin-API:ts
bannlysning kan misslyckas mot ett nätverksfel; middleware som slår tillbaka på
`status = 'offboarded'` kan inte kringgås. Båda finns.

**Bakgrund:** R11 — utan katalogtjänst finns ingen central spärr när någon
slutar, så offboarding är en säkerhetsfunktion, inte en administrativ detalj.

## D-T4 · `payroll_cost_viewer` ligger i egen tabell
**2026-08-16.** PRD §1.4 och Q63: behörigheten ska kunna ges och dras in per
person, oberoende av teknisk roll. Hade den legat som en roll i `employee_role`
hade den som får hjälpa till med IT automatiskt sett allas ersättning.
Tabellen finns redan, modulen (M13) byggs långt senare.

## D-T5 · `/uppstart` finns för att någon måste kunna bli först
**2026-08-16.** Bara en säljchef får lägga upp anställda, så ett nyuppsatt nav har
ingen väg in. Vyn är tillgänglig endast så länge `employee` är tom och stänger
sig själv därefter.

## D-T6 · Migrationer körs med checksumma, aldrig via Supabase-gränssnittet
**2026-08-16.** Definition of Done p. 3. `schema_migrations` har RLS påslagen utan
policy, så tabellen syns inte via REST-API:t.
