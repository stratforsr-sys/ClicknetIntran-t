import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { loggaUtloggning } from "@/lib/inloggningslogg-server";

export async function POST(request: NextRequest) {
  // E6.1: vem som loggar ut maste slas upp FORE signOut(). Efterat finns ingen
  // session att fraga, och raden hade blivit en utloggning utan avsandare.
  const user = await getCurrentUser();
  if (user?.employee) await loggaUtloggning(user.employee.id);

  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/logga-in", request.url), { status: 303 });
}
