import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import {
  MAX_BODY,
  MAX_MEDDELANDE,
  MAX_STACK,
  maskeraOchKlipp,
  rensaSokvag,
  type Felsort,
} from "@/lib/fel";

/**
 * E0.6. Den enda vagen in i `error_report`.
 *
 * Alla tre inganger gar hit — onRequestError, klientens felgrans och knappen
 * "Rapportera fel" — och det ar med flit. Maskeringen och klippet ar
 * forutsattningen for behorigheten i 0026, och en fjarde vag som skriver direkt
 * hade tagit bort den forutsattningen utan att nagot test markt det.
 *
 * ===========================================================================
 * DEN HAR FUNKTIONEN FAR ALDRIG KASTA.
 *
 * Den anropas fran felhanteringen. Kastar den under en krasch byter navet ut
 * ett begripligt fel mot ett fel i felrapporteringen, och det ar det varsta
 * stallet att ha en bugg pa. Allt ligger darfor i ett try/catch som svaljer,
 * och returvardet sager om det gick — anroparen far bestamma om det spelar
 * nagon roll.
 * ===========================================================================
 */

export type Felinlagg = {
  kind: Felsort;
  path: string;
  digest?: string | null;
  message?: string | null;
  stack?: string | null;
  body?: string | null;
  blocking?: boolean;
  reporterId?: string | null;
  userAgent?: string | null;
};

/** Vercels commit-sha. Utan den gar det inte att se om ett fel kom tillbaka. */
function utgava(): string | null {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
    null
  );
}

export async function skrivFel(inlagg: Felinlagg): Promise<boolean> {
  try {
    const db = supabaseAdmin();
    const path = rensaSokvag(inlagg.path);
    const nu = new Date().toISOString();

    const rad = {
      kind: inlagg.kind,
      path,
      digest: inlagg.digest ?? null,
      message: maskeraOchKlipp(inlagg.message, MAX_MEDDELANDE),
      stack: maskeraOchKlipp(inlagg.stack, MAX_STACK),
      // Manuell text maskeras inte: en manniska som skriver "det gick fel nar
      // jag oppnade Annas arende" menar det hon skriver, och en maskerad
      // mening blir obegriplig. Den klipps daremot.
      body: inlagg.body ? inlagg.body.slice(0, MAX_BODY) : null,
      blocking: inlagg.blocking ?? false,
      reporter_id: inlagg.reporterId ?? null,
      user_agent: inlagg.userAgent?.slice(0, 300) ?? null,
      release: utgava(),
      last_seen_at: nu,
    };

    if (inlagg.kind === "manual") {
      const { error } = await db.from("error_report").insert(rad);
      return !error;
    }

    /**
     * Automatisk rapport: en grupp, inte en handelse.
     *
     * `on conflict (digest, path)` mot det partiella indexet i 0026. Traffar
     * den en befintlig rad ska raknaren upp och tidpunkten fram — och det gar
     * inte att gora med en vanlig upsert, eftersom `occurrences` ska rakna och
     * inte skrivas over. Darfor en rpc.
     *
     * En rapport utan digest kan inte grupperas. Den skrivs anda, som en egen
     * rad — en bugg utan digest ar fortfarande en bugg, och att tappa den for
     * att grupperingsnyckeln saknas vore att optimera bort sjalva uppgiften.
     */
    if (!rad.digest) {
      const { error } = await db
        .from("error_report")
        .insert({ ...rad, digest: `okand-${crypto.randomUUID()}` });
      return !error;
    }

    const { error } = await db.rpc("registrera_fel", {
      p_digest: rad.digest,
      p_path: rad.path,
      p_message: rad.message,
      p_stack: rad.stack,
      p_reporter: rad.reporter_id,
      p_user_agent: rad.user_agent,
      p_release: rad.release,
    });

    return !error;
  } catch {
    // Se rubriken ovan. Ett fel i felrapporteringen far inte bli det fel
    // anvandaren ser.
    return false;
  }
}
