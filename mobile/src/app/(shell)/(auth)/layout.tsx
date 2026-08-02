import { Metadata } from "next";
import "@/components/app/mobile-redesign/redesign.css";

export const metadata: Metadata = {
  title: "로그인 - 아가잼잼 관리자",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
