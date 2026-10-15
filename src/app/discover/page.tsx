import type { Metadata } from "next";
import { headers } from "next/headers";

import { AppHeader } from "@/components/app-header";
import { DiscoverView } from "@/components/discover/discover-view";
import { auth } from "@/lib/auth";
import { getDiscoverData } from "@/lib/discover";

export const metadata: Metadata = { title: "ディスカバー" };
export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const discover = await getDiscoverData(session?.user ?? null);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6">
      <AppHeader />
      <section className="pb-6">
        <h1 className="text-2xl font-black">ディスカバー</h1>
        <p className="mt-1 text-sm text-zinc-400">
          みんなが公開している曲とプレイリスト
        </p>
      </section>
      <DiscoverView
        tracks={discover.tracks}
        playlists={discover.playlists}
        loggedIn={Boolean(session)}
      />
    </main>
  );
}
