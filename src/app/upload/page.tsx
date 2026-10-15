import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { UploadForm } from "@/components/upload/upload-form";
import { auth } from "@/lib/auth";

export const metadata: Metadata = { title: "アップロード" };
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login?redirect=/upload");

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

      <h1 className="mb-2 text-2xl font-black">音源をアップロード</h1>
      <p className="mb-8 text-sm text-zinc-400">
        変換（AAC / HLS）が終わるとバックグラウンド再生・倍速再生ができるようになります。
      </p>

      <UploadForm />
    </main>
  );
}
