import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from "@/lib/env";
import { bygCsp } from "@/lib/csp";
import { kvittoGiltigt, STEG2_KAKA } from "@/lib/mfa";
import { MFA_REQUIRED_ROLES } from "@/lib/roles";

/** Publika vagar. Allt annat kraver session. */
const PUBLIC = ["/logga-in", "/auth", "/uppstart"];

/**
 * Kraver den har anvandaren steg tva? Rollerna lases med anvandarens egen
 * token, sa RLS avgor vad som syns — mellanvaran far inga extra rattigheter.
 *
 * Blir svaret otydligt, till exempel for att natet strular, faller vi tillbaka
 * pa nej. Ett ja hade last ute alla nar Supabase har en dalig minut, och
 * spärren finns anda kvar i (app)-layouten som andra led.
 */
async function behoverSteg2(token: string, authUserId: string): Promise<boolean> {
  // Samma strombrytare som kraverMfa(). Utan den skulle en tom rollista anda
  // slappa igenom pa rattigheten nedan, och eftersom kodsidan da skickar
  // tillbaka hit vore resultatet en slinga i stallet for en spärr.
  if (MFA_REQUIRED_ROLES.length === 0) return false;

  try {
    const svar = await fetch(
      `${SUPABASE_URL}/rest/v1/employee` +
        `?select=employee_role(role),employee_permission(permission)` +
        `&auth_user_id=eq.${authUserId}&status=eq.active`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
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
  const undantag = path.startsWith("/logga-in") || path.startsWith("/auth");
  if (user && !undantag) {
    const giltigt = await kvittoGiltigt(request.cookies.get(STEG2_KAKA)?.value, user.id);
    if (!giltigt) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token && (await behoverSteg2(token, user.id))) {
        const url = request.nextUrl.clone();
        url.pathname = "/logga-in/verifiera";
        url.search = "";
        url.searchParams.set("nasta", path);
        return NextResponse.redirect(url);
      }
    }
  }

  if (user && path === "/logga-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
