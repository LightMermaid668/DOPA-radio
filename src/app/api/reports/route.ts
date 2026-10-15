import { NextResponse } from "next/server";

import { db } from "@/db";
import { reports } from "@/db/schema";
import { getSession } from "@/lib/session";

const ALLOWED_REASONS = ["copyright", "inappropriate", "spam", "other"] as const;
const ALLOWED_TARGETS = ["track", "playlist"] as const;

type ReportBody = {
  targetType?: string;
  targetId?: string;
  reason?: string;
  detail?: string;
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ReportBody | null;
  const targetType = body?.targetType;
  const targetId = body?.targetId;
  const reason = body?.reason;

  if (!targetType || !ALLOWED_TARGETS.includes(targetType as (typeof ALLOWED_TARGETS)[number])) {
    return NextResponse.json({ error: "通報対象が不正です" }, { status: 400 });
  }
  if (!targetId || typeof targetId !== "string") {
    return NextResponse.json({ error: "通報対象が不正です" }, { status: 400 });
  }
  if (!reason || !ALLOWED_REASONS.includes(reason as (typeof ALLOWED_REASONS)[number])) {
    return NextResponse.json({ error: "理由を選択してください" }, { status: 400 });
  }

  await db.insert(reports).values({
    targetType,
    targetId,
    reporterId: session.user.id,
    reason,
    detail: body?.detail?.trim().slice(0, 500) || null,
  });

  return NextResponse.json({ ok: true });
}
