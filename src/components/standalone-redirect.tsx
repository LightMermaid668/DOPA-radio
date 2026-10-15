"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * インストール済みPWA（standalone）でランディングページが開かれた場合に、
 * アプリ入口（/start → ライブラリ or ログイン）へ自動転送する。
 * iOS が manifest の start_url を無視して「追加時のURL」で起動するケースの保険。
 */
export function StandaloneRedirect() {
  const router = useRouter();

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      router.replace("/start");
    }
  }, [router]);

  return null;
}
