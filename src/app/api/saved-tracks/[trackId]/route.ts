import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { savedTracks } from "@/db/schema";
import { getSession } from "@/lib/session";

type PatchBody = { pinned?: boolean };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (typeof body?.pinned !== "boolean") {
    return NextResponse.json({ error: "pinned が必要です" }, { status: 400 });
  }

  const { trackId } = await params;
  const updated = await db
    .update(savedTracks)
    .set({ pinnedAt: body.pinned ? new Date() : null })
    .where(and(eq(savedTracks.userId, session.user.id), eq(savedTracks.trackId, trackId)))
    .returning({ id: savedTracks.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: "保存した曲が見つかりません" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ trackId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { trackId } = await params;
  await db
    .delete(savedTracks)
    .where(and(eq(savedTracks.userId, session.user.id), eq(savedTracks.trackId, trackId)));

  return NextResponse.json({ ok: true });
}
