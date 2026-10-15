import type { Metadata } from "next";
import { Suspense } from "react";

import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "新規登録" };

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <Suspense>
        <RegisterForm />
      </Suspense>
    </main>
  );
}
