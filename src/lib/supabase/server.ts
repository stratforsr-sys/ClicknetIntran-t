import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL } from "@/lib/env";
import { pgKlient } from "@/lib/nav2/pgkrok";

/** Klient med den inloggades rattigheter. RLS galler. Anvand i alla lasningar. */
export async function supabaseServer() {
  // Medan Nav 2.0:s data byggs: samma läsningar direkt i Postgres (src/lib/nav2/pgrest.ts).
  const pg = pgKlient("server");
  if (pg) return pg;
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Anropad fran en server component. Middleware fornyar sessionen.
        }
      },
    },
  });
}

/**
 * Klient som gar forbi RLS. Endast i server actions, och endast efter att
 * anroparens behorighet kontrollerats explicit. Varje skrivning ska loggas.
 */
export function supabaseAdmin() {
  const pg = pgKlient("admin");
  if (pg) return pg;
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY saknas — skrivningar ar avstangda.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
