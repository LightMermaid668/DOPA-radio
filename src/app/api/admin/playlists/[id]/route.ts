import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { playlists } from "@/db/schema";
import { getAdminSession } from "@/lib/admin";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { visibility?: string } | null;
  if (body?.visibility !== "private") {
    return NextResponse.json({ error: "visibility=private のみ対応" }, { status: 400 });
  }

  await db
    .update(playlists)
    .set({ visibility: "private", updatedAt: new Date() })
    .where(eq(playlists.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const { id } = await params;
  await db.delete(playlists).where(eq(playlists.id, id));

  return NextResponse.json({ ok: true });
}
