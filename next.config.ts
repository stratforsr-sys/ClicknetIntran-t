import type { NextConfig } from "next";

/**
 * typedRoutes ar avstangt med flit: sidopanelen byggs dynamiskt utifran roll,
 * sa href ar en strang som inte gar att typa som litteral rutt.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
