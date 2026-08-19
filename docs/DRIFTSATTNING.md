# Driftsättning — vad som måste göras utanför koden

Inställningar i Supabase som inte kan sättas från repot.

---

## Stämplingen är påslagen sedan 2026-08-17 · in och ut, inte rast

`M2_AKTIV = true` i `src/lib/tid.ts`. In- och utstämpling vilar på
anställningsavtalet och arbetstidslagens krav på förda anteckningar, och
kräver ingen intresseavvägning.

`RAST_AKTIV = false` står kvar. Raststämpling är övervakning av när en människa
äter lunch och kräver K12 skriven och daterad, K14-informationen kvitterad och
K29, det dokumenterade rastschemat. Så länge den är av drar navet **inga**
raster från arbetad tid: den registrerade tiden är från instämpling till
utstämpling, och rasten hanteras utanför systemet.

**Innan första dagen:**

1. **Lägg upp arbetstiderna** under `/tid/schema`, minst en bolagsrad per
   veckodag. Utan schema stänger nattjobbet aldrig en glömd utstämpling — den
   dagen står öppen tills någon rättar den för hand, och en öppen dag blockerar
   löneperioden.
2. **Lägg upp de anställda** under `/personal/ny`. Var och en får ett
   tillfälligt lösenord som visas en gång.
3. **Berätta hur det fungerar.** Att tiden sätts när knappen trycks, att en
   felstämpling rättas med en begäran till chefen och aldrig raderas, och att
   rasten inte stämplas än.

**Raststämplingen slås på under Tid → Spärrar**, inte i koden. Knappen är
låst tills K12 är publicerad och daterad, K14 kvitterad av alla aktiva och ett
rastschema finns. Villkoren kontrolleras av en trigger i databasen, och listan
i vyn kommer ur samma funktion som triggern dömer efter.

Utkast till båda dokumenten ligger i rutinbiblioteket (skapade av
`scripts/seed-sparrdokument.mjs`). Beslutsdatumet sätts i redaktören.

I koden finns bara nödstoppen `NODSTOPP_STAMPLING` och `NODSTOPP_RAST`. De
stänger av något som databasen säger är påslaget — aldrig tvärtom.

---

## 0. Mejlet måste bära koden · KRAVET ÄR AVSTÄNGT TILLS DETTA ÄR GJORT

**Läge 2026-08-16:** verifierat att mejlet innehåller en "sign in"-länk men
ingen kod, och att länken inte fungerar (samma orsak som punkt 1 nedan).
Därför står `MFA_REQUIRED_ROLES` i `src/lib/roles.ts` tom och ingen möts av
kodsteget. Inloggning sker med lösenord. **K33 är inte uppfylld.**

Hela steget är byggt och testat och slås på genom att sätta tillbaka rollerna
i den listan — men gör det först när a) och b) nedan är klara, annars låses
chefsrollerna ute.

Steg två vid inloggning är en engångskod till e-posten (E1.2). Två saker
avgör om den kommer fram.

**a) Mallen måste innehålla koden.** Supabases standardmall för magisk länk
innehåller bara en länk, ingen kod. Utan `{{ .Token }}` i mallen får
mottagaren ett mejl utan det som ska skrivas in.

[Authentication → Email Templates → Magic Link](https://supabase.com/dashboard/project/kwsyvqymebamiqnxqjgj/auth/templates):
lägg in koden i mallen, till exempel

```html
<p>Din kod till Clicknet Nav: <strong>{{ .Token }}</strong></p>
<p>Koden gäller i en timme. Har du inte försökt logga in kan du strunta i det här mejlet.</p>
```

**b) Egen avsändare (SMTP) måste vara påslagen.** Supabases inbyggda
mejlutskick tar ett par mejl i timmen och är uttryckligen inte till för drift.
Med den kvar slutar inloggningen fungera så fort ett par personer loggar in
samma timme — tyst, för avsändaren märker inget.

[Project Settings → Authentication → SMTP Settings](https://supabase.com/dashboard/project/kwsyvqymebamiqnxqjgj/settings/auth):
koppla in en riktig leverantör (Resend, Postmark eller Brevo) med avsändare på
er egen domän. Det är samma leverantör som E0 ändå behöver för
granskningspåminnelserna i M5.

Koden går att ta fram utan mejl så länge b) inte är löst:

