"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";

function extractPlaylistId(input: string): string | null {
  const match = input
    .trim()
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : null;
}

export function ImportPlaylistForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function importFromLink() {
    if (busy) return;
    const id = extractPlaylistId(value);
    if (!id) {
      setError("共有リンク（またはプレイリストID）を入力してください");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/playlists/${id}/import`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { id?: string; error?: string }
        | null;
      if (res.ok && body?.id) {
        router.push(`/playlists/${body.id}`);
        return;
      }
      setError(body?.error ?? "追加に失敗しました（非公開のプレイリストは追加できません）");
    } catch {
      setError("追加に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void importFromLink();
            }}
            placeholder="共有リンクを貼り付けて自分のリストに追加"
            className="h-10 w-full rounded-xl border border-dopa-700 bg-dopa-900 pl-9 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <Button type="button" onClick={importFromLink} disabled={busy || !value.trim()}>
          {busy ? "追加中…" : "追加"}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
