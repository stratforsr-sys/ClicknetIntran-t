# Driftsättning — vad som måste göras utanför koden

Två inställningar i Supabase kan inte sättas från repot. Båda är verifierade
som fel i nuläget.

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
