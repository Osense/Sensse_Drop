import type { Metadata } from "next";
import { LinksView } from "@/components/links-view";

export const metadata: Metadata = { title: "내 링크" };

export default function Page() {
  return <LinksView />;
}
