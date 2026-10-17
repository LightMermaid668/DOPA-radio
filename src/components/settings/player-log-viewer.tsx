"use client";

import { useState } from "react";
import { Activity, ClipboardCopy } from "lucide-react";

import { getPlayerLogs } from "@/lib/player-log";
import { showToast } from "@/components/ui/toast";

export function PlayerLogViewer() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  function toggle() {
    if (!open) setLogs(getPlayerLogs().slice().reverse());
    setOpen((value) => !value);
  }

  async function copy() {
    const text = getPlayerLogs().join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("再生ログをコピーしました", "success");
    } catch {
      showToast("コピーできませんでした", "error");
    }
  }

  return (
    <section className="rounded-2xl border border-dopa-800 bg-dopa-900 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold">
          <Activity className="size-4 text-accent" />
          再生ログ
        </h2>
        <div className="flex items-center gap-2">
          {open ? (
            <button
              type="button"
              onClick={() => void copy()}
              className="flex h-7 items-center gap-1 rounded-full border border-dopa-700 px-2.5 text-[11px] font-semibold text-zinc-300 hover:bg-dopa-800"
            >
              <ClipboardCopy className="size-3" />
              コピー
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggle}
            className="text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
          >
            {open ? "閉じる" : "表示"}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        再生トラブル（曲送りの不具合など）の調査用ログです。不具合の際は「コピー」して共有してください。
      </p>
      {open ? (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg bg-dopa-950 p-3">
          {logs.length === 0 ? (
            <p className="text-[11px] text-zinc-500">まだログがありません</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {logs.map((line, index) => (
                <li key={`${index}-${line}`} className="font-mono text-[10px] text-zinc-400">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
