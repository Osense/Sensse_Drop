"use client";

/**
 * WSNS 통합 계정 로그인 (Supabase Auth).
 * 가입 · 약관 동의 · 비밀번호 찾기는 wsns.studio 에서 하고, 쎈스드롭에서는 로그인만 합니다.
 */
import * as React from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

type AuthState = {
  ready: boolean;
  session: Session | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /** API 요청에 붙일 Authorization 헤더 (비회원이면 빈 객체) */
  authHeaders: () => Promise<Record<string, string>>;
};

const AuthContext = React.createContext<AuthState | null>(null);

function errorMessage(message: string) {
  if (/invalid login credentials/i.test(message)) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (/email not confirmed/i.test(message)) return "가입 인증 메일의 링크를 먼저 눌러 주세요.";
  if (/rate limit|too many/i.test(message)) return "잠시 후 다시 시도해 주세요.";
  return "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  const [session, setSession] = React.useState<Session | null>(null);

  React.useEffect(() => {
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const value = React.useMemo<AuthState>(
    () => ({
      ready,
      session,
      email: session?.user.email ?? null,
      async signIn(email, password) {
        const { error } = await getSupabase().auth.signInWithPassword({ email, password });
        return error ? errorMessage(error.message) : null;
      },
      async signOut() {
        await getSupabase().auth.signOut();
      },
      async authHeaders() {
        const { data } = await getSupabase().auth.getSession();
        const token = data.session?.access_token;
        const h: Record<string, string> = {};
        if (token) h.Authorization = `Bearer ${token}`;
        return h;
      },
    }),
    [ready, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
