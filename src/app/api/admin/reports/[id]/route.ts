import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { reports } from "@/db/schema";
import { getAdminSession } from "@/lib/admin";

const STATUSES = ["open", "resolved", "dismissed"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { status?: string } | null;
  const status = body?.status;
  if (!status || !STATUSES.includes(status as (typeof STATUSES)[number])) {
    return NextResponse.json({ error: "ステータスが不正です" }, { status: 400 });
  }

  await db
    .update(reports)
    .set({ status, handledBy: session.user.id })
    .where(eq(reports.id, id));

  return NextResponse.json({ ok: true });
}
