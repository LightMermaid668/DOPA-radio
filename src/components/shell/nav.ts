import { Compass, House, ListMusic, Music2, Search } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/home", label: "ホーム", icon: House },
  { href: "/discover", label: "ディスカバー", icon: Compass },
  { href: "/library", label: "ライブラリ", icon: Music2 },
  { href: "/playlists", label: "プレイリスト", icon: ListMusic },
  { href: "/search", label: "検索", icon: Search },
] as const;

export function navIndexForPath(pathname: string): number {
  return NAV_ITEMS.findIndex(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}

/**
 * タブ移動の方向を <html data-nav-direction> に記録し、
 * View Transitions のスライド方向（進む/戻る）に使う。
 */
export function markNavDirection(targetHref: string) {
  if (typeof document === "undefined") return;
  const current = navIndexForPath(window.location.pathname);
  const target = NAV_ITEMS.findIndex((item) => item.href === targetHref);
  if (current === -1 || target === -1 || current === target) return;
  document.documentElement.dataset.navDirection = target > current ? "forward" : "back";
  window.setTimeout(() => {
    delete document.documentElement.dataset.navDirection;
  }, 900);
}
