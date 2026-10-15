"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardList,
  Music2,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import { ShareButton } from "@/components/playlists/share-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePlayer } from "@/stores/player";

export type PlaylistItemData = {
  itemId: string;
  kind: "upload" | "apple" | "spotify";
  trackId: string | null;
  title: string | null;
  artist: string | null;
  durationSec: number | null;
  status: "processing" | "ready" | "failed" | null;
  hasArtwork: boolean;
};

export type PlaylistDetailData = {
  id: string;
  title: string;
  description: string | null;
  visibility: "private" | "unlisted" | "public";
  items: PlaylistItemData[];
};

const VISIBILITY_LABELS: Record<PlaylistDetailData["visibility"], string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type LibraryTrackOption = {
  id: string;
  title: string;
  artist: string | null;
  status: string;
};

export function PlaylistDetail({ data }: { data: PlaylistDetailData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(data.title);
  const [description, setDescription] = useState(data.description ?? "");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [options, setOptions] = useState<LibraryTrackOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!addOpen || options !== null) return;
    void (async () => {
      const res = await fetch("/api/tracks");
      const body = (await res.json().catch(() => null)) as {
        tracks?: LibraryTrackOption[];
      } | null;
      setOptions(body?.tracks ?? []);
    })();
  }, [addOpen, options]);

  const readyItems = data.items.filter(
    (item) => item.kind === "upload" && item.status === "ready" && item.trackId,
  );

  function playFrom(itemId: string) {
    const index = readyItems.findIndex((item) => item.itemId === itemId);
    if (index < 0) return;
    usePlayer.getState().playQueue(
      readyItems.map((item) => ({
        id: item.trackId as string,
        title: item.title ?? "無題のトラック",
        artist: item.artist,
        durationSec: item.durationSec,
        artworkUrl: item.hasArtwork ? `/api/tracks/${item.trackId}/artwork` : null,
      })),
      index,
    );
  }

  async function patchPlaylist(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/playlists/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId: string) {
    setBusy(true);
    try {
      await fetch(`/api/playlists/${data.id}/items/${itemId}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function move(itemId: string, direction: -1 | 1) {
    const ids = data.items.map((item) => item.itemId);
    const index = ids.indexOf(itemId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true);
    try {
      await fetch(`/api/playlists/${data.id}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: ids }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await fetch(`/api/playlists/${data.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackIds: [...selected] }),
      });
      setSelected(new Set());
      setAddOpen(false);
      setOptions(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deletePlaylist() {
    if (!window.confirm(`「${data.title}」を削除しますか？元に戻せません。`)) return;
    setBusy(true);
    try {
      await fetch(`/api/playlists/${data.id}`, { method: "DELETE" });
      router.push("/playlists");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const existingTrackIds = new Set(
    data.items.map((item) => item.trackId).filter((trackId): trackId is string => Boolean(trackId)),
  );
  const addableOptions = (options ?? []).filter(
    (option) => option.status === "ready" && !existingTrackIds.has(option.id),
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-dopa-800 bg-dopa-900 p-5">
        {editing ? (
          <div className="flex flex-col gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="タイトル"
              className="h-10 rounded-xl border border-dopa-700 bg-dopa-950 px-3 text-lg font-bold outline-none focus:border-accent"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="説明（任意）"
              className="rounded-xl border border-dopa-700 bg-dopa-950 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  await patchPlaylist({ title, description });
                  setEditing(false);
                }}
                disabled={!title.trim() || busy}
              >
                <Check className="size-3.5" />
                保存
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setTitle(data.title);
                  setDescription(data.description ?? "");
                }}
              >
                <X className="size-3.5" />
                キャンセル
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-black">{data.title}</h1>
                {data.description ? (
                  <p className="mt-1 text-sm text-zinc-400">{data.description}</p>
                ) : null}
                <p className="mt-2 text-xs text-zinc-500">{data.items.length}曲</p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-zinc-200"
                aria-label="編集"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const first = data.items[0]?.itemId;
                  if (first) playFrom(first);
                }}
                disabled={readyItems.length === 0}
              >
                <Play className="size-3.5" />
                再生
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddOpen((v) => !v)}
              >
                <Plus className="size-3.5" />
                曲を追加
              </Button>
              <ShareButton path={`/p/${data.id}`} title={data.title} />
              <select
                value={data.visibility}
                onChange={(e) => patchPlaylist({ visibility: e.target.value })}
                disabled={busy}
                className="h-8 rounded-full border border-dopa-700 bg-dopa-950 px-2.5 text-xs text-zinc-300 outline-none focus:border-accent"
                aria-label="公開範囲"
              >
                {(Object.keys(VISIBILITY_LABELS) as Array<keyof typeof VISIBILITY_LABELS>).map(
                  (key) => (
                    <option key={key} value={key}>
                      {VISIBILITY_LABELS[key]}
                    </option>
                  ),
                )}
              </select>
              <button
                type="button"
                onClick={deletePlaylist}
                disabled={busy}
                className="flex h-8 items-center gap-1 rounded-full px-3 text-xs text-zinc-400 hover:bg-dopa-800 hover:text-red-400"
              >
                <Trash2 className="size-3.5" />
                削除
              </button>
            </div>
          </>
        )}
      </section>

      {addOpen ? (
        <section className="rounded-2xl border border-dopa-700 bg-dopa-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold">ライブラリから追加</h2>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="text-xs text-zinc-400 underline underline-offset-2"
            >
              閉じる
            </button>
          </div>
          {options === null ? (
            <p className="text-xs text-zinc-500">読み込み中…</p>
          ) : addableOptions.length === 0 ? (
            <p className="text-xs text-zinc-500">追加できる曲がありません</p>
          ) : (
            <>
              <ul className="mb-3 max-h-64 space-y-1 overflow-y-auto">
                {addableOptions.map((option) => (
                  <li key={option.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-dopa-800">
                      <input
                        type="checkbox"
                        checked={selected.has(option.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(option.id)) next.delete(option.id);
                            else next.add(option.id);
                            return next;
                          })
                        }
                        className="size-4 accent-fuchsia-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{option.title}</span>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {option.artist ?? ""}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button type="button" size="sm" onClick={addSelected} disabled={selected.size === 0 || busy}>
                追加（{selected.size}件）
              </Button>
            </>
          )}
        </section>
      ) : null}

      {data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-6 py-12 text-center">
          <ClipboardList className="size-7 text-zinc-500" />
          <p className="text-sm text-zinc-400">「曲を追加」からライブラリの曲を追加しよう</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 pb-8">
          {data.items.map((item, position) => {
            const ready = item.status === "ready";
            return (
              <li
                key={item.itemId}
                className="flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3"
              >
                <span className="w-5 shrink-0 text-right text-xs text-zinc-500">
                  {position + 1}
                </span>
                <button
                  type="button"
                  onClick={() => playFrom(item.itemId)}
                  disabled={!ready}
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg",
                    ready ? "bg-dopa-800 hover:ring-2 hover:ring-accent" : "bg-dopa-800/50",
                  )}
                  aria-label="再生"
                >
                  {ready && item.hasArtwork && item.trackId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/tracks/${item.trackId}/artwork`}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Music2 className="size-4 text-zinc-500" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {item.title ?? "不明なトラック"}
                  </p>
                  <p className="truncate text-xs text-zinc-400">
                    {item.artist ?? "アーティスト不明"} ・ {formatDuration(item.durationSec)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(item.itemId, -1)}
                    disabled={position === 0 || busy}
                    className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 disabled:opacity-30"
                    aria-label="上へ"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(item.itemId, 1)}
                    disabled={position === data.items.length - 1 || busy}
                    className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 disabled:opacity-30"
                    aria-label="下へ"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(item.itemId)}
                    disabled={busy}
                    className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-red-400"
                    aria-label="削除"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
