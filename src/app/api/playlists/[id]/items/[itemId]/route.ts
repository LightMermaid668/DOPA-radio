import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { playlistItems, playlists } from "@/db/schema";
import { getSession } from "@/lib/session";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id, itemId } = await params;
  const playlist = await db.query.playlists.findFirst({
    where: and(eq(playlists.id, id), eq(playlists.ownerId, session.user.id)),
  });
  if (!playlist) {
    return NextResponse.json({ error: "プレイリストが見つかりません" }, { status: 404 });
  }

  await db
    .delete(playlistItems)
    .where(and(eq(playlistItems.id, itemId), eq(playlistItems.playlistId, id)));

  await db.update(playlists).set({ updatedAt: new Date() }).where(eq(playlists.id, id));

  return NextResponse.json({ ok: true });
}
