"use client";

import * as React from "react";
import { Download, FileUp, Info, Trash2, X } from "lucide-react";
import { FileBadge } from "@/components/file-badge";
import { StatusPill } from "@/components/status-pill";
import { Wordmark } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { hwpToPdf, preloadConverter } from "@/lib/convert";
import { extOf, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 서버 없는 미리보기판 (GitHub Pages). 파일은 이 브라우저 밖으로 나가지 않고,
 * HWP · HWPX 를 PDF 로 바꿔 바로 내려받습니다. 비밀번호 링크 공유는 서버를 붙인 뒤에 열립니다.
 */
const MAX_FILES = 10;
const MAX_MB = 20;

type Item = {
  key: string;
  file: File;
  status: "waiting" | "converting" | "done" | "error";
  note?: string;
  error?: string;
  pdf?: Blob;
  url?: string;
};

const pdfName = (name: string) => name.replace(/\.(hwpx?|HWPX?)$/, "") + ".pdf";

export function PdfOnlyView() {
  const [items, setItems] = React.useState<Item[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => () => items.forEach((i) => i.url && URL.revokeObjectURL(i.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function update(key: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function addFiles(list: FileList | File[]) {
    setNotice(null);
    const next = [...items];
    for (const file of Array.from(list)) {
      const ext = extOf(file.name);
      if (ext !== "hwp" && ext !== "hwpx") {
        setNotice(`HWP · HWPX만 바꿀 수 있어요: ${file.name}`);
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        setNotice(`파일 하나는 ${MAX_MB}MB까지예요: ${file.name}`);
        continue;
      }
      if (next.some((p) => p.file.name === file.name && p.file.size === file.size)) continue;
      if (next.length >= MAX_FILES) {
        setNotice(`한 번에 ${MAX_FILES}개까지 바꿀 수 있어요.`);
        break;
      }
      next.push({ key: `${file.name}-${file.size}-${Math.random()}`, file, status: "waiting" });
    }
    setItems(next);
    if (next.length) preloadConverter().catch(() => {});
  }

  async function convertAll() {
    setBusy(true);
    for (const it of items) {
      if (it.status === "done") continue;
      update(it.key, { status: "converting", note: "변환 엔진 준비 중", error: undefined });
      try {
        const pdf = await hwpToPdf(it.file, (done, total) => update(it.key, { note: `${Math.min(done + 1, total)}/${total}쪽` }));
        const url = URL.createObjectURL(pdf);
        update(it.key, { status: "done", pdf, url, note: undefined });
        save(url, pdfName(it.file.name));
      } catch (err) {
        update(it.key, { status: "error", error: (err as Error).message || "PDF로 바꾸지 못했어요." });
      }
    }
    setBusy(false);
  }

  function save(url: string, name: string) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function clear() {
    items.forEach((i) => i.url && URL.revokeObjectURL(i.url));
    setItems([]);
    setNotice(null);
  }

  const pending = items.some((i) => i.status !== "done");

  return (
    <div className="relative">
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-80" />
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="mb-7 animate-fade-up">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            한글 파일을 <span className="text-gradient">보이는 그대로 PDF로</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            HWP · HWPX를 올리면 이 브라우저 안에서 PDF로 바꿔 바로 내려받아요. 파일은 어디에도 올라가지 않아요.
          </p>
        </div>

        <Card className="p-5 sm:p-6">
          <div
            role="button"
            tabIndex={0}
            onClick={() => !busy && inputRef.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              if (!busy) addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-9 text-center transition-colors",
              over ? "border-brand bg-brand/5" : "border-input hover:border-brand/60 hover:bg-brand/5",
            )}
          >
            <span className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-brand/25">
              <FileUp className="size-5" />
            </span>
            <span className="font-semibold">눌러서 고르거나 끌어다 놓으세요</span>
            <span className="text-xs text-muted-foreground">
              HWP · HWPX · 최대 {MAX_FILES}개 · 파일당 {MAX_MB}MB
            </span>
          </div>
          <input
            ref={inputRef}
            type="file"
            hidden
            multiple
            accept=".hwp,.hwpx"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {items.length > 0 && (
            <ul className="mt-3 space-y-2">
              {items.map((p) => (
                <li key={p.key} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                  <FileBadge ext={p.status === "done" ? "pdf" : extOf(p.file.name)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.status === "done" ? pdfName(p.file.name) : p.file.name}</span>
                    <span className={cn("block truncate text-xs", p.error ? "text-destructive" : "text-muted-foreground")}>
                      {p.error ||
                        (p.status === "converting" && p.note
                          ? `PDF로 바꾸는 중 · ${p.note}`
                          : p.pdf
                            ? `${formatSize(p.file.size)} → PDF ${formatSize(p.pdf.size)}`
                            : formatSize(p.file.size))}
                    </span>
                  </span>
                  {p.status === "done" && p.url ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => save(p.url!, pdfName(p.file.name))}>
                      <Download /> 받기
                    </Button>
                  ) : busy || p.status !== "waiting" ? (
                    <StatusPill status={p.status} />
                  ) : (
                    <button
                      type="button"
                      aria-label="빼기"
                      className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => setItems(items.filter((x) => x.key !== p.key))}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex gap-2">
            <Button type="button" variant="brand" size="lg" className="flex-1" disabled={busy || !pending || items.length === 0} onClick={convertAll}>
              {busy ? "PDF로 바꾸는 중… 창을 닫지 마세요" : "PDF로 바꾸고 내려받기"}
            </Button>
            {items.length > 0 && !busy && (
              <Button type="button" variant="outline" size="lg" onClick={clear} aria-label="모두 지우기">
                <Trash2 />
              </Button>
            )}
          </div>
          {notice && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{notice}</p>}
        </Card>

        <div className="mt-4 flex gap-2.5 rounded-xl border bg-brand/5 px-4 py-3.5 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-brand" />
          <p className="text-muted-foreground">
            <b className="text-foreground">미리보기판</b>이에요. 비밀번호 걸린 공유 링크 · QR 코드 · 로그인은 곧 열려요. 수식 · 글상자가 많은 문서는 원본과 조금 다를 수
            있으니 내려받은 PDF를 한 번 확인해 주세요.
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Wordmark /> · 무료 · 파일은 이 기기 밖으로 나가지 않아요
        </p>
      </div>
    </div>
  );
}
