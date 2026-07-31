import { User, Calendar, File, Send } from "lucide-react";
import { DashboardRedesign } from "@/components/app/mobile-redesign/DashboardRedesign";
import "@/components/app/mobile-redesign/redesign.css";

const DUMMY_ANALYTICS = [
  { label: "서비스 진행 중", value: "0", tone: "primary" as const, icon: User },
  { label: "7일 내 시작 예정", value: "0", tone: "orange" as const, icon: Calendar },
  { label: "검토 필요 문서", value: "0", tone: "green" as const, icon: File },
  { label: "계약서 미완료", value: "0", tone: "burgundy" as const, icon: Send },
];

const DUMMY_FILTERS = [
  { label: "전체", count: "", skeleton: true },
  { label: "조치 필요", count: "", skeleton: true },
  { label: "시작 예정", count: "", skeleton: true },
  { label: "종료 예정", count: "", skeleton: true },
];

export default function DashboardLoading() {
  return (
    <div
      data-component="mobile_dashboard_loading_shell"
      className="flex h-full min-h-0 flex-col"
    >
      <DashboardRedesign
        analytics={DUMMY_ANALYTICS}
        sections={[]}
        filters={DUMMY_FILTERS}
        activeFilter="전체"
        analyticsLoading={true}
        loading={true}
      />
    </div>
  );
}
