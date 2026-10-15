import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ListMusic, UploadCloud } from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "ライブラリ" };
export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/library");

  const { user } = session;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-black tracking-tight">
          DOPA<span className="text-accent">-radio</span>
        </span>
        <div className="flex items-center gap-4">
          <span className="text-xs text-zinc-400">{user.name}</span>
          <SignOutButton />
        </div>
      </header>

      <section className="py-10">
        <h1 className="mb-2 text-2xl font-black">ようこそ、{user.name} さん</h1>
        <p className="text-sm text-zinc-400">
          フェーズ0が完了しました。ここからアップロードとプレイリスト機能を載せていきます。
        </p>
      </section>

      <section className="grid gap-4 pb-16 sm:grid-cols-2">
        <div className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 p-6">
          <UploadCloud className="mb-3 size-6 text-zinc-500" aria-hidden />
          <h2 className="mb-1 font-bold text-zinc-300">アップロード</h2>
          <p className="text-xs text-zinc-500">フェーズ1で実装（HLS変換・権利確認つき）</p>
        </div>
        <div className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 p-6">
          <ListMusic className="mb-3 size-6 text-zinc-500" aria-hidden />
          <h2 className="mb-1 font-bold text-zinc-300">プレイリスト</h2>
          <p className="text-xs text-zinc-500">フェーズ2で実装（公開・共有・並び替え）</p>
        </div>
      </section>
    </main>
  );
}
