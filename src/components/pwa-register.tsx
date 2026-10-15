"use client";

import { useEffect } from "react";

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
      window.location.reload();
    };

    const onControllerChange = () => {
      if (!hadController) return; // 初回インストール時はリロード不要
      reloadWhenIdle();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((registration) => {
          const check = () => {
            registration.update().catch(() => {});
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
