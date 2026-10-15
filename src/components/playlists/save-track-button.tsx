"use client";

import { useState } from "react";
import { BookmarkCheck, BookmarkPlus } from "lucide-react";

import { cn } from "@/lib/utils";

export function SaveTrackButton({
  trackId,
  initialSaved,
}: {
  trackId: string;
  initialSaved: boolean;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !saved;
    try {
      const res = next
        ? await fetch("/api/saved-tracks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ trackId }),
          })
        : await fetch(`/api/saved-tracks/${trackId}`, { method: "DELETE" });
      if (res.ok) setSaved(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold",
        saved
          ? "border-accent text-accent"
          : "border-dopa-700 text-zinc-300 hover:bg-dopa-800",
      )}
      aria-label={saved ? "ライブラリから外す" : "ライブラリに追加"}
    >
      {saved ? (
        <BookmarkCheck className="size-3.5" />
      ) : (
        <BookmarkPlus className="size-3.5" />
      )}
      {saved ? "保存済み" : "保存"}
    </button>
  );
}
