/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    // ページ遷移をクロスフェード（View Transitions API）で滑らかに
    viewTransition: true,
  },
  serverExternalPackages: ["pg", "pg-boss", "sharp"],
  poweredByHeader: false,
};

export default nextConfig;
