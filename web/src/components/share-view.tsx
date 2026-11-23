"use client";

import * as React from "react";
import { Download, Loader2, Lock } from "lucide-react";
import { FileBadge } from "@/components/file-badge";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShareMessage } from "@/components/share-message";
import { api, type DownloadItem } from "@/lib/api";
import { extOf, formatDate, formatSize } from "@/lib/format";

type Info = { title: string; expiresAt: string; fileCount: number; authed: boolean };
type State = "loading" | "login" | "list" | "gone";

/** 받는 사람 화면: /s/<링크> */
export function ShareView() {
  const [id, setId] = React.useState("");
  const [state, setState] = React.useState<State>("loading");
  const [info, setInfo] = React.useState<Info | null>(null);
  const [items, setItems] = React.useState<DownloadItem[]>([]);
  const [message, setMessage] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

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
    const shareId = window.location.pathname.split("/").filter(Boolean)[1] ?? "";
    setId(shareId);
    if (!/^[A-Za-z0-9]{8,16}$/.test(shareId)) {
      setState("gone");
      return;
    }
    api<Info>(`/api/s/${shareId}`)
      .then((i) => {
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

  return (
    <div className="relative">
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-72" />
      <div className="mx-auto max-w-lg px-4 py-8 sm:py-12">
        {state === "loading" && (
          <div className="grid place-items-center py-24 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}

        {state === "gone" && (
          <Card className="p-8 text-center">
            <h1 className="text-lg font-bold">링크를 열 수 없어요</h1>
            <p className="mt-2 text-sm text-muted-foreground">링크가 없거나 보관 기간이 지났어요. 보낸 분께 다시 요청해 주세요.</p>
          </Card>
        )}

        {info && (state === "login" || state === "list") && (
          <div className="mb-5 animate-fade-up">
            <p className="text-xs font-semibold text-brand">받을 자료</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{info.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              파일 {info.fileCount}개 · {formatDate(info.expiresAt)}까지
            </p>
          </div>
        )}

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
