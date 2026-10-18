import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { playlistItems, playlists, tracks, visibilityEnum } from "@/db/schema";
import { getSession } from "@/lib/session";

type Visibility = (typeof visibilityEnum.enumValues)[number];

async function getOwnedPlaylist(playlistId: string, userId: string) {
  return db.query.playlists.findFirst({
    where: and(eq(playlists.id, playlistId), eq(playlists.ownerId, userId)),
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const playlist = await getOwnedPlaylist(id, session.user.id);
  if (!playlist) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  const items = await db
    .select({
      id: playlistItems.id,
      position: playlistItems.position,
      kind: playlistItems.kind,
      trackId: playlistItems.trackId,
      externalMeta: playlistItems.externalMeta,
      title: tracks.title,
      artist: tracks.artist,
      durationSec: tracks.durationSec,
      status: tracks.status,
      artworkKey: tracks.artworkKey,
      chorusStartSec: tracks.chorusStartSec,
      chorusEndSec: tracks.chorusEndSec,
    })
    .from(playlistItems)
    .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .where(eq(playlistItems.playlistId, id))
    .orderBy(asc(playlistItems.position));

  return NextResponse.json({ playlist, items });
}

type PatchBody = {
  title?: string;
  description?: string | null;
  visibility?: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const playlist = await getOwnedPlaylist(id, session.user.id);
  if (!playlist) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }

  const patch: Partial<typeof playlists.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim().slice(0, 200);
  }
  if (body.description !== undefined) {
    patch.description = body.description?.trim().slice(0, 500) || null;
  }
  if (body.visibility !== undefined) {
    if (!visibilityEnum.enumValues.includes(body.visibility as Visibility)) {
      return NextResponse.json({ error: "公開範囲が不正です" }, { status: 400 });
    }
    patch.visibility = body.visibility as Visibility;
  }

  await db.update(playlists).set(patch).where(eq(playlists.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const playlist = await getOwnedPlaylist(id, session.user.id);
  if (!playlist) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  await db.delete(playlists).where(eq(playlists.id, id));

  return NextResponse.json({ ok: true });
}
