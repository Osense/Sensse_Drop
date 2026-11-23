"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { PlanCompare } from "@/components/plan-compare";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { STATIC_ONLY } from "@/lib/config";
import { formatDate, formatSize } from "@/lib/format";
import { PLANS, PRO_GRACE_DAYS, type PlanId } from "@/lib/plans";
import { periodLabel, sizeLabel, usePlan } from "@/lib/use-plan";
import { cn } from "@/lib/utils";

const MOCK_PRO_KEY = "sensedrop.mock.pro";
const MOCK_PRO_DAYS = 30;

export function PlansView() {
  const auth = useAuth();
  const { plan, me, refresh } = usePlan();
  const [mockPro, setMockPro] = React.useState(false);
  React.useEffect(() => {
    try {
      setMockPro(Number(localStorage.getItem(MOCK_PRO_KEY)) > Date.now());
    } catch {}
  }, []);

  function toggleMockPro() {
    try {
      if (mockPro) localStorage.removeItem(MOCK_PRO_KEY);
      else localStorage.setItem(MOCK_PRO_KEY, String(Date.now() + MOCK_PRO_DAYS * 86400000));
    } catch {}
    setMockPro(!mockPro);
    refresh();
  }

  const cards: { id: PlanId; price: string; sub: string; points: string[] }[] = [
    {
      id: "guest",
      price: "무료",
      sub: "로그인 없이 바로",
      points: [`한 번에 ${PLANS.guest.maxFiles}개 · 파일당 ${sizeLabel(PLANS.guest.maxFileMb)}`, "10분 후 자동 삭제", "링크 · QR · 안내 문구 · 카운트다운", "배포 기록은 이 기기에서만"],
    },
    {
      id: "member",
      price: "무료",
      sub: "WSNS 계정으로 로그인",
      points: [
        `한 번에 ${PLANS.member.maxFiles}개 · 파일당 ${sizeLabel(PLANS.member.maxFileMb)}`,
        `열린 링크 파일 합계 ${sizeLabel(PLANS.member.quotaMb)}`,
        `10분 ~ ${periodLabel(PLANS.member.maxCustomMinutes)} 보관, 마감 시각 직접 지정`,
        "어느 기기에서나 배포 기록 · 바로 닫기",
      ],
    },
    {
      id: "pro",
      price: `연 ${PLANS.pro.pricePerYear.toLocaleString()}원`,
      sub: "연간 결제만 · 부가세 포함",
      points: [
        "파일 크기 제한 없음 (큰 파일은 나눠 올리고, 끊기면 이어 올리기)",
        `한 번에 ${PLANS.pro.maxFiles}개 · 열린 링크 파일 합계 ${sizeLabel(PLANS.pro.quotaMb)}`,
        `최대 ${periodLabel(PLANS.pro.maxCustomMinutes)} 보관, 마감 시각 직접 지정`,
        "멤버십의 모든 기능",
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">요금제</h1>
        <p className="mt-2 text-muted-foreground">대부분은 무료로 충분해요. 큰 파일을 오래 나눠 줄 때만 프로를 쓰세요.</p>
      </div>

      {me && (
        <Card className="mx-auto mt-8 max-w-xl gap-0 p-4">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>
              지금 <b className="text-brand">{plan.name}</b>
              {me.proUntil && <span className="text-muted-foreground"> · {formatDate(me.proUntil)}까지</span>}
            </span>
            {me.quotaBytes != null && (
              <span className="tabular-nums text-muted-foreground">
                {formatSize(me.usedBytes) || "0B"} / {formatSize(me.quotaBytes)}
              </span>
            )}
          </div>
          {me.quotaBytes != null && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${Math.min(100, (me.usedBytes / me.quotaBytes) * 100)}%` }} />
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">열려 있는 링크의 파일만 세요. 다 쓴 링크를 배포 기록에서 닫으면 바로 자리가 생겨요.</p>
        </Card>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {cards.map((c) => {
          const p = PLANS[c.id];
          const current = plan.id === c.id && (c.id === "guest" ? !auth.session : true);
          return (
            <Card key={c.id} className={cn("relative flex flex-col gap-0 p-6", c.id === "pro" && "border-brand/40 shadow-lg shadow-brand/10")}>
              {current && <span className="absolute -top-3 left-5 rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold text-white">지금 쓰는 중</span>}
              <h2 className="flex items-center gap-1.5 text-lg font-bold">
                {c.id === "pro" && <Sparkles className="size-4 text-brand" />}
                {p.name}
              </h2>
              <p className="text-xs text-muted-foreground">{c.sub}</p>
              <p className="mt-4 text-3xl font-extrabold tracking-tight">{c.price}</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {c.points.map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand" />
                    {t}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {c.id === "guest" ? (
                  <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                    바로 보내기
                  </Link>
                ) : c.id === "member" ? (
                  auth.session ? (
                    <span className={cn(buttonVariants({ variant: "outline" }), "pointer-events-none w-full opacity-70")}>{plan.id === "pro" ? "프로에 포함" : "쓰는 중"}</span>
                  ) : (
                    <Link href="/login/" className={cn(buttonVariants({ variant: "brand" }), "w-full")}>
                      WSNS 계정으로 로그인
                    </Link>
                  )
                ) : (
                  <>
                    <span className={cn(buttonVariants({ variant: "outline" }), "pointer-events-none w-full opacity-70")}>
                      {plan.id === "pro" ? "쓰는 중" : "결제 준비 중이에요"}
                    </span>
                    {STATIC_ONLY && auth.session && (
                      <Button variant="ghost" size="sm" className="mt-2 w-full text-brand" onClick={toggleMockPro}>
                        {mockPro ? "체험판 프로 끄기" : `체험판에서 프로 켜 보기 (${MOCK_PRO_DAYS}일)`}
                      </Button>
                    )}
                    {STATIC_ONLY && !auth.session && <p className="mt-2 text-center text-xs text-muted-foreground">체험판에서는 로그인하면 프로를 켜 볼 수 있어요.</p>}
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <PlanCompare current={auth.session ? plan.id : "guest"} className="mt-10" />

      <div className="mt-8 space-y-2 rounded-xl border bg-muted/30 p-5 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">프로 구독이 끝나면</p>
        <p>· 프로로 만든 링크는 구독이 끝나도 {PRO_GRACE_DAYS}일 동안 그대로 열려요. 끝나기 {PRO_GRACE_DAYS}일 전부터 쎈스드롭 화면에서 닫힐 링크 수를 알려 드려요.</p>
        <p>· {PRO_GRACE_DAYS}일 안에 갱신하면 정해 둔 마감을 그대로 유지해요.</p>
        <p>
          · 갱신하지 않으면 멤버십 한도(파일당 {sizeLabel(PLANS.member.maxFileMb)} · {periodLabel(PLANS.member.maxCustomMinutes)} · 합계 {sizeLabel(PLANS.member.quotaMb)})를 넘는 링크는 닫히고, 파일은 영구 삭제돼요.
        </p>
        <p>· 마감을 구독 종료일보다 늦게 정하면, 링크를 만들 때 한 번 더 확인해 드려요.</p>
      </div>
    </div>
  );
}
