"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 사이트 테마를 <html class="dark">와 color-scheme · theme-color 메타에 함께 반영합니다.
 * color-scheme 을 'only light' 로 두어야 폰이 다크 모드일 때 크롬 · 삼성 인터넷의
 * '자동 다크 모드'가 밝은 테마 화면을 강제로 어둡게 바꾸지 않습니다.
 */
export function applyTheme(dark: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "only dark" : "only light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#16161d" : "#ffffff");
}

export const themeInitScript = `(function(){try{var t=localStorage.getItem('wsns.theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);var m=document.querySelector('meta[name="color-scheme"]');if(m)m.setAttribute('content',d?'only dark':'only light');var c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute('content',d?'#16161d':'#ffffff')}catch(e){}})()`;

export function ThemeToggle() {
  const toggle = () => {
    const isDark = !document.documentElement.classList.contains("dark");
    applyTheme(isDark);
    try {
      localStorage.setItem("wsns.theme", isDark ? "dark" : "light");
    } catch {}
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="다크 모드 전환 · Toggle dark mode" className="size-9">
      <Sun className="rotate-0 scale-100 transition-transform duration-300 dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute rotate-90 scale-0 transition-transform duration-300 dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
