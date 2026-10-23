import pkg from "../../package.json";

/** 表示用バージョン */
export const APP_VERSION: string = pkg.version;

/**
 * ビルド識別子（next.config.mjs でビルド時刻から生成）。
 * PWAの更新検知とバージョン表示に使う。
 */
export const BUILD_ID: string =
  process.env.NEXT_PUBLIC_BUILD_TIME ?? "dev";

/** "v0.4.0 (2026-10-22)" のような表示用文字列 */
export function versionLabel(): string {
  if (!BUILD_ID || BUILD_ID === "dev") return `v${APP_VERSION}`;
  const date = new Date(BUILD_ID);
  if (Number.isNaN(date.getTime())) return `v${APP_VERSION}`;
  const stamp = date.toISOString().slice(0, 10);
  return `v${APP_VERSION} (${stamp})`;
}
