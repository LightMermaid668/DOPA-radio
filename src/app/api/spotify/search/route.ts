import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { getSpotifyAccessToken, searchSpotifyTracks, spotifyConfigured } from "@/lib/spotify";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }
  if (!spotifyConfigured()) {
    return NextResponse.json({ error: "Spotify連携が設定されていません" }, { status: 400 });
  }

  const token = await getSpotifyAccessToken(session.user.id);
  if (!token) {
    return NextResponse.json({ error: "Spotifyと連携してください" }, { status: 400 });
  }

  const term = new URL(request.url).searchParams.get("q")?.trim();
  if (!term) {
    return NextResponse.json({ tracks: [] });
  }

  try {
    const tracks = await searchSpotifyTracks(token, term);
    return NextResponse.json({ tracks });
  } catch (error) {
    console.warn("[spotify] search failed:", error);
    return NextResponse.json({ error: "検索に失敗しました" }, { status: 502 });
  }
}
