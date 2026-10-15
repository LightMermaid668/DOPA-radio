"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";

import { cn } from "@/lib/utils";

export function QrShareButton({
  path,
  title,
  className,
}: {
  path: string;
  title: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path;

  useEffect(() => {
    if (!open) return;
    setDataUrl(null);
    QRCode.toDataURL(url, {
      width: 512,
      margin: 2,
      color: { dark: "#0a0a0c", light: "#ffffff" },
    })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [open, url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("このURLをコピーしてください", url);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full border border-dopa-700 px-3 text-xs font-semibold text-zinc-200 hover:bg-dopa-800",
          className,
        )}
      >
        <QrCode className="size-3.5" />
        QR
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="animate-fade fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-black/70"
              onClick={() => setOpen(false)}
            >
              <div className="flex min-h-full items-center justify-center p-6">
                <div
                  className="animate-pop flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border border-dopa-700 bg-dopa-900 p-5"
                  onClick={(event) => event.stopPropagation()}
                >
                  <p className="text-center text-sm font-bold">{title}</p>
                  <div className="flex size-48 items-center justify-center overflow-hidden rounded-xl bg-white p-2 sm:size-56">
                    {dataUrl ? (
                      <img src={dataUrl} alt="QRコード" className="size-full" />
                    ) : (
                      <span className="text-xs text-zinc-500">生成中…</span>
                    )}
                  </div>
                  <p className="break-all text-center text-[10px] text-zinc-500">{url}</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={copy}
                      className="rounded-full border border-dopa-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-dopa-800"
                    >
                      {copied ? "コピーしました" : "リンクをコピー"}
                    </button>
                    {typeof navigator !== "undefined" && "share" in navigator ? (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.share({ title, url }).catch(() => {});
                        }}
                        className="rounded-full border border-dopa-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-dopa-800"
                      >
                        共有
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="rounded-full px-3 py-1.5 text-xs text-zinc-400 hover:bg-dopa-800"
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
