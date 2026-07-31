import { FileSignature, ClipboardList } from "lucide-react";
import {
  ListCard,
  ListRowsSkeleton,
  MobileSectionNav,
} from "@/components/app/mobile-redesign/primitives";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

const SKELETON_SECTIONS = [
  { id: "maternal-contracts" as const, label: "산모 계약서", icon: FileSignature },
  { id: "service-records" as const, label: "제공기록지", icon: ClipboardList },
];

export default function ContractsLoading() {
  return (
    <MobileDetailSheet
      data-component="mobile_contracts_loading_detail-sheet"
      name="contracts"
      isOpen={false}
      onClose={() => {}}
      list={
        <div
          className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
          data-component="mobile_contracts_loading_list-content"
          data-slot="list-content"
        >
          <MobileSectionNav
            data-component="mobile_contracts_loading_section-nav"
            ariaLabel="계약 문서 섹션"
            items={SKELETON_SECTIONS}
            activeId="maternal-contracts"
            onSelect={() => {}}
          />
          <ListCard
            data-component="mobile_contracts_loading_list-card"
            title="산모 계약서"
            count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
            filters={[
              { label: "전체", count: "", skeleton: true },
              { label: "조치 필요", count: "", skeleton: true },
              { label: "시작 예정", count: "", skeleton: true },
              { label: "종료 예정", count: "", skeleton: true },
            ]}
            activeFilter="전체"
          >
            <ListRowsSkeleton
              data-component="mobile_contracts_loading_skeleton_rows"
              rowCount={6}
            />
          </ListCard>
        </div>
      }
      detail={<div className="detail-body" />}
    />
  );
}
