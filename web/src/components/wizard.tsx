"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type WizardStep = {
  title: string;
  /** 단계 설명 (제목 아래 한 줄) */
  hint?: string;
  content: React.ReactNode;
  /** 다음으로 넘어가기 전 확인. 문제가 있으면 안내 문장 */
  check?: () => string | null;
};

/**
 * 한 화면에서 한 단계씩: 위에 단계 표시, 가운데 지금 단계, 아래 이전 · 다음(마지막은 finish 버튼).
 */
export function Wizard({
  steps,
  step,
  onStep,
  finishLabel,
  onFinish,
  busy,
  notice,
  onBack,
  backLabel = "처음으로",
}: {
  steps: WizardStep[];
  step: number;
  onStep: (n: number) => void;
  finishLabel: React.ReactNode;
  onFinish: () => void;
  busy?: boolean;
  notice?: string | null;
  /** 첫 단계에서 '이전'을 누르면 (첫 화면으로) */
  onBack?: () => void;
  backLabel?: string;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const top = React.useRef<HTMLDivElement>(null);
  const last = step === steps.length - 1;
  const cur = steps[step];

  function go(n: number) {
    setError(null);
    onStep(n);
    requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function next() {
    const problem = cur.check?.() ?? null;
    if (problem) return setError(problem);
    if (last) {
      setError(null);
      onFinish();
    } else go(step + 1);
  }

  /** 앞 단계는 언제든, 뒤 단계는 그 사이 단계를 모두 통과해야 */
  function jump(n: number) {
    if (busy || n === step) return;
    if (n < step) return go(n);
    for (let i = step; i < n; i++) {
      const problem = steps[i].check?.() ?? null;
      if (problem) {
        if (i !== step) go(i);
        return setError(problem);
      }
    }
    go(n);
  }

  return (
    <div ref={top} className="scroll-mt-24">
      <ol className="mb-4 flex items-center gap-1.5" aria-label="진행 단계">
        {steps.map((s, i) => (
          <li key={s.title} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => jump(i)}
              disabled={busy}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-start gap-1.5 rounded-lg text-left",
                i > step && "opacity-60",
              )}
            >
              <span className={cn("h-1.5 w-full rounded-full transition-colors", i <= step ? "bg-gradient-to-r from-brand to-brand-2" : "bg-muted")} />
              <span className={cn("flex min-w-0 items-center gap-1 text-xs font-semibold", i === step ? "text-brand" : "text-muted-foreground")}>
                <span className={cn("grid size-4 shrink-0 place-items-center rounded-full text-[10px]", i < step ? "bg-brand text-white" : i === step ? "bg-brand/15" : "bg-muted")}>
                  {i < step ? <Check className="size-2.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className="hidden truncate sm:inline">{s.title}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <Card key={step} className="animate-fade-up p-5 sm:p-7">
        <p className="text-xs font-semibold text-brand">
          {step + 1}단계 / {steps.length}
        </p>
        <h2 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">{cur.title}</h2>
        {cur.hint && <p className="mt-1 text-sm text-muted-foreground">{cur.hint}</p>}
        <div className="mt-5">{cur.content}</div>

        {(error || notice) && <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error || notice}</p>}

        <div className="mt-6 flex items-center gap-2 border-t pt-5">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={() => go(step - 1)} disabled={busy}>
              <ArrowLeft /> 이전
            </Button>
          ) : (
            onBack && (
              <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
                <ArrowLeft /> {backLabel}
              </Button>
            )
          )}
          <Button type="button" variant="brand" size="lg" className="ml-auto min-w-36" onClick={next} disabled={busy}>
            {last ? (
              finishLabel
            ) : (
              <>
                다음 <ArrowRight />
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
