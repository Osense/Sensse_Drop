// 한글 문서 → PDF 변환에 쓰는 글꼴을 만들어 web/public/fonts/hwp 에 둡니다. (손으로 한 번 돌리고 결과를 커밋)
//
//   cd web && node scripts/build-hwp-fonts.mjs
//
// - 함초롬바탕 · 함초롬돋움 (한컴 무료 배포 글꼴, npm @noonnu/han-batang · @noonnu/hcr-dotum) 을
//   Google Fonts 와 같은 "자주 쓰는 글자 순" 조각(unicode-range)으로 잘라 WOFF2 로 만듭니다.
//   문서에 쓰인 글자가 든 조각만 받으므로 처음 변환할 때도 몇 백 KB 면 됩니다.
// - 수식용 Latin Modern Math, 옛한글용 RHWP Old Hangul 은 rhwp 저장소의 공개 글꼴을 그대로 둡니다.
// - 결과: fonts/hwp/hwp-fonts.css (@font-face 목록), *.woff2, LICENSES.txt
//
// 필요: devDependency subset-font, 네트워크(npm 레지스트리 · raw.githubusercontent.com)

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "fonts", "hwp");
const tmp = mkdtempSync(join(tmpdir(), "hwp-fonts-"));

const RHWP_FONTS = "https://raw.githubusercontent.com/edwardkim/rhwp/main/assets/fonts";

/** 잘라 쓸 글꼴: CSS family 이름 · npm 패키지 · 패키지 안 파일 · 내 PC 에 있으면 먼저 쓸 이름 */
const SLICED = [
  { family: "SD HCR Batang", key: "batang", pkg: "@noonnu/han-batang@0.1.0", file: "fonts/hanbatang-normal.woff", local: ["함초롬바탕", "HCR Batang", "HCRBatang"] },
  { family: "SD HCR Dotum", key: "dotum", pkg: "@noonnu/hcr-dotum@0.1.0", file: "fonts/hcrdotum-normal.woff", local: ["함초롬돋움", "HCR Dotum", "HCRDotum"] },
];
/** 그대로 쓰는 글꼴 */
const WHOLE = [
  { family: "Latin Modern Math", file: "LatinModernMath-Regular.woff2", local: ["Latin Modern Math", "LatinModernMath-Regular"] },
  { family: "RHWP Old Hangul", file: "RHWPOldHangul-Regular.woff2", local: [] },
];

const parseRange = (r) =>
  r.split(",").flatMap((p) => {
    const [a, b] = p.trim().replace(/^U\+/i, "").split("-").map((h) => parseInt(h, 16));
    return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
  });
const toRange = (cps) => {
  const s = [...cps].sort((x, y) => x - y);
  const parts = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(i === j ? `U+${s[i].toString(16)}` : `U+${s[i].toString(16)}-${s[j].toString(16)}`);
    i = j + 1;
  }
  return parts.join(", ");
};

/** 글꼴이 가진 글자 목록: WOFF 의 cmap 표(format 4 · 12)를 직접 읽습니다 */
async function codepointsOf(buf) {
  const { default: zlib } = await import("node:zlib");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = {};
  if (dv.getUint32(0) === 0x774f4646) {
    // wOFF
    const num = dv.getUint16(12);
    for (let i = 0; i < num; i++) {
      const o = 44 + i * 20;
      const tag = String.fromCharCode(...buf.subarray(o, o + 4));
      const off = dv.getUint32(o + 4), comp = dv.getUint32(o + 8), orig = dv.getUint32(o + 12);
      const raw = buf.subarray(off, off + comp);
      tables[tag] = comp === orig ? raw : zlib.inflateSync(raw);
    }
  } else throw new Error("WOFF 만 지원");
  const cmap = tables.cmap;
  const cv = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const n = cv.getUint16(2);
  const cps = new Set();
  for (let i = 0; i < n; i++) {
    const off = cv.getUint32(4 + i * 8 + 4);
    const fmt = cv.getUint16(off);
    if (fmt === 12) {
      const groups = cv.getUint32(off + 12);
      for (let g = 0; g < groups; g++) {
        const s = cv.getUint32(off + 16 + g * 12), e = cv.getUint32(off + 20 + g * 12);
        for (let c = s; c <= e; c++) cps.add(c);
      }
    } else if (fmt === 4) {
      const seg = cv.getUint16(off + 6) / 2;
      for (let k = 0; k < seg; k++) {
        const end = cv.getUint16(off + 14 + k * 2), start = cv.getUint16(off + 16 + seg * 2 + k * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) cps.add(c);
      }
    }
  }
  return cps;
}

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) rmSync(join(out, f));

