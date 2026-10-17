import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "ログイン" };
export const dynamic = "force-dynamic";

function safeRedirect(value: string | undefined): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/home";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  // すでにログイン済みならログインフォームを見せない
  const session = await getSession();
  if (session) {
    const { redirect: target } = await searchParams;
    redirect(safeRedirect(target));
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
