import { NextResponse, type NextRequest } from "next/server";
import { nekadForLeads, taEmotLead } from "@/lib/leads-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Hemsidans leads, med hemligheten i `Authorization: Bearer`. Varianten med
 * hemligheten i adressen ligger i `[token]/route.ts` — båda landar i
 * `taEmotLead()`, och resonemanget står i `src/lib/leads-server.ts`.
 */
export async function GET(request: NextRequest) {
  const nekad = nekadForLeads(null, request);
  if (nekad) return nekad;
  return NextResponse.json({ ok: true, redo: true });
}

export async function POST(request: NextRequest) {
  const nekad = nekadForLeads(null, request);
  if (nekad) return nekad;
  return taEmotLead(request);
}
