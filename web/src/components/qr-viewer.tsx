"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Download, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/countdown";

/** 캔버스에 글을 폭에 맞춰 줄바꿈. 띄어쓰기 단위로 끊고, 한 낱말이 한 줄보다 길 때만 글자 단위로 끊어요 */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const out: string[] = [];
  const fits = (t: string) => ctx.measureText(t).width <= maxWidth;
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(?<=\s)/)) {
      if (fits(line + word)) {
        line += word;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = "";
      for (const ch of Array.from(word)) {
        if (!fits(line + ch) && line) {
          out.push(line);
          line = "";
        }
        line += ch;
      }
    }
    out.push(line.trimEnd());
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last && !fits(last + "…")) last = Array.from(last).slice(0, -1).join("");
    cut[maxLines - 1] = last + "…";
    return cut;
  }
  return out;
}

const FONT = "Pretendard, 'Noto Sans KR', sans-serif";

/** QR 코드를 큰 PNG(제목 · 안내 문구 · 주소 포함)로 만들어 저장 */
export async function saveQrImage(url: string, title: string, message?: string) {
  const W = 1200;
  const qrSize = 720;
  const pad = 90;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `800 56px ${FONT}`;
  const titleLines = wrapLines(measure, title, W - pad * 2, 3);
  measure.font = `500 40px ${FONT}`;
  const msgLines = message ? wrapLines(measure, message, W - pad * 2 - 60, 6) : [];
  const msgH = msgLines.length ? msgLines.length * 58 + 60 : 0;
  const titleH = 70 + titleLines.length * 72;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = titleH + 30 + msgH + 50 + qrSize + 260;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#111827";
  ctx.font = `800 56px ${FONT}`;
  titleLines.forEach((l, i) => ctx.fillText(l, W / 2, 116 + i * 72));

  let y = titleH + 30;
  if (msgLines.length) {
    ctx.fillStyle = "#f5f3ff";
    ctx.beginPath();
    ctx.roundRect(pad, y, W - pad * 2, msgH - 20, 28);
    ctx.fill();
    ctx.fillStyle = "#1f2937";
    ctx.font = `500 40px ${FONT}`;
    msgLines.forEach((l, i) => ctx.fillText(l, W / 2, y + 62 + i * 58));
    y += msgH;
  }
  y += 50;
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, url, { width: qrSize, margin: 0, errorCorrectionLevel: "M" });
  ctx.drawImage(qr, (W - qrSize) / 2, y);
  y += qrSize;
  ctx.font = `500 40px ${FONT}`;
  ctx.fillStyle = "#4b5563";
  ctx.fillText(url.replace(/^https?:\/\//, ""), W / 2, y + 90);
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = "#7c5cf0";
  ctx.fillText("휴대폰 카메라로 찍으면 바로 열려요 · 쎈스드롭", W / 2, y + 180);

  const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[\\/:*?"<>|]/g, " ").trim() || "쎈스드롭"} QR.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** 교실 화면에 띄우는 큰 QR (전체 화면). 맨 위에 제목, 가로 화면은 QR 왼쪽 · 안내 오른쪽, 세로 화면은 위아래 */
export function QrViewer({
  url,
  title,
  message,
  expiresAt,
  open,
  onClose,
}: {
  url: string;
  title: string;
  message?: string;
  expiresAt?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [svg, setSvg] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(setSvg).catch(() => {});
  }, [open, url]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.requestFullscreen?.().catch(() => {});
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="QR 코드 크게 보기"
      className="fixed inset-0 z-[100] flex flex-col overflow-auto bg-white px-[clamp(1rem,5vw,4.5rem)] py-[clamp(1rem,4vh,3rem)] text-gray-900"
    >
      {/* 위: 제목 (버튼과 겹치지 않게 같은 줄) */}
      <div className="flex items-start gap-4">
        <h2 className="min-w-0 flex-1 break-keep text-[clamp(1.3rem,3.4vw,3rem)] font-extrabold leading-tight tracking-tight">{title}</h2>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" className="bg-white text-gray-900" onClick={() => saveQrImage(url, title, message)}>
            <Download /> <span className="max-sm:hidden">이미지로 저장</span>
          </Button>
          <Button variant="outline" size="sm" className="bg-white text-gray-900" onClick={onClose} aria-label="닫기">
            <X /> <span className="max-sm:hidden">닫기</span>
          </Button>
        </div>
      </div>

      {/* 아래: 가로 화면은 QR 왼쪽 · 안내 오른쪽, 세로 화면은 위아래. QR 둘레에 여백을 넉넉히 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-[3vh] py-[3vh] landscape:flex-row landscape:items-center landscape:gap-[5vw]">
        <div className="shrink-0 rounded-3xl border border-gray-200 p-[clamp(0.75rem,2.5vh,2rem)] shadow-sm">
          <div
            className="aspect-square w-[min(68vw,38vh)] landscape:w-[min(36vw,56vh)] [&_svg]:h-full [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
        <div className="flex min-w-0 max-w-[90vw] flex-col items-center gap-[2vh] text-center landscape:max-w-[46vw] landscape:flex-1 landscape:items-start landscape:text-left">
          {message && (
            <p className="max-h-[40vh] w-full overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-violet-50 px-[clamp(1rem,2vw,1.75rem)] py-[clamp(0.75rem,1.6vw,1.25rem)] text-[clamp(1rem,2vw,1.9rem)] font-medium leading-relaxed text-gray-800">
              {message}
            </p>
          )}
          <p className="break-all text-[clamp(1.1rem,2.4vw,2rem)] font-bold tracking-tight text-gray-700">{url.replace(/^https?:\/\//, "")}</p>
          {expiresAt && <Countdown expiresAt={expiresAt} size="lg" />}
          <p className="text-sm text-gray-500">휴대폰 카메라로 QR 코드를 찍거나 위 주소를 직접 쳐서 열어요</p>
        </div>
      </div>
    </div>
  );
}

export function QrButtons({ onOpen, onSave }: { onOpen: () => void; onSave: () => void }) {
  return (
    <>
      <Button variant="outline" size="sm" onClick={onOpen}>
        <Maximize2 /> QR 크게 보기
      </Button>
      <Button variant="outline" size="sm" onClick={onSave}>
        <Download /> QR 저장
      </Button>
    </>
  );
}
