"use client";

/**
 * プレイヤーの動作ログ（リングバッファ）。
 * 再生トラブルの調査用に設定画面から確認・コピーできるようにする。
 */

const MAX_LOGS = 200;
let logs: string[] = [];

export function playerLog(message: string) {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;
  logs.push(`${time} ${message}`);
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
  console.info("[player]", message);
}

export function getPlayerLogs(): string[] {
  return [...logs];
}
