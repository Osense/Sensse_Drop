"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Download, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Countdown } from "@/components/countdown";

/** QR 코드를 큰 PNG(제목 · 주소 포함)로 만들어 저장 */
export async function saveQrImage(url: string, title: string) {
  const W = 1200;
  const qrSize = 900;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 1380;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, canvas.height);
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, url, { width: qrSize, margin: 0, errorCorrectionLevel: "M" });
  ctx.drawImage(qr, (W - qrSize) / 2, 170);
  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.font = "800 64px Pretendard, 'Noto Sans KR', sans-serif";
  ctx.fillText(title.length > 26 ? title.slice(0, 25) + "…" : title, W / 2, 110);
  ctx.font = "500 40px Pretendard, 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#4b5563";
  ctx.fillText(url.replace(/^https?:\/\//, ""), W / 2, 1150);
  ctx.font = "700 34px Pretendard, 'Noto Sans KR', sans-serif";
  ctx.fillStyle = "#7c5cf0";
  ctx.fillText("휴대폰 카메라로 찍으면 바로 열려요 · 쎈스드롭", W / 2, 1250);
  const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[\\/:*?"<>|]/g, " ").trim() || "쎈스드롭"} QR.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** 교실 화면에 띄우는 큰 QR (전체 화면) */
export function QrViewer({ url, title, expiresAt, open, onClose }: { url: string; title: string; expiresAt?: string; open: boolean; onClose: () => void }) {
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
    <div ref={ref} role="dialog" aria-modal="true" aria-label="QR 코드 크게 보기" className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-[2vh] overflow-auto bg-white p-4 text-gray-900">
      <div className="absolute right-3 top-3 flex gap-2">
        <Button variant="outline" size="sm" className="bg-white text-gray-900" onClick={() => saveQrImage(url, title)}>
          <Download /> 이미지로 저장
        </Button>
        <Button variant="outline" size="sm" className="bg-white text-gray-900" onClick={onClose} aria-label="닫기">
          <X /> 닫기
        </Button>
      </div>
      <h2 className="max-w-[90vw] truncate text-center text-[clamp(1.5rem,4vw,3rem)] font-extrabold tracking-tight">{title}</h2>
      <div className="aspect-square w-[min(86vw,68vh)] [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="max-w-[90vw] break-all text-center text-[clamp(1rem,2.4vw,1.75rem)] font-semibold text-gray-600">{url.replace(/^https?:\/\//, "")}</p>
      {expiresAt && <Countdown expiresAt={expiresAt} size="lg" />}
      <p className="text-sm text-gray-500">휴대폰 카메라로 QR 코드를 찍으면 바로 열려요</p>
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
