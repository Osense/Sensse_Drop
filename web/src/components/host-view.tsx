"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, EyeOff, FileUp, Lock, Plus, Sparkles, TriangleAlert, X } from "lucide-react";
import { Wizard, type WizardStep } from "@/components/wizard";
import { FileBadge } from "@/components/file-badge";
import { ShareManager } from "@/components/share-manager";
import { StatusPill } from "@/components/status-pill";
import { Wordmark } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioCard } from "@/components/ui/radio-card";
import { api, ApiError, localLinks } from "@/lib/api";
import { uploadFile } from "@/lib/upload";
import { periodLabel, sizeLabel, usePlan } from "@/lib/use-plan";
import { Dialog } from "@/components/ui/dialog";
import { ExpirePicker, fromLocalInput } from "@/components/expire-picker";
import { formatDate } from "@/lib/format";
import { hwpToPdf, preloadConverter } from "@/lib/convert";
import { useAuth } from "@/lib/auth";
import { baseOf, displayName, extOf, formatSize } from "@/lib/format";
import { FileNameInput } from "@/components/file-name-input";
import { cn } from "@/lib/utils";
import { ACCEPT, isAllowed, isHangul } from "@/lib/file-types";

/** 제목 최대 글자 수 (worker TITLE_MAX 와 같게). QR 화면 · 저장 이미지에서 두 줄 안에 들어가요 */
const TITLE_MAX = 40;

const OUTPUTS = [
  { value: "pdf", title: "PDF로 보내기", desc: "받는 사람은 PDF만" },
  { value: "both", title: "PDF + 원본", desc: "둘 다 받을 수 있게" },
  { value: "original", title: "원본 그대로", desc: "변환하지 않아요" },
] as const;

type Picked = { key: string; file: File; label: string; status: "waiting" | "uploading" | "converting" | "done" | "error"; error?: string; note?: string };
type Created = { id: string; adminToken: string; password: string };

