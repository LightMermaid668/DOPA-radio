"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label="ログアウト"
      className="flex size-9 items-center justify-center rounded-full text-zinc-400 hover:bg-dopa-800 hover:text-zinc-200"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      <LogOut className="size-4.5" />
    </button>
  );
}
