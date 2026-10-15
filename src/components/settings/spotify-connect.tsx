"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const STATUS_MESSAGES: Record<string, string> = {
  connected: "Spotifyと連携しました",
  error: "Spotify連携に失敗しました。もう一度お試しください",
  unconfigured: "サーバー側のSpotify設定（SPOTIFY_CLIENT_ID）が未完了です",
};

export function SpotifyConnect({
  configured,
  connected,
  status,
}: {
  configured: boolean;
  connected: boolean;
  status: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    const confirmed = await confirmDialog({
      title: "Spotify連携を解除しますか？",
      confirmLabel: "解除",
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await fetch("/api/integrations/spotify", { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-dopa-800 bg-dopa-900 p-5">
      <h2 className="mb-1 font-bold">Spotify</h2>
      <p className="mb-4 text-xs leading-relaxed text-zinc-500">
        プレイリストへの曲検索・追加に使います。再生はSpotifyアプリ側で行われます（ユーザーはSpotify
        Premium推奨）。
      </p>

      {status && STATUS_MESSAGES[status] ? (
        <p className="mb-3 text-xs text-accent">{STATUS_MESSAGES[status]}</p>
      ) : null}

      {!configured ? (
        <p className="text-xs text-zinc-500">
          サーバー側の設定が未完了です（管理者向け: <code>SPOTIFY_CLIENT_ID</code> /{" "}
          <code>SPOTIFY_CLIENT_SECRET</code> を .env に設定）
        </p>
      ) : connected ? (
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-[#4ade80]">接続済み</span>
          <Button type="button" variant="outline" size="sm" onClick={disconnect} disabled={busy}>
            {busy ? "解除中…" : "連携を解除"}
          </Button>
        </div>
      ) : (
        <a
          href="/api/integrations/spotify/connect"
          className={cn(buttonVariants({ size: "sm" }))}
        >
          Spotifyと連携する
        </a>
      )}
    </section>
  );
}
