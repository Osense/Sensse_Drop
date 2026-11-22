"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, FolderOpen, Plus } from "lucide-react";
import { ShareManager } from "@/components/share-manager";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, localLinks, type LocalLink } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";

type Row = { id: string; title: string; createdAt: string; expiresAt?: string; fileCount?: number };

export function LinksView() {
  const auth = useAuth();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const local = localLinks.all();
    let server: Row[] = [];
    if (auth.session) {
      try {
        server = (await api<{ shares: Row[] }>("/api/me/shares", { headers: await auth.authHeaders() })).shares;
      } catch {}
    }
    const seen = new Set(server.map((s) => s.id));
    setRows([...server, ...local.filter((l: LocalLink) => !seen.has(l.id))].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, [auth]);

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

  const forget = (id: string) => {
    localLinks.remove(id);
    setOpen(null);
    load();
  };

  if (open) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <button onClick={() => setOpen(null)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> 내 링크
        </button>
        <ShareManager id={open} headers={headersFor(open)} onDeleted={() => forget(open)} onMissing={() => forget(open)} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">내 링크</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {auth.session ? "내 계정과 이 기기에서 만든 링크예요." : "이 기기에서 만든 링크예요. 로그인하면 어느 기기에서나 볼 수 있어요."}
          </p>
        </div>
        <Link href="/" className={buttonVariants({ variant: "brand", size: "sm" })}>
          <Plus /> 새 링크
        </Link>
      </div>

      {rows === null ? (
        <Card className="h-40 animate-pulse bg-muted/40" />
      ) : rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <FolderOpen className="size-8 text-muted-foreground" />
          <p className="font-semibold">아직 만든 링크가 없어요</p>
          <p className="text-sm text-muted-foreground">한글 파일을 올리고 첫 링크를 만들어 보세요.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const expired = r.expiresAt ? Date.parse(r.expiresAt) < Date.now() : false;
            return (
              <li key={r.id}>
                <button
                  onClick={() => setOpen(r.id)}
                  className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-brand/50 hover:bg-brand/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(r.createdAt)} 만듦
                      {r.fileCount != null ? ` · 파일 ${r.fileCount}개` : ""}
                      {r.expiresAt ? ` · ${expired ? "만료됨" : `${formatDate(r.expiresAt)}까지`}` : ""}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-brand">관리</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
