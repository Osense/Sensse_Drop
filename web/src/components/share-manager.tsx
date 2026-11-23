"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Check, Copy, ExternalLink, RotateCw, Trash2 } from "lucide-react";
import { FileBadge } from "@/components/file-badge";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShareMessage } from "@/components/share-message";
import { api, type ManagedShare } from "@/lib/api";
import { hwpToPdf } from "@/lib/convert";
import { formatDate, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 만든 링크 한 개의 상태 · 공유 · 삭제.
 * headers: 비회원은 X-Admin-Token, 회원은 Authorization
 */
export function ShareManager({
  id,
  headers,
  password,
  onDeleted,
  onMissing,
}: {
  id: string;
  headers: () => Promise<Record<string, string>>;
  /** 방금 만든 링크라면 비밀번호를 함께 복사할 수 있게 */
  password?: string;
  onDeleted?: () => void;
  onMissing?: () => void;
}) {
  const [share, setShare] = React.useState<ManagedShare | null>(null);
  const [qr, setQr] = React.useState("");
  const [copied, setCopied] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = React.useCallback(async () => {
    try {
      const data = await api<ManagedShare>(`/api/shares/${id}/manage`, { headers: await headers() });
      setShare(data);
      clearTimeout(timer.current);
      if (data.files.some((f) => f.status === "uploading" || f.status === "converting")) {
        timer.current = setTimeout(load, 2500);
      }
    } catch (e) {
      if ((e as { status?: number }).status === 404) onMissing?.();
    }
  }, [id, headers, onMissing]);

  React.useEffect(() => {
    load();
    return () => clearTimeout(timer.current);
  }, [load]);

  React.useEffect(() => {
    if (share?.url) QRCode.toDataURL(share.url, { margin: 1, width: 320 }).then(setQr).catch(() => {});
  }, [share?.url]);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  }

  async function remove() {
    if (!confirm("이 링크와 올린 파일을 모두 지울까요? 받는 사람도 더 이상 받을 수 없어요.")) return;
    await api(`/api/shares/${id}`, { method: "DELETE", headers: await headers() }).catch(() => {});
    onDeleted?.();
  }

  const [fixing, setFixing] = React.useState<string | null>(null);
  const pickRef = React.useRef<HTMLInputElement>(null);
  const fixTarget = React.useRef<string | null>(null);

  /** 실패한 파일: 같은 파일(또는 직접 만든 PDF)을 다시 골라 이 브라우저에서 바꿔 올리기 */
  async function reupload(file: File) {
    const fileId = fixTarget.current;
    if (!fileId || !share) return;
    setFixing(fileId);
    try {
      const pdf = /\.pdf$/i.test(file.name) ? file : await hwpToPdf(file);
      await api(`/api/shares/${id}/files/${fileId}?kind=pdf`, {
        method: "PUT",
        headers: { ...(await headers()), "Content-Type": "application/octet-stream" },
        body: pdf,
      });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setFixing(null);
      load();
    }
  }

  if (!share) {
    return <Card className="h-64 animate-pulse bg-muted/40" />;
  }

  const message = `[${share.title}]\n${share.url}${password ? `\n비밀번호: ${password}` : ""}`;

  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-gradient-to-br from-brand/10 via-transparent to-brand-2/10 p-5 sm:p-6">
        <p className="text-xs font-semibold text-brand">공유 링크</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight">{share.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{formatDate(share.expiresAt)}까지 받을 수 있어요</p>
        <ShareMessage text={share.message} className="mt-3 bg-background/70" />

        <div className="mt-4 flex gap-2">
          <Input readOnly value={share.url} className="h-11 bg-background font-medium" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="brand" className="h-11 shrink-0" onClick={() => copy(share.url, "url")}>
            {copied === "url" ? <Check /> : <Copy />}
            {copied === "url" ? "복사됨" : "복사"}
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="공유 링크 QR 코드" className="size-36 shrink-0 rounded-lg border bg-white p-1.5" />
          )}
          <div className="flex-1 space-y-3 text-sm text-muted-foreground">
            <p>메신저로 링크와 비밀번호를 보내거나, 교실 화면에 QR 코드를 띄워 주세요.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => copy(message, "msg")}>
                {copied === "msg" ? <Check /> : <Copy />}
                {password ? "링크 + 비밀번호 복사" : "제목 + 링크 복사"}
              </Button>
              <a href={share.url} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLink /> 받는 화면 보기
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <h3 className="text-sm font-semibold">파일 {share.files.length}개</h3>
        <ul className="mt-3 space-y-2">
          {share.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
              <FileBadge ext={f.ext} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={f.name}>
                  {f.name}
                </span>
                {f.error ? (
                  <span className="block truncate text-xs text-destructive" title={f.error}>
                    {f.error}
                  </span>
                ) : (
                  <span className="block text-xs text-muted-foreground">
                    {formatSize(f.size)}
                    {f.pdfSize ? ` → PDF ${formatSize(f.pdfSize)}` : ""}
                  </span>
                )}
              </span>
              <StatusPill status={f.status} />
              {f.status === "error" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label="파일을 다시 골라 PDF로 올리기"
                  title="파일을 다시 골라 PDF로 올리기"
                  disabled={fixing === f.id}
                  onClick={() => {
                    fixTarget.current = f.id;
                    pickRef.current?.click();
                  }}
                >
                  <RotateCw className={fixing === f.id ? "animate-spin" : undefined} />
                </Button>
              )}
            </li>
          ))}
        </ul>
        <input
          ref={pickRef}
          type="file"
          hidden
          accept=".hwp,.hwpx,.pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) reupload(file);
          }}
        />
        <div className="mt-5 flex justify-end">
          <button onClick={remove} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-destructive hover:text-destructive")}>
            <Trash2 /> 링크 지우기
          </button>
        </div>
      </div>
    </Card>
  );
}
