import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { integrations } from "@/db/schema";
import { getSession } from "@/lib/session";
import { disconnectSpotify, spotifyConfigured } from "@/lib/spotify";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const row = await db.query.integrations.findFirst({
    where: and(eq(integrations.userId, session.user.id), eq(integrations.provider, "spotify")),
  });

  return NextResponse.json({
    configured: spotifyConfigured(),
    connected: Boolean(row),
    providerUserId: row?.providerUserId ?? null,
  });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  await disconnectSpotify(session.user.id);
  return NextResponse.json({ ok: true });
}
