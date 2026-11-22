"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** 자동 삭제 시간 고르기 (비회원은 잠긴 선택지에 자물쇠) */
export function ExpirePicker({
  options,
  value,
  isAllowed,
  onChange,
  member,
  disabled,
  note,
}: {
  options: { minutes: number; label: string }[];
  value: number;
  isAllowed: (minutes: number) => boolean;
  onChange: (minutes: number) => void;
  member: boolean;
  disabled?: boolean;
  note?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-4 gap-1.5">
        {options.map((o) => {
          const locked = !isAllowed(o.minutes);
          return (
            <button
              type="button"
              key={o.minutes}
              disabled={locked || disabled}
              onClick={() => onChange(o.minutes)}
              title={locked ? "로그인하면 고를 수 있어요" : undefined}
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
      </div>
      <p className="text-xs text-muted-foreground">
        {note ??
          (member ? (
            "정한 시간이 지나면 링크와 파일이 저절로 지워져요."
          ) : (
            <>
              비회원은 <b className="text-foreground">10분 후 삭제</b>만 쓸 수 있어요.{" "}
              <Link href="/login/" className="font-semibold text-brand">
                로그인
              </Link>
              하면 1시간 · 3일 · 7일도 고를 수 있어요.
            </>
          ))}
      </p>
    </div>
  );
}
