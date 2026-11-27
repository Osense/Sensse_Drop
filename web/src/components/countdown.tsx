"use client";

import * as React from "react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

/** 남은 시간을 "2일 3시간 4분" 또는 "12:34" 처럼 */
export function formatRemaining(ms: number) {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}일 ${h}시간 ${pad(m)}분 ${pad(sec)}초`;
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

export function useRemaining(expiresAt?: string | null) {
  const target = expiresAt ? Date.parse(expiresAt) : NaN;
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!Number.isFinite(target)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  return Number.isFinite(target) ? Math.max(0, target - now) : null;
}

/** 링크가 닫히기까지 남은 시간 (1초마다). 0이 되면 onExpire */
export function Countdown({
  expiresAt,
  onExpire,
  className,
  size = "md",
  label = "닫히기까지",
  doneText = "링크가 닫혔어요",
}: {
  expiresAt: string;
  onExpire?: () => void;
  className?: string;
  size?: "md" | "lg";
  label?: string;
  doneText?: string;
}) {
  const left = useRemaining(expiresAt);
  const fired = React.useRef(false);
  React.useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [left, onExpire]);
  if (left == null) return null;
  const urgent = left < 5 * 60 * 1000;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold tabular-nums",
        size === "lg" ? "px-4 py-2 text-lg" : "px-3 py-1 text-sm",
        left === 0 ? "border-destructive/40 text-destructive" : urgent ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-brand/30 bg-brand/5 text-brand",
        className,
      )}
      role="timer"
      aria-live="off"
    >
      <Timer className={size === "lg" ? "size-5" : "size-4"} />
      {left === 0 ? doneText : <>{label} {formatRemaining(left)}</>}
    </span>
  );
}
