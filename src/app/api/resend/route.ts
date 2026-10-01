import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { notifiera } from "@/lib/notishandelse-server";

export const dynamic = "force-dynamic";

/**
 * Resends webhook (0071): vad hände med mejlpåminnelserna?
 *
 * =============================================================================
 * RÅDATA FÖRST, TOLKNING SEDAN — som `call_ingest` för växeln
 *
 * Kroppen sparas hel i `integration_log` innan något tolkas. Blir tolkningen
 * fel går den att göra om utan att Resend behöver skicka något igen.
 *
 * SIGNATUREN PRÖVAS, ALLTID. Resend signerar med Svix: HMAC-SHA256 över
 * `id.tidsstämpel.kropp` med hemligheten `RESEND_WEBHOOK_SECRET` (`whsec_…`).
 * Saknas hemligheten svarar rutten 503 — hellre inga statusar än statusar från
 * vem som helst. Äldre än fem minuter nekas, så en uppfångad begäran inte kan
 * spelas upp igen.
 *
 * `email.delivered` och `email.sent` → skickad. `email.bounced` och
 * `email.failed` → fel, och den ansvariga får en notis: då vet hon att kunden
 * inte blev påmind.
 * =============================================================================
 */
export async function POST(request: NextRequest) {
  const hemlighet = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!hemlighet) return NextResponse.json({ fel: "RESEND_WEBHOOK_SECRET saknas" }, { status: 503 });

  const kropp = await request.text();
  const id = request.headers.get("svix-id") ?? "";
  const tid = request.headers.get("svix-timestamp") ?? "";
  const signaturer = request.headers.get("svix-signature") ?? "";
  if (!id || !tid || !signaturer) return NextResponse.json({ fel: "signatur saknas" }, { status: 401 });
  if (Math.abs(Date.now() / 1000 - Number(tid)) > 300) return NextResponse.json({ fel: "för gammal" }, { status: 401 });

  const nyckel = Buffer.from(hemlighet.replace(/^whsec_/, ""), "base64");
  const vantad = createHmac("sha256", nyckel).update(`${id}.${tid}.${kropp}`).digest();
  const giltig = signaturer.split(" ").some((s) => {
    const [, sig] = s.split(",");
    if (!sig) return false;
    const b = Buffer.from(sig, "base64");
    return b.length === vantad.length && timingSafeEqual(b, vantad);
  });
  if (!giltig) return NextResponse.json({ fel: "fel signatur" }, { status: 401 });

  let handelse: { type?: string; data?: { email_id?: string; bounce?: { message?: string } } };
  try {
    handelse = JSON.parse(kropp);
  } catch {
    return NextResponse.json({ fel: "ogiltig JSON" }, { status: 400 });
  }

  const db = supabaseAdmin();
  await db.from("integration_log").insert({ system: "resend", direction: "in", body: handelse as unknown as Record<string, unknown> });

  const typ = handelse.type ?? "";
  const mejl = handelse.data?.email_id ?? "";
  const status =
    typ === "email.delivered" || typ === "email.sent"
      ? "skickad"
      : typ === "email.bounced" || typ === "email.failed"
        ? "fel"
        : null;
  if (!mejl || !status) return NextResponse.json({ ok: true, hoppad: typ });

  const { data } = await db.rpc("lk_resend_handelse", {
    p_resend_id: mejl,
    p_status: status,
    p_fel: status === "fel" ? (handelse.data?.bounce?.message ?? typ) : null,
  });
  const svar = data as unknown as { event_id: string; ansvarig: string; mottagare: string } | null;

  if (svar && status === "fel") {
    const { data: e } = await db.from("calendar_event").select("title, dag, tid").eq("id", svar.event_id).maybeSingle();
    await notifiera({
      till: svar.ansvarig,
      av: null,
      kalla: "leverans-studs",
      typ: "kalender",
      rubrik: `Påminnelsen till ${svar.mottagare === "kund" ? "kunden" : "dig"} kom inte fram`,
      detalj: e ? `${e.title} · ${e.dag} ${String(e.tid ?? "").slice(0, 5)}` : "",
      href: e ? `/kalender?dag=${e.dag}&handelse=${svar.event_id}` : "/kalender",
      objekt: { typ: "calendar_event", id: svar.event_id },
    });
  }
  return NextResponse.json({ ok: true, status });
}
