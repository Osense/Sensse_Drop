import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  pdf: "bg-red-500 text-white",
  hwp: "bg-sky-500 text-white",
  hwpx: "bg-sky-600 text-white",
  doc: "bg-blue-600 text-white",
  docx: "bg-blue-600 text-white",
  xls: "bg-emerald-600 text-white",
  xlsx: "bg-emerald-600 text-white",
  csv: "bg-emerald-600 text-white",
  ppt: "bg-orange-500 text-white",
  pptx: "bg-orange-500 text-white",
  jpg: "bg-violet-500 text-white",
  jpeg: "bg-violet-500 text-white",
  png: "bg-violet-500 text-white",
  gif: "bg-violet-500 text-white",
  webp: "bg-violet-500 text-white",
  heic: "bg-violet-500 text-white",
  zip: "bg-amber-500 text-white",
  mp4: "bg-pink-500 text-white",
  mov: "bg-pink-500 text-white",
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
