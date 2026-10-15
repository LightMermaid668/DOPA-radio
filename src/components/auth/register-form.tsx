"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/library";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    if (password.length < 8) {
      setError("パスワードは8文字以上で入力してください。");
      setLoading(false);
      return;
    }

    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
    });
    if (signUpError) {
      setError(
        signUpError.status === 422 || signUpError.status === 400
          ? "このメールアドレスは既に登録されているか、入力内容に誤りがあります。"
          : "登録に失敗しました。時間をおいて再度お試しください。",
      );
      setLoading(false);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  async function onGoogle() {
    setError(null);
    await authClient.signIn.social({ provider: "google", callbackURL: redirectTo });
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-1 text-2xl font-black">新規登録</h1>
      <p className="mb-8 text-sm text-zinc-400">
        すでにアカウントがある方は{" "}
        <Link href="/login" className="text-accent underline underline-offset-4">
          ログイン
        </Link>
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-zinc-400">表示名</span>
          <input
            type="text"
            required
            maxLength={32}
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 rounded-xl border border-dopa-700 bg-dopa-900 px-4 text-base outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-zinc-400">メールアドレス</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 rounded-xl border border-dopa-700 bg-dopa-900 px-4 text-base outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-zinc-400">パスワード（8文字以上）</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-xl border border-dopa-700 bg-dopa-900 px-4 text-base outline-none focus:border-accent"
          />
        </label>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <Button type="submit" size="lg" disabled={loading}>
          {loading ? "登録中..." : "登録する"}
        </Button>
      </form>

      <p className="mt-4 text-xs leading-relaxed text-zinc-500">
        登録すると
        <Link href="/terms" className="underline underline-offset-2">
          利用規約
        </Link>
        とプライバシーポリシーに同意したものとみなされます。
      </p>

      <div className="my-6 flex items-center gap-3 text-xs text-zinc-500">
        <span className="h-px flex-1 bg-dopa-800" />
        または
        <span className="h-px flex-1 bg-dopa-800" />
      </div>

      <Button type="button" variant="outline" size="lg" className="w-full" onClick={onGoogle}>
        Googleで登録
      </Button>
    </div>
  );
}
