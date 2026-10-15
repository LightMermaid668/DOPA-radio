"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/library";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await authClient.signIn.email({ email, password });
    if (signInError) {
      setError("メールアドレスまたはパスワードが正しくありません。");
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
      <h1 className="mb-1 text-2xl font-black">ログイン</h1>
      <p className="mb-8 text-sm text-zinc-400">
        アカウントがなければ{" "}
        <Link href="/register" className="text-accent underline underline-offset-4">
          新規登録
        </Link>
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
          <span className="text-zinc-400">パスワード</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-xl border border-dopa-700 bg-dopa-900 px-4 text-base outline-none focus:border-accent"
          />
        </label>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <Button type="submit" size="lg" disabled={loading}>
          {loading ? "ログイン中..." : "ログイン"}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-zinc-500">
        <span className="h-px flex-1 bg-dopa-800" />
        または
        <span className="h-px flex-1 bg-dopa-800" />
      </div>

      <Button type="button" variant="outline" size="lg" className="w-full" onClick={onGoogle}>
        Googleでログイン
      </Button>
    </div>
  );
}
