import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { count, desc, eq } from "drizzle-orm";
import { ListMusic } from "lucide-react";

import { CreatePlaylistForm } from "@/components/playlists/create-playlist-form";
import { ImportPlaylistForm } from "@/components/playlists/import-playlist-form";
import { db } from "@/db";
import { playlistItems, playlists } from "@/db/schema";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "プレイリスト" };
export const dynamic = "force-dynamic";

const VISIBILITY_LABELS: Record<string, string> = {
  private: "非公開",
  unlisted: "限定公開",
  public: "公開",
};

export default async function PlaylistsPage() {
  const session = await getSession();
  if (!session) redirect("/login?redirect=/playlists");

  const rows = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      description: playlists.description,
      visibility: playlists.visibility,
      itemCount: count(playlistItems.id),
    })
    .from(playlists)
    .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.ownerId, session.user.id))
    .groupBy(playlists.id)
    .orderBy(desc(playlists.updatedAt));

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 pb-2">
        <h1 className="text-2xl font-black">プレイリスト</h1>
        <CreatePlaylistForm />
        <ImportPlaylistForm />
      </section>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-6 py-14 text-center">
          <ListMusic className="size-7 text-zinc-500" aria-hidden />
          <p className="text-sm text-zinc-400">プレイリストを作って仲間に共有しよう</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((playlist, index) => (
            <li
              key={playlist.id}
              className="animate-row"
              style={{ animationDelay: `${Math.min(index * 35, 280)}ms` }}
            >
              <Link
                href={`/playlists/${playlist.id}`}
                className="group flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-dopa-700 hover:shadow-lg hover:shadow-accent/5"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dopa-800 transition-transform duration-200 group-hover:scale-105">
                  <ListMusic className="size-4 text-accent" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{playlist.title}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {VISIBILITY_LABELS[playlist.visibility] ?? playlist.visibility} ・{" "}
                    {Number(playlist.itemCount)}曲
                  </p>
                </div>
                <span className="shrink-0 text-xs text-zinc-500 transition-transform duration-200 group-hover:translate-x-0.5">
                  編集 →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
