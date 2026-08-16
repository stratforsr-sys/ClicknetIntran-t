import { SUPABASE_URL } from "@/lib/env";

/**
 * Content-Security-Policy med nonce per svar.
 *
 * Next.js plockar upp noncet ur den har headern och satter det pa sina egna
 * script-taggar automatiskt. 'strict-dynamic' gor att skript som laddas av ett
 * betrott skript arver fortroendet — utan det maste varje chunk listas.
 *
 * style-src tillater 'unsafe-inline' eftersom next/font injicerar en inline
 * stiltagg. Det ar en kand och accepterad kompromiss; inline-stilar kan inte
 * kora kod, sa risken ar begransad till utseende.
 */
export function bygCsp(nonce: string): string {
  const supabase = SUPABASE_URL || "https://*.supabase.co";
  const utveckling = process.env.NODE_ENV !== "production";

  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${utveckling ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${supabase} ${supabase.replace("https://", "wss://")}`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}
