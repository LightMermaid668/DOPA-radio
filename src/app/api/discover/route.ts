import { NextResponse } from "next/server";

import { getDiscoverData } from "@/lib/discover";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  try {
    const data = await getDiscoverData(session?.user ?? null);
    return NextResponse.json(data);
  } catch (error) {
    console.warn("[discover] failed:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}
