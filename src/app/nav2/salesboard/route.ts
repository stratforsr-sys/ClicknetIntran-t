import { medNyckel } from "@/lib/nav2/nyckel";
import { LASLAGE_TEXT, SKRIVLAGE, sammaUrsprung } from "@/lib/nav2/skrivlage";
import { skarmlistan, utfor, vemFragar } from "@/lib/salesboard/handlingar";
import { FEL, atkomstsvar, tolkaSkrivning } from "@/lib/salesboard/skrivning";
import { svar } from "@/lib/salesboard/svar";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0: Inställningar → Säljtavlan, allt som ändrar tavlan.
 *
 *   POST, `{handling, …}`: spara, para, byt_namn, ljud_skarm, koppla_bort,
 *   person och testa. Arbetet görs i `src/lib/salesboard/handlingar.ts`.
 *
 *   GET: skärmarna, `{skarmar, nu}`. Sektionen frågar var 30:e sekund efter
 *   "sedd för …", och var tredje medan en nyss parad TV hämtar sin nyckel.
 *
 * ===========================================================================
 * BARA SUPERADMIN, OCH INNAN NÅGOT LÄSES ELLER SKRIVS (beställaren 2026-10-25).
 * En skrivning prövar först samma ursprung (rutten tar kakor), sedan nivån
 * (`vemFragar`, som frågar `tavlansAdmin`). Utan session 401, en säljare eller
 * admin 403, och 503 när det inte går att veta. Läsningen har inget att
 * förfalska och prövas bara på nivån. Förebilden är `/nav2/satser`.
 *
 * LÄSLÄGE: står `SKRIVLAGE.salesboard` på false svarar en skrivning 423 innan
 * något skrivs. Skärmlistan läses ändå, eftersom den inte ändrar något.
 *
 * EN SKRIVNING EN GÅNG. Allt går genom `medNyckel`: samma `X-Nav-Nyckel` en
 * gång till ger samma svar, så ett försök som hängde kan skickas igen utan två
 * skärmar eller två testhändelser.
 * ===========================================================================
 */

export async function POST(request: Request) {
  if (!sammaUrsprung(request)) return svar({ fel: FEL.ursprung }, 403);

  try {
    const vem = await vemFragar();
    const nej = atkomstsvar(vem);
    if (nej || vem.typ !== "admin") return svar({ fel: nej?.fel ?? FEL.ovantat }, nej?.status ?? 500);
    if (!SKRIVLAGE.salesboard) return svar({ fel: LASLAGE_TEXT, laslage: true }, 423);

    let kropp: unknown;
    try {
      kropp = await request.json();
    } catch {
      return svar({ fel: FEL.ogiltig }, 400);
    }
    const skrivning = tolkaSkrivning(kropp);
    if ("fel" in skrivning) return svar(skrivning, 400);

    return await medNyckel(request, vem.id, () => utfor(skrivning, vem.id));
  } catch (e) {
    console.error("nav2/salesboard:", e instanceof Error ? e.message : e);
    return svar({ fel: FEL.ovantat }, 500);
  }
}

export async function GET() {
  try {
    const nej = atkomstsvar(await vemFragar());
    if (nej) return svar({ fel: nej.fel }, nej.status);
    return await skarmlistan();
  } catch (e) {
    console.error("nav2/salesboard: skärmarna:", e instanceof Error ? e.message : e);
    return svar({ fel: FEL.ovantat }, 500);
  }
}
