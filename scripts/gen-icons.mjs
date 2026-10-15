import { mkdir } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const OUT_DIR = path.resolve(import.meta.dirname, "../public/icons");

function logoSvg({ size, padding = 0 }) {
  const inner = 512 - padding * 2;
  const scale = inner / 512;
  const offset = padding;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#ef4444"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="#0a0a0c"/>
  <g transform="translate(${offset},${offset}) scale(${scale})">
    <circle cx="256" cy="256" r="150" fill="none" stroke="url(#g)" stroke-width="26" opacity="0.35"/>
    <circle cx="256" cy="256" r="112" fill="url(#g)"/>
    <path d="M232 200 L232 312 L320 256 Z" fill="#0a0a0c"/>
  </g>
</svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const targets = [
    { file: "icon-192.png", size: 192, padding: 0 },
    { file: "icon-512.png", size: 512, padding: 0 },
    { file: "icon-maskable-512.png", size: 512, padding: 90 },
    { file: "apple-touch-icon.png", size: 180, padding: 0 },
  ];

  for (const target of targets) {
    const svg = logoSvg(target);
    await sharp(Buffer.from(svg)).png().toFile(path.join(OUT_DIR, target.file));
    console.log(`generated ${target.file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
