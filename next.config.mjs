/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    // ページ遷移をクロスフェード（View Transitions API）で滑らかに
    viewTransition: true,
  },
  serverExternalPackages: ["pg", "pg-boss", "sharp"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
};

export default nextConfig;
