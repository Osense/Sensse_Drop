"use client";

import * as React from "react";
import { ArrowRight, Clock, FileText, FolderArchive, Inbox, Lock, QrCode, Send, Users } from "lucide-react";
import { CollectHostView } from "@/components/collect-host-view";
import { HostView } from "@/components/host-view";
import { HOME_EVENT } from "@/lib/home";
import { cn } from "@/lib/utils";

export type Mode = "share" | "collect";


const readMode = (): Mode | null => {
  const h = window.location.hash.replace("#", "");
  return h === "share" || h === "collect" ? h : null;
};

/**
 * 첫 화면: 기능 소개 + '파일 배포하기' · '수합하기' 중 고르기 → 같은 화면에서 한 단계씩 진행.
 * 고른 것은 주소 끝(#share · #collect)에 적어 두어 뒤로 가기로 첫 화면에 돌아올 수 있어요.
 */
export function HomeView({ initial = null }: { initial?: Mode | null }) {
  const [mode, setMode] = React.useState<Mode | null>(initial);

  React.useEffect(() => {
    const sync = () => setMode(readMode() ?? null);
    if (initial) {
      if (!readMode()) history.replaceState(null, "", `#${initial}`);
    } else sync();
    const home = () => {
      if (readMode()) history.pushState(null, "", window.location.pathname + window.location.search);
      setMode(null);
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    window.addEventListener(HOME_EVENT, home);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener(HOME_EVENT, home);
    };
  }, [initial]);

  const choose = React.useCallback((m: Mode | null) => {
    if (m) window.location.hash = m;
    else history.pushState(null, "", window.location.pathname + window.location.search);
    setMode(m);
    window.scrollTo({ top: 0 });
  }, []);
  const goHome = React.useCallback(() => choose(null), [choose]);

  if (mode === "share") return <HostView onHome={goHome} />;
  if (mode === "collect") return <CollectHostView onHome={goHome} />;

  return (
    <div className="relative">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <div className="animate-fade-up text-center">
          <p className="text-sm font-semibold text-brand">쎈스드롭 · WSNS 쎈스 시리즈</p>
          <h1 className="mt-2 text-[clamp(2rem,7vw,3.25rem)] font-extrabold leading-[1.15] tracking-tight">
            나눠 주고, 걷는 일을
            <br />
            <span className="text-gradient">링크 하나로</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            시험지 · 가정통신문은 비밀번호 링크로 나눠 주고, 과제는 링크 하나로 걷어요. 한글(HWP · HWPX)은 보이는 그대로 PDF로 바꿔 주고, 정한 시간이 지나면 파일은 저절로 지워져요.
          </p>
        </div>

        <div className="mt-9 grid gap-3 sm:grid-cols-2">
          <Choice
            onClick={() => choose("share")}
            icon={<Send />}
            title="파일 배포하기"
            desc="자료를 올려 비밀번호 링크 · QR로 나눠 줘요."
            points={["한글은 보이는 그대로 PDF로", "링크 + 비밀번호, 교실 화면엔 QR", "받는 사람은 눌러서 바로 내려받기"]}
          />
          <Choice
            onClick={() => choose("collect")}
            icon={<Inbox />}
            title="수합하기"
            desc="학생이 이름을 적고 과제 파일을 내요."
            points={["학생별로 모아 보고 ZIP으로 한 번에", "명단을 넣으면 안 낸 학생이 바로", "학생끼리는 서로의 파일을 못 봐요"]}
            accent
          />
        </div>

        <h2 className="mt-14 text-center text-lg font-bold">이런 걸 해 줘요</h2>
        <ul className="mt-5 grid gap-3 sm:grid-cols-3">
          <Feature icon={<FileText />} title="한글 → PDF" desc="HWP · HWPX를 올리는 사람 브라우저에서 바로 PDF로 바꿔요. 다른 파일은 그대로." />
          <Feature icon={<Lock />} title="비밀번호 링크" desc="drop.wsns.studio/k3m9qr 처럼 직접 칠 수 있는 짧은 주소에 비밀번호까지." />
          <Feature icon={<QrCode />} title="QR 크게 띄우기" desc="교실 화면에 QR을 크게 띄우거나 이미지로 저장해 나눠요." />
          <Feature icon={<Users />} title="학생별 수합" desc="이름별로 모이고, 명단과 비교해 안 낸 학생을 바로 알려 줘요." />
          <Feature icon={<FolderArchive />} title="ZIP 한 번에" desc="모은 과제를 학생별 폴더나 '이름_파일명'으로 묶어 받아요." />
          <Feature icon={<Clock />} title="저절로 지워짐" desc="정한 시간이 되면 링크가 닫히고 파일이 지워져요. 웹에 남지 않아요." />
        </ul>
      </div>
    </div>
  );
}

function Choice({ onClick, icon, title, desc, points, accent }: { onClick: () => void; icon: React.ReactNode; title: string; desc: string; points: string[]; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col rounded-2xl border bg-card p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/60 hover:shadow-lg hover:shadow-brand/10 active:scale-[0.99]",
        accent && "border-brand/30",
      )}
    >
      <span className="grid size-12 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-brand/25 [&_svg]:size-6">{icon}</span>
      <span className="mt-4 text-xl font-extrabold tracking-tight">{title}</span>
      <span className="mt-1 text-sm text-muted-foreground">{desc}</span>
      <ul className="mt-4 space-y-1.5 text-sm">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />
            {p}
          </li>
        ))}
      </ul>
      <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand">
        시작하기 <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <li className="rounded-xl border bg-card p-4">
      <span className="grid size-9 place-items-center rounded-lg bg-brand/10 text-brand [&_svg]:size-4.5">{icon}</span>
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </li>
  );
}
