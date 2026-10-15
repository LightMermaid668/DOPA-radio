import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { tracks, visibilityEnum } from "@/db/schema";
import { getSession } from "@/lib/session";
import { deleteTrackStorage } from "@/lib/tracks";

type Visibility = (typeof visibilityEnum.enumValues)[number];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, id) });
  if (!track) {
    return NextResponse.json({ error: "トラックが見つかりません" }, { status: 404 });
  }
  if (track.visibility === "private" && track.ownerId !== session.user.id) {
    return NextResponse.json({ error: "トラックが見つかりません" }, { status: 404 });
  }

  return NextResponse.json({
    track: {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      genre: track.genre,
      durationSec: track.durationSec,
      status: track.status,
      visibility: track.visibility,
      hasArtwork: Boolean(track.artworkKey),
      playCount: track.playCount,
      createdAt: track.createdAt,
    },
  });
}

type PatchBody = {
  title?: string;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  visibility?: string;
  pinned?: boolean;
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
  const track = await db.query.tracks.findFirst({
    where: and(eq(tracks.id, id), eq(tracks.ownerId, session.user.id)),
  });
  if (!track) {
    return NextResponse.json({ error: "トラックが見つかりません" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) {
    return NextResponse.json({ error: "入力が不正です" }, { status: 400 });
  }

  const patch: Partial<typeof tracks.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim().slice(0, 200);
  }
  if (body.artist !== undefined) patch.artist = body.artist?.trim().slice(0, 200) || null;
  if (body.album !== undefined) patch.album = body.album?.trim().slice(0, 200) || null;
  if (body.genre !== undefined) patch.genre = body.genre?.trim().slice(0, 100) || null;
  if (body.visibility !== undefined) {
    if (!visibilityEnum.enumValues.includes(body.visibility as Visibility)) {
      return NextResponse.json({ error: "公開範囲が不正です" }, { status: 400 });
    }
    patch.visibility = body.visibility as Visibility;
  }
  if (typeof body.pinned === "boolean") {
    patch.pinnedAt = body.pinned ? new Date() : null;
  }

  await db.update(tracks).set(patch).where(eq(tracks.id, id));

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
  const track = await db.query.tracks.findFirst({
    where: and(eq(tracks.id, id), eq(tracks.ownerId, session.user.id)),
  });
  if (!track) {
    return NextResponse.json({ error: "トラックが見つかりません" }, { status: 404 });
  }

  await db.delete(tracks).where(eq(tracks.id, id));
  await deleteTrackStorage(track);

  return NextResponse.json({ ok: true });
}
