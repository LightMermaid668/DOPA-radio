"use client";

import { useEffect } from "react";

import { showToast } from "@/components/ui/toast";
import { BUILD_ID } from "@/lib/version";
import { usePlayer } from "@/stores/player";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let refreshing = false;
    const hadController = Boolean(navigator.serviceWorker.controller);

    // 再生中は邪魔しない（停止後に自動で最新版へリロード）
    const reloadWhenIdle = () => {
      if (refreshing) return;
      if (usePlayer.getState().isPlaying) {
        window.setTimeout(reloadWhenIdle, 5000);
        return;
      }
      refreshing = true;
      try {
        sessionStorage.setItem("dopa:last-update-reload", String(Date.now()));
      } catch {
        /* ignore */
      }
      // リロード後に古いHTMLが返るキャッシュを避けるため、クエリを付けて再取得
      const url = new URL(window.location.href);
      url.searchParams.set("_v", String(Date.now()));
      window.location.replace(url.toString());
    };

    const onControllerChange = () => {
      if (!hadController) return; // 初回インストール時はリロード不要
      // バージョン更新で直前にリロードした場合は二重リロードを避ける
      let lastReload = 0;
      try {
        lastReload = Number(sessionStorage.getItem("dopa:last-update-reload") ?? 0);
      } catch {
        /* ignore */
      }
      if (Date.now() - lastReload < 30_000) return;
      reloadWhenIdle();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // サーバー側のビルドIDと比較して、古い画面が残っていたら更新する
    let updateNotified = false;
    const checkVersion = async () => {
      try {
        const res = await fetch(`/api/version?ts=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { build?: string };
        if (!data.build || data.build === BUILD_ID) return;
        // リロードしても古い画面が残る環境向けの無限ループ防止
        let attempted = "";
        try {
          attempted = sessionStorage.getItem("dopa:update-attempt") ?? "";
        } catch {
          /* ignore */
        }
        if (attempted === data.build) {
          if (!updateNotified) {
            updateNotified = true;
            showToast("新しいバージョンがあります。アプリを完全に終了して開き直してください", "info");
          }
          return;
        }
        try {
          sessionStorage.setItem("dopa:update-attempt", data.build);
        } catch {
          /* ignore */
        }
        if (!updateNotified) {
          updateNotified = true;
          showToast("新しいバージョンがあります。まもなく更新します", "info");
        }
        reloadWhenIdle();
      } catch {
        /* オフライン等は無視 */
      }
    };

    const register = () => {
      // クエリをビルドIDにして、SafariでもSW更新を確実に検知させる
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, {
          updateViaCache: "none",
        })
        .then((registration) => {
          const check = () => {
            registration.update().catch(() => {});
            void checkVersion();
          };
          check();
          const interval = window.setInterval(check, 60 * 1000);
          const onVisibility = () => {
            if (document.visibilityState === "visible") check();
          };
          document.addEventListener("visibilitychange", onVisibility);
          window.addEventListener("beforeunload", () => {
            window.clearInterval(interval);
            document.removeEventListener("visibilitychange", onVisibility);
          });
        })
        .catch(() => {
          /* 失敗は無視（次回起動時に再試行される） */
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