const slices = JSON.parse(readFileSync(join(root, "scripts", "fonts", "korean-slices.json"), "utf8")).slices.map(parseRange);
const JAMO = (c) => (c >= 0x1100 && c <= 0x11ff) || (c >= 0xa960 && c <= 0xa97f) || (c >= 0xd7b0 && c <= 0xd7ff) || (c >= 0x3130 && c <= 0x318f);
let css = `/* 쎈스드롭 한글 문서 변환용 글꼴 — scripts/build-hwp-fonts.mjs 가 만듦. 고치지 마세요. 라이선스: LICENSES.txt */\n`;
let total = 0;

for (const font of SLICED) {
  execFileSync("npm", ["pack", font.pkg, "--silent", "--pack-destination", tmp], { stdio: ["ignore", "pipe", "inherit"] });
  const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
  const dir = join(tmp, font.key);
  mkdirSync(dir);
  execFileSync("tar", ["xzf", join(tmp, tgz), "-C", dir]);
  rmSync(join(tmp, tgz));
  const buf = readFileSync(join(dir, "package", font.file));
  const have = await codepointsOf(buf);
  const used = new Set();
  // 1) 자주 쓰는 글자 순 조각 2) 옛한글 자모(조합 규칙이 한 조각에 같이 있어야 함) 3) 나머지는 1,500자씩
  const groups = slices.map((s) => s.filter((c) => have.has(c) && !JAMO(c)));
  groups.push([...have].filter(JAMO));
  for (const g of groups) g.forEach((c) => used.add(c));
  const rest = [...have].filter((c) => !used.has(c) && c >= 0x20).sort((a, b) => a - b);
  for (let i = 0; i < rest.length; i += 1500) groups.push(rest.slice(i, i + 1500));
  const src = font.local.map((n) => `local("${n}")`).join(", ");
  let n = 0;
  for (const g of groups) {
    if (!g.length) continue;
    const name = `${font.key}-${String(n++).padStart(3, "0")}.woff2`;
    const woff2 = await subsetFont(buf, String.fromCodePoint(...g), { targetFormat: "woff2" });
    writeFileSync(join(out, name), woff2);
    total += woff2.length;
    css += `@font-face{font-family:"${font.family}";font-display:block;src:${src}, url(${name}) format("woff2");unicode-range:${toRange(g)}}\n`;
  }
  console.log(`${font.family}: ${n} 조각`);
}

for (const font of WHOLE) {
  const res = await fetch(`${RHWP_FONTS}/${font.file}`);
  if (!res.ok) throw new Error(`${font.file}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(out, font.file), bytes);
  total += bytes.length;
  const src = [...font.local.map((n) => `local("${n}")`), `url(${font.file}) format("woff2")`].join(", ");
  css += `@font-face{font-family:"${font.family}";font-display:block;src:${src}}\n`;
}

writeFileSync(join(out, "hwp-fonts.css"), css);
writeFileSync(join(out, "LICENSES.txt"), readFileSync(join(root, "scripts", "fonts", "LICENSES.txt")));
rmSync(tmp, { recursive: true, force: true });
console.log(`합계 ${(total / 1048576).toFixed(1)}MB → public/fonts/hwp`);
