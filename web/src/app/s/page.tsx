import type { Metadata } from "next";
import { ShareView } from "@/components/share-view";

export const metadata: Metadata = { title: "자료 받기", robots: { index: false } };

/** Worker 가 /s/<링크> 요청을 이 페이지로 보냅니다. */
export default function Page() {
  return <ShareView />;
}
