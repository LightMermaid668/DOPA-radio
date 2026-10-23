import { NextResponse } from "next/server";

/**
 * PWAのHTML/RSCをキャッシュさせない（更新が反映されない問題の対策）。
 * 静的アセットはハッシュ付きで不変なので対象外。
 */
export function middleware() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}

export const config = {
  // ページ（HTML/RSC）のみ。/_next/static・画像・API・拡張子付きファイルは除外
  matcher: ["/((?!_next/static|_next/image|api|icons|.*\\..*).*)"],
};
