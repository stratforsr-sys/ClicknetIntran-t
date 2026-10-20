import { lasUtkast, utkastfil } from "@/lib/nav2/mall";

export const dynamic = "force-dynamic";

/** Utkastets skript, samma for alla. Se src/lib/nav2/mall.ts. Mellanvaran kraver inloggning som for /nav2. */
export async function GET(request: Request) {
  const d = await lasUtkast();
  return utkastfil(d.skript, "text/javascript", d.vSkript, new URL(request.url).searchParams.get("v"));
}
