"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardList,
  Library,
  Music2,
  Pencil,
  Play,
  Plus,
  Search,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";

import { ShareButton } from "@/components/playlists/share-button";
import { NowPlayingIndicator } from "@/components/player/now-playing-indicator";
import { QrShareButton } from "@/components/share/qr-share-button";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { usePlayer, type PlayerTrack } from "@/stores/player";

export type PlaylistItemData = {
  itemId: string;
  kind: "upload" | "apple" | "spotify";
  trackId: string | null;
  ownerId: string | null;
  title: string | null;
  artist: string | null;
  durationSec: number | null;
  status: "processing" | "ready" | "failed" | null;
  hasArtwork: boolean;
  artworkUrl: string | null;
  deepLink: string | null;
  previewUrl: string | null;
  chorusStartSec: number | null;
  chorusEndSec: number | null;
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

const KIND_LABELS: Record<PlaylistItemData["kind"], string> = {
  upload: "アップロード",
  apple: "Apple Music",
  spotify: "Spotify",
};

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toPlayerTrack(item: PlaylistItemData): PlayerTrack | null {
  if (item.kind === "upload") {
    if (!item.trackId || item.status !== "ready") return null;
    return {
      id: item.trackId,
      kind: "upload",
      title: item.title ?? "無題のトラック",
      artist: item.artist,
      durationSec: item.durationSec,
      artworkUrl: item.hasArtwork ? `/api/tracks/${item.trackId}/artwork` : null,
      chorusStartSec: item.chorusStartSec,
      chorusEndSec: item.chorusEndSec,
    };
  }
  if (!item.title) return null;
  return {
    id: `${item.kind}:${item.itemId}`,
    kind: item.kind,
    title: item.title,
    artist: item.artist,
    durationSec: item.durationSec,
    artworkUrl: item.artworkUrl,
    previewUrl: item.previewUrl,
    deepLink: item.deepLink,
  };
}

type LibraryTrackOption = {
  id: string;
  title: string;
  artist: string | null;
  status: string;
  ownerName?: string | null;
  own?: boolean;
};

type ExternalSearchResult = {
  externalId: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  durationMs: number | null;
  previewUrl?: string | null;
};

type AddMode = "library" | "apple" | "spotify";

export function PlaylistDetail({
  data,
  currentUserId,
}: {
  data: PlaylistDetailData;
  currentUserId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(data.title);
  const [description, setDescription] = useState(data.description ?? "");
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("library");
  const [options, setOptions] = useState<LibraryTrackOption[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ExternalSearchResult[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (!addOpen || addMode !== "library" || options !== null) return;
    void (async () => {
      const res = await fetch("/api/tracks?include=saved");
      const body = (await res.json().catch(() => null)) as {
        tracks?: LibraryTrackOption[];
      } | null;
      setOptions(body?.tracks ?? []);
    })();
  }, [addOpen, addMode, options]);

  const queueEntries = data.items
    .map((item) => ({ itemId: item.itemId, track: toPlayerTrack(item) }))
    .filter((entry): entry is { itemId: string; track: PlayerTrack } => entry.track !== null);

  const currentTrackId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playerIsPlaying = usePlayer((s) => s.isPlaying);

  function playFrom(itemId: string) {
    const index = queueEntries.findIndex((entry) => entry.itemId === itemId);
    if (index < 0) return;
    usePlayer.getState().playQueue(
      queueEntries.map((entry) => entry.track),
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

  async function runSearch() {
    const term = searchTerm.trim();
    if (!term || searchBusy || addMode === "library") return;
    setSearchBusy(true);
    setSearchError(null);
    setSearchResults(null);
    try {
      const endpoint = addMode === "apple" ? "/api/apple/search" : "/api/spotify/search";
      const res = await fetch(`${endpoint}?q=${encodeURIComponent(term)}`);
      const body = (await res.json().catch(() => null)) as
        | { tracks?: ExternalSearchResult[]; error?: string }
        | null;
      if (!res.ok) {
        setSearchError(body?.error ?? "検索に失敗しました");
        setSearchResults([]);
        return;
      }
      setSearchResults(body?.tracks ?? []);
    } catch {
      setSearchError("検索に失敗しました");
      setSearchResults([]);
    } finally {
      setSearchBusy(false);
    }
  }

  async function addExternal(kind: "apple" | "spotify", externalId: string) {
    setAddingId(externalId);
    setSearchError(null);
    try {
      const res = await fetch(`/api/playlists/${data.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ external: [{ kind, externalId }] }),
      });
      if (res.ok) {
        setSearchResults((prev) =>
          prev ? prev.filter((result) => result.externalId !== externalId) : prev,
        );
        router.refresh();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setSearchError(body?.error ?? "追加に失敗しました");
      }
    } finally {
      setAddingId(null);
    }
  }

  async function deletePlaylist() {
    const confirmed = await confirmDialog({
      title: `「${data.title}」を削除しますか？`,
      description: "元に戻せません。",
      confirmLabel: "削除",
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await fetch(`/api/playlists/${data.id}`, { method: "DELETE" });
      router.push("/home?tab=playlists");
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
                  if (queueEntries[0]) playFrom(queueEntries[0].itemId);
                }}
                disabled={queueEntries.length === 0}
              >
                <Play className="size-3.5" />
                再生
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (queueEntries.length > 0) {
                    usePlayer.getState().playQueueShuffled(queueEntries.map((entry) => entry.track));
                  }
                }}
                disabled={queueEntries.length === 0}
              >
                <Shuffle className="size-3.5" />
                シャッフル
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
              <QrShareButton path={`/p/${data.id}`} title={data.title} />
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
            <div className="flex gap-1">
              {(["library", "apple", "spotify"] as AddMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setAddMode(mode);
                    setSearchResults(null);
                    setSearchError(null);
                  }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold",
                    addMode === mode
                      ? "bg-rainbow text-dopa-950"
                      : "text-zinc-300 hover:bg-dopa-800",
                  )}
                >
                  {mode === "library"
                    ? "ライブラリ"
                    : mode === "apple"
                      ? "Apple Music"
                      : "Spotify"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="text-xs text-zinc-400 underline underline-offset-2"
            >
              閉じる
            </button>
          </div>

          {addMode === "library" ? (
            options === null ? (
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
                        <span className="max-w-40 shrink-0 truncate text-xs text-zinc-500">
                          {option.artist ?? ""}
                          {option.ownerName ? ` ・ ${option.ownerName}さん` : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  size="sm"
                  onClick={addSelected}
                  disabled={selected.size === 0 || busy}
                >
                  追加（{selected.size}件）
                </Button>
              </>
            )
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runSearch();
                  }}
                  placeholder="曲名・アーティストで検索"
                  className="h-9 flex-1 rounded-xl border border-dopa-700 bg-dopa-950 px-3 text-sm outline-none focus:border-accent"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={runSearch}
                  disabled={!searchTerm.trim() || searchBusy}
                >
                  <Search className="size-3.5" />
                  {searchBusy ? "検索中…" : "検索"}
                </Button>
              </div>

              {addMode === "spotify" ? (
                <p className="text-[11px] text-zinc-500">
                  Spotifyは
                  <a
                    href="/settings"
                    className="text-accent underline underline-offset-2"
                  >
                    設定
                  </a>
                  から連携が必要です（再生はSpotifyアプリで行います）
                </p>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  30秒の試聴が再生できます（フル再生は「アプリで開く」からApple Musicで）
                </p>
              )}

              {searchError ? <p className="text-xs text-red-400">{searchError}</p> : null}

              {searchResults !== null ? (
                searchResults.length === 0 ? (
                  <p className="text-xs text-zinc-500">見つかりませんでした</p>
                ) : (
                  <ul className="max-h-72 space-y-1 overflow-y-auto">
                    {searchResults.map((result) => (
                      <li
                        key={result.externalId}
                        className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-dopa-800"
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dopa-800">
                          {result.artworkUrl ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={result.artworkUrl}
                              alt=""
                              className="size-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <Music2 className="size-4 text-zinc-500" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{result.title}</p>
                          <p className="truncate text-xs text-zinc-500">{result.artist}</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            addExternal(addMode as "apple" | "spotify", result.externalId)
                          }
                          disabled={addingId === result.externalId}
                        >
                          <Plus className="size-3.5" />
                          {addingId === result.externalId ? "追加中…" : "追加"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-6 py-12 text-center">
          <ClipboardList className="size-7 text-zinc-500" />
          <p className="text-sm text-zinc-400">
            「曲を追加」からライブラリやApple Musicの曲を追加しよう
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 pb-8">
          {data.items.map((item, position) => {
            const mapped = toPlayerTrack(item);
            const playable = mapped !== null;
            const isCurrent = mapped !== null && currentTrackId === mapped.id;
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
                  disabled={!playable}
                  className={cn(
                    "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg",
                    playable ? "bg-dopa-800 hover:ring-2 hover:ring-accent" : "bg-dopa-800/50",
                  )}
                  aria-label="再生"
                >
                  {item.kind === "upload" && item.hasArtwork && item.trackId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/tracks/${item.trackId}/artwork`}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : item.kind !== "upload" && item.artworkUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={item.artworkUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Music2 className="size-4 text-zinc-500" />
                  )}
                  {isCurrent ? (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <NowPlayingIndicator playing={playerIsPlaying} />
                    </span>
                  ) : null}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">
                      {item.title ?? "不明なトラック"}
                    </p>
                    {item.kind !== "upload" ? (
                      <span className="shrink-0 rounded-full bg-dopa-800 px-2 py-0.5 text-[9px] font-bold text-zinc-300">
                        {KIND_LABELS[item.kind]}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-zinc-400">
                    {item.artist ?? "アーティスト不明"} ・ {formatDuration(item.durationSec)}
                    {item.kind === "apple" && item.previewUrl ? " ・ 試聴" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {item.kind === "upload" && item.ownerId ? (
                    <Link
                      href={item.ownerId === currentUserId ? "/home" : `/u/${item.ownerId}`}
                      className="flex size-8 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-zinc-200"
                      aria-label="ライブラリへ"
                      title="ライブラリへ"
                    >
                      <Library className="size-3.5" />
                    </Link>
                  ) : null}
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
