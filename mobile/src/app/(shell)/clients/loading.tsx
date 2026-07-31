import { Users, Workflow } from "lucide-react";
import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function ClientsLoading() {
  return (
    <ShellListSkeleton
      name="clients"
      title="고객 목록"
      filterLabels={["전체", "계약서 필요", "신규"]}
      sectionNav={[
        { id: "list", label: "고객 목록", icon: Users },
        { id: "automation", label: "자동화", icon: Workflow },
      ]}
      activeSectionId="list"
      listDataSlot="clients-content"
    />
  );
}
