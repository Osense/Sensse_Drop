// @rhwp/core(한글 렌더러)를 번들러를 거치지 않고 public/vendor 로 복사합니다.
// WASM(약 28MB)은 Cloudflare 정적 파일 한도(25MB)를 넘어서 gzip 으로 줄여 두고,
// Worker 가 /vendor/rhwp_bg.wasm 요청에 Content-Encoding: gzip 으로 내보냅니다.
import { createReadStream, createWriteStream, copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip, constants } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@rhwp", "core");
const out = join(root, "public", "vendor");
mkdirSync(out, { recursive: true });

copyFileSync(join(src, "rhwp.js"), join(out, "rhwp.js"));
copyFileSync(join(src, "LICENSE"), join(out, "rhwp.LICENSE.txt"));

const wasm = join(src, "rhwp_bg.wasm");
const gz = join(out, "rhwp_bg.wasm.gz");
if (!existsSync(gz) || statSync(gz).mtimeMs < statSync(wasm).mtimeMs) {
  await pipeline(createReadStream(wasm), createGzip({ level: constants.Z_BEST_COMPRESSION }), createWriteStream(gz));
}
// 정적 호스팅(GitHub Pages)은 Worker 가 없어 gzip 을 풀어 줄 수 없으니 원본 WASM 도 둡니다.
if (process.env.NEXT_PUBLIC_STATIC_ONLY === "1") copyFileSync(wasm, join(out, "rhwp_bg.wasm"));
console.log(`vendor: rhwp.js, rhwp_bg.wasm.gz (${(statSync(gz).size / 1048576).toFixed(1)}MB)`);
