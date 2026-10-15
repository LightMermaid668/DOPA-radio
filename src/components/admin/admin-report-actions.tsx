"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, EyeOff, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function AdminReportActions({
  reportId,
  status,
  targetType,
  targetId,
}: {
  reportId: string;
  status: string;
  targetType: string;
  targetId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setStatus(next: "resolved" | "dismissed") {
    setBusy(true);
    try {
      await fetch(`/api/admin/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteTrack() {
    if (!window.confirm("この曲を削除しますか？（元に戻せません）")) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/tracks/${targetId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function privacyPlaylist() {
    setBusy(true);
    try {
      await fetch(`/api/admin/playlists/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: "private" }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deletePlaylist() {
    if (!window.confirm("このプレイリストを削除しますか？（元に戻せません）")) return;
    setBusy(true);
    try {
      await fetch(`/api/admin/playlists/${targetId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {status === "open" ? (
        <>
          <Button type="button" size="sm" variant="outline" onClick={() => setStatus("resolved")} disabled={busy}>
            <Check className="size-3.5" />
            対応済み
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setStatus("dismissed")} disabled={busy}>
            <X className="size-3.5" />
            却下
          </Button>
        </>
      ) : null}
      {targetType === "track" ? (
        <Button type="button" size="sm" variant="outline" onClick={deleteTrack} disabled={busy}>
          <Trash2 className="size-3.5" />
          曲を削除
        </Button>
      ) : (
        <>
          <Button type="button" size="sm" variant="outline" onClick={privacyPlaylist} disabled={busy}>
            <EyeOff className="size-3.5" />
            非公開化
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={deletePlaylist} disabled={busy}>
            <Trash2 className="size-3.5" />
            削除
          </Button>
        </>
      )}
    </div>
  );
}
