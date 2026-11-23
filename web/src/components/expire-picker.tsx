"use client";

import Link from "next/link";
import { CalendarClock, Lock } from "lucide-react";
import type { Plan } from "@/lib/plans";
import { formatRemaining } from "@/components/countdown";
import { formatDate } from "@/lib/format";
import { periodLabel } from "@/lib/use-plan";
import { cn } from "@/lib/utils";

/** datetime-local 입력값 ↔ Date (내 컴퓨터 시간대) */
export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v) : null);

/**
 * 자동 삭제 시간 고르기: 요금제가 허락하는 시간, 또는 마감 시각 직접 지정(년 · 월 · 일 · 시 · 분).
 * 쓸 수 없는 선택지에는 자물쇠.
 */
export function ExpirePicker({
  options,
  plan,
  value,
  customAt,
  onChange,
  onCustomAt,
  minCustomMinutes,
  disabled,
}: {
  options: { minutes: number; label: string }[];
  plan: Plan;
  value: number | "custom";
  customAt: string;
  onChange: (v: number | "custom") => void;
  onCustomAt: (v: string) => void;
  minCustomMinutes: number;
  disabled?: boolean;
}) {
  const canCustom = plan.maxCustomMinutes > 0;
  const lockedTip = (m: number) => (plan.id === "guest" ? "로그인하면 고를 수 있어요" : m > (plan.maxCustomMinutes || 0) ? "프로에서 고를 수 있어요" : undefined);
  const now = Date.now();
  const min = new Date(now + minCustomMinutes * 60000);
  const max = new Date(now + plan.maxCustomMinutes * 60000);
  const at = fromLocalInput(customAt);
  const bad = at && (at.getTime() < min.getTime() - 60000 || at.getTime() > max.getTime());

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1.5">
        {options.map((o) => {
          const locked = !plan.expireMinutes.includes(o.minutes);
          return (
            <button
              type="button"
              key={o.minutes}
              disabled={locked || disabled}
              onClick={() => onChange(o.minutes)}
              title={locked ? lockedTip(o.minutes) : undefined}
              className={cn(
                "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full border px-1 py-1.5 text-[13px] transition-colors sm:text-sm",
                value === o.minutes ? "border-brand bg-brand/10 font-semibold text-brand" : "hover:bg-accent",
                locked && "cursor-not-allowed text-muted-foreground/60 hover:bg-transparent",
              )}
            >
              {locked && <Lock className="size-3" />}
              {o.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={!canCustom || disabled}
          onClick={() => {
            if (!customAt) onCustomAt(toLocalInput(new Date(Math.min(max.getTime(), now + 2 * 3600000))));
            onChange("custom");
          }}
          title={canCustom ? "마감 시각을 직접 정해요" : "로그인하면 쓸 수 있어요"}
          className={cn(
            "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full border px-1 py-1.5 text-[13px] transition-colors sm:text-sm",
            value === "custom" ? "border-brand bg-brand/10 font-semibold text-brand" : "hover:bg-accent",
            !canCustom && "cursor-not-allowed text-muted-foreground/60 hover:bg-transparent",
          )}
        >
          {canCustom ? <CalendarClock className="size-3.5" /> : <Lock className="size-3" />}
          직접 지정
        </button>
      </div>

      {value === "custom" && canCustom && (
        <div className="rounded-xl border bg-muted/30 p-3">
          <label htmlFor="expires-at" className="text-sm font-semibold">
            링크가 닫힐 시각
          </label>
          <input
            id="expires-at"
            type="datetime-local"
            value={customAt}
            min={toLocalInput(min)}
            max={toLocalInput(max)}
            disabled={disabled}
            onChange={(e) => onCustomAt(e.target.value)}
            className={cn(
              "mt-1.5 block h-11 w-full rounded-md border bg-background px-3 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:max-w-xs",
              bad && "border-destructive",
            )}
          />
          <p className={cn("mt-1.5 text-xs", bad ? "text-destructive" : "text-muted-foreground")}>
            {bad
              ? `${formatDate(min.toISOString())}부터 ${formatDate(max.toISOString())} 사이로 정해 주세요.`
              : at
                ? `${formatDate(at.toISOString())}에 링크가 닫히고 파일이 지워져요 · 앞으로 ${formatRemaining(at.getTime() - now)}`
                : "년 · 월 · 일 · 시 · 분을 고르거나 입력해 주세요."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">강의나 시험이 끝나는 시각에 맞춰 두면, 그 뒤로는 아무도 받을 수 없어요.</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {plan.id === "guest" ? (
          <>
            나그네는 <b className="text-foreground">10분 후 삭제</b>만 쓸 수 있어요.{" "}
            <Link href="/login/" className="font-semibold text-brand">
              로그인
            </Link>
            하면 7일까지 고르고, 마감 시각도 직접 정할 수 있어요.
          </>
        ) : plan.id === "member" ? (
          <>
            멤버십은 {periodLabel(plan.maxCustomMinutes)}까지 고를 수 있어요. 30일 · 1년은{" "}
            <Link href="/plans/" className="font-semibold text-brand">
              프로
            </Link>
            에서 쓸 수 있어요.
          </>
        ) : (
          <>프로는 {periodLabel(plan.maxCustomMinutes)}까지 고를 수 있어요. 정한 시간이 지나면 링크와 파일이 저절로 지워져요.</>
        )}
      </p>
    </div>
  );
}
