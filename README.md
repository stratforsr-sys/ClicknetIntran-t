# Clicknet Nav

Intranät för Clicknet. Byggs modul för modul enligt `PRD_Clicknet_Intranat_v1.0.md`
(funktion) och `PRD_UI_UX_Clicknet_Nav_v1.0.md` (design).

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres, Auth, RLS)
i eu-north-1. Deploy sker automatiskt från `main` till Vercel.

## Vad som finns idag

| Modul | Status |
|---|---|
| **M1 Identitet, organisation, behörighet** | I drift |
| M5 Rutiner och dokument | Näst på tur |
| M4 Personalärenden | Planerad |
| M6 Utbildning | Planerad |
| M2 Tid och närvaro | Planerad |

Sidopanelen visar bara moduler som faktiskt är byggda. Dödlänkar med
"kommer snart" lär användaren att menyn ljuger.

## Kom igång

```bash
npm install
cp .env.example .env.local     # fyll i värdena från Supabase
npm run dev
```

Första gången: logga in med din e-post, så leder navet dig till `/uppstart`
där du blir första användaren med rollerna säljchef och administratör.
Vyn stänger sig själv så fort registret har en rad.

## Databas

Handskriven SQL i `supabase/migrations/`, aldrig ändringar direkt i
Supabase-gränssnittet (Definition of Done p. 3).

```bash
DATABASE_URL=... npm run sql              # kör alla ej körda migrationer
DATABASE_URL=... npm run sql 0001_identitet
```

Varje migration körs i en transaktion och bokförs i `schema_migrations` med
checksumma. Ändrar du en redan körd fil varnar skriptet i stället för att köra
om den — skapa en ny migration i stället.

## Regler som inte får brytas

1. **Behörighet ligger i databasen, inte i UI:t.** En vy som hämtar fel data ska
   få noll rader från Postgres, inte filtreras bort i React.
2. **Inget hexvärde utanför `src/app/globals.css`.** Alla färger, radier,
   skuggor och typsnittssteg är tokens.
3. **Skrivningar går via server actions med service role**, efter explicit
   behörighetskontroll, och loggas i `audit_log`.
4. **Ingen `UPDATE` på historik.** Rättelser skapar nya rader.
5. Varje vy ska fungera på 375 px och gå att nå med tangentbord.
