import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL, isConfigured } from "@/lib/env";
import { bygCsp } from "@/lib/csp";
import { kvittoGiltigt, STEG2_KAKA } from "@/lib/mfa";
import { MFA_REQUIRED_ROLES } from "@/lib/roles";
import { BYTESVAG, kraverByte } from "@/lib/losenordsbyte";

/**
 * Publika vagar. Allt annat kraver session.
 *
 * /api star med eftersom rutterna dar autentiserar sig sjalva — det
 * schemalagda jobbet har ingen session att visa upp, och skulle annars
 * omdirigeras till inloggningssidan och tyst gora ingenting.
 */
const PUBLIC = ["/logga-in", "/auth", "/uppstart", "/api"];

/** E6.5. Kakan som haller nere dagsstamplingen. Bar ett datum, inget mer. */
const AKTIVITETSKAKA = "nav_dag";

/**
 * Kraver den har anvandaren steg tva? Rollerna lases med anvandarens egen
 * token, sa RLS avgor vad som syns — mellanvaran far inga extra rattigheter.
 *
 * Blir svaret otydligt, till exempel for att natet strular, faller vi tillbaka
 * pa nej. Ett ja hade last ute alla nar Supabase har en dalig minut, och
 * spärren finns anda kvar i (app)-layouten som andra led.
 */
async function behoverSteg2(
  token: string,
  authUserId: string,
  flaggadForByte: boolean,
): Promise<boolean> {
  // Samma strombrytare som kraverMfa(). Utan den skulle en tom rollista anda
  // slappa igenom pa rattigheten nedan, och eftersom kodsidan da skickar
  // tillbaka hit vore resultatet en slinga i stallet for en spärr.
  if (MFA_REQUIRED_ROLES.length === 0) return false;

  /**
   * Undantaget for konton som ska byta losenord.
   *
   * Sedan migration 0017 ger den tokenen noll rader ur varje tabell. En
   * flaggad saljchef hade darfor sett ut som ett konto helt utan roller,
   * alltsa ett som inte behover steg tva — och da hade ordningen kastats om.
   * Den som kommit over ett tillfalligt losenord for ett chefskonto hade fatt
   * satta ett eget UTAN att bekrafta enheten forst, vilket ar precis det som
   * ordningen langre ner finns till for att hindra.
   *
   * Bara for de kontona, och bara for den har enda fragan. Alla andra lases
   * fortfarande med anvandarens egen token, sa RLS avgor vad som syns och
   * mellanvaran far inte mer an den behover.
   */
  const nyckel = flaggadForByte && SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY;
  const bararen = flaggadForByte && SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY : token;

  try {
    const svar = await fetch(
      `${SUPABASE_URL}/rest/v1/employee` +
        `?select=employee_role(role),employee_permission(permission)` +
        `&auth_user_id=eq.${authUserId}&status=eq.active`,
      { headers: { apikey: nyckel, Authorization: `Bearer ${bararen}` } },
    );
    if (!svar.ok) return false;

    const rad = ((await svar.json()) as {
      employee_role: { role: string }[];
      employee_permission: { permission: string }[];
    }[])[0];
    if (!rad) return false;

    const kravRoller: string[] = MFA_REQUIRED_ROLES;
    if (rad.employee_role.some((r) => kravRoller.includes(r.role))) return true;
    return rad.employee_permission.some((p) => p.permission === "payroll_cost_viewer");
  } catch {
    return false;
  }
}

