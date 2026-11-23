"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff, FileUp, Lock, Plus, Sparkles, X } from "lucide-react";
import { FileBadge } from "@/components/file-badge";
import { ShareManager } from "@/components/share-manager";
import { StatusPill } from "@/components/status-pill";
import { Wordmark } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioCard } from "@/components/ui/radio-card";
import { api, localLinks, type AppConfig } from "@/lib/api";
import { hwpToPdf, preloadConverter } from "@/lib/convert";
import { useAuth } from "@/lib/auth";
import { baseOf, displayName, extOf, formatSize } from "@/lib/format";
import { FileNameInput } from "@/components/file-name-input";
import { ExpirePicker } from "@/components/expire-picker";
import { cn } from "@/lib/utils";
import { ACCEPT, isAllowed, isHangul } from "@/lib/file-types";

const DEFAULT_CONFIG: AppConfig = {
  guest: { maxFiles: 2, maxFileMb: 5 },
  member: { maxFiles: 10, maxFileMb: 20 },
  expireOptions: [
    { minutes: 10, label: "10분 후" },
    { minutes: 60, label: "1시간 후" },
    { minutes: 4320, label: "3일 후" },
    { minutes: 10080, label: "7일 후" },
  ],
  guestExpireMinutes: [10],
  defaultExpireMinutes: { guest: 10, member: 4320 },
};

const OUTPUTS = [
  { value: "pdf", title: "PDF로 보내기", desc: "받는 사람은 PDF만" },
  { value: "both", title: "PDF + 원본", desc: "둘 다 받을 수 있게" },
  { value: "original", title: "원본 그대로", desc: "변환하지 않아요" },
] as const;

type Picked = { key: string; file: File; label: string; status: "waiting" | "uploading" | "converting" | "done" | "error"; error?: string; note?: string };
type Created = { id: string; adminToken: string; password: string };

