"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, LogOut } from "lucide-react";
import { AppIcon, Wordmark } from "@/components/app-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { STATIC_ONLY } from "@/lib/config";
import { HOME_EVENT } from "@/lib/home";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "처음" },
  { href: "/links/", label: "배포 기록" },
  { href: "/plans/", label: "요금제" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { ready, email, signOut } = useAuth();
  const isShare = pathname.startsWith("/s/") || /^\/[a-km-np-z2-9]{6}\/?$/.test(pathname);
  const showNav = !isShare;

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
        <Link href="/" onClick={() => window.dispatchEvent(new Event(HOME_EVENT))} className="flex items-center gap-2.5">
          <AppIcon />
          <span className="leading-tight">
            <Wordmark className="block text-[17px]" />
            <span className="block text-[11px] font-medium text-muted-foreground">쎈스드롭</span>
          </span>
        </Link>

        {showNav && (
          <nav className="ml-2 hidden items-center gap-1 rounded-full bg-muted p-1 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => n.href === "/" && window.dispatchEvent(new Event(HOME_EVENT))}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  pathname === n.href && "bg-background text-foreground shadow-sm",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {!isShare && ready && (
            email ? (
              <>
                <span className="hidden max-w-40 truncate text-sm text-muted-foreground md:inline">{email}</span>
                <Button variant="ghost" size="sm" onClick={() => signOut()}>
                  <LogOut /> 로그아웃
                </Button>
              </>
            ) : (
              <Link href="/login/" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <LogIn /> 로그인
              </Link>
            )
          )}
          <ThemeToggle />
        </div>
      </div>
      {showNav && (
        <nav className="flex border-t sm:hidden">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => n.href === "/" && window.dispatchEvent(new Event(HOME_EVENT))}
              className={cn(
                "flex-1 py-2.5 text-center text-sm font-medium text-muted-foreground",
                pathname === n.href && "text-foreground shadow-[inset_0_-2px_0_var(--brand)]",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      )}
      {STATIC_ONLY && (
        <div className="border-t bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <b>체험판</b> · 서버 연결 전이라 만든 링크와 파일은 이 브라우저에만 저장돼요. 다른 기기 · QR로는 열리지 않아요.
        </div>
      )}
    </header>
  );
}
