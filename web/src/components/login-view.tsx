"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { AppIcon } from "@/components/app-icon";
import { BrandLogo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { WSNS_FORGOT_URL, WSNS_SIGNUP_URL } from "@/lib/config";

export function LoginView() {
  const router = useRouter();
  const { signIn, session } = useAuth();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (session) router.replace("/");
  }, [session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(await signIn(email.trim(), password));
    setBusy(false);
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-10 md:grid-cols-2 md:py-16">
      <div className="order-2 md:order-1">
        <AppIcon className="size-12" />
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">WSNS 계정으로 더 넉넉하게</h1>
        <p className="mt-2 text-muted-foreground">쎈스드롭은 무료예요. 로그인하면 한 번에 더 많이, 더 큰 파일을 보낼 수 있어요.</p>
        <div className="mt-5 overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium" />
                <th className="px-4 py-2 font-medium">비회원</th>
                <th className="px-4 py-2 font-semibold text-brand">로그인</th>
              </tr>
            </thead>
            <tbody className="text-center">
              <tr className="border-t">
                <td className="px-4 py-2.5 text-left">한 번에 올리는 파일</td>
                <td>2개</td>
                <td className="font-semibold">10개</td>
              </tr>
              <tr className="border-t">
                <td className="px-4 py-2.5 text-left">파일 하나 용량</td>
                <td>5MB</td>
                <td className="font-semibold">20MB</td>
              </tr>
              <tr className="border-t">
                <td className="px-4 py-2.5 text-left">자동 삭제</td>
                <td>10분 후</td>
                <td className="font-semibold">10분~7일</td>
              </tr>
              <tr className="border-t">
                <td className="px-4 py-2.5 text-left">배포 기록 모아 보기 · 바로 닫기</td>
                <td className="text-muted-foreground">이 기기만</td>
                <td>
                  <Check className="mx-auto size-4 text-brand" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <BrandLogo className="h-5" /> wsns.studio · 쎈스 초크 · 쎈스 스쿨과 같은 계정이에요. 계정이 없으면 WSNS에서 무료로 가입하세요.
        </p>
      </div>

      <Card className="order-1 h-fit p-6 md:order-2">
        <h2 className="text-lg font-bold">로그인</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">이메일</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">비밀번호</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" variant="brand" className="w-full" size="lg" disabled={busy}>
            {busy ? "확인 중…" : "로그인"}
          </Button>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</p>}
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <a href={WSNS_SIGNUP_URL} target="_blank" rel="noopener" className="font-semibold text-brand">
            WSNS 회원가입
          </a>
          <a href={WSNS_FORGOT_URL} target="_blank" rel="noopener" className="text-muted-foreground hover:text-foreground">
            비밀번호 찾기
          </a>
        </div>
      </Card>
    </div>
  );
}
