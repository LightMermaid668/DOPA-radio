import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { savedTracks } from "@/db/schema";
import { getSession } from "@/lib/session";

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
