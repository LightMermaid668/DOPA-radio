"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function CreatePlaylistForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string } | null;
      if (res.ok && data?.id) {
        router.push(`/playlists/${data.id}`);
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
        }}
        placeholder="新しいプレイリスト名（例: ドパ朝プレイリスト）"
        maxLength={200}
        className="h-10 flex-1 rounded-xl border border-dopa-700 bg-dopa-900 px-4 text-sm outline-none focus:border-accent"
      />
      <Button type="button" onClick={create} disabled={!title.trim() || busy}>
        {busy ? "作成中…" : "作成"}
      </Button>
    </div>
  );
}
