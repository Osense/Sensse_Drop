import { CheckCircle2, CircleAlert, Clock, Loader2, Upload } from "lucide-react";
import { STATUS_TEXT } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const Icon =
    status === "done" ? CheckCircle2 : status === "error" ? CircleAlert : status === "waiting" ? Clock : status === "uploading" ? Upload : Loader2;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-semibold",
        status === "done" && "text-emerald-600 dark:text-emerald-400",
        status === "error" && "text-destructive",
        (status === "converting" || status === "uploading") && "text-brand",
        status === "waiting" && "text-muted-foreground",
        className,
      )}
    >
      <Icon className={cn("size-3.5", status === "converting" && "animate-spin")} />
      {STATUS_TEXT[status] ?? status}
    </span>
  );
}
