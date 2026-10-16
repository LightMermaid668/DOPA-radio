"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  LogOut,
  Music2,
  Settings,
  UploadCloud,
  UserRound,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export type ShellUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

type MenuItem = {
  href: string;
  label: string;
  hint: string;
  icon: typeof Music2;
  accent?: boolean;
};

const MENU_ITEMS: MenuItem[] = [
  {
    href: "/library",
    label: "ライブラリ / 公開設定",
    hint: "自分の曲の公開範囲を変える",
    icon: Music2,
  },
  {
    href: "",
    label: "公開ページを見る",
    hint: "みんなに共有される自分のページ",
    icon: UserRound,
  },
  {
    href: "/upload",
    label: "アップロード",
    hint: "新しい曲を追加する",
    icon: UploadCloud,
  },
  {
    href: "/settings",
    label: "設定",
    hint: "Spotify連携・再生設定など",
    icon: Settings,
  },
];

function Avatar({
  user,
  className,
}: {
  user: ShellUser;
  className?: string;
}) {
  const initial = user.name?.trim().charAt(0) || "D";
  return (
    <span
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-full",
        className,
      )}
    >
      <span className="bg-rainbow animate-rainbow absolute inset-0" aria-hidden />
      <span className="absolute inset-[2px] rounded-full bg-dopa-900" aria-hidden />
      {user.image ? (
        <img
          src={user.image}
          alt=""
          className="absolute inset-[2px] size-[calc(100%-4px)] rounded-full object-cover"
        />
      ) : (
        <span className="relative z-10 font-black text-white">{initial}</span>
      )}
    </span>
  );
}

export function AccountButton({ user }: { user: ShellUser | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!user) {
    return (
      <Link
        href="/login"
        className="bg-rainbow rounded-full px-4 py-1.5 text-xs font-bold text-dopa-950 transition-transform duration-200 hover:scale-105 active:scale-95"
      >
        ログイン
      </Link>
    );
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  const items = MENU_ITEMS.map((item) =>
    item.href === "" ? { ...item, href: `/u/${user.id}` } : item,
  );

  const menuContent = (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
        <Avatar user={user} className="size-11 text-lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{user.name}</p>
          <p className="truncate text-[11px] text-zinc-500">{user.email}</p>
        </div>
      </div>
      <div className="my-1 h-px bg-dopa-800" />
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            className="animate-row group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-dopa-800"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-dopa-800 text-accent transition-transform duration-200 group-hover:scale-110">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-zinc-100">
                {item.label}
              </span>
              <span className="block truncate text-[10px] text-zinc-500">
                {item.hint}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-zinc-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-400" />
          </Link>
        );
      })}
      <div className="my-1 h-px bg-dopa-800" />
      <button
        type="button"
        onClick={signOut}
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/10"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
          <LogOut className="size-4" />
        </span>
        ログアウト
      </button>
    </div>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="アカウントメニュー"
        aria-expanded={open}
        className={cn(
          "block rounded-full transition-transform duration-200 hover:scale-105 active:scale-95",
          open && "scale-105",
        )}
      >
        <Avatar user={user} className="size-9 text-sm shadow-lg shadow-accent/10" />
      </button>

      {open ? (
        <>
          <div
            className="animate-fade fixed inset-0 z-[70] bg-black/50 md:bg-black/20"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="animate-slide-up fixed inset-x-2 z-[80] rounded-2xl border border-dopa-700 bg-dopa-900/95 p-2 shadow-2xl backdrop-blur md:hidden"
            style={{ bottom: "calc(var(--dopa-tabbar-offset, 0px) + 0.5rem)" }}
          >
            {menuContent}
          </div>
          <div className="animate-pop absolute top-full right-0 z-[80] mt-2 hidden w-72 rounded-2xl border border-dopa-700 bg-dopa-900/95 p-2 shadow-2xl backdrop-blur md:block">
            {menuContent}
          </div>
        </>
      ) : null}
    </div>
  );
}
