import { NextResponse } from "next/server";
import { count, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { playlistItems, playlists, visibilityEnum } from "@/db/schema";
import { getSession } from "@/lib/session";

type Visibility = (typeof visibilityEnum.enumValues)[number];

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: playlists.id,
      title: playlists.title,
      description: playlists.description,
      visibility: playlists.visibility,
      createdAt: playlists.createdAt,
      updatedAt: playlists.updatedAt,
      itemCount: count(playlistItems.id),
    })
    .from(playlists)
    .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.ownerId, session.user.id))
    .groupBy(playlists.id)
    .orderBy(desc(playlists.updatedAt));

  return NextResponse.json({ playlists: rows });
}

type CreateBody = {
  title?: string;
  description?: string;
  visibility?: string;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateBody | null;
  const title = body?.title?.trim().slice(0, 200);
  if (!title) {
    return NextResponse.json({ error: "タイトルを入力してください" }, { status: 400 });
  }

  const visibility = visibilityEnum.enumValues.includes(body?.visibility as Visibility)
    ? (body?.visibility as Visibility)
    : "private";

  const [playlist] = await db
    .insert(playlists)
    .values({
      ownerId: session.user.id,
      title,
      description: body?.description?.trim().slice(0, 500) || null,
      visibility,
    })
    .returning({ id: playlists.id });

  return NextResponse.json({ id: playlist.id });
}
