import { NextResponse, type NextRequest } from "next/server";
import { kontrolleraCron } from "@/lib/jobb/behorighet";
import { bevaka } from "@/lib/crm/inflode-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Inkio-bevakningen (0277). `pg_cron` ringer varje minut via `kalla_jobb`,
 * som utkorgen. Läser historiken för varje kund som har en order i Nav och
 * tar in det som är nytt eller ändrat — se `bevaka()` i
 * `src/lib/crm/inflode-server.ts`.
 *
 * JOBBET SKAPAS AVSTÄNGT i 0277 och slås på när grenen mergats: `job_target`
 * pekar på produktionen, och där finns rutten först efter mergen.
 *
 * POST för `pg_net`, GET för en människa med `curl`. Samma `CRON_SECRET`.
 * `?kund=556782-8743` läser bara den kunden.
 */
async function kor(request: NextRequest) {
  const nekad = kontrolleraCron(request);
  if (nekad) return nekad;
  const kund = new URL(request.url).searchParams.get("kund");
  return NextResponse.json(await bevaka(kund ? { bara: [kund] } : {}));
}

export async function POST(request: NextRequest) {
  return kor(request);
}

export async function GET(request: NextRequest) {
  return kor(request);
}
