import { lasUtkast, utkastfil } from "@/lib/nav2/mall";

export const dynamic = "force-dynamic";

/** Utkastets stil, samma for alla. Se src/lib/nav2/mall.ts. */
export async function GET(request: Request) {
  const d = await lasUtkast();
  return utkastfil(d.stil, "text/css", d.vStil, new URL(request.url).searchParams.get("v"));
}
