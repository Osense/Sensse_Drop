"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, LogOut } from "lucide-react";
import { AppIcon, Wordmark } from "@/components/app-icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { STATIC_ONLY } from "@/lib/config";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "보내기" },
  { href: "/links/", label: "내 링크" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { ready, email, signOut } = useAuth();
  const isShare = pathname.startsWith("/s/") || STATIC_ONLY;

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <AppIcon />
          <span className="leading-tight">
            <Wordmark className="block text-[17px]" />
            <span className="block text-[11px] font-medium text-muted-foreground">쎈스드롭</span>
          </span>
        </Link>

        {!isShare && (
          <nav className="ml-2 hidden items-center gap-1 rounded-full bg-muted p-1 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
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
      {!isShare && (
        <nav className="flex border-t sm:hidden">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
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
    </header>
  );
}
