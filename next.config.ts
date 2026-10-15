import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pg-boss", "sharp"],
  poweredByHeader: false,
};

export default nextConfig;
