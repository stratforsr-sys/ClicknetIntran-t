import type { NextConfig } from "next";

/**
 * typedRoutes ar avstangt med flit: sidopanelen byggs dynamiskt utifran roll,
 * sa href ar en strang som inte gar att typa som litteral rutt.
 *
 * Content-Security-Policy sitter INTE har utan i middleware, eftersom den
 * behover ett nytt nonce per svar. Ovriga headers ar statiska och ligger kvar.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * Nav 2.0-utkastet (/nav2) laser sin sida fran disk. Utan den har raden
   * kommer filen inte med i Vercels serverlosa funktion, och rutten svarar
   * ENOENT forst i produktion — lokalt finns ju filen.
   */
  outputFileTracingIncludes: {
    "/nav2": ["./src/nav2/utkast.html"],
    // Skriptet och stilen ar egna filer sedan 2026-10-19 (src/lib/nav2/mall.ts).
    "/nav2/skript.js": ["./src/nav2/utkast.html"],
    "/nav2/stil.css": ["./src/nav2/utkast.html"],
  },

  /**
   * Ingen hojd `serverActions.bodySizeLimit` har, och det ar ett medvetet val.
   *
   * Uppladdade filer gar INTE genom navet. De gar direkt fran webblasaren till
   * Supabase Storage via en signerad uppladdningslank — Vercel tar emot hogst
   * 4,5 MB i kroppen till en serverlos funktion, och en hojd grans i Next hade
   * darfor bara flyttat felet till plattformen, som svarar med nagot som inte
   * sager vad anvandaren gjorde. Se src/components/Filuppladdning.tsx.
   */

  /**
   * Gul 29 (produktionsprovet 2026-10-30): `/favicon.ico` gav 404. Webbläsare som
   * frågar efter den utan att läsa `<link rel="icon">` får appens ikon (src/app/icon.png).
   * Middleware rör den inte: matchern hoppar över favicon.ico, så bron fångar den inte.
   */
  async redirects() {
    return [{ source: "/favicon.ico", destination: "/icon.png", permanent: true }];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            // Navet behover inga av dessa. Att stanga av dem i forvag ar
            // billigare an att upptacka att ett beroende bett om dem.
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), " +
              "magnetometer=(), gyroscope=(), interest-cohort=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
      {
        // Typsnitten (F1 i prestandaprovet 2026-11-02). Sidan begär dem med ?v= (src/app/nav2/route.ts),
        // så adressen byts när filen byts, och de cachas för alltid i stället för att frågas om vid varje
        // besök. Utan ?v= (offline-sidan, public/app-sw.js) som förut.
        source: "/nav2/fonts/:fil",
        has: [{ type: "query", key: "v" }],
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // Persondata far aldrig cachas av en mellanliggande proxy.
        source: "/(personal|logg|uppstart)/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
