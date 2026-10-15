import { NextResponse } from "next/server";
import { and, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { playlistItems, playlists, savedTracks, tracks } from "@/db/schema";
import { lookupAppleTrack } from "@/lib/apple";
import { getSession } from "@/lib/session";
import { getSpotifyAccessToken, lookupSpotifyTrack } from "@/lib/spotify";

async function getOwnedPlaylistId(playlistId: string, userId: string) {
  const playlist = await db.query.playlists.findFirst({
    where: and(eq(playlists.id, playlistId), eq(playlists.ownerId, userId)),
  });
  return playlist?.id ?? null;
}

type ExternalRequest = { kind: string; externalId: string };
type AddBody = { trackIds?: string[]; external?: ExternalRequest[] };
type ReorderBody = { itemIds?: string[] };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const ownedId = await getOwnedPlaylistId(id, session.user.id);
  if (!ownedId) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as AddBody | null;
  const trackIds = (body?.trackIds ?? []).filter((trackId) => typeof trackId === "string");
  const externalRequests = (body?.external ?? []).filter(
    (item) =>
      item &&
      typeof item.externalId === "string" &&
      (item.kind === "apple" || item.kind === "spotify"),
  );

  if (trackIds.length > 100 || externalRequests.length > 50) {
    return NextResponse.json({ error: "一度に追加できる数を超えています" }, { status: 400 });
  }
  if (trackIds.length === 0 && externalRequests.length === 0) {
    return NextResponse.json({ error: "追加する曲を指定してください" }, { status: 400 });
  }

  type NewItem = {
    kind: "upload" | "apple" | "spotify";
    trackId: string | null;
    externalId: string | null;
    externalMeta: Record<string, unknown> | null;
  };

  const newItems: NewItem[] = [];

  if (trackIds.length > 0) {
    // 自分の曲に加えて、保存した曲（他人の公開曲）も追加できる
    const savedTrackIds = db
      .select({ trackId: savedTracks.trackId })
      .from(savedTracks)
      .where(eq(savedTracks.userId, session.user.id));
    const addableTracks = await db
      .select({ id: tracks.id })
      .from(tracks)
      .where(
        and(
          eq(tracks.status, "ready"),
          inArray(tracks.id, trackIds),
          or(eq(tracks.ownerId, session.user.id), inArray(tracks.id, savedTrackIds)),
        ),
      );
    const addableIds = new Set(addableTracks.map((row) => row.id));
    for (const trackId of trackIds) {
      if (!addableIds.has(trackId)) continue;
      newItems.push({ kind: "upload", trackId, externalId: null, externalMeta: null });
    }
  }

  for (const external of externalRequests) {
    if (external.kind === "apple") {
      const track = await lookupAppleTrack(external.externalId);
      if (!track) continue;
      newItems.push({
        kind: "apple",
        trackId: null,
        externalId: track.externalId,
        externalMeta: {
          title: track.title,
          artist: track.artist,
          album: track.album,
          artworkUrl: track.artworkUrl,
          deepLink: track.deepLink,
          previewUrl: track.previewUrl,
          durationMs: track.durationMs,
        },
      });
    } else if (external.kind === "spotify") {
      const token = await getSpotifyAccessToken(session.user.id);
      if (!token) {
        return NextResponse.json(
          { error: "Spotifyと連携してから追加してください" },
          { status: 400 },
        );
      }
      const track = await lookupSpotifyTrack(token, external.externalId);
      if (!track) continue;
      newItems.push({
        kind: "spotify",
        trackId: null,
        externalId: track.externalId,
        externalMeta: {
          title: track.title,
          artist: track.artist,
          album: track.album,
          artworkUrl: track.artworkUrl,
          deepLink: track.deepLink,
          durationMs: track.durationMs,
          uri: track.uri ?? undefined,
        },
      });
    }
  }

  if (newItems.length === 0) {
    return NextResponse.json({ error: "追加できる曲がありません" }, { status: 400 });
  }

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${playlistItems.position}), 0)` })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, id));
  const basePosition = Number(maxRow?.max ?? 0);

  await db.insert(playlistItems).values(
    newItems.map((item, index) => ({
      playlistId: id,
      kind: item.kind,
      trackId: item.trackId,
      externalId: item.externalId,
      externalMeta: item.externalMeta,
      position: basePosition + index + 1,
      addedBy: session.user.id,
    })),
  );

  await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));

  return NextResponse.json({ ok: true, added: newItems.length });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const ownedId = await getOwnedPlaylistId(id, session.user.id);
  if (!ownedId) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as ReorderBody | null;
  const itemIds = body?.itemIds?.filter((itemId) => typeof itemId === "string");
  if (!itemIds?.length) {
    return NextResponse.json({ error: "並び順が不正です" }, { status: 400 });
  }

  const existing = await db
    .select({ id: playlistItems.id })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, id));
  const existingIds = new Set(existing.map((row) => row.id));
  const validOrder = itemIds.filter((itemId) => existingIds.has(itemId));
  if (validOrder.length !== existingIds.size) {
    return NextResponse.json({ error: "並び順が不正です" }, { status: 400 });
  }

  for (let index = 0; index < validOrder.length; index++) {
    await db
      .update(playlistItems)
      .set({ position: index + 1 })
      .where(and(eq(playlistItems.id, validOrder[index]), eq(playlistItems.playlistId, id)));
  }

  await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));

  return NextResponse.json({ ok: true });
}
