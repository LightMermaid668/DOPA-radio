import { NextResponse } from "next/server";

import { searchAppleTracks } from "@/lib/apple";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const term = new URL(request.url).searchParams.get("q")?.trim();
  if (!term) {
    return NextResponse.json({ tracks: [] });
  }

  try {
    const tracks = await searchAppleTracks(term);
    return NextResponse.json({ tracks });
  } catch (error) {
    console.warn("[apple] search failed:", error);
    return NextResponse.json({ error: "検索に失敗しました" }, { status: 502 });
  }
}
