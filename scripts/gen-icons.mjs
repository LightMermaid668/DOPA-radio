import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "public/icons");
const PUBLIC_DIR = path.join(ROOT, "public");

// PWA のホーム画面アイコンは端末・ランチャーごとに要求サイズが異なる。
// 1 つでも欠けるとアイコンが表示されない端末があるため、主要サイズを網羅する。
const ANY_SIZES = [48, 72, 96, 144, 192, 256, 384, 512];
// maskable は 192/512 が必須（Android のインストール要件は 192 以上）
const MASKABLE_SIZES = [192, 512];
// Apple の推奨サイズ: iPhone 180 / iPhone(旧) 120 / iPad 152 / iPad Pro 167
const APPLE_SIZES = [120, 152, 167, 180];

function logoSvg({ size, padding = 0 }) {
  const inner = 512 - padding * 2;
  const scale = inner / 512;
  const offset = padding;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="rainbow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff5f6d"/>
      <stop offset="18%" stop-color="#ff9f43"/>
      <stop offset="34%" stop-color="#f7e463"/>
      <stop offset="52%" stop-color="#4ade80"/>
      <stop offset="70%" stop-color="#38bdf8"/>
      <stop offset="86%" stop-color="#a78bfa"/>
      <stop offset="100%" stop-color="#f472b6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#0a0a0c"/>
  <g transform="translate(${offset},${offset}) scale(${scale})">
    <circle cx="256" cy="256" r="176" fill="none" stroke="url(#rainbow)" stroke-width="20" opacity="0.95"/>
    <circle cx="256" cy="256" r="120" fill="url(#rainbow)"/>
    <path d="M232 198 L232 314 L322 256 Z" fill="#0a0a0c"/>
  </g>
</svg>`;
}

async function renderPng(size, padding) {
  return sharp(Buffer.from(logoSvg({ size, padding }))).png().toBuffer();
}

// ICO コンテナ（Vista 以降は PNG 埋め込みを全ブラウザがサポート）
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  for (const size of ANY_SIZES) {
    const file = `icon-${size}.png`;
    await writeFile(path.join(OUT_DIR, file), await renderPng(size, 0));
    console.log(`generated ${file}`);
  }

  for (const size of MASKABLE_SIZES) {
    const padding = Math.round(90 * (size / 512));
    const file = `icon-maskable-${size}.png`;
    await writeFile(path.join(OUT_DIR, file), await renderPng(size, padding));
    console.log(`generated ${file}`);
  }

  for (const size of APPLE_SIZES) {
    const file = size === 180 ? "apple-touch-icon.png" : `apple-touch-icon-${size}.png`;
    await writeFile(path.join(OUT_DIR, file), await renderPng(size, 0));
    console.log(`generated ${file}`);
  }

  // ブラウザ/ランチャーが慣習的に直リクエストする root 直下のフォールバック
  await copyFile(
    path.join(OUT_DIR, "apple-touch-icon.png"),
    path.join(PUBLIC_DIR, "apple-touch-icon.png"),
  );
  await copyFile(
    path.join(OUT_DIR, "apple-touch-icon.png"),
    path.join(PUBLIC_DIR, "apple-touch-icon-precomposed.png"),
  );
  console.log("generated apple-touch-icon.png / apple-touch-icon-precomposed.png (root)");

  const ico = buildIco(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, data: await renderPng(size, 0) })),
    ),
  );
  await writeFile(path.join(PUBLIC_DIR, "favicon.ico"), ico);
  console.log("generated favicon.ico");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
