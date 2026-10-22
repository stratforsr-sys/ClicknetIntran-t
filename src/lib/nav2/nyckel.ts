/**
 * Nav 2.0: en skrivning som skickas två gånger görs en gång (granskningen G1, G2, F2-3).
 *
 * Klienten (`ndSkriv` i utkastet) skickar en slumpad nyckel i huvudet
 * `X-Nav-Nyckel`, och samma nyckel igen när ett försök inte fick något svar
 * (tidsgränsen eller nätet). En rutt som skapar något låter `medNyckel` köra
 * handlingen:
 *
 * - Första gången tas raden i `nav_skrivnyckel` (0208), handlingen körs och
 *   svaret sparas.
 * - Nästa gång med samma nyckel kommer samma svar tillbaka, med huvudet
 *   `X-Nav-Upprepad: 1`, och ingenting görs igen.
 * - Medan den första pågår får den andra 409 med `PAGAR_TEXT` och `pagar: true`,
 *   så att klienten behåller nyckeln till nästa försök.
 *
 * En nyckel lever ett dygn. Äldre rader raderas före varje ny, så tabellen
 * gallrar sig själv. Utan huvudet körs handlingen som förut.
 *
 * Tabellen nås bara med service role: RLS utan policyer, och ingen rätt för
 * anon eller authenticated.
 */

export const PAGAR_TEXT = "Det här sparas redan. Vänta ett ögonblick.";

type Rad = { klar: boolean; status: number | null; svar: unknown };

/** Vad en begäran med nyckel ska göra, ur om raden togs nu och hur den ser ut om den redan fanns. */
export function nyckelBeslut(togs: boolean, rad: Rad | null): "kor" | "upprepa" | "pagar" {
  if (togs) return "kor";
  return rad?.klar ? "upprepa" : "pagar";
}

/** Lagret bakom nycklarna. Rutterna använder tabellen; provet byter det mot ett i minnet. */
export type Nyckellager = {
  ta(nyckel: string, aktor: string): Promise<{ togs: boolean; rad: (Rad & { aktor: string }) | null }>;
  spara(nyckel: string, status: number, svar: unknown): Promise<void>;
  slapp(nyckel: string): Promise<void>;
};

const DYGN_MS = 24 * 3600 * 1000;
const NYCKEL = /^[A-Za-z0-9-]{8,64}$/;

// Klienten läses in först när en nyckel faktiskt kommer, så att provet kan läsa beslutet utan Next.
async function tabellen(): Promise<Nyckellager> {
  const { supabaseAdmin } = await import("@/lib/supabase/server");
  const db = supabaseAdmin();
  return {
    async ta(nyckel, aktor) {
      await db.from("nav_skrivnyckel").delete().lt("skapad", new Date(Date.now() - DYGN_MS).toISOString());
      const { data, error } = await db.from("nav_skrivnyckel").upsert({ nyckel, aktor }, { onConflict: "nyckel", ignoreDuplicates: true }).select("nyckel");
      if (error) throw new Error(`Nyckeln kunde inte läsas: ${error.message}`);
      if (data && data.length) return { togs: true, rad: null };
      const { data: rad } = await db.from("nav_skrivnyckel").select("aktor, klar, status, svar").eq("nyckel", nyckel).maybeSingle();
      return { togs: false, rad: (rad as (Rad & { aktor: string }) | null) ?? null };
    },
    async spara(nyckel, status, svar) {
      await db.from("nav_skrivnyckel").update({ klar: true, status, svar }).eq("nyckel", nyckel);
    },
    async slapp(nyckel) {
      await db.from("nav_skrivnyckel").delete().eq("nyckel", nyckel);
    },
  };
}

const json = (data: unknown, status: number, extra: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store, max-age=0", ...extra } });

/** Kör `gor` en gång per nyckel. `aktor` är den inloggades employee-id; en annans nyckel ger aldrig deras svar. */
export async function medNyckel(request: Request, aktor: string, gor: () => Promise<Response>, lager?: Nyckellager): Promise<Response> {
  const nyckel = request.headers.get("x-nav-nyckel");
  if (!nyckel || !NYCKEL.test(nyckel)) return gor();
  const l = lager ?? (await tabellen());
  const { togs, rad } = await l.ta(nyckel, aktor);
  if (!togs && rad && rad.aktor !== aktor) return json({ fel: "Ogiltig begäran." }, 400);
  const beslut = nyckelBeslut(togs, rad);
  // `pagar` säger klienten att behålla nyckeln: det första försöket kan fortfarande lyckas.
  if (beslut === "pagar") return json({ fel: PAGAR_TEXT, pagar: true }, 409);
  if (beslut === "upprepa") return json(rad!.svar ?? {}, rad!.status ?? 200, { "X-Nav-Upprepad": "1" });

  let svar: Response;
  try {
    svar = await gor();
  } catch (e) {
    // Ingenting att svara med: nästa försök med samma nyckel får göra det igen.
    await l.slapp(nyckel);
    throw e;
  }
  const kropp = await svar.clone().json().catch(() => null);
  await l.spara(nyckel, svar.status, kropp);
  return svar;
}
