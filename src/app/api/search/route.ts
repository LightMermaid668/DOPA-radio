import { NextResponse } from "next/server";

import { searchContent, type SearchScope } from "@/lib/search";
import { getSession } from "@/lib/session";

export async function GET(request: Request) {
  const session = await getSession();
  const params = new URL(request.url).searchParams;
  const query = params.get("q") ?? "";
  const scope: SearchScope = params.get("scope") === "discover" ? "discover" : "library";

  if (scope === "library" && !session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  try {
    const results = await searchContent(session?.user.id ?? null, scope, query);
    return NextResponse.json(results);
  } catch (error) {
    console.warn("[search] failed:", error);
    return NextResponse.json({ error: "検索に失敗しました" }, { status: 500 });
  }
}
