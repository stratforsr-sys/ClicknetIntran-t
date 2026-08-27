import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { loggaInloggning } from "@/lib/inloggningslogg-server";

/**
 * Landningspunkt for den magiska lanken.
 *
 * E6.1: HAR skrivs raden om att nagon kom in med lank, inte nar lanken
 * begardes. En begard lank som aldrig oppnades ar ingen inloggning, och en logg
 * som blandar ihop de tva svarar fel pa "var hen inne den dagen".
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nasta = searchParams.get("nasta") ?? "/";

  if (code) {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const epost = data.user?.email;
      if (epost) await loggaInloggning(epost, "lank");
      return NextResponse.redirect(`${origin}${nasta}`);
    }
  }

  return NextResponse.redirect(`${origin}/logga-in?fel=lank`);
}