```bash
node -e '
const B=process.env.NEXT_PUBLIC_SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const r=await fetch(B+"/auth/v1/admin/generate_link",{method:"POST",
 headers:{apikey:K,Authorization:"Bearer "+K,"Content-Type":"application/json"},
 body:JSON.stringify({type:"magiclink",email:"zen@clicknet.se"})});
const j=await r.json();console.log("Kod:",j.email_otp??j.properties.email_otp);'
```

Det är en nödutgång för den som sitter fast, inte en arbetsrutin: den kräver
service role-nyckeln och går förbi hela poängen med steg två.

---

## 1. Magiska länkar går till fel adress · BLOCKERANDE

**Verifierat 2026-08-16.** En magisk länk genererad mot
`https://clicknet-nav.vercel.app/auth/bekrafta` får i praktiken
`redirect_to = http://localhost:3000`. Supabase ignorerar en omdirigering som
inte finns i tillåtelselistan och faller tillbaka på Site URL, som fortfarande
står på utvecklingsvärdet.

Följden är att inloggning med magisk länk inte fungerar för någon i produktion.
Lösenordsinloggning fungerar, så navet är användbart under tiden.

**Åtgärd** — [Authentication → URL Configuration](https://supabase.com/dashboard/project/kwsyvqymebamiqnxqjgj/auth/url-configuration):

| Fält | Värde |
|---|---|
| Site URL | `https://clicknet-nav.vercel.app` |
| Redirect URLs | `https://clicknet-nav.vercel.app/**`<br>`http://localhost:3000/**` |

Lägg till den egna domänen också när `nav.clicknet.se` är på plats.

**Verifiera efteråt:**

```bash
node -e '
const B=process.env.NEXT_PUBLIC_SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY;
const o="https://clicknet-nav.vercel.app/auth/bekrafta";
const r=await fetch(B+"/auth/v1/admin/generate_link",{method:"POST",
 headers:{apikey:K,Authorization:"Bearer "+K,"Content-Type":"application/json"},
 body:JSON.stringify({type:"magiclink",email:"zen@clicknet.se",redirect_to:o})});
const j=await r.json();
console.log(new URL(j.action_link??j.properties.action_link).searchParams.get("redirect_to")===o?"OK":"FEL");'
```

---

## 2. Registreringen är öppen · BÖR STÄNGAS

**Verifierat 2026-08-16.** `/auth/v1/settings` svarar `disable_signup: false`.
Vem som helst som känner till projektets adress och den publika nyckeln — som
per definition ligger i webbläsarens kod — kan skapa ett konto.

Skadan är begränsad: ett konto utan `employee`-rad ser bara "väntar på
aktivering" och RLS ger noll rader ur samtliga tabeller. Men det strider mot
§1.7, där navet är identitetskällan och konton provisioneras här. Öppen
registrering ger också en väg att skicka mejl från er domän.

**Åtgärd** — [Authentication → Sign In / Providers → Email](https://supabase.com/dashboard/project/kwsyvqymebamiqnxqjgj/auth/providers):
slå av **Allow new users to sign up**.

Det påverkar inte upplägg av anställda, eftersom de skapas med service
role-nyckeln som går förbi spärren.

---

## 3. Lösenord som återanvänds

`TheFamilj123` används både som databaslösenord och som inloggningslösenord för
`zen@clicknet.se`. Databaslösenordet ger full åtkomst förbi varje RLS-policy och
varje behörighetskontroll i systemet. Byt ett av dem.

Databaslösenordet byts under Settings → Database → Reset database password.
Glöm inte att uppdatera `DATABASE_URL` i `~/.clicknet/nav.env` efteråt.

---

## 4. Övrigt före bredd-lansering

| Vad | Var i backloggen |
|---|---|
| MFA för chefs- och ekonomiroller | E1.2, K33 |
| Felrapportering (Sentry) | E0.6 |
| Transaktionell e-post från hej@clicknet.se | E0.8, R13 |
| Egen domän `nav.clicknet.se` | E0.11 |
| Verifierad backup-återläsning | E0.10 |
| PUB-avtal med Supabase och Vercel | K22 |
