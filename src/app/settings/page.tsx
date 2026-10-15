import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, Music4, TriangleAlert } from "lucide-react";

import pkg from "../../../package.json";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SpotifyConnect } from "@/components/settings/spotify-connect";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { isAdminEmail } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { spotifyConfigured } from "@/lib/spotify";

export const metadata: Metadata = { title: "設定" };
export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ spotify?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/settings");

  const { spotify } = await searchParams;

  const row = await db.query.integrations.findFirst({
    where: and(
      eq(integrations.userId, session.user.id),
      eq(integrations.provider, "spotify"),
    ),
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <Link
          href="/library"
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
          ライブラリ
        </Link>
        <SignOutButton />
      </header>

      <h1 className="mb-6 text-2xl font-black">設定</h1>

      <div className="flex flex-col gap-4 pb-16">
        <SpotifyConnect
          configured={spotifyConfigured()}
          connected={Boolean(row)}
          status={spotify ?? null}
        />

        <section className="rounded-2xl border border-dopa-800 bg-dopa-900 p-5">
          <h2 className="mb-1 flex items-center gap-2 font-bold">
            <Music4 className="size-4 text-accent" />
            Apple Music
          </h2>
          <p className="text-xs leading-relaxed text-zinc-500">
            連携設定は不要です。プレイリスト編集画面から検索して追加でき、30秒の試聴と「Apple
            Musicで開く」が使えます（フル再生はApple Musicアプリ側）。
          </p>
        </section>

        <section className="rounded-2xl border border-dopa-800 bg-dopa-900 p-5">
          <h2 className="mb-1 flex items-center gap-2 font-bold">
            <TriangleAlert className="size-4 text-[#f7e463]" />
            アップロードのルール
          </h2>
          <p className="text-xs leading-relaxed text-zinc-500">
            自分が権利を持つ音源か、許諾を得た音源のみアップロードできます。市販の楽曲は
            Apple Music / Spotify 連携で追加してください。
          </p>
        </section>

        {isAdminEmail(session.user.email) ? (
          <Link
            href="/admin"
            className="flex items-center justify-between rounded-2xl border border-dopa-800 bg-dopa-900 p-5 hover:border-dopa-700"
          >
            <div>
              <h2 className="font-bold">管理者メニュー</h2>
              <p className="text-xs text-zinc-500">通報の確認と対応</p>
            </div>
            <span className="text-xs text-zinc-500">開く →</span>
          </Link>
        ) : null}
      </div>

      <p className="mt-auto pb-8 pt-6 text-center text-[10px] text-zinc-600">
        DOPA-radio v{pkg.version}
      </p>
    </main>
  );
}
