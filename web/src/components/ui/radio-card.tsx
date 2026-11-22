"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** 결제수단 선택 등에 쓰는 카드형 라디오 */
export function RadioCard({
  name,
  value,
  checked,
  onSelect,
  children,
  className,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-center gap-3 rounded-lg border bg-background p-3.5 text-sm transition-all hover:border-foreground/30 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
        checked && "border-brand bg-brand/5 ring-1 ring-brand",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center rounded-full border border-input transition-colors",
          checked && "border-brand",
        )}
      >
        <span className={cn("size-2 rounded-full bg-brand transition-transform", checked ? "scale-100" : "scale-0")} />
      </span>
      {children}
    </label>
  );
}
