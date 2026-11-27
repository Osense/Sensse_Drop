"use client";

import * as React from "react";
import QRCode from "qrcode";
import { Check, CircleCheck, CircleDashed, Copy, Download, ExternalLink, FileArchive, Inbox, Loader2, Lock, LockOpen, Trash2, Users } from "lucide-react";
import { Countdown } from "@/components/countdown";
import { FileBadge } from "@/components/file-badge";
import { QrButtons, QrViewer, saveQrImage } from "@/components/qr-viewer";
import { ShareMessage } from "@/components/share-message";
import { StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, apiBlob, type ManagedFile, type ManagedShare } from "@/lib/api";
import { formatDate, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { makeZip, safeSegment, saveBlob } from "@/lib/zip";

/** 이름 비교용: 띄어쓰기 · 대소문자 무시 */
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

type Group = { name: string; files: ManagedFile[]; last: string };

function groupBySubmitter(files: ManagedFile[]): Group[] {
  const map = new Map<string, Group>();
  for (const f of files) {
    const name = f.submitter || "이름 없음";
    const g = map.get(norm(name)) ?? { name, files: [], last: "" };
    g.files.push(f);
    if ((f.createdAt ?? "") > g.last) g.last = f.createdAt ?? "";
    map.set(norm(name), g);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 명단에 있는 이름이 낸 사람 이름에 들어 있으면 낸 것으로 봐요 ("3번 김하늘" ↔ "김하늘") */
function matches(rosterName: string, groups: Group[]) {
  const r = norm(rosterName);
  return groups.some((g) => norm(g.name) === r || norm(g.name).includes(r));
}

/**
 * 수합 링크 한 개: 링크 · QR, 제출 현황(학생별), 안 낸 학생, ZIP 받기, 제출 마감 · 지금 닫기.
 * headers: 비회원은 X-Admin-Token, 회원은 Authorization
 */
export function CollectManager({
  id,
  headers,
  password,
  onDeleted,
  onMissing,
}: {
  id: string;
  headers: () => Promise<Record<string, string>>;
  password?: string;
  onDeleted?: () => void;
  onMissing?: () => void;
}) {
  const [share, setShare] = React.useState<ManagedShare | null>(null);
  const [qr, setQr] = React.useState("");
  const [qrOpen, setQrOpen] = React.useState(false);
  const closeQr = React.useCallback(() => setQrOpen(false), []);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [zip, setZip] = React.useState<{ done: number; total: number } | null>(null);
  const [layout, setLayout] = React.useState<"folders" | "flat">("folders");
  const [error, setError] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = React.useCallback(async () => {
    try {
      const data = await api<ManagedShare>(`/api/shares/${id}/manage`, { headers: await headers() });
      setShare(data);
      clearTimeout(timer.current);
      // 열려 있는 동안 새 제출을 5초마다 확인
      if (Date.parse(data.expiresAt) > Date.now()) timer.current = setTimeout(load, 5000);
    } catch (e) {
      if ((e as { status?: number }).status === 404) onMissing?.();
      else timer.current = setTimeout(load, 10000);
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

  async function setClosed(closed: boolean) {
    setBusy("collect");
    try {
      await api(`/api/shares/${id}/collect`, { method: "POST", headers: { ...(await headers()), "Content-Type": "application/json" }, body: JSON.stringify({ closed }) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      load();
    }
  }

  async function removeFile(f: ManagedFile) {
    if (!confirm(`${f.submitter ?? ""}의 '${f.name}'을 지울까요? 되돌릴 수 없어요.`)) return;
    setBusy(f.id);
    await api(`/api/shares/${id}/files/${f.id}`, { method: "DELETE", headers: await headers() }).catch((e) => setError((e as Error).message));
    setBusy(null);
    load();
  }

  async function closeLink() {
    if (!confirm("이 수합 링크를 지금 닫을까요? 학생은 더 이상 낼 수 없고, 모은 파일도 바로 지워져요. ZIP으로 받아 두셨나요?")) return;
    await api(`/api/shares/${id}/close`, { method: "POST", headers: await headers() }).catch(() => {});
    onDeleted?.();
  }

  const fileName = (f: ManagedFile) => (f.ext === "pdf" && !/\.pdf$/i.test(f.name) ? `${f.name}.pdf` : f.name);

  async function downloadOne(f: ManagedFile) {
    setBusy(f.id);
    try {
      const blob = await apiBlob(`/api/shares/${id}/files/${f.id}/download`, { headers: await headers() });
      saveBlob(blob, `${safeSegment(f.submitter ?? "")}_${fileName(f)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function downloadZip() {
    if (!share) return;
    const ready = share.files.filter((f) => f.status === "done");
    const total = ready.reduce((n, f) => n + (f.pdfSize ?? f.size), 0);
    if (total > 1.5 * 1024 ** 3 && !confirm(`모두 ${formatSize(total)}예요. 브라우저에서 ZIP으로 묶기엔 커서 멈출 수 있어요. 그래도 묶을까요? (안 되면 학생별로 받아 주세요)`)) return;
    setError(null);
    setZip({ done: 0, total: ready.length });
    try {
      const h = await headers();
      const entries: { path: string; blob: Blob }[] = [];
      // 4개씩 동시에 받기
      const queue = [...ready];
      const worker = async () => {
        for (let f = queue.shift(); f; f = queue.shift()) {
          const blob = await apiBlob(`/api/shares/${id}/files/${f.id}/download`, { headers: h });
          const who = safeSegment(f.submitter ?? "");
          entries.push({ path: layout === "folders" ? `${who}/${fileName(f)}` : `${who}_${fileName(f)}`, blob });
          setZip((z) => (z ? { ...z, done: z.done + 1 } : z));
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      entries.sort((a, b) => a.path.localeCompare(b.path, "ko"));
      const out = await makeZip(entries);
      saveBlob(out, `${safeSegment(share.title)}.zip`);
    } catch (e) {
      setError(`ZIP을 만들지 못했어요: ${(e as Error).message}`);
    } finally {
      setZip(null);
    }
  }

  if (!share) return <Card className="h-64 animate-pulse bg-muted/40" />;

  const c = share.collect;
  const groups = groupBySubmitter(share.files);
  const roster = c?.roster ?? [];
  const missing = roster.filter((r) => !matches(r, groups));
  const extra = roster.length ? groups.filter((g) => !roster.some((r) => norm(g.name) === norm(r) || norm(g.name).includes(norm(r)))) : [];
  const deadlinePassed = Boolean(c?.deadline && Date.parse(c.deadline) <= Date.now());
  const ended = Date.parse(share.expiresAt) <= Date.now() || Boolean(share.purged);
  const accepting = !ended && !c?.closedAt && !deadlinePassed;
  const readyCount = share.files.filter((f) => f.status === "done").length;
  const totalBytes = share.files.reduce((n, f) => n + (f.status === "done" ? (f.pdfSize ?? f.size) : 0), 0);
  const text = `[${share.title}] 과제 제출\n${share.url}${password ? `\n비밀번호: ${password}` : ""}`;

  return (
    <Card className="overflow-hidden">
      <div className="border-b bg-gradient-to-br from-brand/10 via-transparent to-brand-2/10 p-5 sm:p-6">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-brand">
          <Inbox className="size-3.5" /> 수합 링크
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight">{share.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {accepting ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" /> 제출 받는 중
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold text-muted-foreground">
              <Lock className="size-3.5" /> {ended ? "링크가 닫혔어요" : "제출 마감"}
            </span>
          )}
          {accepting && c?.deadline && <Countdown expiresAt={c.deadline} label="제출 마감까지" doneText="제출 마감" onExpire={load} />}
          {!ended && <span className="text-sm text-muted-foreground">{formatDate(share.expiresAt)}에 링크와 모은 파일이 지워져요</span>}
        </div>
        <ShareMessage text={share.message} className="mt-3 bg-background/70" />

        {!ended && (
          <>
            <div className="mt-4 flex gap-2">
              <Input readOnly value={share.url} className="h-11 bg-background font-medium" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="brand" className="h-11 shrink-0" onClick={() => copy(share.url, "url")}>
                {copied === "url" ? <Check /> : <Copy />}
                {copied === "url" ? "복사됨" : "복사"}
              </Button>
            </div>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
              {qr && (
                <button type="button" onClick={() => setQrOpen(true)} className="group relative shrink-0 self-start" aria-label="QR 코드 크게 보기">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="수합 링크 QR 코드" className="size-36 rounded-lg border bg-white p-1.5 transition-transform group-hover:scale-[1.03]" />
                  <span className="absolute inset-x-0 bottom-1.5 mx-auto w-fit rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">눌러서 크게</span>
                </button>
              )}
              <div className="flex-1 space-y-3 text-sm text-muted-foreground">
                <p>
                  교실 화면에 QR을 띄우거나 링크를 보내 주세요. 학생은 {c?.nameLabel || "이름"}을 적고 파일을 내요.
                  {c?.hasPassword ? " 제출 비밀번호도 함께 알려 주세요." : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => copy(text, "msg")}>
                    {copied === "msg" ? <Check /> : <Copy />}
                    {password ? "링크 + 비밀번호 복사" : "제목 + 링크 복사"}
                  </Button>
                  <QrButtons onOpen={() => setQrOpen(true)} onSave={() => saveQrImage(share.url, `${share.title} · 과제 제출`, share.message)} />
                  <a href={share.url} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    <ExternalLink /> 학생 화면 보기
                  </a>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="낸 학생" value={roster.length ? `${roster.length - missing.length}/${roster.length}명` : `${groups.length}명`} accent />
          <Stat label="받은 파일" value={`${readyCount}개`} />
          <Stat label="용량" value={formatSize(totalBytes) || "0B"} />
        </div>

        {!ended && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/30 p-3">
            <div className="mr-auto flex items-center gap-1 rounded-full bg-background p-1 text-xs font-semibold" role="radiogroup" aria-label="ZIP 안 정리 방식">
              {(
                [
                  ["folders", "학생별 폴더"],
                  ["flat", "이름_파일명"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={layout === k}
                  onClick={() => setLayout(k)}
                  className={cn("rounded-full px-3 py-1 transition-colors", layout === k ? "bg-brand/10 text-brand" : "text-muted-foreground hover:text-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button variant="brand" onClick={downloadZip} disabled={readyCount === 0 || zip != null}>
              {zip ? <Loader2 className="animate-spin" /> : <FileArchive />}
              {zip ? `묶는 중 ${zip.done}/${zip.total}` : `모두 ZIP으로 받기 (${readyCount}개)`}
            </Button>
          </div>
        )}
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</p>}

        {roster.length > 0 && (
          <div className="rounded-xl border p-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Users className="size-4 text-brand" /> 명단 확인
              <span className="ml-auto text-xs font-medium text-muted-foreground">
                안 낸 학생 {missing.length}명 · 낸 학생 {roster.length - missing.length}명
              </span>
            </h3>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {roster.map((r) => {
                const done = !missing.includes(r);
                return (
                  <li
                    key={r}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                      done ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-dashed text-muted-foreground",
                    )}
                  >
                    {done ? <CircleCheck className="size-3.5" /> : <CircleDashed className="size-3.5" />}
                    {r}
                  </li>
                );
              })}
            </ul>
            {missing.length > 0 && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => copy(missing.join(", "), "missing")}>
                {copied === "missing" ? <Check /> : <Copy />} 안 낸 학생 이름 복사
              </Button>
            )}
            {extra.length > 0 && <p className="mt-2 text-xs text-muted-foreground">명단에 없는 이름으로 낸 사람: {extra.map((g) => g.name).join(", ")}</p>}
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold">제출 현황 {groups.length > 0 && <span className="text-muted-foreground">· {groups.length}명</span>}</h3>
          {groups.length === 0 ? (
            <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              <Inbox className="size-7" />
              {ended ? "낸 파일이 없어요." : "아직 낸 학생이 없어요. 새로 내면 여기에 바로 보여요."}
            </div>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {groups.map((g) => (
                <li key={g.name} className="rounded-xl border">
                  <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand">{Array.from(g.name.replace(/[^\p{L}]/gu, "") || g.name)[0]}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.name}</span>
                    {g.last && <span className="shrink-0 text-xs text-muted-foreground">{formatDate(g.last)}</span>}
                  </div>
                  <ul className="divide-y">
                    {g.files.map((f) => (
                      <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                        <FileBadge ext={f.ext} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium" title={f.name}>
                            {f.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">{formatSize(f.size)}</span>
                        </span>
                        {f.status === "done" ? (
                          !ended && (
                            <Button variant="ghost" size="icon" className="size-8" aria-label={`${f.name} 받기`} title="받기" disabled={busy === f.id} onClick={() => downloadOne(f)}>
                              {busy === f.id ? <Loader2 className="animate-spin" /> : <Download />}
                            </Button>
                          )
                        ) : (
                          <StatusPill status={f.status} />
                        )}
                        {!ended && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={`${f.name} 지우기`}
                            title="지우기"
                            disabled={busy === f.id}
                            onClick={() => removeFile(f)}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!ended && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
            {accepting ? (
              <Button variant="outline" size="sm" disabled={busy === "collect"} onClick={() => setClosed(true)}>
                <Lock /> 제출 마감하기
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={busy === "collect"} onClick={() => setClosed(false)}>
                <LockOpen /> 다시 받기
              </Button>
            )}
            <button onClick={closeLink} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-destructive hover:text-destructive")}>
              <Trash2 /> 링크 닫고 파일 지우기
            </button>
          </div>
        )}
        {!ended && <p className="text-xs text-muted-foreground">제출을 마감해도 모은 파일은 {formatDate(share.expiresAt)}까지 남아 있어요. 그 전에 꼭 받아 두세요.</p>}
      </div>
      <QrViewer url={share.url} title={`${share.title} · 과제 제출`} message={share.message} expiresAt={c?.deadline ?? share.expiresAt} open={qrOpen} onClose={closeQr} />
    </Card>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-3", accent && "border-brand/40 bg-brand/5")}>
      <span className={cn("block text-xs font-medium text-muted-foreground", accent && "text-brand")}>{label}</span>
      <span className="mt-0.5 block text-lg font-extrabold tabular-nums tracking-tight">{value}</span>
    </div>
  );
}
