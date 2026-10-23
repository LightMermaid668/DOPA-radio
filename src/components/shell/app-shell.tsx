"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Download, Settings, UploadCloud } from "lucide-react";

import { Logo } from "@/components/logo";
import { QrScannerButton } from "@/components/share/qr-scanner-button";
import { AccountButton, type ShellUser } from "@/components/shell/account-button";
import { markNavDirection, NAV_ITEMS, navIndexForPath } from "@/components/shell/nav";
import { isDesktopApp } from "@/lib/desktop";
import { cn } from "@/lib/utils";
import { versionLabel } from "@/lib/version";

export function AppShell({
  user,
  children,
}: {
  user: ShellUser | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeIndex = navIndexForPath(pathname);
  const mainRef = useRef<HTMLElement>(null);
  const previousPathRef = useRef(pathname);
  const [desktopApp, setDesktopApp] = useState(false);

  useEffect(() => {
    setDesktopApp(isDesktopApp());
  }, []);

  // タブバー分だけプレイヤーを持ち上げる（CSS変数で伝える）
  useEffect(() => {
    document.body.classList.add("dopa-shell-active");
    return () => document.body.classList.remove("dopa-shell-active");
  }, []);

  // View Transitions非対応ブラウザ用: コンテンツ全体をスライドインさせる
  useEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = pathname;
    if (previousPath === pathname || typeof document === "undefined") return;
    const supportsViewTransition =
      typeof (document as Document & { startViewTransition?: unknown })
        .startViewTransition === "function";
    if (supportsViewTransition) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const previousIndex = navIndexForPath(previousPath);
    const nextIndex = navIndexForPath(pathname);
    if (previousIndex === -1 || nextIndex === -1 || previousIndex === nextIndex) return;

    const element = mainRef.current;
    if (!element) return;
    const fromRight = nextIndex > previousIndex;
    element.animate(
      [
        { transform: `translateX(${fromRight ? 100 : -100}%)`, opacity: 0.9 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 340, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [pathname]);

  return (
    <div className="min-h-dvh w-full">
      {/* デスクトップ: 左サイドバー */}
      <aside className="app-sidebar fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-dopa-800/80 bg-dopa-900/80 px-3 py-6 backdrop-blur md:flex">
        <Link href="/home" className="px-3 pb-7" aria-label="ホーム">
          <Logo className="text-xl" />
        </Link>

        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item, index) => {
            const active = index === activeIndex;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => markNavDirection(item.href)}
                className={cn(
                  "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-200",
                  active
                    ? "bg-dopa-800 text-white"
                    : "text-zinc-400 hover:translate-x-0.5 hover:bg-dopa-800/60 hover:text-zinc-100",
                )}
              >
                <span
                  className={cn(
                    "bg-rainbow absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full transition-all duration-300",
                    active ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
                <Icon
                  className={cn(
                    "size-4.5 shrink-0 transition-transform duration-200",
                    active ? "scale-110 text-accent" : "group-hover:scale-105",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-1 border-t border-dopa-800 pt-4">
          <Link
            href="/upload"
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:bg-dopa-800/60 hover:text-zinc-100"
          >
            <UploadCloud className="size-4" />
            アップロード
          </Link>
          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:bg-dopa-800/60 hover:text-zinc-100"
          >
            <Settings className="size-4" />
            設定
          </Link>
          <p className="px-3 pt-2 text-[10px] text-zinc-600">DOPA-radio {versionLabel()}</p>
        </div>
      </aside>

      <div className="flex min-h-dvh w-full flex-col md:pl-60">
        {/* トップバー（右にアカウント） */}
        <header className="app-topbar sticky top-0 z-30 flex items-center justify-between gap-2 bg-dopa-950/80 px-5 py-3 backdrop-blur md:justify-end md:px-8">
          <Link href="/home" className="md:hidden" aria-label="ホーム">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            {desktopApp ? (
              <Link
                href="/downloads"
                aria-label="ダウンロード済み"
                title="ダウンロード済み"
                className="flex size-9 items-center justify-center rounded-full text-zinc-300 hover:bg-dopa-800"
              >
                <Download className="size-4.5" />
              </Link>
            ) : null}
            <QrScannerButton />
            <AccountButton user={user} />
          </div>
        </header>

        <main
          ref={mainRef}
          className="mx-auto w-full max-w-3xl flex-1 px-5 pb-56 md:px-8 md:pb-40"
        >
          {children}
        </main>
      </div>

      {/* モバイル: 下部タブバー */}
      <nav
        className="app-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-dopa-800/80 bg-dopa-950/90 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="メインナビゲーション"
      >
        <div className="relative mx-auto flex h-16 max-w-md items-stretch px-1">
          {activeIndex >= 0 ? (
            <span
              aria-hidden
              className="absolute top-1 bottom-1 rounded-2xl bg-dopa-800 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                width: `${100 / NAV_ITEMS.length}%`,
                left: 0,
                transform: `translateX(${activeIndex * 100}%)`,
              }}
            />
          ) : null}
          {NAV_ITEMS.map((item, index) => {
            const active = index === activeIndex;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => markNavDirection(item.href)}
                className="relative z-10 flex flex-1 flex-col items-center justify-center gap-0.5"
                aria-current={active ? "page" : undefined}
              >
                <Icon
                  className={cn(
                    "size-5 transition-all duration-300",
                    active
                      ? "-translate-y-0.5 scale-110 text-accent drop-shadow-[0_0_10px_rgba(232,121,249,0.45)]"
                      : "text-zinc-500",
                  )}
                />
                <span
                  className={cn(
                    "text-[10px] font-semibold transition-colors duration-200",
                    active ? "text-accent" : "text-zinc-500",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
