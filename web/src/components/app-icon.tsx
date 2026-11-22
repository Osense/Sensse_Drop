import { cn } from "@/lib/utils";

/** 쎈스드롭 앱 아이콘 (public/icon.svg 와 같은 그림) */
export function AppIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/icon.svg" alt="" width={64} height={64} className={cn("size-9 rounded-[22%] shadow-md shadow-brand/25", className)} />
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-extrabold tracking-tight", className)}>
      Sense <span className="text-gradient">Drop</span>
    </span>
  );
}
