import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { supabaseAdmin } from "@/lib/supabase/server";
import { korMorgonjobbet } from "@/lib/jobb/morgon";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Morgonbrevet. EGEN CRON-POST, och det är den andra och sista.
 *
 * Hobby-planen tar två poster per projekt och kör var och en en gång per dygn.
 * Nattjobbet 02:30 är den ena; den här är den andra, och därmed är kvoten
 * uppäten. Nästa schemalagda jobb får läggas in som ett steg i något av dem —
 * se rubriken i `natt/route.ts` om vad som hände den gång tre poster
 * deklarerades: ingen av dem kördes, och det syntes inte på något sätt.
 *
 * DEN LIGGER INTE I NATTJOBBET, trots att det hade sparat posten. Ett brev som
 * ska ligga i inkorgen när arbetsdagen börjar kan inte skickas 02:30 — då är
 * det femte brevet uppifrån när någon loggar in, i stället för det första.
 *
 * TIDEN I `vercel.json` ÄR UTC OCH FÖLJER INTE SOMMARTID. `30 5 * * *` blir
 * 07:30 svensk tid på sommaren och 06:30 på vintern. Det är en halvtimmes
 * glidning två gånger om året, och alternativet — två poster med olika tid —
 * kostar den sista cron-posten för att lösa något ingen kommer att märka.
 * Jobbet räknar själv fram det svenska datumet (`svensktDatum`) och hoppar över
 * helger på det, så veckodagen blir aldrig fel av zonen.
 */
export async function GET(request: NextRequest) {
  const nekad = kontrolleraCron(request);
  if (nekad) return nekad;

  return NextResponse.json(await korMorgonjobbet(supabaseAdmin()));
}
