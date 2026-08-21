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
   * Uppladdade filer gar genom en server action, och gransen dar ar 1 MB som
   * standard. Bucketen slapper in 10 MB (0022), sa utan den har raden hade en
   * fotograferad intygssida fran en telefon fallit pa mellanvaran med ett fel
   * som inte sager vad som var fel.
   *
   * 12 och inte 10: kroppen bar aven falt och grans-strangar, och en fil pa
   * exakt tio megabyte ska nekas av regeln i filer.ts med ett begripligt
   * meddelande, inte av ramverket.
   */
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
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
        // Persondata far aldrig cachas av en mellanliggande proxy.
        source: "/(personal|logg|uppstart)/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
