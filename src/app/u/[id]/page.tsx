import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ListMusic, Music2 } from "lucide-react";

import { Logo } from "@/components/logo";
import { PublicPlayButton, type PublicTrack } from "@/components/playlists/public-play-button";
import { SaveTrackButton } from "@/components/playlists/save-track-button";
import { QrShareButton } from "@/components/share/qr-share-button";
import { db } from "@/db";
import { user as userTable } from "@/db/auth-schema";
import { playlists, savedTracks, tracks } from "@/db/schema";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function getOwner(id: string) {
  return db.query.user.findFirst({ where: eq(userTable.id, id) });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const owner = await getOwner(id);
  if (!owner) return { title: "DOPA-radio" };
  return {
    title: `${owner.name} のライブラリ`,
    description: `${owner.name} さんが公開している曲`,
    openGraph: {
      title: `${owner.name} のライブラリ | DOPA-radio`,
      url: `/u/${owner.id}`,
    },
  };
}

function formatDuration(sec: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const owner = await getOwner(id);
  if (!owner) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  const isOwn = session?.user.id === owner.id;

  const trackRows = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      durationSec: tracks.durationSec,
      artworkKey: tracks.artworkKey,
      playCount: tracks.playCount,
    })
    .from(tracks)
    .where(
      and(
        eq(tracks.ownerId, owner.id),
        eq(tracks.visibility, "public"),
        eq(tracks.status, "ready"),
      ),
    )
    .orderBy(desc(tracks.createdAt))
    .limit(200);

  const savedIds = new Set<string>();
  if (session?.user && trackRows.length > 0) {
    const saved = await db
      .select({ trackId: savedTracks.trackId })
      .from(savedTracks)
      .where(
        and(
          eq(savedTracks.userId, session.user.id),
          inArray(
            savedTracks.trackId,
            trackRows.map((row) => row.id),
          ),
        ),
      );
    for (const row of saved) savedIds.add(row.trackId);
  }

  const playableTracks: PublicTrack[] = trackRows.map((row) => ({
    id: row.id,
    kind: "upload" as const,
    title: row.title,
    artist: row.artist,
    durationSec: row.durationSec,
    artworkUrl: row.artworkKey ? `/api/tracks/${row.id}/artwork` : null,
  }));

  const ownerPlaylists = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      visibility: playlists.visibility,
    })
    .from(playlists)
    .where(and(eq(playlists.ownerId, owner.id), eq(playlists.visibility, "public")))
    .orderBy(desc(playlists.updatedAt))
    .limit(30);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/">
          <Logo />
        </Link>
        <QrShareButton path={`/u/${owner.id}`} title={`${owner.name} のライブラリ`} />
      </header>

      <section className="flex flex-col gap-4 pb-8">
        <div className="flex items-center gap-4">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-dopa-800 text-2xl font-black text-rainbow">
            {(owner.name ?? "?").slice(0, 1)}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-zinc-500">公開ライブラリ</p>
            <h1 className="text-2xl font-black">{owner.name}</h1>
            <p className="mt-1 text-xs text-zinc-500">{playableTracks.length}曲</p>
          </div>
        </div>

        {isOwn ? (
          <p className="text-xs text-zinc-500">
            これはあなたの公開ライブラリです（公開設定の曲だけが表示されます）
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <PublicPlayButton redirectTo={`/u/${owner.id}`} tracks={playableTracks} />
        </div>
      </section>

      {ownerPlaylists.length > 0 ? (
        <section className="pb-6">
          <h2 className="mb-2 text-sm font-bold text-zinc-300">公開プレイリスト</h2>
          <ul className="flex flex-col gap-2">
            {ownerPlaylists.map((playlist) => (
              <li key={playlist.id}>
                <Link
                  href={`/p/${playlist.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3 hover:border-dopa-700"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-dopa-800">
                    <ListMusic className="size-4 text-accent" />
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {playlist.title}
                  </p>
                  <span className="shrink-0 text-xs text-zinc-500">開く →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="pb-16">
        <h2 className="mb-2 text-sm font-bold text-zinc-300">曲</h2>
        {trackRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-4 py-6 text-center text-xs text-zinc-500">
            公開されている曲がありません
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {trackRows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-4 py-3"
              >
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-dopa-800">
                  {row.artworkKey ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/tracks/${row.id}/artwork`}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <Music2 className="size-4 text-zinc-500" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.title}</p>
                  <p className="truncate text-xs text-zinc-400">
                    {row.artist ?? "アーティスト不明"}
                    {row.playCount > 0 ? ` ・ ${row.playCount}回再生` : ""}
                  </p>
                </div>
                {session && !isOwn ? (
                  <SaveTrackButton trackId={row.id} initialSaved={savedIds.has(row.id)} />
                ) : null}
                <span className="shrink-0 text-xs text-zinc-500">
                  {formatDuration(row.durationSec)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
