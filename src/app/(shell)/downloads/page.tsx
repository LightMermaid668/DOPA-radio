import type { Metadata } from "next";

import { DownloadsView } from "@/components/desktop/downloads-view";

export const metadata: Metadata = { title: "ダウンロード済み" };
export const dynamic = "force-dynamic";

export default function DownloadsPage() {
  return (
    <div className="flex flex-col gap-5">
      <section className="pb-2">
        <h1 className="text-2xl font-black">ダウンロード済み</h1>
        <p className="mt-1 text-sm text-zinc-400">
          デスクトップアプリに保存した曲。アプリ内でそのまま再生できます。
        </p>
      </section>
      <DownloadsView />
    </div>
  );
}
