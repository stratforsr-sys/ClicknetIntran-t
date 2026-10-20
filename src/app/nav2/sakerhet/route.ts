import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { kraverMfa, STEG2_DYGN } from "@/lib/mfa";
import { svensktDatum } from "@/lib/klocka";
import { bytLosenord, glomEnheten, skickaKod, verifieraKod } from "@/app/(app)/profil/actions";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: Inställningar → Säkerhet. Bara det egna kontot.
 *
 * ===========================================================================
 * REPOTS ACTIONS, OFÖRÄNDRADE (`src/app/(app)/profil/actions.ts`). Kraven,
 * felmeddelandena och händelseloggen är deras:
 *
 *   losen         `bytLosenord` → `utforBytLosenord`: det nuvarande ordet
 *                 kontrolleras, `losenordskrav.ts` granskar det nya, och
 *                 audit_log får `auth.password_changed` (aldrig ordet).
 *   kod-skicka    `skickaKod`: koden går till kontots egen adress, aldrig en
 *                 adress ur formuläret.
 *   kod-bekrafta  `verifieraKod`: kvittot i kakan `nav_steg2` (30 dygn),
 *                 `auth.step2_verified` eller `auth.step2_failed`.
 *   glom          `glomEnheten`: kvittot bort, `auth.step2_forgotten`.
 * ===========================================================================
 *
 * Koden skickas och bekräftas bara när kontot kräver den (`kraverMfa`), som
 * utkastet visar flödet. Annars vore det en väg att mejla koder i onödan.
 * `/byt-losenord` (tvånget vid första inloggningen) stannar i inloggningen.
 *
 * LÄSLÄGE: står `SKRIVLAGE.sakerhet` på false svarar POST 423 innan något ändras.
 */

type Svar = { ok?: string; fel?: string; [k: string]: unknown };
const svar = (data: Svar, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });

function form(falt: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(falt)) f.set(k, v);
  return f;
}

// Lösenordets fält är fritt text; inget rimligt ord är längre än så här (bcrypt läser 72 byte).
const MAX = 1000;
const text = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX) : "");

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.employee) return svar({ fel: "Du måste vara inloggad." }, 401);
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const handling = String(b.handling ?? "");

  if (!SKRIVLAGE.sakerhet) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);

  try {
    switch (handling) {
      case "losen": {
        const s = await bytLosenord({}, form({ nuvarande: text(b.nu), nytt: text(b.ny), upprepa: text(b.upp) }));
        return s.fel ? svar({ fel: s.fel }, 400) : svar({ ok: s.ok ?? "" });
      }

      case "kod-skicka": {
        if (!kraverMfa(user)) return svar({ fel: "Din roll kräver ingen kod." }, 400);
        const s = await skickaKod({}, form({}));
        return s.fel ? svar({ fel: s.fel }, 429) : svar({ ok: s.ok ?? "" });
      }

      case "kod-bekrafta": {
        if (!kraverMfa(user)) return svar({ fel: "Din roll kräver ingen kod." }, 400);
        const s = await verifieraKod({}, form({ kod: text(b.kod).slice(0, 20) }));
        if (s.fel) return svar({ fel: s.fel }, 400);
        return svar({ ok: "", till: svensktDatum(new Date(Date.now() + STEG2_DYGN * 86400000)) });
      }

      case "glom":
        await glomEnheten();
        return svar({ ok: "" });

      default:
        return svar({ fel: "Okänd handling." }, 400);
    }
  } catch {
    return svar({ fel: "Det gick inte att spara." }, 500);
  }
}
