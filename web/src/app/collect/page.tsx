import type { Metadata } from "next";
import { CollectHostView } from "@/components/collect-host-view";

export const metadata: Metadata = { title: "과제 수합" };

export default function Page() {
  return <CollectHostView />;
}
