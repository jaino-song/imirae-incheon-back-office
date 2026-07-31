import { ShellListSkeleton } from "@/components/app/mobile-redesign/ShellListSkeleton";

export default function ConsultationsLoading() {
  return (
    <ShellListSkeleton
      name="consultations"
      title="상담 조회"
      searchPlaceholder="상담자, 매니저, 내용 검색"
      filterLabels={["전체", "상담 대기", "상담 완료"]}
    />
  );
}
