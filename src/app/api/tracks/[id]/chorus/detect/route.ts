import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { tracks } from "@/db/schema";
import { enqueueChorusDetection } from "@/lib/jobs";
import { getSession } from "@/lib/session";

export async function POST(
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
  if (!track || track.status !== "ready") {
    return NextResponse.json({ error: "曲が見つかりません" }, { status: 404 });
  }

  await db
    .update(tracks)
    .set({ chorusSource: null, chorusStartSec: null, chorusEndSec: null })
    .where(eq(tracks.id, id));
  await enqueueChorusDetection(id);

  return NextResponse.json({ ok: true });
}
