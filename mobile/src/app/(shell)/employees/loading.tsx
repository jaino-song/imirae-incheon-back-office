import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function EmployeesLoading() {
  return (
    <ShellListSkeleton
      name="employees"
      title="제공인력"
      filterLabels={["전체", "활동 중", "휴직"]}
      listDataSlot="employees-content"
    />
  );
}
