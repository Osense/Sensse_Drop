"use client";

import * as React from "react";
import { Download, Loader2, Lock } from "lucide-react";
import { FileBadge } from "@/components/file-badge";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShareMessage } from "@/components/share-message";
import { Countdown } from "@/components/countdown";
import { STATIC_ONLY } from "@/lib/config";
import { api, type CollectInfo, type DownloadItem } from "@/lib/api";
import { SubmitView } from "@/components/submit-view";
import { extOf, formatDate, formatSize } from "@/lib/format";

type Info = { title: string; message?: string; expiresAt: string; fileCount: number; authed: boolean };
const isCollect = (i: Info | CollectInfo): i is CollectInfo => (i as CollectInfo).kind === "collect";
type State = "loading" | "login" | "list" | "gone";

/** 받는 사람 화면: /<코드> (예: drop.wsns.studio/k3m9qr) */
export function ShareView() {
  const [id, setId] = React.useState("");
  const [state, setState] = React.useState<State>("loading");
  const [info, setInfo] = React.useState<Info | null>(null);
  const [collect, setCollect] = React.useState<CollectInfo | null>(null);
  const [items, setItems] = React.useState<DownloadItem[]>([]);
  const [message, setMessage] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  /** 카운트다운이 끝나면 목록을 닫습니다 (서버에서도 만료된 링크는 열리지 않아요) */
  const expire = React.useCallback(() => {
    clearTimeout(timer.current);
    setItems([]);
    setState("gone");
  }, []);

  const loadList = React.useCallback(async (shareId: string) => {
    try {
      const data = await api<{ items: DownloadItem[]; message?: string }>(`/api/s/${shareId}/files`);
      setItems(data.items);
      setMessage(data.message ?? "");
      setState("list");
      clearTimeout(timer.current);
      if (data.items.some((i) => i.status === "uploading" || i.status === "converting")) {
        timer.current = setTimeout(() => loadList(shareId), 3000);
      }
    } catch (e) {
      setState((e as { status?: number }).status === 401 ? "login" : "gone");
    }
  }, []);

  React.useEffect(() => {
    // /<코드> (서버, 직접 치는 짧은 주소) · /s/<코드> (예전 주소) · /s/?id=<코드> (체험판)
    const parts = window.location.pathname.split("/").filter(Boolean);
    const shareId = new URLSearchParams(window.location.search).get("id") || (parts.includes("s") ? parts[parts.indexOf("s") + 1] : parts[parts.length - 1]) || "";
    setId(shareId);
    if (!/^[A-Za-z0-9]{6,16}$/.test(shareId)) {
      setState("gone");
      return;
    }
    api<Info | CollectInfo>(`/api/s/${shareId}`)
      .then((i) => {
        // 수합 링크: 학생 제출 화면
        if (isCollect(i)) {
          document.title = `${i.title} · 과제 제출 · 쎈스드롭`;
          setCollect(i);
          return;
        }
        setInfo(i);
        document.title = `${i.title} · 쎈스드롭`;
        if (i.authed) loadList(shareId);
        else setState("login");
      })
      .catch(() => setState("gone"));
    return () => clearTimeout(timer.current);
  }, [loadList]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      await api(`/api/s/${id}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      await loadList(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  if (collect) return <SubmitView id={id} info={collect} />;

  return (
    <div className="relative">
      {/* 맨 위 가운데: 링크가 닫히기까지 남은 시간 (스크롤해도 보이게) */}
      {info && (state === "login" || state === "list") && (
        <div className="sticky top-16 z-30 border-b bg-background/85 py-2.5 backdrop-blur-xl">
          <div className="flex flex-col items-center gap-0.5 px-4 text-center">
            <Countdown expiresAt={info.expiresAt} onExpire={expire} size="lg" />
            <span className="text-xs text-muted-foreground">{formatDate(info.expiresAt)}에 닫히고 파일이 지워져요</span>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-lg px-4 py-8 sm:py-12">
        {state === "loading" && (
          <div className="grid place-items-center py-24 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}

        {state === "gone" && (
          <Card className="p-8 text-center">
            <h1 className="text-lg font-bold">링크를 열 수 없어요</h1>
            <p className="mt-2 text-sm text-muted-foreground">링크가 없거나 정한 시간이 지나 닫혔어요. 보낸 분께 다시 요청해 주세요.</p>
          </Card>
        )}

        {info && (state === "login" || state === "list") && (
          <div className="mb-5 animate-fade-up">
            <p className="text-sm font-semibold text-brand">받을 자료</p>
            <h1 className="mt-1.5 text-[clamp(1.9rem,8vw,2.75rem)] font-extrabold leading-[1.15] tracking-tight">{info.title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">받을 파일 {state === "list" ? items.length : info.fileCount}개</p>
          </div>
        )}

        {state === "login" && <ShareMessage text={info?.message} className="mb-4" />}

        {state === "login" && (
          <Card className="p-5 sm:p-6">
            <form onSubmit={login} className="space-y-3">
              <label htmlFor="pw" className="flex items-center gap-2 font-semibold">
                <Lock className="size-4 text-brand" /> 비밀번호를 넣어 주세요
              </label>
              <Input
                id="pw"
                type="password"
                autoFocus
                autoComplete="off"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="보낸 분께 받은 비밀번호"
                className="h-12 text-base"
              />
              <Button type="submit" variant="brand" size="lg" className="w-full" disabled={checking || !pw}>
                {checking ? <Loader2 className="animate-spin" /> : null} 확인
              </Button>
              {error && <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</p>}
            </form>
          </Card>
        )}

        {state === "list" && (
          <>
            <ShareMessage text={message} className="mb-4" />
            <ul className="space-y-2.5">
              {items.map((item) => {
                const ready = item.status === "done";
                const ext = item.kind === "pdf" ? "pdf" : extOf(item.name);
                const body = (
                  <>
                    <FileBadge ext={ext} className="h-10 min-w-12" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold leading-snug">{item.name}</span>
                      <span className="block text-xs text-muted-foreground">{formatSize(item.size)}</span>
                    </span>
                    {ready ? (
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-white shadow-md shadow-brand/25">
                        <Download className="size-4" />
                      </span>
                    ) : (
                      <StatusPill status={item.status} />
                    )}
                  </>
                );
                return (
                  <li key={`${item.fileId}-${item.kind}`}>
                    {ready ? (
                      <a
                        href={`/api/s/${id}/download/${item.fileId}/${item.kind}`}
                        download={item.name}
                        onClick={
                          STATIC_ONLY
                            ? (e) => {
                                e.preventDefault();
                                import("@/lib/mock-api").then((m) => m.mockDownload(id, item.fileId, item.kind, item.name)).catch((err) => alert(err.message));
                              }
                            : undefined
                        }
                        className="flex min-h-16 items-center gap-3 rounded-xl border bg-card p-3.5 shadow-sm transition-all hover:border-brand/50 hover:bg-brand/5 active:scale-[0.99]"
                      >
                        {body}
                      </a>
                    ) : (
                      <div className="flex min-h-16 items-center gap-3 rounded-xl border bg-card p-3.5 opacity-70">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-center text-xs text-muted-foreground">파일을 누르면 바로 내려받아져요.</p>
          </>
        )}
      </div>
    </div>
  );
}
