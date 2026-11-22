"use client";

import { Pencil } from "lucide-react";

/** 파일 목록에서 받는 사람에게 보일 이름을 바로 고치는 칸 (확장자는 고정) */
export function FileNameInput({ value, ext, onChange, disabled }: { value: string; ext: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="group flex min-w-0 items-center gap-1 rounded-md border border-transparent px-1 -mx-1 focus-within:border-brand/50 focus-within:bg-background hover:border-input">
      <input
        value={value}
        disabled={disabled}
        maxLength={150}
        onChange={(e) => onChange(e.target.value)}
        aria-label="받는 사람에게 보일 파일 이름"
        className="min-w-0 flex-1 bg-transparent py-0.5 text-sm font-medium outline-none disabled:cursor-default"
      />
      <span className="shrink-0 text-sm text-muted-foreground">.{ext}</span>
      {!disabled && <Pencil className="size-3.5 shrink-0 text-muted-foreground/70 group-focus-within:text-brand" />}
    </label>
  );
}
