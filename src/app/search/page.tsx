import type { Metadata } from "next";

import { AppHeader } from "@/components/app-header";
import { SearchView } from "@/components/search/search-view";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "検索" };
export const dynamic = "force-dynamic";

export default async function SearchPage() {
  const session = await getSession();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6">
      <AppHeader />
      <section className="pb-6">
        <h1 className="text-2xl font-black">検索</h1>
        <p className="mt-1 text-sm text-zinc-400">
          ライブラリ（自分の曲・保存した曲・自分のプレイリスト）か、ディスカバー（公開されている曲・プレイリスト）を選んで検索できます。
        </p>
      </section>
      <SearchView loggedIn={Boolean(session)} />
    </main>
  );
}
