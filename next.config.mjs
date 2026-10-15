/** @type {import("next").NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "pg-boss", "sharp"],
  poweredByHeader: false,
};

export default nextConfig;
