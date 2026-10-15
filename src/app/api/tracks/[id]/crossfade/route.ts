import { NextResponse } from "next/server";

import { presignGet } from "@/lib/s3";
import { getSession } from "@/lib/session";
import { findAccessibleTrack } from "@/lib/tracks";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const { id } = await params;
  const track = await findAccessibleTrack(id, session.user.id);
  if (!track || track.status !== "ready" || !track.crossfadeKey) {
    return NextResponse.json({ error: "クロスフェード音源がありません" }, { status: 404 });
  }

  return NextResponse.redirect(await presignGet(track.crossfadeKey), 302);
}
