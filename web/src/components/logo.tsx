import { cn } from "@/lib/utils";

/** WSNS studio 공식 로고 (밝은 화면 / 어두운 화면 버전) */
export function BrandLogo({ className, alt = "WSNS studio" }: { className?: string; alt?: string }) {
  return (
    <span className={cn("inline-block", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/wsns-studio.svg" alt={alt} width={408} height={132} className="block h-full w-auto dark:hidden" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/wsns-studio-on-dark.svg" alt={alt} width={408} height={132} className="hidden h-full w-auto dark:block" />
    </span>
  );
}
