import type { Metadata } from "next";

/**
 * Appens huvud (uppgift 7). Rena strängar och en konstant, inga andra importer:
 * filen läses av rutten /nav2, av rotlayouten och av provet.
 *
 * /nav2 skickar sitt eget <head> och får taggarna av appHuvud(). Inloggnings-
 * sidorna (/logga-in, /logga-in/verifiera, /byt-losenord, /uppstart) ritas av
 * Next med rotlayouten och får samma app av APP_METADATA. Det är där den
 * utloggade iPhone-användaren står när hen trycker "Lägg till på hemskärmen".
 *
 * Utseendet är orört: statusraden är `default` (ljus), ingen viewport-fit och
 * ingen theme-color. Ikonen på inloggningssidorna kommer av Nexts apple-icon
 * (src/app/apple-icon.png, samma byte som apple-touch-180.png).
 */
export const APP_METADATA: Pick<Metadata, "manifest" | "appleWebApp"> = {
  manifest: "/nav2/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Nav", statusBarStyle: "default" },
};

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Taggarna efter <meta charset>. iPhone zoomar in när man trycker i ett fält
 * under 16 px, och utkastets fält är 13,5–15 px: maximum-scale=1 hindrar det,
 * och nypzoomen finns kvar på iOS. På Android skulle den stänga av nypzoomen,
 * så där står viewporten som förut. En iPad i skrivbordsläge säger Macintosh
 * och får Androids variant, eftersom servern inte kan se pekskärmen.
 */
export function appHuvud(ua: string, version: string | null): string {
  const iphone = /iPhone|iPad|iPod/.test(ua);
  return (
    `<meta name="viewport" content="width=device-width, initial-scale=1${iphone ? ", maximum-scale=1" : ""}">` +
    `<link rel="apple-touch-icon" href="/nav2/ikon/apple-touch-180.png">` +
    `<meta name="apple-mobile-web-app-capable" content="yes">` +
    `<meta name="apple-mobile-web-app-title" content="Nav">` +
    `<meta name="apple-mobile-web-app-status-bar-style" content="default">` +
    (version === null ? "" : `<meta name="nav-version" content="${html(version)}">`)
  );
}

export function skal(ua: string, version: string | null): string {
  return `<!doctype html><html lang="sv"><head><meta charset="utf-8">` + appHuvud(ua, version);
}
