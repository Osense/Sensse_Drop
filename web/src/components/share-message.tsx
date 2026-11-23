import { MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";

/** 보낸 사람이 쓴 안내 메시지 (줄바꿈 그대로, 글자로만 보여 줌) */
export function ShareMessage({ text, className }: { text?: string | null; className?: string }) {
  if (!text) return null;
  return (
    <div className={cn("flex gap-3 rounded-xl border bg-brand/5 px-4 py-3.5", className)}>
      <MessageSquareText className="mt-0.5 size-4 shrink-0 text-brand" />
      <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
    </div>
  );
}
