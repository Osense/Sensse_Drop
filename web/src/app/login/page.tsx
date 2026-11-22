import type { Metadata } from "next";
import { LoginView } from "@/components/login-view";

export const metadata: Metadata = { title: "로그인" };

export default function Page() {
  return <LoginView />;
}
