import type { Metadata, Viewport } from "next";
import { PlayerBar } from "@/components/player/player-bar";
import { PwaRegister } from "@/components/pwa-register";
import { DialogHost } from "@/components/ui/dialog";
import { PWA_ANY_ICONS, PWA_APPLE_ICONS, PWA_FAVICON_ICO } from "@/lib/pwa-icons";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DOPA-radio",
    template: "%s | DOPA-radio",
  },
  description: "ドパガキのための音楽基地。みんなで曲を持ち寄って、プレイリストを共有しよう。",
  applicationName: "DOPA-radio",
  appleWebApp: {
    capable: true,
    title: "DOPA-radio",
    statusBarStyle: "black-translucent",
  },
  // Next.js は apple-mobile-web-app-capable を出力しないため iOS 向けに明示する
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    icon: PWA_ANY_ICONS.map(({ src, sizes, type }) => ({ url: src, sizes, type })),
    shortcut: PWA_FAVICON_ICO,
    apple: PWA_APPLE_ICONS,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        {children}
        <PlayerBar />
        <DialogHost />
        <PwaRegister />
      </body>
    </html>
  );
}
