import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  pdf: "bg-red-500 text-white",
  hwp: "bg-sky-500 text-white",
  hwpx: "bg-sky-600 text-white",
};

export function FileBadge({ ext, className }: { ext: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 min-w-11 shrink-0 items-center justify-center rounded-md px-1.5 text-[10px] font-extrabold uppercase tracking-wide",
        COLORS[ext] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {ext}
    </span>
  );
}
