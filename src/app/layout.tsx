import type { Metadata, Viewport } from "next";
import { PlayerBar } from "@/components/player/player-bar";
import { PwaRegister } from "@/components/pwa-register";
import { DialogHost } from "@/components/ui/dialog";
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
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
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
