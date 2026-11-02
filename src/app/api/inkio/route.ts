import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { bevaka } from "@/lib/crm/inflode-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Inkios webhooks (0277): order, avtal, fakturor, ärenden och nya kunder.
 *
 * =============================================================================
 * EN KNUFF, INTE EN KÄLLA
 *
 * Inkio har ingen webhook för anteckningar, samtal, filer eller kortflyttar,
 * så bevakningen (varje minut) är det som gör att inget missas. En webhook
 * gör bara att EN kund läses direkt i stället för inom en minut: kroppen
 * sparas för felsökning, kunden slås upp och `bevaka` läser dess historik.
 * Ingenting i kroppen skrivs in i Nav som det står — det som skrivs är det
 * Inkio själv svarar när Nav frågar. En förfalskad knuff kan alltså bara få
 * Nav att läsa en kund en gång till.
 *
 * NYCKELN PRÖVAS ÄNDÅ. `INKIO_WEBHOOK_SECRET` måste finnas (annars 503), och
 * begäran måste bära den: antingen som egen rubrik `X-Nav-Nyckel` (Inkios
 * webhook har fält för egna rubriker) eller som Inkios signatur
 * `X-Inkio-Signature`, HMAC-SHA256 över kroppen (hex, med eller utan
 * `sha256=`, eller base64). Inkios dokumentation säger inte vilken form
 * signaturen har; den egna rubriken fungerar oavsett.
 *
 * Inkio försöker igen efter 1 min, 10 min och 1 h, så samma leverans kan
 * komma flera gånger. `leverans_id` är unik, och en dubblett läser bara om.
 * =============================================================================
 */
function giltig(request: NextRequest, kropp: string, hemlighet: string): boolean {
  const lika = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
  const egen = request.headers.get("x-nav-nyckel");
  if (egen && lika(Buffer.from(egen), Buffer.from(hemlighet))) return true;

  const sig = (request.headers.get("x-inkio-signature") ?? "").trim();
  if (!sig) return false;
  const mac = createHmac("sha256", hemlighet).update(kropp).digest();
  const varden = sig.split(/[,\s]+/).map((s) => s.replace(/^(sha256|v1)=/, ""));
  return varden.some((v) => {
    if (/^[0-9a-f]{64}$/i.test(v)) return lika(Buffer.from(v.toLowerCase(), "hex"), mac);
    try {
      return lika(Buffer.from(v, "base64"), mac);
    } catch {
      return false;
    }
  });
}

/** Kundens id i Inkio, var det än står i kroppen. */
function kundId(h: Record<string, unknown>): string | null {
  const d = (h.data && typeof h.data === "object" ? h.data : h) as Record<string, unknown>;
  const kandidater = [d.customer, d.customer_id, (d.doc as Record<string, unknown> | undefined)?.customer, h.customer, h.customer_id];
  if (String(h.event ?? h.type ?? "").startsWith("customer.")) kandidater.push(d.id, d.name);
  for (const k of kandidater) if (typeof k === "string" && k.trim()) return k.trim();
  return null;
}

export async function POST(request: NextRequest) {
  const hemlighet = process.env.INKIO_WEBHOOK_SECRET?.trim();
  if (!hemlighet) return NextResponse.json({ fel: "INKIO_WEBHOOK_SECRET saknas" }, { status: 503 });

  const kropp = await request.text();
  const ok = giltig(request, kropp, hemlighet);
  if (!ok) return NextResponse.json({ fel: "fel nyckel" }, { status: 401 });

  let h: Record<string, unknown> = {};
  try {
    h = JSON.parse(kropp) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ fel: "ogiltig JSON" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const leverans =
    request.headers.get("x-inkio-delivery") ?? request.headers.get("x-inkio-delivery-id") ?? (typeof h.delivery_id === "string" ? h.delivery_id : null) ?? (typeof h.id === "string" ? h.id : null);
  const kund = kundId(h);
  await db
    .from("crm_webbkrok")
    .upsert(
      { leverans_id: leverans, handelse: String(h.event ?? h.type ?? "").slice(0, 60) || null, kund_id: kund, signatur_ok: true, body: h },
      { onConflict: "leverans_id", ignoreDuplicates: true },
    );

  let org: string | null = null;
  if (kund) {
    const { data } = await db.from("crm_kund").select("org_number").eq("customer_id", kund).maybeSingle();
    org = (data?.org_number as string | undefined) ?? null;
  }
  // Inkio väntar inte på läsningen. En okänd kund (en ny i Inkio) läses av hela varvet.
  after(async () => {
    await bevaka(org ? { bara: [org] } : {});
  });
  return NextResponse.json({ ok: true, kund: org ?? null });
}
