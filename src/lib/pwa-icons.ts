// PWA アイコン定義の一元管理（manifest.ts と layout.tsx の両方から参照する）
//
// すべての URL に ?v= を付けてキャッシュを無効化する。
// iOS は apple-touch-icon を URL 単位で長期キャッシュし、同じ URL のまま
// 画像を差し替えても反映されない（アイコンが表示されない端末が出る）ため、
// アイコン画像を変更したら ICON_VERSION を必ず上げること。
export const ICON_VERSION = "2";

const v = (path: string) => `${path}?v=${ICON_VERSION}`;

export type PwaIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable" | "monochrome";
};

// 通常アイコン（purpose: any）。端末・ランチャーごとに要求サイズが異なるため網羅する
export const PWA_ANY_ICONS: PwaIcon[] = [48, 72, 96, 144, 192, 256, 384, 512].map((size) => ({
  src: v(`/icons/icon-${size}.png`),
  sizes: `${size}x${size}`,
  type: "image/png",
  purpose: "any",
}));

// maskable アイコン（Android の丸型/スクエア型マスク対応）
export const PWA_MASKABLE_ICONS: PwaIcon[] = [192, 512].map((size) => ({
  src: v(`/icons/icon-maskable-${size}.png`),
  sizes: `${size}x${size}`,
  type: "image/png",
  purpose: "maskable",
}));

// Apple touch icon（iOS/iPadOS。PNG・非透過・端末別サイズが必須）
export const PWA_APPLE_ICONS = [
  { url: v("/icons/apple-touch-icon-120.png"), sizes: "120x120", type: "image/png" },
  { url: v("/icons/apple-touch-icon-152.png"), sizes: "152x152", type: "image/png" },
  { url: v("/icons/apple-touch-icon-167.png"), sizes: "167x167", type: "image/png" },
  { url: v("/icons/apple-touch-icon.png"), sizes: "180x180", type: "image/png" },
];

export const PWA_FAVICON_ICO = v("/favicon.ico");
