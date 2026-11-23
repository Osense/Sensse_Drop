"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Download, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/countdown";

/** 캔버스에 글을 폭에 맞춰 줄바꿈 (한글은 글자 단위로 끊어요) */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const ch of Array.from(para)) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        out.push(line);
        line = ch.trimStart();
      } else line += ch;
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/.{0,1}$/, "") + "…";
    return cut;
  }
  return out;
}

const FONT = "Pretendard, 'Noto Sans KR', sans-serif";

/** QR 코드를 큰 PNG(제목 · 안내 문구 · 주소 포함)로 만들어 저장 */
export async function saveQrImage(url: string, title: string, message?: string) {
  const W = 1200;
  const qrSize = 860;
  const pad = 90;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `500 40px ${FONT}`;
  const msgLines = message ? wrapLines(measure, message, W - pad * 2 - 60, 6) : [];
  const msgH = msgLines.length ? msgLines.length * 58 + 60 : 0;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 150 + msgH + 40 + qrSize + 260;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.textAlign = "center";
  ctx.fillStyle = "#111827";
  ctx.font = `800 64px ${FONT}`;
  ctx.fillText(title.length > 26 ? title.slice(0, 25) + "…" : title, W / 2, 110);

  let y = 150;
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
  y += 40;
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

/** 교실 화면에 띄우는 큰 QR (전체 화면). 가로 화면은 QR 왼쪽 · 설명 오른쪽, 세로 화면은 위아래 */
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
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-auto bg-white p-4 pt-16 text-gray-900 landscape:pt-4"
    >
      <div className="absolute right-3 top-3 flex gap-2">
        <Button variant="outline" size="sm" className="bg-white text-gray-900" onClick={() => saveQrImage(url, title, message)}>
          <Download /> 이미지로 저장
        </Button>
        <Button variant="outline" size="sm" className="bg-white text-gray-900" onClick={onClose} aria-label="닫기">
          <X /> 닫기
        </Button>
      </div>
      <div className="flex w-full max-w-[1600px] flex-col items-center gap-[3vh] landscape:flex-row landscape:items-center landscape:justify-center landscape:gap-[5vw]">
        <div
          className="aspect-square w-[min(86vw,46vh)] shrink-0 landscape:w-[min(48vw,82vh)] [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="flex min-w-0 max-w-[90vw] flex-col items-center gap-[2vh] text-center landscape:max-w-[42vw] landscape:items-start landscape:text-left">
          <h2 className="text-[clamp(1.5rem,3.6vw,3.25rem)] font-extrabold leading-tight tracking-tight break-keep">{title}</h2>
          {message && (
            <p className="max-h-[36vh] overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-violet-50 px-[clamp(1rem,2vw,1.75rem)] py-[clamp(0.75rem,1.6vw,1.25rem)] text-[clamp(1rem,2vw,1.9rem)] font-medium leading-relaxed text-gray-800">
              {message}
            </p>
          )}
          <p className="break-all text-[clamp(0.95rem,1.8vw,1.5rem)] font-semibold text-gray-600">{url.replace(/^https?:\/\//, "")}</p>
          {expiresAt && <Countdown expiresAt={expiresAt} size="lg" />}
          <p className="text-sm text-gray-500">휴대폰 카메라로 QR 코드를 찍으면 바로 열려요</p>
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
