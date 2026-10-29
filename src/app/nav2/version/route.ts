import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Nav 2.0 som app: vilken version som körs just nu.
 *
 * Sidan bär sin egen version i `<meta name="nav-version">`. Appen frågar här
 * när den tas fram och var halvtimme, och skiljer sig svaren åt har en ny
 * deploy kommit. `null` när ingen commit finns (lokalt): appen gör då ingenting.
 *
 * Ligger bakom inloggningen (mellanvaran, som grannrutterna): ett utloggat
 * anrop får inloggningssidan, JSON-tolkningen fallerar i appen och kollen
 * hoppas över. Rutten läser ingen användardata.
 */
export async function GET() {
  return NextResponse.json(
    { v: process.env.VERCEL_GIT_COMMIT_SHA ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
