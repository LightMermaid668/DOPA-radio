import { Settings, UploadCloud } from "lucide-react";
import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Logo } from "@/components/logo";

export function AppHeader() {
  return (
    <header className="flex items-center justify-between py-6">
      <Link href="/home" aria-label="ホーム">
        <Logo />
      </Link>
      <div className="flex items-center gap-0.5">
        <Link
          href="/upload"
          aria-label="アップロード"
          className="flex size-9 items-center justify-center rounded-full text-zinc-300 hover:bg-dopa-800"
        >
          <UploadCloud className="size-4.5" />
        </Link>
        <Link
          href="/settings"
          aria-label="設定"
          className="flex size-9 items-center justify-center rounded-full text-zinc-300 hover:bg-dopa-800"
        >
          <Settings className="size-4.5" />
        </Link>
        <SignOutButton />
      </div>
    </header>
  );
}