export function HostView() {
  const auth = useAuth();
  const member = Boolean(auth.session);
  const [config, setConfig] = React.useState<AppConfig>(DEFAULT_CONFIG);
  const limits = member ? config.member : config.guest;

  const [files, setFiles] = React.useState<Picked[]>([]);
  const [output, setOutput] = React.useState<string>("pdf");
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [pickedMinutes, setMinutes] = React.useState<number | null>(null);
  // 비회원은 10분만. 고른 값이 없거나 쓸 수 없는 값이면 기본값으로.
  const minutesAllowed = (m: number) => member || config.guestExpireMinutes.includes(m);
  const minutes =
    pickedMinutes != null && minutesAllowed(pickedMinutes)
      ? pickedMinutes
      : member
        ? config.defaultExpireMinutes.member
        : config.defaultExpireMinutes.guest;
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    api<AppConfig>("/api/config")
      .then((c) => setConfig(c))
      .catch(() => {});
  }, []);

  function addFiles(list: FileList | File[]) {
    setNotice(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      const ext = extOf(file.name);
      if (!isAllowed(ext)) {
        setNotice(`이 형식은 올릴 수 없어요: ${file.name} (한글 · PDF · 오피스 문서 · 이미지 · 압축 · 음성 · 영상 가능)`);
        continue;
      }
      if (file.size > limits.maxFileMb * 1024 * 1024) {
        setNotice(
          member
            ? `파일 하나는 ${limits.maxFileMb}MB까지예요: ${file.name}`
            : `비회원은 파일 하나에 ${limits.maxFileMb}MB까지예요. 로그인하면 ${config.member.maxFileMb}MB까지 올릴 수 있어요.`,
        );
        continue;
      }
      if (next.some((p) => p.file.name === file.name && p.file.size === file.size)) continue;
      if (next.length >= limits.maxFiles) {
        setNotice(
          member
            ? `한 번에 ${limits.maxFiles}개까지 올릴 수 있어요.`
            : `비회원은 한 번에 ${limits.maxFiles}개까지예요. 로그인하면 ${config.member.maxFiles}개까지 올릴 수 있어요.`,
        );
        break;
      }
      next.push({ key: `${file.name}-${file.size}-${Math.random()}`, file, label: baseOf(file.name), status: "waiting" });
    }
    setFiles(next);
    // HWP · HWPX 가 있으면 변환 엔진을 미리 받아 둡니다.
    if (next.some((p) => isHangul(extOf(p.file.name)))) preloadConverter().catch(() => {});
  }

  function setStatus(key: string, status: Picked["status"], error?: string, note?: string) {
    setFiles((prev) => prev.map((p) => (p.key === key ? { ...p, status, error, note } : p)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    if (files.length === 0) return setNotice("파일을 한 개 이상 올려 주세요.");
    if (password.length < 4) return setNotice("받는 사람 비밀번호를 4자 이상으로 정해 주세요.");

    setBusy(true);
    try {
      const headers = { "Content-Type": "application/json", ...(await auth.authHeaders()) };
      const res = await api<{ id: string; adminToken: string; files: { id: string }[] }>("/api/shares", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title,
          message,
          password,
          output,
          expireMinutes: minutes,
          files: files.map((p) => ({ name: displayName(p.label, p.file.name), size: p.file.size })),
        }),
      });
      localLinks.add({ id: res.id, adminToken: res.adminToken, title: title || "배포 자료", createdAt: new Date().toISOString() });

      // 파일마다: 이 브라우저에서 PDF로 바꾼 뒤 올립니다. (원본은 필요할 때만 올려요)
      for (let i = 0; i < files.length; i++) {
        const p = files[i];
        const fileId = res.files[i].id;
        const ext = extOf(p.file.name);
        // 한글만 보내는 방식을 따르고, PDF는 PDF로, 다른 형식은 원본 그대로 보냅니다.
        const needsPdf = isHangul(ext) && output !== "original";
        const needsOriginal = isHangul(ext) ? output !== "pdf" : ext !== "pdf";
        const put = (kind: "pdf" | "original", body: Blob) =>
          api<{ status: Picked["status"] }>(`/api/shares/${res.id}/files/${fileId}?kind=${kind}`, {
            method: "PUT",
            headers: { "X-Admin-Token": res.adminToken, "Content-Type": "application/octet-stream" },
            body,
          });
        try {
          let status: Picked["status"] = "uploading";
          if (needsPdf) {
            setStatus(p.key, "converting", undefined, "변환 엔진 준비 중");
            let pdf: Blob;
            try {
              pdf = await hwpToPdf(p.file, (done, total) => setStatus(p.key, "converting", undefined, `${Math.min(done + 1, total)}/${total}쪽`));
            } catch (err) {
              const message = (err as Error).message || "PDF로 바꾸지 못했어요.";
              await api(`/api/shares/${res.id}/files/${fileId}/fail`, {
                method: "POST",
                headers: { "X-Admin-Token": res.adminToken, "Content-Type": "application/json" },
                body: JSON.stringify({ error: message }),
              }).catch(() => {});
              throw new Error(message);
            }
            setStatus(p.key, "uploading");
            status = (await put("pdf", pdf)).status;
          }
          if (ext === "pdf") {
            setStatus(p.key, "uploading");
            status = (await put("pdf", p.file)).status;
          }
          if (needsOriginal) {
            setStatus(p.key, "uploading");
            status = (await put("original", p.file)).status;
          }
          setStatus(p.key, status);
        } catch (err) {
          setStatus(p.key, "error", (err as Error).message);
        }
      }
      setCreated({ id: res.id, adminToken: res.adminToken, password });
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCreated(null);
    setFiles([]);
    setTitle("");
    setMessage("");
    setPassword("");
    setOutput("pdf");
    setMinutes(null);
  }

  const headersFor = React.useCallback(async (): Promise<Record<string, string>> => {
    return created ? { "X-Admin-Token": created.adminToken } : {};
  }, [created]);

  if (created) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <ShareManager id={created.id} headers={headersFor} password={created.password} onDeleted={reset} onMissing={reset} />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={reset}>
            <Plus /> 새 링크 만들기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-80" />
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="mb-7 animate-fade-up">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            한글 파일 올리고, <span className="text-gradient">링크 하나로</span>
          </h1>
          <p className="mt-2 text-muted-foreground">
            한글(HWP · HWPX)은 보이는 그대로 PDF로 바꾸고, 이미지 · 오피스 문서 등 다른 파일은 그대로, 비밀번호 걸린 링크 하나로 나눠 줘요.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4" autoComplete="off">
          <Card className="p-5 sm:p-6">
            <Step n={1} title="자동 삭제 시간" />
            <ExpirePicker
              options={config.expireOptions}
              value={minutes}
              isAllowed={minutesAllowed}
              onChange={setMinutes}
              member={member}
              disabled={busy}
            />
          </Card>

          <Card className="p-5 sm:p-6">
            <Step n={2} title="파일 올리기" />
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
                한글 · PDF · 오피스 · 이미지 등 · 최대 {limits.maxFiles}개 · 파일당 {limits.maxFileMb}MB
              </span>
            </div>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
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
                      <FileNameInput
                        value={p.label}
                        ext={extOf(p.file.name)}
                        disabled={busy || p.status !== "waiting"}
                        onChange={(v) => setFiles((prev) => prev.map((x) => (x.key === p.key ? { ...x, label: v } : x)))}
                      />
                      <span className={cn("block truncate text-xs", p.error ? "text-destructive" : "text-muted-foreground")}>
                        {p.error || (p.note && p.status === "converting" ? `PDF로 바꾸는 중 · ${p.note}` : formatSize(p.file.size))}
                      </span>
                    </span>
                    {busy || p.status !== "waiting" ? (
                      <StatusPill status={p.status} />
                    ) : (
                      <button
                        type="button"
                        aria-label="빼기"
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => setFiles(files.filter((x) => x.key !== p.key))}
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {files.length > 0 && !busy && (
              <p className="mt-2 text-xs text-muted-foreground">파일 이름을 누르면 받는 사람에게 보일 이름을 바꿀 수 있어요.</p>
            )}

            {!member && auth.ready && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-brand/5 px-3 py-2.5 text-sm">
                <Sparkles className="size-4 shrink-0 text-brand" />
                <span className="flex-1 text-muted-foreground">
                  로그인하면 <b className="text-foreground">{config.member.maxFiles}개 · 파일당 {config.member.maxFileMb}MB</b>까지 올릴 수 있어요.
                </span>
                <Link href="/login/" className="shrink-0 font-semibold text-brand">
                  로그인
                </Link>
              </div>
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <Step n={3} title="한글 파일 보내는 방식" />
            <div className="grid gap-2 sm:grid-cols-3">
              {OUTPUTS.map((o) => (
                <RadioCard key={o.value} name="output" value={o.value} checked={output === o.value} onSelect={setOutput}>
                  <span>
                    <span className="block font-semibold">{o.title}</span>
                    <span className="block text-xs text-muted-foreground">{o.desc}</span>
                  </span>
                </RadioCard>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">PDF · 이미지 · 오피스 문서 등 다른 파일은 고른 방식과 상관없이 그대로 보내요.</p>
          </Card>

          <Card className="space-y-4 p-5 sm:p-6">
            <Step n={4} title="링크 설정" />
            <div className="space-y-1.5">
              <Label htmlFor="title">제목</Label>
              <Input id="title" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="예) 2학기 기말고사 3학년 수학" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="message">
                  안내 메시지 <span className="font-normal text-muted-foreground">(선택)</span>
                </Label>
                <span className="text-xs text-muted-foreground">{message.length}/1000</span>
              </div>
              <Textarea
                id="message"
                value={message}
                maxLength={1000}
                rows={3}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={"예) 3학년 여러분, 기말고사 수고 많았어요! 과목별 정답과 해설이에요.\n궁금한 점은 담임 선생님께 물어보세요."}
              />
              <p className="text-xs text-muted-foreground">어떤 자료인지, 인사말 등을 적으면 링크를 연 사람에게 바로 보여요. 비밀번호 같은 비밀 정보는 적지 마세요.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">받는 사람 비밀번호</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pw"
                  type={showPw ? "text" : "password"}
                  value={password}
                  maxLength={64}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="4자 이상"
                  className="pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? "비밀번호 숨기기" : "비밀번호 보기"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">링크를 받은 사람이 이 비밀번호를 넣어야 파일 목록이 보여요.</p>
            </div>
            <Button type="submit" variant="brand" size="lg" className="w-full" disabled={busy}>
              {busy ? "바꾸고 올리는 중… 창을 닫지 마세요" : "공유 링크 만들기"}
            </Button>
            {notice && <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{notice}</p>}
          </Card>
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Wordmark /> · 무료 · 올린 파일은 정한 시간이 지나면 지워져요
        </p>
      </div>
    </div>
  );
}

function Step({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-semibold">
      <span className="grid size-6 place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand">{n}</span>
      {title}
    </h2>
  );
}
