"use client";

/**
 * 한글(HWP/HWPX) → PDF 변환. 올리는 사람의 브라우저 안에서 합니다 (서버로 원본을 보내 변환하지 않음).
 *
 * 1. @rhwp/core (Rust + WebAssembly 한글 렌더러, MIT) 로 문서를 쪽 단위로 그립니다.
 * 2. 문서에 쓰인 글자에 맞춰 대체 웹폰트(나눔 · Noto)를 먼저 받아 둔 뒤 다시 조판해
 *    줄바꿈 · 자간이 화면과 같게 맞춥니다.
 * 3. 각 쪽을 고해상도 그림으로 그려 jsPDF 로 PDF 한 개로 묶습니다.
 *
 * rhwp 는 번들러를 거치지 않고 /vendor/rhwp.js · /vendor/rhwp_bg.wasm 에서 바로 읽습니다
 * (scripts/prepare-vendor.mjs, Worker 의 gzip 제공).
 */

type RhwpDoc = {
  pageCount(): number;
  getPageInfo(page: number): string;
  renderPageSvg(page: number): string;
  renderPageToCanvas(page: number, canvas: HTMLCanvasElement, scale: number): void;
  free(): void;
};
type RhwpModule = {
  default: (opts: { module_or_path: string }) => Promise<unknown>;
  HwpDocument: new (bytes: Uint8Array) => RhwpDoc;
};

const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700&family=Nanum+Myeongjo:wght@400;700&family=Noto+Sans+KR:wght@400;700&family=Noto+Serif+KR:wght@400;700&display=block";
const FONT_FAMILIES = ["Nanum Gothic", "Nanum Myeongjo", "Noto Sans KR", "Noto Serif KR"];

/** 쪽 그림 배율. 1 = 96dpi, 2 = 192dpi (인쇄용으로 충분하고 용량은 적당) */
const RENDER_SCALE = 2;
const JPEG_QUALITY = 0.88;

let loading: Promise<RhwpModule> | null = null;

function ensureFontCss() {
  if (document.querySelector(`link[data-sensedrop-fonts]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONT_CSS;
  link.dataset.sensedropFonts = "1";
  document.head.appendChild(link);
}

/** 변환 엔진을 미리 받아 둡니다 (파일을 고르는 순간 호출하면 기다림이 줄어요). */
export function preloadConverter(): Promise<RhwpModule> {
  if (!loading) {
    loading = (async () => {
      ensureFontCss();
      let ctx: CanvasRenderingContext2D | null = null;
      let last = "";
      // rhwp 가 줄바꿈 · 정렬을 계산할 때 브라우저 글꼴로 글자 폭을 잽니다.
      (globalThis as unknown as { measureTextWidth: (f: string, t: string) => number }).measureTextWidth = (font, text) => {
        if (!ctx) ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) return text.length * 8;
        if (font !== last) {
          ctx.font = font;
          last = font;
        }
        return ctx.measureText(text).width;
      };
      const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/vendor/rhwp.js" as string)) as RhwpModule;
      await mod.default({ module_or_path: "/vendor/rhwp_bg.wasm" });
      return mod;
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

function svgText(svg: string): string {
  const div = document.createElement("div");
  div.innerHTML = svg;
  return div.textContent ?? "";
}

async function loadFontsFor(text: string) {
  const sample = `${text}0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz()①②③④⑤`;
  await Promise.race([
    Promise.all(
      FONT_FAMILIES.flatMap((f) => [400, 700].map((w) => document.fonts.load(`${w} 16px "${f}"`, sample).catch(() => []))),
    ),
    new Promise((r) => setTimeout(r, 15000)), // 글꼴 서버가 느려도 변환은 계속
  ]);
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export type ConvertProgress = (done: number, total: number) => void;

export async function hwpToPdf(file: File, onProgress?: ConvertProgress): Promise<Blob> {
  const [rhwp, { jsPDF }] = await Promise.all([preloadConverter(), import("jspdf")]);
  const bytes = new Uint8Array(await file.arrayBuffer());

  let doc: RhwpDoc;
  try {
    doc = new rhwp.HwpDocument(bytes);
  } catch {
    throw new Error("문서를 열지 못했어요. 암호가 걸렸거나 손상된 파일인지 확인해 주세요.");
  }

  try {
    // 1차: 쓰인 글자를 모아 필요한 글꼴 조각만 받기
    let text = "";
    for (let i = 0; i < doc.pageCount(); i++) text += svgText(doc.renderPageSvg(i));
    await loadFontsFor(text);
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
