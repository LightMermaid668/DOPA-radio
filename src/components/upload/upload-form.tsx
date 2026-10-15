"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, UploadCloud } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FileStatus = "queued" | "uploading" | "done" | "error";

type FileEntry = {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  error?: string;
};

const ACCEPT = ".mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.webm";
const MAX_SIZE = 100 * 1024 * 1024;

function putWithProgress(
  url: string,
  contentType: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`アップロード失敗 (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("通信エラーが発生しました"));
    xhr.send(file);
  });
}

export function UploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const entries: FileEntry[] = Array.from(list).map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: file.size > MAX_SIZE ? "error" : "queued",
      progress: 0,
      error: file.size > MAX_SIZE ? "100MB を超えています" : undefined,
    }));
    setFiles((prev) => [...prev, ...entries]);
  }, []);

  function updateEntry(id: string, patch: Partial<FileEntry>) {
    setFiles((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  async function uploadOne(entry: FileEntry) {
    updateEntry(entry.id, { status: "uploading", progress: 0, error: undefined });
    try {
      const presignRes = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: entry.file.name,
          size: entry.file.size,
          rightsConfirmed: true,
        }),
      });
      const presignData = (await presignRes.json().catch(() => null)) as
        | { trackId: string; uploadUrl: string; contentType: string; error?: string }
        | null;
      if (!presignRes.ok || !presignData?.uploadUrl) {
        throw new Error(presignData?.error ?? "アップロード準備に失敗しました");
      }

      await putWithProgress(presignData.uploadUrl, presignData.contentType, entry.file, (p) =>
        updateEntry(entry.id, { progress: p }),
      );

      const commitRes = await fetch(`/api/tracks/${presignData.trackId}/commit`, {
        method: "POST",
      });
      const commitData = (await commitRes.json().catch(() => null)) as { error?: string } | null;
      if (!commitRes.ok) {
        throw new Error(commitData?.error ?? "変換の開始に失敗しました");
      }

      updateEntry(entry.id, { status: "done", progress: 1 });
    } catch (error) {
      updateEntry(entry.id, {
        status: "error",
        error: error instanceof Error ? error.message : "アップロードに失敗しました",
      });
    }
  }

  async function startUpload() {
    if (!rightsConfirmed || busy) return;
    setBusy(true);
    for (const entry of files) {
      if (entry.status === "queued") {
        await uploadOne(entry);
      }
    }
    setBusy(false);
  }

  const queuedCount = files.filter((entry) => entry.status === "queued").length;
  const doneCount = files.filter((entry) => entry.status === "done").length;

  return (
    <div className="flex flex-col gap-6">
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 p-4">
        <input
          type="checkbox"
          checked={rightsConfirmed}
          onChange={(e) => setRightsConfirmed(e.target.checked)}
          className="mt-0.5 size-4 accent-amber-500"
        />
        <span className="text-sm leading-relaxed text-zinc-300">
          アップロードする音源について、自分が権利を持っているか、権利者から許諾を得ていることを確認しました。
          <span className="mt-1 block text-xs text-zinc-500">
            市販の楽曲はアップロードできません。プレイリストには Apple
            Music・Spotify 連携で追加してください（フェーズ3で実装）。
          </span>
        </span>
      </label>

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragOver
            ? "border-accent bg-dopa-900"
            : "border-dopa-700 bg-dopa-900/50 hover:border-dopa-700 hover:bg-dopa-900",
        )}
      >
        <UploadCloud className="size-7 text-zinc-500" aria-hidden />
        <p className="text-sm font-semibold">タップしてファイルを選択（複数OK）</p>
        <p className="text-xs text-zinc-500">
          mp3 / m4a / aac / wav / flac / ogg・1ファイル 100MB まで
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {files.map((entry) => (
            <li
              key={entry.id}
              className="rounded-xl border border-dopa-800 bg-dopa-900 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm">{entry.file.name}</span>
                <span className="shrink-0 text-xs">
                  {entry.status === "queued" ? (
                    <span className="text-zinc-500">待機中</span>
                  ) : entry.status === "uploading" ? (
                    <span className="text-zinc-300">アップロード中 {Math.round(entry.progress * 100)}%</span>
                  ) : entry.status === "done" ? (
                    <span className="font-semibold text-accent">変換中…</span>
                  ) : (
                    <span className="text-red-400">{entry.error ?? "エラー"}</span>
                  )}
                </span>
              </div>
              {entry.status === "uploading" ? (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-dopa-800">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${Math.round(entry.progress * 100)}%` }}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="button" size="lg" onClick={startUpload} disabled={!rightsConfirmed || busy || queuedCount === 0}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? "アップロード中…" : `アップロードする${queuedCount > 0 ? `（${queuedCount}件）` : ""}`}
        </Button>
        {doneCount > 0 ? (
          <Link href="/library" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            ライブラリへ
          </Link>
        ) : null}
      </div>

      {doneCount > 0 ? (
        <p className="text-xs text-zinc-500">
          変換が終わるとライブラリから再生できるようになります（曲の長さによっては数分かかります）。
        </p>
      ) : null}
    </div>
  );
}
