import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { tracks } from "@/db/schema";
import { getAdminSession } from "@/lib/admin";
import { deleteTrackStorage } from "@/lib/tracks";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const { id } = await params;
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, id) });
  if (!track) {
    return NextResponse.json({ error: "曲が見つかりません" }, { status: 404 });
  }

  await db.delete(tracks).where(eq(tracks.id, id));
  await deleteTrackStorage(track);

  return NextResponse.json({ ok: true });
}
