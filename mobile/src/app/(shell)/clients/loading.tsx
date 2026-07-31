import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function ClientsLoading() {
  return (
    <ShellListSkeleton
      name="clients"
      title="고객"
      searchPlaceholder="고객 이름, 매니저 검색"
      filterLabels={["전체", "계약서 필요", "신규"]}
      sectionNav={[
        { id: "list", label: "고객 목록", iconName: "users" },
        { id: "automation", label: "자동화", iconName: "workflow" },
      ]}
      activeSectionId="list"
      listDataSlot="clients-content"
    />
  );
}
