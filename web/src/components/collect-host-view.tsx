"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, Eye, EyeOff, Inbox, Lock, Plus, Sparkles, Users } from "lucide-react";
import { CollectManager } from "@/components/collect-manager";
import { ExpirePicker, fromLocalInput, toLocalInput } from "@/components/expire-picker";
import { LapseBanner } from "@/components/host-view";
import { Wizard, type WizardStep } from "@/components/wizard";
import { Wordmark } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, localLinks } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { periodLabel, sizeLabel, usePlan } from "@/lib/use-plan";
import { cn } from "@/lib/utils";

const TITLE_MAX = 40;
const NAME_LABELS = ["이름", "학번과 이름", "반 · 번호 · 이름"];

/** 명단 붙여 넣기: 줄바꿈 · 쉼표 · 탭으로 나눔 (엑셀에서 한 열을 복사해 와도 돼요) */
export function parseRoster(text: string) {
  return [...new Set(text.split(/[\n,\t]+/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 300);
}

type Created = { id: string; adminToken: string; password: string };

/** 수합 링크 만들기: 교사가 링크(QR)를 주면 학생이 이름을 적고 파일을 내요 */
export function CollectHostView({ onHome }: { onHome?: () => void } = {}) {
  const auth = useAuth();
  const { config, plan: limits, me, refresh: refreshPlan } = usePlan();
  const guest = limits.id === "guest";

  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [nameLabel, setNameLabel] = React.useState("이름");
  const [perPerson, setPerPerson] = React.useState(1);
  const [password, setPassword] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [rosterText, setRosterText] = React.useState("");
  const [useDeadline, setUseDeadline] = React.useState(false);
  const [deadlineAt, setDeadlineAt] = React.useState("");
  const [picked, setPicked] = React.useState<number | "custom" | null>(null);
  const [customAt, setCustomAt] = React.useState("");
  const expire: number | "custom" =
    picked === "custom" ? (limits.maxCustomMinutes > 0 ? "custom" : limits.defaultExpire) : picked != null && limits.expireMinutes.includes(picked) ? picked : limits.defaultExpire;
  const [beyond, setBeyond] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);
  const [step, setStep] = React.useState(0);
  // 시각 글자는 화면이 뜬 뒤에만 (미리 만든 정적 화면과 어긋나지 않게)
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const roster = parseRoster(rosterText);
  const per = Math.min(perPerson, limits.maxFiles);

  /** 파일이 지워지는 시각 (제출 마감은 이보다 앞이어야 해요) */
  const expiresAt = expire === "custom" ? fromLocalInput(customAt) : new Date(Date.now() + expire * 60000);

  async function submit(e: React.FormEvent | null, acceptBeyondPlan = false) {
    e?.preventDefault();
    setNotice(null);
    setBeyond(null);
    if (password && password.length < 4) return setNotice("제출 비밀번호는 4자 이상으로 정하거나 비워 두세요.");
    const at = expire === "custom" ? fromLocalInput(customAt) : null;
    if (expire === "custom" && !at) return setNotice("파일이 지워질 시각을 정해 주세요.");
    const deadline = useDeadline ? fromLocalInput(deadlineAt) : null;
    if (useDeadline && !deadline) return setNotice("제출 마감 시각을 정해 주세요.");
    if (deadline && deadline.getTime() <= Date.now()) return setNotice("제출 마감은 지금보다 뒤로 정해 주세요.");
    if (deadline && expiresAt && deadline.getTime() > expiresAt.getTime()) return setNotice("제출 마감은 파일이 지워지는 시각보다 앞이어야 해요. 자동 삭제 시간을 늘려 주세요.");

    setBusy(true);
    try {
      const res = await api<{ id: string; adminToken: string }>("/api/collects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await auth.authHeaders()) },
        body: JSON.stringify({
          title,
          message,
          password,
          nameLabel,
          perPerson: per,
          roster,
          deadline: deadline?.toISOString() ?? null,
          ...(at ? { expiresAt: at.toISOString() } : { expireMinutes: expire }),
          acceptBeyondPlan,
        }),
      });
      localLinks.add({ id: res.id, adminToken: res.adminToken, title: title || "과제 제출", createdAt: new Date().toISOString() });
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
    setTitle("");
    setMessage("");
    setPassword("");
    setRosterText("");
    setUseDeadline(false);
    setDeadlineAt("");
  }

  const headersFor = React.useCallback(async (): Promise<Record<string, string>> => (created ? { "X-Admin-Token": created.adminToken } : {}), [created]);

  if (created) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <CollectManager id={created.id} headers={headersFor} password={created.password} onDeleted={reset} onMissing={reset} />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={reset}>
            <Plus /> 새 수합 링크 만들기
          </Button>
        </div>
      </div>
    );
  }

  const steps: WizardStep[] = [
    {
      title: "무엇을 걷나요",
      hint: "학생 화면 맨 위에 크게 보여요.",
      content: <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="title">제목</Label>
                <span className={cn("text-xs tabular-nums", title.length >= TITLE_MAX ? "font-semibold text-brand" : "text-muted-foreground")}>
                  {title.length}/{TITLE_MAX}
                </span>
              </div>
              <Input id="title" value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))} placeholder="예) 3학년 2반 국어 독서 감상문" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="message">
                  안내 <span className="font-normal text-muted-foreground">(선택)</span>
                </Label>
                <span className="text-xs text-muted-foreground">{message.length}/1000</span>
              </div>
              <Textarea
                id="message"
                value={message}
                maxLength={1000}
                rows={3}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={"예) 한글 또는 PDF로 내 주세요. 파일 이름에 번호를 붙이지 않아도 돼요.\n마감 뒤에 낸 과제는 받지 않아요."}
              />
            </div>
      </div>,
    },
    {
      title: "학생이 낼 것",
      hint: "학생이 적을 이름 칸과 낼 파일 수를 정해요.",
      content: <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>이름 칸 안내</Label>
              <div className="flex flex-wrap gap-1.5">
                {NAME_LABELS.map((l) => (
                  <button
                    type="button"
                    key={l}
                    onClick={() => setNameLabel(l)}
                    className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", nameLabel === l ? "border-brand bg-brand/10 font-semibold text-brand" : "hover:bg-accent")}
                  >
                    {l}
                  </button>
                ))}
                <Input value={nameLabel} maxLength={20} onChange={(e) => setNameLabel(e.target.value)} className="h-9 w-40" aria-label="이름 칸 안내 직접 쓰기" />
              </div>
              <p className="text-xs text-muted-foreground">학생 화면에 &lsquo;{nameLabel || "이름"}을 적어 주세요&rsquo;로 보여요. 낸 파일은 이 이름별로 모여요.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="per">한 사람이 한 번에 낼 수 있는 파일</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="per"
                  type="number"
                  min={1}
                  max={limits.maxFiles}
                  value={per}
                  onChange={(e) => setPerPerson(Math.max(1, Math.min(limits.maxFiles, Number(e.target.value) || 1)))}
                  className="h-10 w-24 tabular-nums"
                />
                <span className="text-sm text-muted-foreground">
                  개 (최대 {limits.maxFiles}개 · 파일당 {limits.maxFileMb == null ? "크기 제한 없음" : sizeLabel(limits.maxFileMb)})
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="roster" className="flex items-center gap-1.5">
                  <Users className="size-4 text-brand" /> 학생 명단 <span className="font-normal text-muted-foreground">(선택)</span>
                </Label>
                <span className="text-xs tabular-nums text-muted-foreground">{roster.length}명</span>
              </div>
              <Textarea
                id="roster"
                value={rosterText}
                rows={4}
                onChange={(e) => setRosterText(e.target.value)}
                placeholder={"한 줄에 한 명씩 (엑셀에서 이름 열을 복사해 붙여도 돼요)\n김하늘\n박바다\n이산"}
              />
              <p className="text-xs text-muted-foreground">넣어 두면 아직 안 낸 학생을 바로 볼 수 있어요. 명단은 선생님 화면에만 보이고 학생에게는 보이지 않아요.</p>
            </div>
      </div>,
    },
    {
      title: "마감 · 삭제",
      hint: "언제까지 받고, 모은 파일을 언제 지울지 정해요.",
      check: () => {
        if (expire === "custom" && !fromLocalInput(customAt)) return "파일이 지워질 시각을 정해 주세요.";
        const d = useDeadline ? fromLocalInput(deadlineAt) : null;
        if (useDeadline && !d) return "제출 마감 시각을 정해 주세요.";
        if (d && d.getTime() <= Date.now()) return "제출 마감은 지금보다 뒤로 정해 주세요.";
        if (d && expiresAt && d.getTime() > expiresAt.getTime()) return "제출 마감은 파일이 지워지는 시각보다 앞이어야 해요. 자동 삭제 시간을 늘려 주세요.";
        return null;
      },
      content: <div className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <CalendarClock className="size-4 text-brand" /> 제출 마감
              </Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setUseDeadline(false)}
                  className={cn("rounded-lg border p-3 text-left text-sm transition-colors", !useDeadline ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:bg-accent")}
                >
                  <span className="block font-semibold">직접 마감할 때까지</span>
                  <span className="block text-xs text-muted-foreground">다 냈으면 &lsquo;제출 마감&rsquo; 버튼을 눌러요</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!deadlineAt) {
                      const end = expiresAt?.getTime() ?? Date.now() + 3600000;
                      setDeadlineAt(toLocalInput(new Date(Math.min(end - 60000, Date.now() + 50 * 60000))));
                    }
                    setUseDeadline(true);
                  }}
                  className={cn("rounded-lg border p-3 text-left text-sm transition-colors", useDeadline ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:bg-accent")}
                >
                  <span className="block font-semibold">정한 시각에 마감</span>
                  <span className="block text-xs text-muted-foreground">그 뒤로는 학생이 낼 수 없어요</span>
                </button>
              </div>
              {useDeadline && (
                <input
                  type="datetime-local"
                  value={deadlineAt}
                  min={toLocalInput(new Date())}
                  max={expiresAt ? toLocalInput(expiresAt) : undefined}
                  onChange={(e) => setDeadlineAt(e.target.value)}
                  className="block h-11 w-full rounded-md border bg-background px-3 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:max-w-xs"
                  aria-label="제출 마감 시각"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>모은 파일 자동 삭제</Label>
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
              <p className="text-xs text-muted-foreground">
                이 시각에 링크가 닫히고 모은 파일이 지워져요. 그 전에 ZIP으로 받아 두세요.
                {mounted && expiresAt && ` (${formatDate(expiresAt.toISOString())})`}
              </p>
            </div>
            {guest && auth.ready && (
              <div className="flex items-center gap-2 rounded-lg bg-brand/5 px-3 py-2.5 text-sm">
                <Sparkles className="size-4 shrink-0 text-brand" />
                <span className="flex-1 text-muted-foreground">
                  나그네는 10분 동안만 받아요. 수업 중에 바로 걷을 때 좋아요. 로그인하면 무료로 <b className="text-foreground">{periodLabel(config.plans.member.maxCustomMinutes)}까지 · 한 사람 {config.plans.member.maxFiles}개 · 파일당 {sizeLabel(config.plans.member.maxFileMb)}</b>까지 받아요.
                </span>
                <Link href="/login/" className="shrink-0 font-semibold text-brand">
                  로그인
                </Link>
              </div>
            )}
      </div>,
    },
    {
      title: "제출 비밀번호",
      hint: "정하지 않아도 돼요. 정하면 비밀번호를 아는 학생만 낼 수 있어요.",
      check: () => (password && password.length < 4 ? "제출 비밀번호는 4자 이상으로 정하거나 비워 두세요." : null),
      content: <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pw">
                비밀번호 <span className="font-normal text-muted-foreground">(선택)</span>
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="pw"
                  type={showPw ? "text" : "password"}
                  value={password}
                  maxLength={64}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비워 두면 링크만 있으면 낼 수 있어요"
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
              <p className="text-xs text-muted-foreground">우리 반 학생만 내게 하려면 비밀번호를 정해 칠판에 적어 주세요. 낸 파일은 비밀번호와 상관없이 선생님만 받을 수 있어요.</p>
            </div>
      </div>,
    },
  ];

  return (
    <div className="relative">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="mb-6 animate-fade-up">
          <p className="text-sm font-semibold text-brand">과제 수합하기</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            과제 걷기도 <span className="text-gradient">링크 하나로</span>
          </h1>
        </div>

        {me?.lapse && <LapseBanner lapse={me.lapse} />}

        <Wizard
          steps={steps}
          step={step}
          onStep={setStep}
          busy={busy}
          notice={notice}
          onBack={onHome}
          onFinish={() => submit(null)}
          finishLabel={
            <>
              <Inbox /> {busy ? "만드는 중…" : "수합 링크 만들기"}
            </>
          }
        />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Wordmark /> · {limits.name} · 모은 파일은 선생님 저장 공간을 써요 ·{" "}
          <Link href="/plans/" className="underline-offset-2 hover:underline">
            요금제
          </Link>
        </p>

        <Dialog
          open={beyond != null}
          onClose={() => setBeyond(null)}
          title="구독 기간 이후까지 열려요!"
          description={
            <>
              프로 구독이 {beyond ? formatDate(beyond) : ""}에 끝나요. 고른 삭제 시각은 그보다 늦어요. 구독이 끝나고 7일 안에 갱신하지 않으면 멤버십 한도를 넘는 이 링크와 모은 파일은 <b>영구 삭제</b>돼요.
            </>
          }
        >
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setBeyond(null)}>
              다시 정하기
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
