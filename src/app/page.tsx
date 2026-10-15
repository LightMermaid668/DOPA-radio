import { Headphones, Link2, ListMusic, UploadCloud } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { StandaloneRedirect } from "@/components/standalone-redirect";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: UploadCloud,
    color: "text-[#ff5f6d]",
    title: "曲を持ち寄る",
    description: "メンバーがアップロードした音源をみんなで聴ける。市販の楽曲はApple Musicリンクで追加。",
  },
  {
    icon: ListMusic,
    color: "text-[#f7e463]",
    title: "プレイリストを組む",
    description: "公開・限定公開・非公開を選べるプレイリスト。みんなのドパプレイリストを見つけよう。",
  },
  {
    icon: Headphones,
    color: "text-[#4ade80]",
    title: "裏でずっと流れる",
    description: "画面を閉じてもロックしても再生し続ける。倍速・ピッチ変更も自由。",
  },
  {
    icon: Link2,
    color: "text-[#38bdf8]",
    title: "共有する",
    description: "プレイリストはリンクひとつで共有。Apple MusicやSpotifyの曲もまとめて並べられる。",
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6">
      <StandaloneRedirect />
      <header className="flex items-center justify-between py-6">
        <Logo />
        <nav className="flex items-center gap-3">
          <Link href="/login" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            ログイン
          </Link>
          <Link href="/register" className={cn(buttonVariants({ size: "sm" }))}>
            新規登録
          </Link>
        </nav>
      </header>

      <section className="flex flex-col items-start gap-6 py-20">
        <p className="rounded-full border border-dopa-700 px-3 py-1 text-xs text-zinc-400">
          ドパガキのための音楽基地
        </p>
        <h1 className="max-w-3xl text-4xl leading-tight font-black tracking-tight sm:text-6xl">
          <span className="text-rainbow">ドパドパ</span>する曲を、
          <br />
          みんなで集めて共有しよう。
        </h1>
        <p className="max-w-2xl text-base text-zinc-400 sm:text-lg">
          曲をアップロードしてプレイリストを組む。Apple Music・Spotifyの曲もまとめて並べて、リンクひとつで仲間にシェア。スマホのバックグラウンドでも流れ続けます。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/register" className={cn(buttonVariants({ size: "lg" }))}>
            はじめる（無料）
          </Link>
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            ログイン
          </Link>
        </div>
      </section>

      <section className="grid gap-4 pb-24 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-2xl border border-dopa-800 bg-dopa-900 p-6"
          >
            <feature.icon className={cn("mb-4 size-6", feature.color)} aria-hidden />
            <h2 className="mb-2 text-lg font-bold">{feature.title}</h2>
            <p className="text-sm leading-relaxed text-zinc-400">{feature.description}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto border-t border-dopa-800 py-6 text-xs text-zinc-500">
        DOPA-radio — 権利のある音源のみアップロードできます。市販の楽曲はApple
        Music・Spotify連携でプレイリストに追加してください。
      </footer>
    </main>
  );
}
