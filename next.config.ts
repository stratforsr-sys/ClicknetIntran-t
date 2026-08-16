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
