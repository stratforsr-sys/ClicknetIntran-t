import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { signeraOchLogga } from "@/lib/filer-server";

export const dynamic = "force-dynamic";

/**
 * K36 / AC-3.22 / X5: den enda adress i navet dar en fil gar att komma at.
 *
 * Rutten kontrollerar behorighet, skriver oppningen och skickar sedan vidare
 * till en signerad URL som lever i trettio sekunder. Signaturen lamnar aldrig
 * servern pa nagot annat satt: det finns ingen handling som ger tillbaka en
 * URL till webblasaren, och ingen sida som ritar en.
 *
 * DARFOR AR DET EN OMDIRIGERING OCH INTE EN KNAPP. En handling som lamnar
 * tillbaka adressen hade gjort loggen till nagot man passerar pa vagen — den
 * som fick adressen en gang kunde dela den vidare, och nasta oppning hade inte
 * synts. Nu ar loggraden och tillgangen samma handelse.
 *
 * Att en GET har en sidoeffekt ar avsiktligt. Att lasa filen ar sidoeffekten.
 *
 * ANVAND ETT VANLIGT <a>, ALDRIG <Link>. Next foljer <Link> i forvag nar
 * musen nuddar den, och varje sadan forladdning hade blivit en rad i loggen om
 * en oppning som aldrig skedde. En logg med pahittade rader ar samre an ingen.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.employee) return new NextResponse("Nekad", { status: 401 });

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    null;

  let signerad: { url: string; namn: string } | null;
  try {
    signerad = await signeraOchLogga(id, user.employee.id, ip);
  } catch (err) {
    // Kastas nar oppningen inte gick att skriva. Samma val som
    // registerutdraget gor: hellre ett fel an ett utlamnande utan spar.
    return new NextResponse(
      err instanceof Error ? err.message : "Filen kunde inte lämnas ut.",
      { status: 500 },
    );
  }

  // Finns inte, ar borttagen, eller far inte ses — samma svar i alla tre
  // fallen. Ett nekande som skiljer sig fran ett "finns inte" berattar att
  // filen finns, och for ett lakarintyg ar det i sig en uppgift om halsa.
  if (!signerad) return new NextResponse("Finns inte", { status: 404 });

  return NextResponse.redirect(signerad.url, {
    status: 302,
    headers: { "cache-control": "no-store" },
  });
}
