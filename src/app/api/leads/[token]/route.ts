import { NextResponse, type NextRequest } from "next/server";
import { nekadForLeads, taEmotLead } from "@/lib/leads-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Hemsidans leads, med hemligheten i adressen — för formulärverktyg som bara
 * tar en URL och inte låter oss sätta en header. Samma lösning som
 * `/api/lynes/[token]`, och resonemanget står i `src/lib/leads-server.ts`.
 *
 * GET finns för att många webhookformulär provar adressen innan de sparar den,
 * och en 405 där ser ut som en trasig adress. Svaret säger bara att
 * hemligheten är rätt.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const nekad = nekadForLeads(token, request);
  if (nekad) return nekad;
  return NextResponse.json({ ok: true, redo: true });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const nekad = nekadForLeads(token, request);
  if (nekad) return nekad;
  return taEmotLead(request);
}
