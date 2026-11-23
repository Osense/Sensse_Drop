import { Check, Minus } from "lucide-react";
import { PLANS } from "@/lib/plans";
import { periodLabel, sizeLabel } from "@/lib/use-plan";
import { cn } from "@/lib/utils";

const yes = <Check className="mx-auto size-4 text-brand" aria-label="가능" />;
const no = <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="없음" />;

/** 나그네 · 멤버십 · 프로 비교표 */
export function PlanCompare({ current, className }: { current?: string; className?: string }) {
  const { guest: g, member: m, pro: p } = PLANS;
  const rows: [string, React.ReactNode, React.ReactNode, React.ReactNode][] = [
    ["한 번에 올릴 파일", `${g.maxFiles}개`, `${m.maxFiles}개`, `${p.maxFiles}개`],
    ["파일 하나 크기", sizeLabel(g.maxFileMb), sizeLabel(m.maxFileMb), "제한 없음"],
    ["열린 링크 파일 합계", no, sizeLabel(m.quotaMb), sizeLabel(p.quotaMb)],
    ["자동 삭제", "10분 후", `10분 ~ ${periodLabel(m.maxCustomMinutes)}`, `10분 ~ ${periodLabel(p.maxCustomMinutes)}`],
    ["마감 시각 직접 지정", no, `${periodLabel(m.maxCustomMinutes)} 안`, `${periodLabel(p.maxCustomMinutes)} 안`],
    ["큰 파일 나눠 올리기 · 이어 올리기", no, no, yes],
    ["배포 기록 · 바로 닫기", "이 기기만", "어느 기기에서나", "어느 기기에서나"],
    ["가격", "무료", "무료", `연 ${p.pricePerYear.toLocaleString()}원`],
  ];
  const head = (id: string, name: string, sub: string) => (
    <th className={cn("px-3 py-2.5 font-semibold", current === id && "text-brand")}>
      {name}
      <span className="block text-[11px] font-normal text-muted-foreground">{sub}</span>
    </th>
  );
  return (
    <div className={cn("overflow-x-auto rounded-xl border", className)}>
      <table className="w-full min-w-[460px] text-sm">
        <thead className="bg-muted/60 text-xs">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground" />
            {head("guest", g.name, "로그인 없이")}
            {head("member", m.name, "WSNS 가입")}
            {head("pro", p.name, "연간 구독")}
          </tr>
        </thead>
        <tbody className="text-center">
          {rows.map(([label, ...cells]) => (
            <tr key={label} className="border-t">
              <td className="px-4 py-2.5 text-left text-muted-foreground">{label}</td>
              {cells.map((c, i) => (
                <td key={i} className={cn("px-3 py-2.5", i === 2 && "font-semibold")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
