"use client";

import * as React from "react";
import Link from "next/link";
import { Check, ChevronLeft, Copy, Download, Eye, FolderOpen, HardDrive, Inbox, Link2, Loader2, Lock, Plus, QrCode, Trash2, TriangleAlert } from "lucide-react";
import { CollectManager } from "@/components/collect-manager";
import { Countdown } from "@/components/countdown";
import { FileBadge } from "@/components/file-badge";
import { ShareManager } from "@/components/share-manager";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, downloadOwnFile, localLinks, type ShareSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { STATIC_ONLY } from "@/lib/config";
import { formatDate, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePlan } from "@/lib/use-plan";
import { LapseBanner } from "@/components/host-view";

/** 서버에 기록이 남아 있지 않은, 이 기기에만 적어 둔 링크 */
type Gone = { id: string; title: string; createdAt: string; gone: true };
type Row = ShareSummary | Gone;
type Filter = "all" | "open" | "closed";

const isGone = (r: Row): r is Gone => "gone" in r;

/**
 * 내 배포 기록: 만든 링크를 모두 모아 보여 주고, 바로 닫거나 기록을 지울 수 있게.
 * 모르는 사이에 웹에 남아 떠도는 링크가 없도록 하는 게 목적이에요.
 */
export function LinksView() {
  const auth = useAuth();
  const { me, refresh: refreshPlan } = usePlan();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const local = localLinks.all();
    let server: ShareSummary[] = [];
    if (auth.session) {
      try {
        server = (await api<{ shares: ShareSummary[] }>("/api/me/shares", { headers: await auth.authHeaders() })).shares;
      } catch {}
    }
    const seen = new Set(server.map((s) => s.id));
    const ask = local.filter((l) => !seen.has(l.id));
    let mine: ShareSummary[] = [];
    if (ask.length) {
      try {
        mine = (
          await api<{ shares: ShareSummary[] }>("/api/shares/lookup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ links: ask.map((l) => ({ id: l.id, token: l.adminToken })) }),
          })
        ).shares;
      } catch {}
    }
    const found = new Set(mine.map((s) => s.id));
    const gone: Gone[] = ask.filter((l) => !found.has(l.id)).map((l) => ({ id: l.id, title: l.title, createdAt: l.createdAt, gone: true }));
    setRows([...server, ...mine, ...gone].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    refreshPlan();
  }, [auth, refreshPlan]);

  React.useEffect(() => {
    if (auth.ready) load();
  }, [auth.ready, load]);

  const headersFor = React.useCallback(
    (id: string) => async (): Promise<Record<string, string>> => {
      const token = localLinks.token(id);
      return token ? { "X-Admin-Token": token } : await auth.authHeaders();
    },
    [auth],
  );

  async function close(ids: string[]) {
    setBusy(ids.length > 1 ? "all" : ids[0]);
    try {
      for (const id of ids) await api(`/api/shares/${id}/close`, { method: "POST", headers: await headersFor(id)() }).catch(() => {});
    } finally {
      setBusy(null);
      load();
    }
  }

  async function forget(r: Row) {
    if (!isGone(r)) {
      if (!confirm(`'${r.title}' 기록을 지울까요? 남은 파일이 있으면 함께 지워요.`)) return;
      setBusy(r.id);
      await api(`/api/shares/${r.id}`, { method: "DELETE", headers: await headersFor(r.id)() }).catch(() => {});
      setBusy(null);
    }
    localLinks.remove(r.id);
    load();
  }

  const [getting, setGetting] = React.useState<string | null>(null);
  /** 내가 보낸 파일 받아 보기 (무엇을 보냈는지 확인) */
  async function getOwn(shareId: string, f: ShareSummary["files"][number]) {
    setGetting(f.id);
    try {
      await downloadOwnFile(`/api/shares/${shareId}/files/${f.id}/download`, await headersFor(shareId)(), f.name);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setGetting(null);
    }
  }

  async function copy(r: ShareSummary) {
    try {
      await navigator.clipboard.writeText(r.url);
    } catch {}
    setCopied(r.id);
    setTimeout(() => setCopied(null), 1500);
  }

  if (open) {
    const Manager = (rows ?? []).some((r) => r.id === open && !isGone(r) && r.kind === "collect") ? CollectManager : ShareManager;
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <button onClick={() => { setOpen(null); load(); }} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> 배포 기록
        </button>
        <Manager
          id={open}
          headers={headersFor(open)}
          onDeleted={() => { setOpen(null); load(); }}
          onMissing={() => { setOpen(null); load(); }}
        />
      </div>
    );
  }

  const live = (rows ?? []).filter((r): r is ShareSummary => !isGone(r) && r.state === "open");
  const used = live.reduce((n, r) => n + r.bytes, 0);
  const opens = (rows ?? []).reduce((n, r) => n + (isGone(r) ? 0 : r.opens), 0);
  const downloads = (rows ?? []).reduce((n, r) => n + (isGone(r) ? 0 : r.downloads), 0);
  const shown = (rows ?? []).filter((r) => (filter === "all" ? true : filter === "open" ? !isGone(r) && r.state === "open" : isGone(r) || r.state !== "open"));
  const lingering = live.filter((r) => Date.parse(r.expiresAt) - Date.now() > 3600_000);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">배포 기록</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {auth.session ? "내 계정과 이 기기에서 만든 링크를 모두 모았어요." : "이 기기에서 만든 링크를 모았어요."} 다 나눠 준 링크는 바로 닫아 두세요.
          </p>
        </div>
        <Link href="/" className={buttonVariants({ variant: "brand", size: "sm" })}>
          <Plus /> 새 링크
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={<Link2 />} label="열려 있는 링크" value={rows ? `${live.length}개` : "–"} accent={live.length > 0} />
        <Stat
          icon={<HardDrive />}
          label="쓰고 있는 용량"
          value={rows ? formatSize(used) || "0B" : "–"}
          sub={me?.quotaBytes != null ? `/ ${formatSize(me.quotaBytes)}` : undefined}
          ratio={me?.quotaBytes ? Math.min(1, (me.usedBytes || used) / me.quotaBytes) : undefined}
        />
        <Stat icon={<Eye />} label="받는 화면 열람" value={rows ? `${opens}회` : "–"} />
        <Stat icon={<Download />} label="내려받기" value={rows ? `${downloads}회` : "–"} />
      </div>

      {me?.lapse && (
        <div className="mt-4">
          <LapseBanner lapse={me.lapse} />
        </div>
      )}

      {lingering.length > 0 && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
          <TriangleAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="flex-1 text-sm">
            <b>아직 열려 있는 링크가 {lingering.length}개 있어요.</b> 링크와 비밀번호를 아는 사람은 닫힐 때까지 계속 받을 수 있어요. 다 나눠 줬다면 지금 닫아 주세요.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy != null}
            onClick={() => confirm(`열려 있는 링크 ${live.length}개를 모두 닫을까요? 파일은 바로 지워져요.`) && close(live.map((r) => r.id))}
          >
            <Lock /> {busy === "all" ? "닫는 중…" : "모두 닫기"}
          </Button>
        </div>
      )}

      {!auth.session && auth.ready && (
        <p className="mt-4 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          로그인하면 다른 기기에서 만든 링크도 여기에 함께 보여요.{" "}
          <Link href="/login/" className="font-semibold text-brand">
            로그인
          </Link>
        </p>
      )}

      <div className="mt-6 mb-3 flex gap-1 rounded-full bg-muted p-1 text-sm font-semibold w-fit" role="tablist">
        {(
          [
            ["all", "전체", rows?.length ?? 0],
            ["open", "열림", live.length],
            ["closed", "닫힘", (rows?.length ?? 0) - live.length],
          ] as const
        ).map(([k, label, n]) => (
          <button
            key={k}
            role="tab"
            aria-selected={filter === k}
            onClick={() => setFilter(k)}
            className={cn("rounded-full px-4 py-1.5 transition-colors", filter === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {label} <span className="ml-0.5 tabular-nums text-muted-foreground">{n}</span>
          </button>
        ))}
      </div>

      {rows === null ? (
        <Card className="h-40 animate-pulse bg-muted/40" />
      ) : shown.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <FolderOpen className="size-8 text-muted-foreground" />
          <p className="font-semibold">{filter === "open" ? "열려 있는 링크가 없어요" : filter === "closed" ? "닫힌 링크가 없어요" : "아직 만든 링크가 없어요"}</p>
          <p className="text-sm text-muted-foreground">{filter === "open" ? "모두 닫혀 있어서 웹에 남은 파일이 없어요." : "자료를 올리고 첫 링크를 만들어 보세요."}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) =>
            isGone(r) ? (
              <li key={r.id}>
                <Card className="flex items-center gap-3 p-4 opacity-75">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.title}</span>
                    <span className="block text-xs text-muted-foreground">{formatDate(r.createdAt)} 만듦 · 파일과 기록이 모두 지워졌어요</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => forget(r)}>
                    목록에서 빼기
                  </Button>
                </Card>
              </li>
            ) : (
              <li key={r.id}>
                <Card className={cn("overflow-hidden p-0", r.state === "open" ? "border-brand/30" : "bg-muted/30")}>
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                      <div className="min-w-0 flex-1 basis-60">
                        <p className="flex items-center gap-2 truncate text-base font-bold tracking-tight">
                          {r.kind === "collect" && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                              <Inbox className="size-3" /> 수합
                            </span>
                          )}
                          <span className="truncate">{r.title}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDate(r.createdAt)} 만듦 ·{" "}
                          {r.kind === "collect" ? `낸 학생 ${r.submitters ?? 0}명 · 파일 ${r.files.length}개` : `열람 ${r.opens}회 · 내려받기 ${r.downloads}회`}
                          {r.state === "open" && r.bytes > 0 ? ` · ${formatSize(r.bytes)}` : ""}
                        </p>
                      </div>
                      {r.state === "open" ? (
                        <Countdown expiresAt={r.expiresAt} onExpire={load} className="px-2.5 py-0.5 text-xs" />
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                          <Lock className="size-3.5" />
                          {r.state === "closed" ? "직접 닫음" : "시간 지나 닫힘"} · {formatDate(r.closedAt ?? r.expiresAt)}
                        </span>
                      )}
                    </div>

                    {r.message && <p className="mt-3 line-clamp-2 whitespace-pre-line rounded-lg bg-brand/5 px-3 py-2 text-sm text-foreground/80">{r.message}</p>}

                    <ul className={cn("mt-3 flex flex-wrap gap-1.5", r.kind === "collect" && "hidden")}>
                      {r.files.map((f) => {
                        const inner = (
                          <>
                            <FileBadge ext={f.ext} className="h-5 min-w-9 text-[9px]" />
                            <span className={cn("max-w-48 truncate text-xs font-medium", r.purged && "text-muted-foreground line-through decoration-muted-foreground/50")} title={f.name}>
                              {f.name}
                            </span>
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {formatSize(f.size)} · 받아 감 {f.downloads}
                            </span>
                          </>
                        );
                        const can = !r.purged && r.state === "open";
                        return (
                          <li key={f.id} className="max-w-full">
                            {can ? (
                              <button
                                type="button"
                                title="내가 보낸 파일 받아 보기"
                                disabled={getting === f.id}
                                onClick={() => getOwn(r.id, f)}
                                className="flex max-w-full items-center gap-2 rounded-lg border bg-background px-2 py-1 text-left transition-colors hover:border-brand/50 hover:bg-brand/5"
                              >
                                {inner}
                                {getting === f.id ? <Loader2 className="size-3.5 animate-spin text-brand" /> : <Download className="size-3.5 text-brand" />}
                              </button>
                            ) : (
                              <span className="flex max-w-full items-center gap-2 rounded-lg border bg-background px-2 py-1">{inner}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {r.state !== "open" && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        {r.purged ? "파일은 지웠어요." : "파일을 곧 지워요."} 이 기록(제목 · 파일 이름 · 횟수)은 {r.forgetAt ? `${formatDate(r.forgetAt)}에` : "30일 뒤"} 저절로 사라져요.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-4 py-2.5 sm:px-5">
                    {r.state === "open" ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setOpen(r.id)}>
                          {r.kind === "collect" ? <Inbox /> : <QrCode />} {r.kind === "collect" ? "제출 현황 · QR" : "링크 · QR 보기"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => copy(r)}>
                          {copied === r.id ? <Check /> : <Copy />} {copied === r.id ? "복사됨" : "링크 복사"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={busy != null}
                          onClick={() => confirm(`'${r.title}' 링크를 지금 닫을까요? 받는 사람은 더 이상 열 수 없고, 파일은 바로 지워져요.`) && close([r.id])}
                        >
                          <Lock /> {busy === r.id ? "닫는 중…" : "지금 닫기"}
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" disabled={busy != null} onClick={() => forget(r)}>
                        <Trash2 /> 기록 지우기
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ),
          )}
        </ul>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        링크는 정한 시간이 되거나 직접 닫으면 바로 열리지 않고, 올린 파일도 곧바로 지워요. 무엇을 언제 나눠 줬는지 확인할 수 있게 기록만 30일 동안 남겨 두고, 그 뒤에는 저절로 지워요.
        {STATIC_ONLY && " 체험판에서는 이 브라우저 안에만 저장돼요."}
      </p>
    </div>
  );
}

function Stat({ icon, label, value, accent, sub, ratio }: { icon: React.ReactNode; label: string; value: string; accent?: boolean; sub?: string; ratio?: number }) {
  return (
    <Card className={cn("gap-0 p-3.5 [&_svg]:size-4", accent && "border-brand/40 bg-brand/5")}>
      <span className={cn("flex items-center gap-1.5 text-xs font-medium text-muted-foreground", accent && "text-brand")}>
        {icon}
        {label}
      </span>
      <span className="mt-1 text-xl font-extrabold tabular-nums tracking-tight">
        {value}
        {sub && <span className="ml-1 text-xs font-medium text-muted-foreground">{sub}</span>}
      </span>
      {ratio != null && (
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
          <span className="block h-full rounded-full bg-gradient-to-r from-brand to-brand-2" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
        </span>
      )}
    </Card>
  );
}
