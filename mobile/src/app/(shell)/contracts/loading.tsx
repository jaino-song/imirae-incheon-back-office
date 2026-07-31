import { FileSignature, ClipboardList } from "lucide-react";
import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function ContractsLoading() {
  return (
    <ShellListSkeleton
      name="contracts"
      title="산모 계약서"
      filterLabels={["전체", "조치 필요", "시작 예정", "종료 예정"]}
      sectionNav={[
        { id: "maternal-contracts", label: "산모 계약서", icon: FileSignature },
        { id: "service-records", label: "제공기록지", icon: ClipboardList },
      ]}
      activeSectionId="maternal-contracts"
    />
  );
}
