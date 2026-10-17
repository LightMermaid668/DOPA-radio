import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/auth/register-form";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "新規登録" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // すでにログイン済みなら登録フォームを見せない
  const session = await getSession();
  if (session) redirect("/home");

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Suspense>
        <RegisterForm />
      </Suspense>
    </main>
  );
}
