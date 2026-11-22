"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** 가벼운 모달 다이얼로그 (ESC 닫기, 스크롤 잠금, 포커스 이동) */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative max-h-[92dvh] w-full animate-fade-up overflow-y-auto rounded-t-2xl border bg-card p-6 shadow-2xl outline-none sm:max-w-lg sm:rounded-2xl",
          className,
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="닫기 · Close"
        >
          <X className="size-4" />
        </button>
        <h2 id={titleId} className="pr-8 text-lg font-semibold">{title}</h2>
        {description && <div className="mt-1.5 text-sm text-muted-foreground">{description}</div>}
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
