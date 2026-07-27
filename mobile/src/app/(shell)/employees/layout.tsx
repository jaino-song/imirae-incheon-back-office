import { Metadata } from "next";

export const metadata: Metadata = {
  title: "제공인력 - 아가잼잼 관리자",
};

export default function EmployeesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
