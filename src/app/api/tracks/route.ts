import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { user as userTable } from "@/db/auth-schema";
import { savedTracks, tracks, visibilityEnum } from "@/db/schema";
import { getSession } from "@/lib/session";

type Visibility = (typeof visibilityEnum.enumValues)[number];

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const includeSaved = new URL(request.url).searchParams.get("include") === "saved";

  const rows = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      album: tracks.album,
      genre: tracks.genre,
      durationSec: tracks.durationSec,
      status: tracks.status,
      visibility: tracks.visibility,
      playCount: tracks.playCount,
      pinnedAt: tracks.pinnedAt,
      chorusStartSec: tracks.chorusStartSec,
      chorusEndSec: tracks.chorusEndSec,
      artworkKey: tracks.artworkKey,
      createdAt: tracks.createdAt,
    })
    .from(tracks)
    .where(eq(tracks.ownerId, session.user.id))
    .orderBy(desc(tracks.createdAt));

  if (!includeSaved) {
    return NextResponse.json({
      tracks: rows.map((row) => ({
        ...row,
        hasArtwork: Boolean(row.artworkKey),
        own: true,
        ownerName: null,
      })),
    });
  }

  const savedRows = await db
    .select({
      id: tracks.id,
      title: tracks.title,
      artist: tracks.artist,
      album: tracks.album,
      genre: tracks.genre,
      durationSec: tracks.durationSec,
      status: tracks.status,
      visibility: tracks.visibility,
      playCount: tracks.playCount,
      createdAt: savedTracks.createdAt,
      ownerName: userTable.name,
    })
    .from(savedTracks)
    .innerJoin(tracks, eq(savedTracks.trackId, tracks.id))
    .leftJoin(userTable, eq(tracks.ownerId, userTable.id))
    .where(eq(savedTracks.userId, session.user.id))
    .orderBy(desc(savedTracks.createdAt));

  return NextResponse.json({
    tracks: [
      ...rows.map((row) => ({
        ...row,
        hasArtwork: Boolean(row.artworkKey),
        own: true,
        ownerName: null,
      })),
      ...savedRows.map((row) => ({ ...row, own: false, ownerName: row.ownerName ?? null })),
    ],
  });
}

type BulkPatchBody = {
  ids?: string[];
  visibility?: string;
};

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as BulkPatchBody | null;
  if (!body?.ids?.length || body.ids.length > 500) {
    return NextResponse.json({ error: "対象が指定されていません" }, { status: 400 });
  }
  if (!visibilityEnum.enumValues.includes(body.visibility as Visibility)) {
    return NextResponse.json({ error: "公開範囲が不正です" }, { status: 400 });
  }

  await db
    .update(tracks)
    .set({ visibility: body.visibility as Visibility, updatedAt: new Date() })
    .where(and(eq(tracks.ownerId, session.user.id), inArray(tracks.id, body.ids)));

  return NextResponse.json({ ok: true });
}
