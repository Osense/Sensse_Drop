"use client";

import * as React from "react";
import { CircleCheck, FileUp, Loader2, Lock, Plus, Send, Undo2, X } from "lucide-react";
import { Countdown } from "@/components/countdown";
import { FileBadge } from "@/components/file-badge";
import { ShareMessage } from "@/components/share-message";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, localSubmissions, type CollectInfo, type LocalSubmission } from "@/lib/api";
import { ACCEPT, isAllowed } from "@/lib/file-types";
import { extOf, formatDate, formatSize } from "@/lib/format";
import { uploadFile } from "@/lib/upload";
import { cn } from "@/lib/utils";

type Picked = { key: string; file: File; status: "waiting" | "uploading" | "done" | "error"; note?: string; error?: string };
type MineFile = { id: string; name: string; ext: string; size: number; status: string; submitter: string; createdAt: string | null };
type Mine = LocalSubmission & { files: MineFile[] };

const NAME_KEY = "sensedrop.submit.name";

/** 학생 화면: 수합 링크 (/<코드>) — 이름을 적고 파일을 내요. 다른 학생이 낸 파일은 보이지 않아요. */
export function SubmitView({ id, info: first }: { id: string; info: CollectInfo }) {
  const [info, setInfo] = React.useState(first);
  const [name, setName] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [files, setFiles] = React.useState<Picked[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [mine, setMine] = React.useState<Mine[]>([]);
  const [adding, setAdding] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const maxBytes = info.maxFileMb == null ? Infinity : info.maxFileMb * 1024 * 1024;

  const loadMine = React.useCallback(async () => {
    const out: Mine[] = [];
    for (const s of localSubmissions.all(id)) {
      try {
        const r = await api<{ files: MineFile[] }>(`/api/s/${id}/mine`, { headers: { "X-Submit-Token": s.token } });
        if (r.files.length) out.push({ ...s, files: r.files });
        else localSubmissions.remove(id, s.token);
      } catch {}
    }
    setMine(out);
  }, [id]);

  React.useEffect(() => {
    try {
      setName(localStorage.getItem(NAME_KEY) || "");
    } catch {}
    loadMine();
  }, [loadMine]);

  const refreshInfo = React.useCallback(() => {
    api<CollectInfo>(`/api/s/${id}`)
      .then(setInfo)
      .catch(() => setInfo((i) => ({ ...i, open: false })));
  }, [id]);

  function addFiles(list: FileList | File[]) {
    setNotice(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      if (!isAllowed(extOf(file.name))) {
        setNotice(`이 형식은 낼 수 없어요: ${file.name} (한글 · PDF · 오피스 문서 · 이미지 · 압축 · 음성 · 영상 가능)`);
        continue;
      }
      if (file.size === 0) {
        setNotice(`빈 파일이에요: ${file.name}`);
        continue;
      }
      if (file.size > maxBytes) {
        setNotice(`파일 하나에 ${formatSize(maxBytes)}까지 낼 수 있어요: ${file.name}`);
        continue;
      }
      if (next.some((p) => p.file.name === file.name && p.file.size === file.size)) continue;
      if (next.length >= info.perPerson) {
        setNotice(`한 번에 ${info.perPerson}개까지 낼 수 있어요.`);
        break;
      }
      next.push({ key: `${file.name}-${file.size}-${Math.random()}`, file, status: "waiting" });
    }
    setFiles(next);
  }

  const setStatus = (key: string, patch: Partial<Picked>) => setFiles((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    if (!name.trim()) return setNotice(`${info.nameLabel}을 적어 주세요.`);
    if (files.length === 0) return setNotice("낼 파일을 골라 주세요.");
    setBusy(true);
    try {
      const res = await api<{ token: string; name: string; files: { id: string; kind: "pdf" | "original" }[] }>(`/api/s/${id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password: pw, files: files.map((p) => ({ name: p.file.name, size: p.file.size })) }),
      });
      try {
        localStorage.setItem(NAME_KEY, res.name);
      } catch {}
      localSubmissions.add(id, { token: res.token, name: res.name, at: new Date().toISOString() });
      let failed = 0;
      for (let i = 0; i < files.length; i++) {
        const p = files[i];
        setStatus(p.key, { status: "uploading" });
        try {
          await uploadFile({
            shareId: id,
            fileId: res.files[i].id,
            kind: res.files[i].kind,
            blob: p.file,
            name: p.file.name,
            headers: { "X-Submit-Token": res.token },
            onProgress: (r) => p.file.size > 4 * 1024 * 1024 && setStatus(p.key, { note: `${Math.floor(r * 100)}%` }),
          });
          setStatus(p.key, { status: "done", note: undefined });
        } catch (err) {
          failed++;
          setStatus(p.key, { status: "error", error: (err as Error).message });
        }
      }
      await loadMine();
      if (failed === 0) {
        setFiles([]);
        setAdding(false);
      } else {
        setNotice(`${failed}개를 올리지 못했어요. 인터넷 연결을 확인하고, 올리지 못한 제출은 취소한 뒤 다시 내 주세요.`);
      }
    } catch (err) {
      setNotice((err as Error).message);
      if ((err as { status?: number }).status === 410) refreshInfo();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(s: Mine) {
    if (!confirm(`${formatDate(s.at)}에 낸 파일 ${s.files.length}개를 취소할까요? 선생님 화면에서도 지워져요.`)) return;
    try {
      await api(`/api/s/${id}/mine`, { method: "DELETE", headers: { "X-Submit-Token": s.token } });
      localSubmissions.remove(id, s.token);
    } catch (err) {
      alert((err as Error).message);
    }
    loadMine();
  }

  const showForm = info.open && (mine.length === 0 || adding);

  return (
    <div className="relative">
      <div className="sticky top-16 z-30 border-b bg-background/85 py-2.5 backdrop-blur-xl">
        <div className="flex flex-col items-center gap-0.5 px-4 text-center">
          {info.open ? (
            <>
              <Countdown expiresAt={info.deadline} onExpire={refreshInfo} size="lg" label="제출 마감까지" doneText="제출 마감" />
              <span className="text-xs text-muted-foreground">{formatDate(info.deadline)}까지 낼 수 있어요</span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-lg font-semibold text-muted-foreground">
              <Lock className="size-5" /> 제출이 마감됐어요
            </span>
          )}
        </div>
      </div>
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-72" />
      <div className="mx-auto max-w-lg px-4 py-8 sm:py-12">
        <div className="mb-5 animate-fade-up">
          <p className="text-sm font-semibold text-brand">과제 제출</p>
          <h1 className="mt-1.5 text-[clamp(1.9rem,8vw,2.75rem)] font-extrabold leading-[1.15] tracking-tight">{info.title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            한 번에 {info.perPerson}개까지 · 파일당 {info.maxFileMb == null ? "크기 제한 없음" : formatSize(maxBytes)} · 낸 파일은 선생님만 볼 수 있어요
          </p>
        </div>

        <ShareMessage text={info.message} className="mb-4" />

        {mine.length > 0 && (
          <Card className="mb-4 overflow-hidden border-emerald-500/40">
            <div className="flex items-center gap-2 bg-emerald-500/10 px-4 py-3 font-semibold text-emerald-700 dark:text-emerald-300">
              <CircleCheck className="size-5" /> 제출했어요
            </div>
            <ul className="divide-y">
              {mine.map((s) => (
                <li key={s.token} className="p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    <b className="min-w-0 flex-1 truncate">{s.name}</b>
                    <span className="text-xs text-muted-foreground">{formatDate(s.at)}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {s.files.map((f) => (
                      <li key={f.id} className="flex items-center gap-2.5">
                        <FileBadge ext={f.ext} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{f.name}</span>
                          <span className="block text-xs text-muted-foreground">{formatSize(f.size)}</span>
                        </span>
                        <StatusPill status={f.status === "done" ? "done" : f.status === "error" ? "error" : "uploading"} />
                      </li>
                    ))}
                  </ul>
                  {info.open && (
                    <Button variant="ghost" size="sm" className="mt-2 text-muted-foreground" onClick={() => cancel(s)}>
                      <Undo2 /> 이 제출 취소
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {info.open && !adding && (
              <div className="border-t p-3">
                <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
                  <Plus /> 파일 더 내기
                </Button>
              </div>
            )}
          </Card>
        )}

        {!info.open && mine.length === 0 && (
          <Card className="p-8 text-center">
            <h2 className="text-lg font-bold">제출이 마감됐어요</h2>
            <p className="mt-2 text-sm text-muted-foreground">더 낼 수 없어요. 늦게 냈다면 선생님께 직접 말씀드려 주세요.</p>
          </Card>
        )}

        {showForm && (
          <Card className="p-5 sm:p-6">
            <form onSubmit={submit} className="space-y-4" autoComplete="off">
              <div className="space-y-1.5">
                <label htmlFor="who" className="font-semibold">
                  {info.nameLabel}
                </label>
                <Input
                  id="who"
                  value={name}
                  maxLength={30}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={info.nameLabel === "이름" ? "예) 김하늘" : `예) ${info.nameLabel.includes("반") ? "2반 15번 김하늘" : "30215 김하늘"}`}
                  className="h-12 text-base"
                  disabled={busy}
                />
              </div>
              {info.needsPassword && (
                <div className="space-y-1.5">
                  <label htmlFor="pw" className="flex items-center gap-1.5 font-semibold">
                    <Lock className="size-4 text-brand" /> 제출 비밀번호
                  </label>
                  <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="선생님께 받은 비밀번호" className="h-12 text-base" disabled={busy} />
                </div>
              )}

              <div>
                <span className="font-semibold">낼 파일</span>
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
                    "mt-1.5 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                    over ? "border-brand bg-brand/5" : "border-input hover:border-brand/60 hover:bg-brand/5",
                  )}
                >
                  <span className="grid size-11 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-brand/25">
                    <FileUp className="size-5" />
                  </span>
                  <span className="font-semibold">눌러서 파일 고르기</span>
                  <span className="text-xs text-muted-foreground">휴대폰에서는 사진 · 파일 앱에서 고를 수 있어요 · 최대 {info.perPerson}개</span>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  hidden
                  multiple={info.perPerson > 1}
                  accept={ACCEPT}
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                {files.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {files.map((p) => (
                      <li key={p.key} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                        <FileBadge ext={extOf(p.file.name)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.file.name}</span>
                          <span className={cn("block truncate text-xs", p.error ? "text-destructive" : "text-muted-foreground")}>
                            {p.error || `${formatSize(p.file.size)}${p.note ? ` · 올리는 중 ${p.note}` : ""}`}
                          </span>
                        </span>
                        {busy || p.status !== "waiting" ? (
                          <StatusPill status={p.status} />
                        ) : (
                          <button type="button" aria-label="빼기" className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => setFiles(files.filter((x) => x.key !== p.key))}>
                            <X className="size-4" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Button type="submit" variant="brand" size="lg" className="w-full" disabled={busy || files.length === 0 || !name.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />} {busy ? "내는 중… 창을 닫지 마세요" : "제출하기"}
              </Button>
              {adding && !busy && (
                <Button type="button" variant="ghost" className="w-full" onClick={() => setAdding(false)}>
                  그만두기
                </Button>
              )}
              {notice && <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{notice}</p>}
            </form>
          </Card>
        )}

        <p className="mt-4 text-center text-xs text-muted-foreground">이 기기에서 낸 제출은 마감 전까지 여기서 확인하고 취소할 수 있어요.</p>
      </div>
    </div>
  );
}
