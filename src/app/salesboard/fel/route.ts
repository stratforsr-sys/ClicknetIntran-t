import { rensaDigest } from "@/lib/fel";
import { skrivFel } from "@/lib/fel-server";
import { sammaUrsprung } from "@/lib/nav2/skrivlage";
import { tavlansAtkomst } from "@/lib/salesboard/atkomst";
import { svar } from "@/lib/salesboard/svar";

export const dynamic = "force-dynamic";

/**
 * Tavlans fel, och mätningen efter ett testfirande, till navets felrapporter (/fel).
 *
 * Skyddet runt ett firande ritar ingenting när kompositionen kastar, och en tv har
 * ingen konsol som någon läser. Utan den här vägen syntes felet ingenstans: på
 * kontorets tv (Google-appens webbläsare) kom inget firande fram 2026-11-04, och
 * ingenting i navet sa varför. Den tar emot från en parad skärm och från en inloggad,
 * som `/salesboard/data`, och skriver bara genom `skrivFel` (maskering och klipp).
 */
export async function POST(request: Request) {
  if (!sammaUrsprung(request)) return svar({ fel: "Fel ursprung." }, 403);
  const atkomst = await tavlansAtkomst(request).catch(() => null);
  if (!atkomst) return svar({ fel: "Skärmen är inte parad." }, 401);

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return svar({ fel: "Ogiltig begäran." }, 400);
  }
  const digest = rensaDigest(b.digest);
  if (!digest || !digest.startsWith("salesboard-")) return svar({ fel: "Ogiltig begäran." }, 400);

  const vem = atkomst.typ === "skarm" ? atkomst.skarm.namn : "inloggad";
  await skrivFel({
    kind: "automatic",
    path: "/salesboard",
    digest,
    message: `${vem}: ${typeof b.message === "string" ? b.message : "okänt fel"}`,
    stack: typeof b.stack === "string" ? b.stack : null,
    userAgent: request.headers.get("user-agent"),
  });
  return svar({ ok: "Tack." });
}
