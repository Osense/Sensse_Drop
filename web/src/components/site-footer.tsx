import { BrandLogo } from "@/components/logo";
import { PRODUCT_URL, WSNS_URL } from "@/lib/config";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center">
        <a href={WSNS_URL} aria-label="WSNS studio">
          <BrandLogo className="h-6" />
        </a>
        <span>쎈스 시리즈 · 쎈스드롭은 무료예요.</span>
        <a href={PRODUCT_URL} className="underline-offset-4 hover:underline sm:ml-auto">
          쎈스드롭 소개
        </a>
      </div>
    </footer>
  );
}
