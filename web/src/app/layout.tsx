import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppBackground } from "@/components/app-background";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { themeInitScript } from "@/components/theme-toggle";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: { default: "쎈스드롭 — 한글 문서를 PDF로, 링크 하나로", template: "%s | 쎈스드롭" },
  description: "HWP · HWPX 파일을 올리면 보이는 그대로 PDF로 바꿔, 비밀번호 걸린 링크 하나로 나눠 줍니다. WSNS 쎈스 시리즈.",
};

export const viewport: Viewport = {};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="only light" />
        <meta name="theme-color" content="#ffffff" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-dvh">
        <AppBackground />
        <AuthProvider>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
