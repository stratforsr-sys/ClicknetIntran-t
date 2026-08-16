import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_URL } from "@/lib/env";

/** Klient med den inloggades rattigheter. RLS galler. Anvand i alla lasningar. */
export async function supabaseServer() {
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
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY saknas — skrivningar ar avstangda.");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
