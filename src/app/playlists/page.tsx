import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { ListMusic } from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { CreatePlaylistForm } from "@/components/playlists/create-playlist-form";
import { buttonVariants } from "@/components/ui/button";
import { db } from "@/db";
import { playlistItems, playlists } from "@/db/schema";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "プレイリスト" };
export const dynamic = "force-dynamic";

const VISIBILITY_LABELS: Record<string, string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

export default async function PlaylistsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/playlists");

  const rows = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      description: playlists.description,
      visibility: playlists.visibility,
      updatedAt: playlists.updatedAt,
      itemCount: count(playlistItems.id),
    })
    .from(playlists)
    .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.ownerId, session.user.id))
    .groupBy(playlists.id)
    .orderBy(desc(playlists.updatedAt));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-black tracking-tight">
          DOPA<span className="text-accent">-radio</span>
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/library"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            ライブラリ
          </Link>
          <SignOutButton />
        </div>
      </header>

      <section className="pb-6">
        <h1 className="mb-4 text-2xl font-black">プレイリスト</h1>
        <CreatePlaylistForm />
      </section>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-6 py-14 text-center">
          <ListMusic className="size-7 text-zinc-500" aria-hidden />
          <p className="text-sm text-zinc-400">プレイリストを作って仲間に共有しよう</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2 pb-16">
          {rows.map((playlist) => (
            <li key={playlist.id}>
              <Link
                href={`/playlists/${playlist.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-5 py-4 hover:border-dopa-700"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold">{playlist.title}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {VISIBILITY_LABELS[playlist.visibility] ?? playlist.visibility} ・{" "}
                    {Number(playlist.itemCount)}曲
                  </p>
                </div>
                <span className="shrink-0 text-xs text-zinc-500">編集 →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