export async function updateSession(request: NextRequest) {
  // Nytt nonce per svar. Maste satta pa BADE requesten (sa Next kan lasa det
  // nar sidan renderas) och svaret (sa webblasaren far regeln).
  const nonce = btoa(crypto.randomUUID());
  const csp = bygCsp(nonce);

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  let response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);

  if (!isConfigured) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers } });
        response.headers.set("content-security-policy", csp);
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + "/"));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/logga-in";
    url.searchParams.set("nasta", path);
    return NextResponse.redirect(url);
  }

  /**
   * AC-1.1: chefs- och ekonomiroller bekraftar nya enheter med en kod till
   * e-posten. Kvittot ligger i en signerad kaka.
   *
   * Ordningen ar vald for att kosta minst: kakan kontrolleras forst, och den
   * ar bara en HMAC-jamforelse utan natverk. Rollerna hamtas enbart nar kakan
   * saknas eller gatt ut, alltsa en gang per enhet och manad.
   *
   * Att detta ligger i mellanvaran och inte i en layout ar avsiktligt: da
   * galler det aven for route handlers och for sidor som byggs till senare.
   */
  const undantag = path.startsWith("/logga-in") || path.startsWith("/auth") || path.startsWith("/api");
  const skaByta = Boolean(user && kraverByte(user.app_metadata));
  if (user && !undantag) {
    const giltigt = await kvittoGiltigt(request.cookies.get(STEG2_KAKA)?.value, user.id);
    if (!giltigt) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token && (await behoverSteg2(token, user.id, skaByta))) {
        const url = request.nextUrl.clone();
        url.pathname = "/logga-in/verifiera";
        url.search = "";
        url.searchParams.set("nasta", path);
        return NextResponse.redirect(url);
      }
    }
  }

  /**
   * Tvingat losenordsbyte.
   *
   * Ligger EFTER steg tva med flit. En chef som bytt enhet ska bekrafta
   * enheten forst — annars kan den som kommit over ett tillfalligt losenord
   * satta ett eget och darmed las­a ute den ratta agaren.
   *
   * Flaggan ligger i `app_metadata` och foljer med i svaret fran getUser(),
   * som anda hamtas har. Kontrollen kostar alltsa ingenting extra.
   *
   * Att den sitter i mellanvaran och inte i en layout ar samma skal som ovan:
   * en server action ar ett POST till sidans egen adress, och den passerar
   * har. Ett konto med tvang kommer alltsa inte at att SKRIVA nagot heller,
   * inte bara at att titta.
   *
   * Sedan migration 0017 ar det har inte langre den enda spa­rren. Databasen
   * ger samma konto noll rader ur varje tabell, aven for den som gar rakt pa
   * API:t och aldrig ser en enda av navets sidor. Omdirigeringen har finns
   * kvar for att den ger en vag framat i stallet for en tom skarm.
   */
  if (user && skaByta && !undantag && path !== BYTESVAG) {
    const url = request.nextUrl.clone();
    url.pathname = BYTESVAG;
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && path === "/logga-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  /**
   * E6.5: bokfor att den inloggade anvant navet i dag.
   *
   * VARFOR I MELLANVARAN. Den ar det enda stallet som ser VARJE begaran. En
   * saljare som loggar in, laser tre rutiner och gar hem passerar aldrig en
   * server action — hade stampeln legat i en sadan hade DAU matt vilka som
   * ANDRAR nagot, vilket ar en annan fraga an vilka som ANVANDER navet.
   *
   * VARFOR EN KAKA. Utan den blir det en skrivning per begaran. Kakan bar
   * dagens datum: stammer det med i dag ar dagen redan bokford och ingenting
   * hander. Det ger hogst ett anrop per person, enhet och dygn. Tva enheter ger
   * tva anrop, och primarnyckeln (employee_id, day) gor det andra till
   * ingenting.
   *
   * Kakan ar inte ett skydd och behover inte vara signerad — det varsta nagon
   * astadkommer genom att radera den ar en extra `on conflict do nothing`.
   *
   * Kakan satts SIST, pa `response` som den star da. Ett rpc-anrop kan fa
   * Supabase att fornya tokenen, och `setAll` ovan byter da ut hela `response`
   * mot ett nytt objekt. En kaka satt fore anropet hade suttit pa det gamla
   * och forsvunnit tyst — och dagen hade bokforts om vid varje sidbyte.
   *
   * Fel svaljs. Adoptionsstatistik far inte kunna lasa ute nagon ur navet.
   */
  const idag = new Date().toISOString().slice(0, 10);
  if (user && request.cookies.get(AKTIVITETSKAKA)?.value !== idag) {
    try {
      await supabase.rpc("registrera_aktivitet");
      response.cookies.set(AKTIVITETSKAKA, idag, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        // Ett dygn racker, och gor att kakan inte blir kvar over ett datumbyte.
        maxAge: 60 * 60 * 24,
      });
    } catch {
      // Tyst med flit. Se rubriken ovan.
    }
  }

  return response;
}