export function HostView({ onHome }: { onHome?: () => void } = {}) {
  const auth = useAuth();
  const { config, plan: limits, me, refresh: refreshPlan } = usePlan();
  const guest = limits.id === "guest";
  const maxBytes = limits.maxFileMb == null ? Infinity : limits.maxFileMb * 1024 * 1024;
  const left = me?.quotaBytes != null ? Math.max(0, me.quotaBytes - me.usedBytes) : null;

  const [files, setFiles] = React.useState<Picked[]>([]);
  const [output, setOutput] = React.useState<string>("pdf");
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [picked, setPicked] = React.useState<number | "custom" | null>(null);
  const [customAt, setCustomAt] = React.useState("");
  // 고른 값이 없거나 이 요금제에서 쓸 수 없는 값이면 기본값으로.
  const expire: number | "custom" =
    picked === "custom" ? (limits.maxCustomMinutes > 0 ? "custom" : limits.defaultExpire) : picked != null && limits.expireMinutes.includes(picked) ? picked : limits.defaultExpire;
  const [beyond, setBeyond] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);
  const [step, setStep] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | File[]) {
    setNotice(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      const ext = extOf(file.name);
      if (!isAllowed(ext)) {
        setNotice(`이 형식은 올릴 수 없어요: ${file.name} (한글 · PDF · 오피스 문서 · 이미지 · 압축 · 음성 · 영상 가능)`);
        continue;
      }
      if (file.size > maxBytes) {
        setNotice(
          guest
            ? `나그네는 파일 하나에 ${limits.maxFileMb}MB까지예요. 로그인하면 ${config.plans.member.maxFileMb}MB까지 올릴 수 있어요.`
            : `${limits.name}은 파일 하나에 ${sizeLabel(limits.maxFileMb)}까지예요: ${file.name}. 프로는 파일 크기 제한이 없어요.`,
        );
        continue;
      }
      if (next.some((p) => p.file.name === file.name && p.file.size === file.size)) continue;
      if (next.length >= limits.maxFiles) {
        setNotice(
          guest
            ? `나그네는 한 번에 ${limits.maxFiles}개까지예요. 로그인하면 ${config.plans.member.maxFiles}개까지 올릴 수 있어요.`
            : `${limits.name}은 한 번에 ${limits.maxFiles}개까지 올릴 수 있어요.`,
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

  async function submit(e: React.FormEvent | null, acceptBeyondPlan = false) {
    e?.preventDefault();
    setNotice(null);
    setBeyond(null);
    if (files.length === 0) return setNotice("파일을 한 개 이상 올려 주세요.");
    if (password.length < 4) return setNotice("받는 사람 비밀번호를 4자 이상으로 정해 주세요.");
    const pickedSize = files.reduce((n, p) => n + p.file.size, 0);
    if (left != null && pickedSize > left) {
      return setNotice(`${limits.name}은 열려 있는 링크의 파일을 합쳐 ${sizeLabel(limits.quotaMb)}까지 둘 수 있어요. 지금 ${formatSize(left)} 남았어요. 배포 기록에서 다 쓴 링크를 닫으면 자리가 생겨요.`);
    }
    const at = expire === "custom" ? fromLocalInput(customAt) : null;
    if (expire === "custom" && !at) return setNotice("링크가 닫힐 시각을 정해 주세요.");

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
          ...(at ? { expiresAt: at.toISOString() } : { expireMinutes: expire }),
          acceptBeyondPlan,
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
          uploadFile({
            shareId: res.id,
            fileId,
            kind,
            blob: body,
            name: p.file.name,
            headers: { "X-Admin-Token": res.adminToken },
            onProgress: (r) => body.size > 8 * 1024 * 1024 && setStatus(p.key, "uploading", undefined, `${Math.floor(r * 100)}%`),
          }).then((status) => ({ status }));
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
      refreshPlan();
    } catch (err) {
      const data = (err as ApiError).data;
      if (data?.code === "beyond_plan") setBeyond(String(data.proUntil ?? ""));
      else setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCreated(null);
    setStep(0);
    setFiles([]);
    setTitle("");
    setMessage("");
    setPassword("");
    setOutput("pdf");
    setPicked(null);
    setCustomAt("");
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

  const hasHangul = files.some((p) => isHangul(extOf(p.file.name)));
  const steps: WizardStep[] = [
    {
      title: "파일 올리기",
      hint: "나눠 줄 파일을 골라 주세요. 한글(HWP · HWPX)은 보이는 그대로 PDF로 바꿔 줘요.",
      check: () => (files.length === 0 ? "파일을 한 개 이상 올려 주세요." : null),
      content: (
        <>
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
                한글 · PDF · 오피스 · 이미지 · 영상 등 · 최대 {limits.maxFiles}개 · 파일당 {limits.maxFileMb == null ? "크기 제한 없음" : sizeLabel(limits.maxFileMb)}
                {left != null && ` · 남은 공간 ${formatSize(left)}`}
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
                        {p.error ||
                          (p.note && p.status === "converting"
                            ? `PDF로 바꾸는 중 · ${p.note}`
                            : p.note && p.status === "uploading"
                              ? `${formatSize(p.file.size)} · 올리는 중 ${p.note}`
                              : formatSize(p.file.size))}
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

            {guest && auth.ready && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-brand/5 px-3 py-2.5 text-sm">
                <Sparkles className="size-4 shrink-0 text-brand" />
                <span className="flex-1 text-muted-foreground">
                  로그인하면 무료 멤버십으로 <b className="text-foreground">{config.plans.member.maxFiles}개 · 파일당 {sizeLabel(config.plans.member.maxFileMb)} · {periodLabel(config.plans.member.maxCustomMinutes)}</b>까지 올릴 수 있어요.
                </span>
                <Link href="/login/" className="shrink-0 font-semibold text-brand">
                  로그인
                </Link>
              </div>
            )}
            {limits.id === "member" && files.some((p) => p.file.size > maxBytes * 0.5) && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-brand/5 px-3 py-2.5 text-sm">
                <Sparkles className="size-4 shrink-0 text-brand" />
                <span className="flex-1 text-muted-foreground">
                  큰 파일을 자주 보내면 <b className="text-foreground">프로</b>가 편해요. 파일 크기 제한 없이 {sizeLabel(config.plans.pro.quotaMb)}까지, 1년 보관.
                </span>
                <Link href="/plans/" className="shrink-0 font-semibold text-brand">
                  요금제
                </Link>
              </div>
            )}
        </>
      ),
    },
    ...(hasHangul
      ? [
          {
            title: "보내는 방식",
            hint: "한글 파일을 어떻게 보낼까요?",
            content: (
              <>
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
              </>
            ),
          },
        ]
      : []),
    {
      title: "자동 삭제",
      hint: "정한 시간이 지나면 링크가 닫히고 파일이 지워져요.",
      content: (
        <>
            <ExpirePicker
              options={config.expireOptions}
              plan={limits}
              value={expire}
              customAt={customAt}
              onChange={setPicked}
              onCustomAt={setCustomAt}
              minCustomMinutes={config.minCustomMinutes}
              disabled={busy}
            />
        </>
      ),
    },
    {
      title: "링크 설정",
      hint: "받는 사람에게 보일 제목과 비밀번호를 정해 주세요.",
      check: () => (password.length < 4 ? "받는 사람 비밀번호를 4자 이상으로 정해 주세요." : null),
      content: (
        <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="title">제목</Label>
                <span className={cn("text-xs tabular-nums", title.length >= TITLE_MAX ? "font-semibold text-brand" : "text-muted-foreground")}>
                  {title.length}/{TITLE_MAX}
                </span>
              </div>
              <Input id="title" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))} placeholder="예) 2학기 기말고사 3학년 수학" />
              <p className="text-xs text-muted-foreground">QR 화면에 크게 보여서 {TITLE_MAX}자까지 쓸 수 있어요. 자세한 설명은 안내 메시지에 적어 주세요.</p>
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
          {busy && (
            <ul className="space-y-1.5 rounded-xl border bg-muted/30 p-3">
              {files.map((p) => (
                <li key={p.key} className="flex items-center gap-2 text-sm">
                  <FileBadge ext={extOf(p.file.name)} />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  {p.note && <span className="text-xs tabular-nums text-muted-foreground">{p.note}</span>}
                  <StatusPill status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
  ];
  const at = Math.min(step, steps.length - 1);

  return (
    <div className="relative">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="mb-6 animate-fade-up">
          <p className="text-sm font-semibold text-brand">파일 배포하기</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            파일 올리고, <span className="text-gradient">링크 하나로</span>
          </h1>
        </div>

        {me?.lapse && <LapseBanner lapse={me.lapse} />}

        <Wizard
          steps={steps}
          step={at}
          onStep={setStep}
          busy={busy}
          notice={notice}
          onBack={onHome}
          onFinish={() => submit(null)}
          finishLabel={busy ? "바꾸고 올리는 중… 창을 닫지 마세요" : "공유 링크 만들기"}
        />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Wordmark /> · {limits.name} · 올린 파일은 정한 시간이 지나면 지워져요 ·{" "}
          <Link href="/plans/" className="underline-offset-2 hover:underline">
            요금제
          </Link>
        </p>

        <Dialog
          open={beyond != null}
          onClose={() => setBeyond(null)}
          title="구독 기간 이후까지 배포돼요!"
          description={
            <>
              프로 구독이 {beyond ? formatDate(beyond) : ""}에 끝나요. 고른 마감은 그보다 늦어요. 구독이 끝나고 {7}일 안에 갱신하지 않으면 멤버십 한도를 넘는 이 링크와 파일은 <b>영구 삭제</b>돼요.
            </>
          }
        >
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setBeyond(null)}>
              마감 다시 정하기
            </Button>
            <Button variant="brand" onClick={() => submit(null, true)}>
              확인하고 만들기
            </Button>
          </div>
        </Dialog>
      </div>
    </div>
  );
}

/** 프로가 곧 끝나거나 끝난 뒤 유예 중: 갱신하지 않으면 닫힐 링크 */
export function LapseBanner({ lapse }: { lapse: { proUntil: string; closesAt: string; links: number } }) {
  const ended = Date.parse(lapse.proUntil) < Date.now();
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="flex-1">
        <b>
          프로가 {formatDate(lapse.proUntil)}에 {ended ? "끝났어요" : "끝나요"}. 갱신하지 않으면 {formatDate(lapse.closesAt)}에 링크 {lapse.links}개가 닫혀요.
        </b>{" "}
        멤버십 한도(파일당 20MB · 7일 · 1GB)를 넘는 링크는 닫히고 파일은 영구 삭제돼요.{" "}
        <Link href="/plans/" className="font-semibold text-brand">
          요금제 보기
        </Link>
      </p>
    </div>
  );
}
