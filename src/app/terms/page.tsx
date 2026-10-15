import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "利用規約" };

export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6 py-12">
      <Link href="/" className="mb-8 text-sm text-zinc-400 hover:text-zinc-200">
        ← DOPA-radio
      </Link>
      <h1 className="mb-6 text-2xl font-black">利用規約（ドラフト）</h1>
      <div className="flex flex-col gap-4 text-sm leading-relaxed text-zinc-300">
        <p>
          本サービスは友人・コミュニティ向けの非公開音楽共有サービスです。正式な規約は準備中です（フェーズ4で整備予定）。
        </p>
        <h2 className="mt-2 font-bold">音源のアップロードについて</h2>
        <ul className="list-disc pl-5">
          <li>自分が権利を保有するか、権利者から許諾を得た音源のみアップロードできます。</li>
          <li>市販の楽曲（CD・配信音源など）のアップロードは禁止です。Apple Music・Spotify連携で追加してください。</li>
          <li>権利侵害の申し立てがあった場合、該当音源を予告なく削除します。</li>
        </ul>
        <h2 className="mt-2 font-bold">禁止事項</h2>
        <ul className="list-disc pl-5">
          <li>第三者の権利を侵害するコンテンツの投稿</li>
          <li>サービスの運営を妨害する行為</li>
        </ul>
      </div>
    </main>
  );
}
