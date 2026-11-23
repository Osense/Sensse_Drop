"use client";

/**
 * 한글(HWP/HWPX) → PDF 변환. 올리는 사람의 브라우저 안에서 합니다 (서버로 원본을 보내 변환하지 않음).
 *
 * 1. @rhwp/core (Rust + WebAssembly 한글 렌더러, MIT) 로 문서를 쪽 단위로 그립니다.
 *    글자 위치 · 줄바꿈은 rhwp 가 한글 글꼴 치수표로 계산하므로 원본과 같습니다.
 * 2. 글자 모양은 "그리는 글꼴"이 결정합니다. 그래서
 *    - 올리는 사람 PC 에 원본 글꼴(한컴 오피스의 HY신명조 · 함초롬 · 수식 글꼴 등)이 있으면 그것을 그대로 쓰고,
 *    - 없으면 가장 닮은 무료 글꼴로 바꿔 그립니다 (FONT_MAP):
 *      신명조 · 바탕 계열 → 함초롬바탕, 돋움 · 굴림 계열 → 함초롬돋움, 중고딕 · 그래픽 → 본고딕 중간 굵기,
 *      견명조 · 견고딕 · 헤드라인처럼 굵은 글꼴 → 본명조 · 본고딕 가장 굵은 굵기, 수식 → Latin Modern Math.
 *    함초롬 · 수식 글꼴은 우리 사이트(/fonts/hwp, scripts/build-hwp-fonts.mjs)에서, 본고딕 · 본명조는 Google Fonts 에서
 *    문서에 쓰인 글자가 든 조각만 받습니다.
 * 3. 먼저 작게 한 번 그려 쓰인 글꼴 · 글자를 모으고 → 그 글꼴을 다 받은 뒤 → 고해상도로 그려 jsPDF 로 묶습니다.
 *
 * rhwp 는 번들러를 거치지 않고 /vendor/rhwp.js · /vendor/rhwp_bg.wasm 에서 바로 읽습니다
 * (scripts/prepare-vendor.mjs, Worker 의 gzip 제공).
 */

import { asset } from "@/lib/config";

type RhwpDoc = {
  pageCount(): number;
  getPageInfo(page: number): string;
  renderPageToCanvas(page: number, canvas: HTMLCanvasElement, scale: number): void;
  free(): void;
};
type RhwpModule = {
  default: (opts: { module_or_path: string }) => Promise<unknown>;
  HwpDocument: new (bytes: Uint8Array) => RhwpDoc;
};

const GOOGLE_FONTS =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=Noto+Serif+KR:wght@400;700;900&family=Nanum+Gothic:wght@400;700&family=Nanum+Myeongjo:wght@400;700&display=block";
const HWP_FONTS = "/fonts/hwp/hwp-fonts.css";

/** 대신 그릴 글꼴. weight 를 주면 문서의 굵기 대신 그 굵기로 (원래 굵은 글꼴을 흉내) */
type Supply = { family: string; weight?: number };
const HCR_BATANG: Supply = { family: "SD HCR Batang" };
const HCR_DOTUM: Supply = { family: "SD HCR Dotum" };
const SERIF_HEAVY: Supply = { family: "Noto Serif KR", weight: 900 };
const SANS_HEAVY: Supply = { family: "Noto Sans KR", weight: 900 };
const SANS_MEDIUM: Supply = { family: "Noto Sans KR", weight: 500 };
const SANS: Supply = { family: "Noto Sans KR" };
const SERIF: Supply = { family: "Noto Serif KR" };

