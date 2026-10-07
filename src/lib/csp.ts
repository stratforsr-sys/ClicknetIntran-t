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
/**
 * Var webblasaren far lagga filer i R2 (0065).
 *
 * ===========================================================================
 * UTAN DEN HAR RADEN FALLER VARJE UPPLADDNING TILL R2 MED "Failed to fetch".
 *
 * Intyg, bilagor, rollspel och anstallningsavtal laddas upp DIREKT fran
 * webblasaren med en forhandssignerad PUT — se Filuppladdning.tsx. Bucketens
 * CORS slapper in navet, men CSP:n stoppar anropet innan det lamnar
 * webblasaren, och felet sager ingenting om varfor. Upptackt 2026-10-07 nar
 * det forsta anstallningsavtalet skulle bifogas: sedan R2-flytten 2026-09-21
 * hade ingen laddat upp nagot fran webblasaren.
 *
 * Adressen raknas fram ur samma miljovariabler som servern signerar med, sa
 * de kan inte glida isar. AWS-klienten signerar "virtual-hosted": bucketen
 * ligger forst i vardnamnet (`intranet.<konto>.eu.r2.cloudflarestorage.com`).
 * Endpointens egen adress star med for den dag klienten byter till path-style.
 *
 * Saknas R2 i miljon gar uppladdningen till Supabase, som redan star nedan.
 * ===========================================================================
 */
function r2Kallor(): string[] {
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  if (!endpoint) return [];
  try {
    const u = new URL(endpoint);
    return bucket ? [u.origin, `${u.protocol}//${bucket}.${u.host}`] : [u.origin];
  } catch {
    return [];
  }
}

export function bygCsp(nonce: string): string {
  const supabase = SUPABASE_URL || "https://*.supabase.co";
  const utveckling = process.env.NODE_ENV !== "production";

  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${utveckling ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self' ${supabase} ${supabase.replace("https://", "wss://")}${r2Kallor().map((k) => ` ${k}`).join("")}`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}
