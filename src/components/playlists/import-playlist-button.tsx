"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

export function ImportPlaylistButton({
  playlistId,
  ownerId,
}: {
  playlistId: string;
  ownerId: string;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;
  if (session.user?.id === ownerId) return null;

  async function importPlaylist() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/playlists/${playlistId}/import`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { id?: string; count?: number; error?: string }
        | null;
      if (res.ok && body?.id) {
        router.push(`/playlists/${body.id}`);
        return;
      }
      setError(body?.error ?? "コピーに失敗しました");
    } catch {
      setError("コピーに失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={importPlaylist}
        disabled={busy}
      >
        <Copy className="size-4" />
        {busy ? "コピー中…" : "自分のリストにコピー"}
      </Button>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
