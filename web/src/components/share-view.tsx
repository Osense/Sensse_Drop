"use client";

import * as React from "react";
import { Download, Loader2, Lock, ShieldCheck } from "lucide-react";
import { FileBadge } from "@/components/file-badge";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ShareMessage } from "@/components/share-message";
import { Countdown } from "@/components/countdown";
import { STATIC_ONLY } from "@/lib/config";
import { api, type DownloadItem } from "@/lib/api";
import { baseOf, extOf, formatDate, formatSize } from "@/lib/format";
import { decryptName, decryptStream, derivePassword, pickSaveTarget, saveDecrypted, sessionKeys, unwrapShareKey } from "@/lib/e2e";

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4", mp3: "audio/mpeg" };

type Info = { title: string; message?: string; expiresAt: string; fileCount: number; authed: boolean; kdf?: { iter: number; salt: string } | null };
type State = "loading" | "login" | "list" | "gone";

/** 받는 사람 화면: /<코드> (예: drop.wsns.studio/k3m9qr) */
export function ShareView() {
  const [id, setId] = React.useState("");
  const [state, setState] = React.useState<State>("loading");
  const [info, setInfo] = React.useState<Info | null>(null);
  const [items, setItems] = React.useState<DownloadItem[]>([]);
  const [message, setMessage] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  /** 이 링크의 열쇠 (비밀번호에서 풀어 이 탭에만 둬요) */
  const keyRef = React.useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [progress, setProgress] = React.useState<Record<string, string>>({});
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
      const k = keyRef.current;
      if (k) {
        const pairs = await Promise.all(
          data.items.filter((i) => i.nameEnc).map(async (i) => {
            const real = await decryptName(k, i.fileId, i.nameEnc!).catch(() => null);
            return [`${i.fileId}-${i.kind}`, real == null ? i.name : i.kind === "pdf" ? `${baseOf(real)}.pdf` : real] as const;
          }),
        );
        setNames(Object.fromEntries(pairs));
      }
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
    api<Info>(`/api/s/${shareId}`)
      .then((i) => {
        setInfo(i);
        document.title = `${i.title} · 쎈스드롭`;
        // 잠긴 링크는 열쇠가 이 탭에 있어야 목록을 보여 줘요 (없으면 비밀번호를 다시 물어요)
        keyRef.current = i.kdf ? sessionKeys.get(shareId) : null;
        if (i.authed && (!i.kdf || keyRef.current)) loadList(shareId);
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
      if (info?.kdf) {
        // 비밀번호는 서버로 보내지 않아요: 이 브라우저에서 열쇠와 확인용 값을 만들어 확인용 값만 보내요
        const { pwKey, authKey } = await derivePassword(pw, info.kdf.salt, info.kdf.iter);
        const res = await api<{ wrap: string; pepper: string }>(`/api/s/${id}/auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ authKey }),
        });
        const k = await unwrapShareKey(pwKey, res.pepper, id, res.wrap);
        keyRef.current = k;
        sessionKeys.set(id, k);
      } else {
        await api(`/api/s/${id}/auth`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        });
      }
      await loadList(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setChecking(false);
    }
  }

  /** 잠긴 파일: 받으면서 이 브라우저에서 풀어 저장 */
  async function downloadEncrypted(item: DownloadItem, name: string) {
    const k = keyRef.current;
    if (!k) return setState("login");
    const tag = `${item.fileId}-${item.kind}`;
    if (progress[tag]) return;
    const ext = item.kind === "pdf" ? "pdf" : extOf(name);
    try {
      const target = await pickSaveTarget(name, item.size).catch((e: Error) => {
        if (e.name === "AbortError") throw e;
        return null;
      });
      setProgress((p) => ({ ...p, [tag]: "받는 중" }));
      let body: ReadableStream<Uint8Array>;
      let total = item.size ?? 0;
      if (STATIC_ONLY) {
        const blob = await (await import("@/lib/mock-api")).mockDownloadBlob(id, item.fileId, item.kind);
        body = blob.stream();
        total = blob.size;
      } else {
        const res = await fetch(`/api/s/${id}/download/${item.fileId}/${item.kind}`, { credentials: "same-origin" });
        if (res.status === 401) {
          setState("login");
          throw new Error("비밀번호를 다시 넣어 주세요.");
        }
        if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error || "파일을 받지 못했어요.");
        body = res.body;
        total = Number(res.headers.get("Content-Length")) || total;
      }
      await saveDecrypted(
        name,
        MIME[ext] ?? "application/octet-stream",
        (write) => decryptStream(k, body, write, (n) => total > 4 * 1024 * 1024 && setProgress((p) => ({ ...p, [tag]: `${Math.min(99, Math.floor((n / total) * 100))}%` }))),
        target,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") alert((e as Error).message);
    } finally {
      setProgress((p) => {
        const next = { ...p };
        delete next[tag];
        return next;
      });
    }
  }

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
                const tag = `${item.fileId}-${item.kind}`;
                const name = names[tag] ?? item.name;
                const busy = progress[tag];
                const ext = item.kind === "pdf" ? "pdf" : extOf(name);
                const body = (
                  <>
                    <FileBadge ext={ext} className="h-10 min-w-12" />
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold leading-snug">{name}</span>
                      <span className="block text-xs text-muted-foreground">{busy ? `${busy} · 잠금 푸는 중` : formatSize(item.size)}</span>
                    </span>
                    {busy ? (
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
                        <Loader2 className="size-4 animate-spin" />
                      </span>
                    ) : ready ? (
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
                        download={name}
                        onClick={
                          item.nameEnc
                            ? (e) => {
                                e.preventDefault();
                                downloadEncrypted(item, name);
                              }
                            : STATIC_ONLY
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
            {info?.kdf && (
              <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-brand" /> 비밀번호로 잠긴 파일이라, 이 기기에서 잠금을 풀며 받아요.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
