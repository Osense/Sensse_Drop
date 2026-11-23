"use client";

import { cn } from "@/lib/utils";

/** 만화풍 굵은 화살표 (아래를 가리킴). 테두리는 글자색, 속은 브랜드 그라디언트 */
function Arrow({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 40 58" className={className} style={style} aria-hidden="true">
      <defs>
        <linearGradient id="comic-arrow-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--brand)" />
          <stop offset="1" stopColor="var(--brand-2)" />
        </linearGradient>
      </defs>
      <path
        d="M13 3h14v27h10L20 55 3 30h10z"
        fill="url(#comic-arrow-fill)"
        stroke="var(--foreground)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 파일 목록(또는 비밀번호 칸) 바로 위에서 통통 튀며 아래를 가리키는 화살표 셋 + 말풍선 */
export function PointDown({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-1.5", className)} aria-hidden="true">
      <span className="comic-box comic-pop -rotate-2 rounded-xl bg-amber-300 px-3.5 py-1 text-[15px] font-black text-gray-900">{label}</span>
      <div className="flex items-end gap-7">
        {[0, 1, 2].map((i) => (
          <Arrow
            key={i}
            className={cn("comic-arrow-down h-9 w-6", i === 1 ? "h-11 w-7" : i === 0 ? "-rotate-12" : "rotate-12")}
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

/** 넓은 화면에서 목록 양옆에서 안쪽을 가리키는 화살표 (휴대폰에서는 숨김: 파일 버튼을 가리지 않게) */
export function PointSides() {
  return (
    <>
      <div className="pointer-events-none absolute top-1/2 right-full mr-4 hidden -translate-y-1/2 flex-col gap-6 lg:flex" aria-hidden="true">
        {[0, 1].map((i) => (
          <span key={i} className="comic-arrow-right block" style={{ animationDelay: `${i * 0.2}s` }}>
            <Arrow className="h-12 w-8 -rotate-90" />
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute top-1/2 left-full ml-4 hidden -translate-y-1/2 flex-col gap-6 lg:flex" aria-hidden="true">
        {[0, 1].map((i) => (
          <span key={i} className="comic-arrow-left block" style={{ animationDelay: `${i * 0.2}s` }}>
            <Arrow className="h-12 w-8 rotate-90" />
          </span>
        ))}
      </div>
    </>
  );
}
