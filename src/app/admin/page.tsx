import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { ShieldAlert } from "lucide-react";

import { AdminReportActions } from "@/components/admin/admin-report-actions";
import { AppHeader } from "@/components/app-header";
import { db } from "@/db";
import { user as userTable } from "@/db/auth-schema";
import { playlists, reports, tracks } from "@/db/schema";
import { getAdminSession } from "@/lib/admin";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "管理" };
export const dynamic = "force-dynamic";

const REASON_LABELS: Record<string, string> = {
  copyright: "著作権侵害",
  inappropriate: "不適切なコンテンツ",
  spam: "スパム・迷惑行為",
  other: "その他",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-400",
  dismissed: "bg-dopa-800 text-zinc-400",
};

const STATUS_LABELS: Record<string, string> = {
  open: "未対応",
  resolved: "対応済み",
  dismissed: "却下",
};

export default async function AdminPage() {
  const session = await getAdminSession();
  if (!session) notFound();

  const reportRows = await db
    .select()
    .from(reports)
    .orderBy(desc(reports.createdAt))
    .limit(100);

  const trackIds = reportRows
    .filter((report) => report.targetType === "track")
    .map((report) => report.targetId);
  const playlistIds = reportRows
    .filter((report) => report.targetType === "playlist")
    .map((report) => report.targetId);

  const trackMap = new Map<string, { title: string; ownerName: string | null }>();
  if (trackIds.length > 0) {
    const rows = await db
      .select({ id: tracks.id, title: tracks.title, ownerName: userTable.name })
      .from(tracks)
      .leftJoin(userTable, eq(tracks.ownerId, userTable.id))
      .where(inArray(tracks.id, trackIds));
    for (const row of rows) {
      trackMap.set(row.id, { title: row.title, ownerName: row.ownerName });
    }
  }

  const playlistMap = new Map<string, { title: string; ownerName: string | null }>();
  if (playlistIds.length > 0) {
    const rows = await db
      .select({ id: playlists.id, title: playlists.title, ownerName: userTable.name })
      .from(playlists)
      .leftJoin(userTable, eq(playlists.ownerId, userTable.id))
      .where(inArray(playlists.id, playlistIds));
    for (const row of rows) {
      playlistMap.set(row.id, { title: row.title, ownerName: row.ownerName });
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6">
      <AppHeader />

      <section className="pb-6">
        <h1 className="mb-1 flex items-center gap-2 text-2xl font-black">
          <ShieldAlert className="size-5 text-accent" />
          管理
        </h1>
        <p className="text-sm text-zinc-400">通報の確認と対応（{reportRows.length}件）</p>
      </section>

      {reportRows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-dopa-700 bg-dopa-900/60 px-4 py-8 text-center text-xs text-zinc-500">
          通報はありません
        </p>
      ) : (
        <ul className="flex flex-col gap-2 pb-16">
          {reportRows.map((report) => {
            const target =
              report.targetType === "track"
                ? trackMap.get(report.targetId)
                : playlistMap.get(report.targetId);
            return (
              <li
                key={report.id}
                className="flex flex-col gap-3 rounded-2xl border border-dopa-800 bg-dopa-900 px-5 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          STATUS_STYLES[report.status] ?? STATUS_STYLES.open,
                        )}
                      >
                        {STATUS_LABELS[report.status] ?? report.status}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {report.targetType === "track" ? "曲" : "プレイリスト"}
                        {target ? `「${target.title}」` : "（削除済み）"}
                        {target?.ownerName ? ` ・ ${target.ownerName}さん` : ""}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold">
                      {REASON_LABELS[report.reason] ?? report.reason}
                    </p>
                    {report.detail ? (
                      <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                        {report.detail}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[10px] text-zinc-600">
                      {report.createdAt.toLocaleString("ja-JP")}
                    </p>
                  </div>
                </div>

                <AdminReportActions
                  reportId={report.id}
                  status={report.status}
                  targetType={report.targetType}
                  targetId={report.targetId}
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
