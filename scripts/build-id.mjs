// ビルドIDを1回だけ生成する（next.configの評価回数に依存させない）
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, "src", "generated");
const file = join(dir, "build-id.json");

const id = process.env.DOPA_BUILD_ID || new Date().toISOString();

mkdirSync(dir, { recursive: true });
writeFileSync(file, `${JSON.stringify({ id }, null, 2)}\n`, "utf8");
console.log(`[build-id] ${id}`);
