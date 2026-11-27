"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, ExternalLink, Loader2, Lock, RotateCw, ShieldCheck, Upload } from "lucide-react";
import { uploadFile } from "@/lib/upload";
import { isHangul } from "@/lib/file-types";
import { FileBadge } from "@/components/file-badge";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShareMessage } from "@/components/share-message";
import { Countdown } from "@/components/countdown";
import { QrButtons, QrViewer, saveQrImage } from "@/components/qr-viewer";
import { api, downloadOwnFile, type ManagedFile, type ManagedShare } from "@/lib/api";
import { hwpToPdf } from "@/lib/convert";
import { decryptName, localNames, sessionKeys, unlockWithPassword } from "@/lib/e2e";
import { Dialog } from "@/components/ui/dialog";
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
  shareKey,
  onDeleted,
  onMissing,
}: {
  id: string;
  headers: () => Promise<Record<string, string>>;
  /** 방금 만든 링크라면 비밀번호를 함께 복사할 수 있게 */
  password?: string;
  /** 방금 만든 링크의 열쇠 (없으면 비밀번호를 넣어 풀어요) */
  shareKey?: Uint8Array<ArrayBuffer>;
  onDeleted?: () => void;
  onMissing?: () => void;
}) {
  const [share, setShare] = React.useState<ManagedShare | null>(null);
  const [key, setKey] = React.useState<Uint8Array<ArrayBuffer> | null>(() => shareKey ?? sessionKeys.get(id));
  const [names, setNames] = React.useState<Record<string, string>>(() => localNames.get(id));
  // 잠긴 파일 이름: 열쇠가 있으면 풀어서 보여 줘요 (없으면 이 기기에 적어 둔 이름, 그것도 없으면 '파일 1.hwp')
  React.useEffect(() => {
    if (!key || !share) return;
    let live = true;
    Promise.all(share.files.filter((f) => f.nameEnc).map(async (f) => [f.id, await decryptName(key, f.id, f.nameEnc!).catch(() => f.name)] as const)).then((pairs) => {
      if (live && pairs.length) setNames((n) => ({ ...n, ...Object.fromEntries(pairs) }));
    });
    return () => {
      live = false;
    };
  }, [key, share]);
  const nameOf = (f: { id: string; name: string }) => names[f.id] ?? f.name;
  const [qr, setQr] = React.useState("");
  const [qrOpen, setQrOpen] = React.useState(false);
  const closeQr = React.useCallback(() => setQrOpen(false), []);
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

  /** 지금 닫기: 받는 사람은 더 이상 못 열고 파일은 바로 지움. 기록은 '배포 기록'에 30일 남음 */
  async function remove() {
    if (!confirm("이 링크를 지금 닫을까요? 받는 사람은 더 이상 열 수 없고, 올린 파일은 바로 지워져요.")) return;
    await api(`/api/shares/${id}/close`, { method: "POST", headers: await headers() }).catch(() => {});
    onDeleted?.();
  }

  const [fixing, setFixing] = React.useState<string | null>(null);
  const pickRef = React.useRef<HTMLInputElement>(null);
  const fixTarget = React.useRef<string | null>(null);

  const [progress, setProgress] = React.useState<Record<string, number>>({});

  /**
   * 실패한 한글 파일: 같은 파일(또는 직접 만든 PDF)을 다시 골라 이 브라우저에서 바꿔 올리기.
   * 올리다 끊긴 파일: 같은 파일을 다시 골라 이어 올리기 (큰 파일은 올린 조각 다음부터)
   */
  /** 잠긴 링크에 다시 올리려면 열쇠가 필요해요: 비밀번호를 넣어 풀기 */
  /** 열쇠가 생기면 이어서 할 일: 다시 올릴 파일, 또는 받아 볼 파일 */
  type Pending = { upload: File } | { get: ManagedFile; kind: "pdf" | "original" };
  const [unlock, setUnlock] = React.useState<Pending | null>(null);
  const [unlockPw, setUnlockPw] = React.useState("");
  const [unlockErr, setUnlockErr] = React.useState<string | null>(null);
  const [unlocking, setUnlocking] = React.useState(false);
  async function doUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!share?.enc?.wrap || !unlock) return;
    setUnlocking(true);
    setUnlockErr(null);
    try {
      const k = await unlockWithPassword(share.id, share.enc, unlockPw);
      setKey(k);
      const next = unlock;
      setUnlock(null);
      setUnlockPw("");
      if ("upload" in next) reupload(next.upload, k);
      else getOwn(next.get, next.kind, k);
    } catch (err) {
      setUnlockErr((err as Error).message);
    } finally {
      setUnlocking(false);
    }
  }

  async function reupload(file: File, k: Uint8Array<ArrayBuffer> | null = key) {
    const fileId = fixTarget.current;
    const f = share?.files.find((x) => x.id === fileId);
    if (!fileId || !share || !f) return;
    if (share.enc && !k) {
      setUnlockErr(null);
      setUnlock({ upload: file });
      return;
    }
    const shareKey = share.enc ? k : null;
    setFixing(fileId);
    try {
      const h = await headers();
      const onProgress = (r: number) => setProgress((p) => ({ ...p, [fileId]: r }));
      if (f.status === "error") {
        const pdf = /\.pdf$/i.test(file.name) ? file : await hwpToPdf(file);
        await uploadFile({ shareId: id, fileId, kind: "pdf", blob: pdf, headers: h, shareKey });
      } else {
        if (file.size !== f.size) throw new Error(`처음에 고른 파일과 크기가 달라요. '${nameOf(f)}'(${formatSize(f.size)})을 골라 주세요.`);
        const hangul = isHangul(f.ext);
        if (f.ext === "pdf") await uploadFile({ shareId: id, fileId, kind: "pdf", blob: file, name: file.name, headers: h, shareKey, onProgress });
        if (hangul && share.output !== "original" && f.pdfSize == null) await uploadFile({ shareId: id, fileId, kind: "pdf", blob: await hwpToPdf(file), headers: h, shareKey });
        if ((hangul && share.output !== "pdf") || (!hangul && f.ext !== "pdf")) {
          await uploadFile({ shareId: id, fileId, kind: "original", blob: file, name: file.name, headers: h, shareKey, onProgress });
        }
      }
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setFixing(null);
      load();
    }
  }

  const [getting, setGetting] = React.useState<string | null>(null);
  /** 내가 올린 파일 받아 보기 (무엇을 보냈는지 확인) */
  async function getOwn(f: ManagedFile, kind: "pdf" | "original", k: Uint8Array<ArrayBuffer> | null = key) {
    // 잠긴 링크는 열쇠가 있어야 풀어 볼 수 있어요 (없으면 비밀번호를 물어요)
    if (share?.enc && !k) {
      setUnlockErr(null);
      setUnlock({ get: f, kind });
      return;
    }
    setGetting(`${f.id}-${kind}`);
    try {
      let real = nameOf(f);
      if (k && f.nameEnc) real = await decryptName(k, f.id, f.nameEnc).catch(() => real);
      const fallback = kind === "pdf" ? `${real.replace(/\.[A-Za-z0-9]+$/, "")}.pdf` : real;
      await downloadOwnFile(`/api/shares/${id}/files/${f.id}/download?kind=${kind}`, await headers(), fallback, share?.enc ? k : null);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setGetting(null);
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Countdown expiresAt={share.expiresAt} />
          <span className="text-sm text-muted-foreground">{formatDate(share.expiresAt)}에 링크와 파일이 지워져요</span>
        </div>
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
            <button type="button" onClick={() => setQrOpen(true)} className="group relative shrink-0 self-start" aria-label="QR 코드 크게 보기">
              <img src={qr} alt="공유 링크 QR 코드" className="size-36 rounded-lg border bg-white p-1.5 transition-transform group-hover:scale-[1.03]" />
              <span className="absolute inset-x-0 bottom-1.5 mx-auto w-fit rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">눌러서 크게</span>
            </button>
          )}
          <div className="flex-1 space-y-3 text-sm text-muted-foreground">
            <p>메신저로 링크와 비밀번호를 보내거나, 교실 화면에 QR 코드를 띄워 주세요.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => copy(message, "msg")}>
                {copied === "msg" ? <Check /> : <Copy />}
                {password ? "링크 + 비밀번호 복사" : "제목 + 링크 복사"}
              </Button>
              <QrButtons onOpen={() => setQrOpen(true)} onSave={() => saveQrImage(share.url, share.title, share.message)} />
              <a href={share.url} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <ExternalLink /> 받는 화면 보기
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">파일 {share.files.length}개</h3>
          {share.enc && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand" title="파일과 파일 이름은 비밀번호로 잠겨 있어 서버도 열어 볼 수 없어요">
              <ShieldCheck className="size-3.5" /> 종단간 암호화
            </span>
          )}
        </div>
        <ul className="mt-3 space-y-2">
          {share.files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
              <FileBadge ext={f.ext} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={nameOf(f)}>
                  {nameOf(f)}
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
              {f.status === "done" ? (
                <span className="flex shrink-0 items-center gap-1">
                  {(
                    [
                      ["pdf", f.ext === "pdf" || (isHangul(f.ext) && share.output !== "original")],
                      ["original", isHangul(f.ext) ? share.output !== "pdf" : f.ext !== "pdf"],
                    ] as const
                  )
                    .filter(([, on]) => on)
                    .map(([kind]) => (
                      <Button
                        key={kind}
                        variant="outline"
                        size="sm"
                        className="h-8 px-2.5"
                        title={kind === "pdf" ? "올린 PDF 받아 보기" : "올린 원본 받아 보기"}
                        disabled={getting === `${f.id}-${kind}`}
                        onClick={() => getOwn(f, kind)}
                      >
                        {getting === `${f.id}-${kind}` ? <Loader2 className="animate-spin" /> : <Download />}
                        {kind === "pdf" ? "PDF" : isHangul(f.ext) ? "원본" : "받기"}
                      </Button>
                    ))}
                </span>
              ) : (
                <StatusPill status={f.status} />
              )}
              {fixing === f.id && progress[f.id] != null && <span className="text-xs tabular-nums text-brand">{Math.floor(progress[f.id] * 100)}%</span>}
              {f.status === "uploading" && fixing !== f.id && (
                <Button
                  variant="outline"
                  size="sm"
                  title="같은 파일을 다시 골라 이어서 올려요"
                  onClick={() => {
                    fixTarget.current = f.id;
                    pickRef.current?.click();
                  }}
                >
                  <Upload /> 이어 올리기
                </Button>
              )}
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
          accept={share.files.find((x) => x.id === fixTarget.current)?.status === "uploading" ? undefined : ".hwp,.hwpx,.pdf"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) reupload(file);
          }}
        />
        <div className="mt-5 flex justify-end">
          <button onClick={remove} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-destructive hover:text-destructive")}>
            <Lock /> 지금 닫기
          </button>
        </div>
      </div>
      <Dialog
        open={unlock != null}
        onClose={() => setUnlock(null)}
        title="비밀번호를 넣어 주세요"
        description="파일은 이 링크의 비밀번호로 잠겨 있어요. 서버는 비밀번호를 모르기 때문에, 파일을 다시 올리거나 받아 보려면 한 번 넣어야 해요."
      >
        <form onSubmit={doUnlock} className="mt-4 space-y-3">
          <Input type="password" autoFocus autoComplete="off" value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)} placeholder="링크 비밀번호" className="h-11" />
          {unlockErr && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{unlockErr}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setUnlock(null)}>
              취소
            </Button>
            <Button type="submit" variant="brand" disabled={!unlockPw || unlocking}>
              {unlocking ? "확인 중…" : "확인"}
            </Button>
          </div>
        </form>
      </Dialog>
      <QrViewer url={share.url} title={share.title} message={share.message} expiresAt={share.expiresAt} open={qrOpen} onClose={closeQr} />
    </Card>
  );
}