const norm = (name: string) => name.replace(/["']/g, "").replace(/\s+/g, "").toLowerCase();

/** 문서 글꼴 이름 → 대신 쓸 글꼴. 이름은 norm() 으로 비교 (띄어쓰기 · 대소문자 무시) */
const FONT_MAP = new Map<string, Supply>();
const add = (s: Supply, names: string[]) => names.forEach((n) => FONT_MAP.set(norm(n), s));
add(HCR_BATANG, [
  "함초롬바탕", "함초롱바탕", "HCR Batang", "한컴바탕", "Haansoft Batang", "새바탕",
  "신명조", "HY신명조", "한양신명조", "HYSinMyeongJo", "HYSinMyeongJo-Medium", "HY신명조M",
  "바탕", "바탕체", "Batang", "BatangChe", "휴먼명조", "명조", "한컴 바탕", "문체부 바탕체",
]);
add(HCR_DOTUM, [
  "함초롬돋움", "함초롱돋움", "HCR Dotum", "한컴돋움", "Haansoft Dotum", "새돋움", "한컴산뜻돋움",
  "돋움", "돋움체", "Dotum", "DotumChe", "굴림", "굴림체", "Gulim", "GulimChe", "새굴림", "휴먼고딕", "고딕",
]);
add(SERIF_HEAVY, ["견명조", "HY견명조", "한양견명조", "HYMyeongJo-Extra", "HY견명조B", "태명조", "HY태명조"]);
add(SANS_HEAVY, [
  "견고딕", "HY견고딕", "한양견고딕", "HYGothic-Extra", "HY헤드라인M", "HYHeadLine M", "HYHeadLine Medium",
  "HYHeadLine", "헤드라인", "양재튼튼체B", "휴먼둥근헤드라인", "태고딕", "HY태고딕",
]);
add(SANS_MEDIUM, [
  "중고딕", "HY중고딕", "한양중고딕", "HYGothic", "HYGothic-Medium", "HY중고딕M",
  "HY그래픽", "HY그래픽M", "한양그래픽", "HYGraphic-Medium", "HYGraphic"]);
add(SANS, ["맑은 고딕", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Pretendard", "본고딕"]);
add(SERIF, ["Noto Serif KR", "Noto Serif CJK KR", "AppleMyungjo", "본명조"]);
add({ family: "Nanum Gothic" }, ["나눔고딕", "NanumGothic", "Nanum Gothic"]);
add({ family: "Nanum Myeongjo" }, ["나눔명조", "NanumMyeongjo", "Nanum Myeongjo"]);
add({ family: "Latin Modern Math" }, ["Latin Modern Math"]);
add({ family: "RHWP Old Hangul" }, ["RHWP Old Hangul"]);

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

/** 이 글꼴이 올리는 사람 PC 에 깔려 있나 (기본 글꼴과 글자 폭이 다르면 있는 것) */
const localCache = new Map<string, boolean>();
let probe: CanvasRenderingContext2D | null = null;
const PROBE_TEXT = "가나다라 마바사 wWmMiI1l0Oㅎ한글漢字";
function isLocalFont(family: string): boolean {
  const key = norm(family);
  const hit = localCache.get(key);
  if (hit !== undefined) return hit;
  if (!probe) probe = document.createElement("canvas").getContext("2d");
  let found = false;
  if (probe) {
    for (const base of ["monospace", "serif", "sans-serif"]) {
      probe.font = `40px ${base}`;
      const w0 = probe.measureText(PROBE_TEXT).width;
      probe.font = `40px "${family.replace(/["']/g, "")}", ${base}`;
      if (Math.abs(probe.measureText(PROBE_TEXT).width - w0) > 0.5) {
        found = true;
        break;
      }
    }
  }
  localCache.set(key, found);
  return found;
}

/**
 * rhwp 가 정한 글꼴 지정("bold 16px "HY견명조", 'Haansoft Batang', … , serif")을 바꿉니다.
 * 앞에서부터 보며 PC 에 있는 글꼴을 만나면 그대로 두고, FONT_MAP 에 있는 글꼴을 만나면 그 대체 글꼴을 맨 앞에 둡니다.
 */
const rewriteCache = new Map<string, string>();
export function rewriteFont(font: string): string {
  const hit = rewriteCache.get(font);
  if (hit !== undefined) return hit;
  let result = font;
  const m = font.match(/^(.*?)(\d*\.?\d+px)(?:\/\S+)?\s+(.+)$/);
  if (m) {
    const [, prefix, size, list] = m;
    for (const raw of list.split(",")) {
      const fam = raw.trim().replace(/^["']|["']$/g, "");
      if (!fam || GENERIC.has(fam.toLowerCase())) break;
      if (isLocalFont(fam)) break;
      const s = FONT_MAP.get(norm(fam));
      if (s) {
        const style = prefix.split(/\s+/).filter((t) => t && (s.weight ? !/^(bold|bolder|lighter|normal|\d{3})$/i.test(t) : true));
        if (s.weight) style.push(String(s.weight));
        result = `${style.join(" ")} ${size} "${s.family}", ${list}`.trim();
        break;
      }
    }
  }
  rewriteCache.set(font, result);
  return result;
}

/** 이 캔버스에서만 rhwp 의 글꼴 지정을 대체 글꼴로 바꿔 그리게 합니다 (onText: 쓰인 글꼴 · 글자 모으기) */
function hookCanvas(canvas: HTMLCanvasElement, onText?: (font: string, text: string) => void) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이 브라우저에서는 문서를 그릴 수 없어요.");
  const fontDesc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font")!;
  Object.defineProperty(ctx, "font", {
    configurable: true,
    get() {
      return fontDesc.get!.call(this);
    },
    set(v: string) {
      fontDesc.set!.call(this, rewriteFont(v));
    },
  });
  if (onText) {
    const fill = ctx.fillText.bind(ctx);
    const stroke = ctx.strokeText.bind(ctx);
    ctx.fillText = (t: string, x: number, y: number, w?: number) => {
      onText(ctx.font, t);
      return w === undefined ? fill(t, x, y) : fill(t, x, y, w);
    };
    ctx.strokeText = (t: string, x: number, y: number, w?: number) => {
      onText(ctx.font, t);
      return w === undefined ? stroke(t, x, y) : stroke(t, x, y, w);
    };
  }
  return ctx;
}

function addStylesheet(href: string, key: string): Promise<void> {
  const found = document.querySelector<HTMLLinkElement>(`link[data-sensedrop-fonts="${key}"]`);
  if (found) return found.sheet ? Promise.resolve() : new Promise((r) => found.addEventListener("load", () => r(), { once: true }));
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.crossOrigin = "anonymous";
    link.dataset.sensedropFonts = key;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // 글꼴 목록을 못 받아도 변환은 계속 (기본 글꼴로)
    document.head.appendChild(link);
  });
}

let loading: Promise<RhwpModule> | null = null;

/** 변환 엔진을 미리 받아 둡니다 (파일을 고르는 순간 호출하면 기다림이 줄어요). */
export function preloadConverter(): Promise<RhwpModule> {
  if (!loading) {
    loading = (async () => {
      const css = Promise.all([addStylesheet(GOOGLE_FONTS, "google"), addStylesheet(asset(HWP_FONTS), "hwp")]);
      let ctx: CanvasRenderingContext2D | null = null;
      let last = "";
      // rhwp 가 치수표에 없는 글꼴의 줄바꿈 · 정렬을 계산할 때 브라우저로 글자 폭을 잽니다 (그릴 때와 같은 대체 글꼴로).
      (globalThis as unknown as { measureTextWidth: (f: string, t: string) => number }).measureTextWidth = (font, text) => {
        if (!ctx) ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) return text.length * 8;
        if (font !== last) {
          ctx.font = rewriteFont(font);
          last = font;
        }
        return ctx.measureText(text).width;
      };
      const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ asset("/vendor/rhwp.js") as string)) as RhwpModule;
      await mod.default({ module_or_path: asset("/vendor/rhwp_bg.wasm") });
      await css;
      return mod;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** 문서에 쓰인 글꼴 · 글자만 받아 둡니다 (조각 글꼴이라 필요한 부분만). */
async function loadFonts(used: Map<string, Set<string>>) {
  const jobs: Promise<unknown>[] = [];
  for (const [font, chars] of used) {
    const at16 = font.replace(/\d*\.?\d+px/, "16px");
    jobs.push(document.fonts.load(at16, [...chars].join("")).catch(() => []));
  }
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 30000))]); // 글꼴 서버가 느려도 변환은 계속
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export type ConvertProgress = (done: number, total: number) => void;

/** 쪽 그림 배율. 1 = 96dpi, 2 = 192dpi (인쇄용으로 충분하고 용량은 적당) */
const RENDER_SCALE = 2;
const JPEG_QUALITY = 0.88;

export async function hwpToPdf(file: File, onProgress?: ConvertProgress): Promise<Blob> {
  const [rhwp, { jsPDF }] = await Promise.all([preloadConverter(), import("jspdf")]);
  const bytes = new Uint8Array(await file.arrayBuffer());

  let doc: RhwpDoc;
  try {
    doc = new rhwp.HwpDocument(bytes);
  } catch {
    throw new Error("문서를 열지 못했어요. 암호가 걸렸거나 손상된 파일인지 확인해 주세요.");
  }

  // 1차: 작게 그려 보며 쓰인 글꼴과 글자 모으기 → 그 글꼴 받기
  try {
    const used = new Map<string, Set<string>>();
    const probeCanvas = document.createElement("canvas");
    hookCanvas(probeCanvas, (font, text) => {
      let set = used.get(font);
      if (!set) used.set(font, (set = new Set()));
      for (const ch of text) set.add(ch);
    });
    for (let i = 0; i < doc.pageCount(); i++) doc.renderPageToCanvas(i, probeCanvas, 0.1);
    await loadFonts(used);
  } finally {
    doc.free();
  }

  // 2차: 글꼴이 준비된 상태로 다시 조판해 그리기
  doc = new rhwp.HwpDocument(bytes);
  try {
    const total = doc.pageCount();
    if (total === 0) throw new Error("빈 문서예요.");
    let pdf: InstanceType<typeof jsPDF> | null = null;
    const canvas = document.createElement("canvas");
    hookCanvas(canvas);

    for (let i = 0; i < total; i++) {
      onProgress?.(i, total);
      await nextFrame();
      const info = JSON.parse(doc.getPageInfo(i)) as { width: number; height: number };
      // rhwp 단위는 96dpi 픽셀 → PDF 포인트(72dpi)
      const wPt = (info.width * 72) / 96;
      const hPt = (info.height * 72) / 96;
      const orientation = wPt > hPt ? "landscape" : "portrait";
      doc.renderPageToCanvas(i, canvas, RENDER_SCALE);
      const jpeg = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      if (!pdf) pdf = new jsPDF({ unit: "pt", format: [wPt, hPt], orientation, compress: true });
      else pdf.addPage([wPt, hPt], orientation);
      pdf.addImage(jpeg, "JPEG", 0, 0, wPt, hPt, undefined, "FAST");
    }
    onProgress?.(total, total);
    pdf!.setProperties({ title: file.name.replace(/\.[^.]+$/, ""), creator: "쎈스드롭 (WSNS)" });
    return pdf!.output("blob");
  } finally {
    doc.free();
  }
}
