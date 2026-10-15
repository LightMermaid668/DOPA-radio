import type { MetadataRoute } from "next";

// PWA のアプリID（UUID）。変更すると別アプリ扱いになり、再インストールで新しいアイデンティティになる
const APP_ID = "8f2d5c1a-64b7-4e93-9a0f-3d6e7b21c845";

// デプロイ更新が即座に反映されるようキャッシュさせない
export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `/start?app=${APP_ID}`,
    name: "DOPA-radio",
    short_name: "DOPA",
    description: "ドパガキのための音楽基地。曲を持ち寄ってプレイリストを共有しよう。",
    start_url: `/start?app=${APP_ID}`,
    // Android Chrome: インストール済みPWAがサイト内リンク（共有されたプレイリスト等）を
    // ブラウザではなくアプリで開けるようにする（iOSは非対応）
    launch_handler: { client_mode: "navigate-existing" },
    display: "standalone",
    background_color: "#0a0a0c",
    theme_color: "#0a0a0c",
    lang: "ja",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
