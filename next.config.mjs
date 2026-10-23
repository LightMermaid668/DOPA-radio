/** @type {import("next").NextConfig} */
// ビルドIDは scripts/build-id.mjs が src/generated/build-id.json に1回だけ書き出す
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
