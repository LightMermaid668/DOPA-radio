"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Flag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const REASONS: Array<{ key: string; label: string }> = [
  { key: "copyright", label: "著作権侵害" },
  { key: "inappropriate", label: "不適切なコンテンツ" },
  { key: "spam", label: "スパム・迷惑行為" },
  { key: "other", label: "その他" },
];

export function ReportButton({
  targetType,
  targetId,
  compact = false,
}: {
  targetType: "track" | "playlist";
  targetId: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("copyright");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, reason, detail }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "通報に失敗しました");
    } catch {
      setError("通報に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDone(false);
          setOpen(true);
        }}
        aria-label="通報する"
        className={cn(
          "flex items-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-red-400",
          compact ? "size-8 justify-center" : "h-8 gap-1.5 border border-dopa-700 px-3 text-xs font-semibold",
        )}
      >
        <Flag className="size-3.5" />
        {compact ? null : "通報"}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="animate-fade fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-black/70"
              onClick={() => setOpen(false)}
            >
              <div className="flex min-h-full items-center justify-center p-6">
                <div
                  className="animate-pop flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-dopa-700 bg-dopa-900 p-5"
                  onClick={(event) => event.stopPropagation()}
                >
                  {done ? (
                    <>
                      <p className="text-sm font-bold">通報しました</p>
                      <p className="text-xs text-zinc-400">
                        ご協力ありがとうございます。管理者が確認します。
                      </p>
                      <Button type="button" size="sm" onClick={() => setOpen(false)}>
                        閉じる
                      </Button>
                    </>
                  ) : (
                    <>
                      <h2 className="text-sm font-bold">
                        {targetType === "track" ? "曲" : "プレイリスト"}を通報
                      </h2>

                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] text-zinc-400">理由</span>
                        <select
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="h-9 rounded-xl border border-dopa-700 bg-dopa-950 px-3 text-sm outline-none focus:border-accent"
                        >
                          {REASONS.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] text-zinc-400">詳細（任意）</span>
                        <textarea
                          value={detail}
                          onChange={(e) => setDetail(e.target.value)}
                          maxLength={500}
                          rows={3}
                          placeholder="状況を教えてください"
                          className="rounded-xl border border-dopa-700 bg-dopa-950 px-3 py-2 text-sm outline-none focus:border-accent"
                        />
                      </div>

                      {error ? <p className="text-xs text-red-400">{error}</p> : null}

                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" onClick={submit} disabled={busy}>
                          {busy ? "送信中…" : "通報する"}
                        </Button>
                        <button
                          type="button"
                          onClick={() => setOpen(false)}
                          className="text-xs text-zinc-400 underline underline-offset-2"
                        >
                          キャンセル
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
