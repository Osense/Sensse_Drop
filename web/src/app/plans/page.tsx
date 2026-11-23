import type { Metadata } from "next";
import { PlansView } from "@/components/plans-view";

export const metadata: Metadata = { title: "요금제" };

export default function Page() {
  return <PlansView />;
}
