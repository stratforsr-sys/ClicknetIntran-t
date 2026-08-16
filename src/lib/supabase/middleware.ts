import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from "@/lib/env";
import { bygCsp } from "@/lib/csp";

/** Publika vagar. Allt annat kraver session. */
const PUBLIC = ["/logga-in", "/auth", "/uppstart"];

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
   * AC-1.1: den som har en faktor MASTE anvanda den. Sessionen sitter kvar pa
   * aal1 tills koden matats in, sa "har faktor men star pa aal1" ar samma sak
   * som "halvvags inloggad". Kontrollen lases ur token som redan finns i
   * handen och kostar darfor inget extra anrop.
   *
   * Att detta ligger i mellanvaran och inte i en layout ar avsiktligt: da
   * galler det aven for route handlers och for sidor som byggs till senare.
   */
  if (user) {
    const { data: niva } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const halvvags = niva?.currentLevel === "aal1" && niva?.nextLevel === "aal2";
    const undantag = path.startsWith("/logga-in") || path.startsWith("/auth");
    if (halvvags && !undantag) {
      const url = request.nextUrl.clone();
      url.pathname = "/logga-in/verifiera";
      url.search = "";
      url.searchParams.set("nasta", path);
      return NextResponse.redirect(url);
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
