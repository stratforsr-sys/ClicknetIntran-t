import "server-only";

import { createPrivateKey, sign } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nav 2.0: Web Push (0121), för kvällsnotisen (E5.8).
 *
 * ===========================================================================
 * INGET PAKET OCH INGET INNEHÅLL I PUSHEN.
 *
 * Pushen skickas tom. Enhetens service worker (`public/nav2/sw.js`) väcks av
 * den och hämtar texten från `/nav2/hem?kvall=1` med personens egen
 * inloggning. Det ger tre saker:
 *
 *   - Ingen kryptering av innehåll (RFC 8291) behövs, bara VAPID-signaturen
 *     (RFC 8292), och den klarar `node:crypto` själv. Inget nytt beroende.
 *   - Texten räknas när den visas, med samma RLS som sidan. Notisen och
 *     startsidan säger alltså samma sak (E5.8 kräver det).
 *   - Ingenting om personalen passerar pushtjänsten (Google, Apple, Mozilla).
 *
 * NYCKLARNA ligger i miljön: `VAPID_PUBLIC_KEY` (65 byte, base64url, okomprimerad
 * P-256-punkt), `VAPID_PRIVATE_KEY` (32 byte, base64url) och `VAPID_SUBJECT`
 * (mailto:). Utan dem finns ingen push, och vyn säger det.
 * ===========================================================================
 */

const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fran64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function vapidPublik(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function vapidJwt(endpoint: string): string | null {
  const pub = vapidPublik(), priv = process.env.VAPID_PRIVATE_KEY?.trim(), sub = process.env.VAPID_SUBJECT?.trim() || "mailto:zen@clicknet.se";
  if (!pub || !priv) return null;
  const p = fran64u(pub);
  if (p.length !== 65 || p[0] !== 4) return null;
  const nyckel = createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33, 65)), d: priv }, format: "jwk" });
  const huvud = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const krav = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
  const signatur = sign("sha256", Buffer.from(`${huvud}.${krav}`), { key: nyckel, dsaEncoding: "ieee-p1363" });
  return `${huvud}.${krav}.${b64u(signatur)}`;
}

export type Pushutfall = { ok: boolean; status: number; borta: boolean; fel: string | null };

/** En tom push till en enhet. `borta` = enheten finns inte längre (404/410) och ska tas bort. */
export async function skickaPush(endpoint: string): Promise<Pushutfall> {
  const jwt = vapidJwt(endpoint);
  if (!jwt) return { ok: false, status: 0, borta: false, fel: "VAPID-nycklarna saknas." };
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `vapid t=${jwt}, k=${vapidPublik()}`, TTL: String(12 * 3600), Urgency: "normal", "Content-Length": "0" },
    });
    const borta = r.status === 404 || r.status === 410;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, borta, fel: r.ok ? null : (await r.text().catch(() => "")).slice(0, 200) || `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, status: 0, borta: false, fel: e instanceof Error ? e.message : String(e) };
  }
}

/** Pushar till alla en persons enheter. Enheter som är borta tas bort. Svarar med antalet som tog emot. */
export async function pushaTill(db: SupabaseClient, employeeId: string): Promise<{ enheter: number; ok: number; fel: string[] }> {
  const { data } = await db.from("push_subscription").select("id, endpoint").eq("employee_id", employeeId);
  const enheter = (data ?? []) as { id: string; endpoint: string }[];
  const fel: string[] = [];
  let ok = 0;
  for (const e of enheter) {
    const u = await skickaPush(e.endpoint);
    if (u.ok) {
      ok++;
      await db.from("push_subscription").update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("id", e.id);
    } else if (u.borta) {
      await db.from("push_subscription").delete().eq("id", e.id);
    } else {
      fel.push(u.fel ?? `HTTP ${u.status}`);
      await db.from("push_subscription").update({ last_error: u.fel }).eq("id", e.id);
    }
  }
  return { enheter: enheter.length, ok, fel };
}
