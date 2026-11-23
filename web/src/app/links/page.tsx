import type { Metadata } from "next";
import { LinksView } from "@/components/links-view";

export const metadata: Metadata = { title: "배포 기록" };

export default function Page() {
  return <LinksView />;
}
