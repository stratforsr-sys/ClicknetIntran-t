import { NextResponse } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Statuslampan i inloggningens band: svarar inloggningstjänsten?
 *
 * Den som inte kommer in vill veta om det är lösenordet eller navet. Lampan
 * frågar GoTrues egen hälsoadress med den publika nyckeln, alltså samma tjänst
 * som tar emot inloggningen, och säger hur det gick. Ingen data läses.
 *
 * Utan inloggning (sidan ligger under /logga-in, som mellanvaran släpper
 * fram), och därför med ett minne på femton sekunder per serverinstans: en
 * öppen adress som ringer Supabase för varje anrop vore en förstärkare åt den
 * som vill belasta tjänsten.
 */
export const dynamic = "force-dynamic";

type Svar = { lage: "uppe" | "langsam" | "nere"; ms: number | null };

const LANGSAM_MS = 1500;
const TIDSGRANS_MS = 4000;
const MINNE_MS = 15_000;

let minne: { svar: Svar; tid: number } | null = null;

export async function GET() {
  if (minne && Date.now() - minne.tid < MINNE_MS) return svara(minne.svar);

  const start = performance.now();
  let svar: Svar;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(TIDSGRANS_MS),
    });
    const ms = Math.round(performance.now() - start);
    svar = r.ok ? { lage: ms > LANGSAM_MS ? "langsam" : "uppe", ms } : { lage: "nere", ms };
  } catch {
    svar = { lage: "nere", ms: null };
  }

  minne = { svar, tid: Date.now() };
  return svara(svar);
}

function svara(svar: Svar) {
  return NextResponse.json(svar, { headers: { "Cache-Control": "no-store" } });
}
