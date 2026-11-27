import type { Metadata } from "next";
import { HomeView } from "@/components/home-view";

export const metadata: Metadata = { title: "과제 수합" };

/** 예전 주소: 첫 화면의 '수합하기'로 바로 */
export default function Page() {
  return <HomeView initial="collect" />;
}
