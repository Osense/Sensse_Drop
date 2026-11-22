import { HostView } from "@/components/host-view";
import { PdfOnlyView } from "@/components/pdf-only-view";
import { STATIC_ONLY } from "@/lib/config";

export default function Page() {
  return STATIC_ONLY ? <PdfOnlyView /> : <HostView />;
}
