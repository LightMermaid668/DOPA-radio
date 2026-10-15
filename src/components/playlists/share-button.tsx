"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";

import { promptDialog } from "@/components/ui/dialog";

export function ShareButton({ path, title }: { path: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = new URL(path, window.location.origin).toString();
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* キャンセル時はクリップボードにフォールバック */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      void promptDialog({
        title: "URLをコピー",
        description: "クリップボードにコピーできませんでした。手動でコピーしてください。",
        defaultValue: url,
        confirmLabel: "閉じる",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="flex h-8 items-center gap-1.5 rounded-full border border-dopa-700 px-3 text-xs font-semibold text-zinc-200 hover:bg-dopa-800"
    >
      <Share2 className="size-3.5" />
      {copied ? "コピーしました" : "共有"}
    </button>
  );
}
