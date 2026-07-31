import { Users, Workflow } from "lucide-react";
import {
  ListCard,
  ListRowsSkeleton,
  MobileSectionNav,
} from "@/components/app/mobile-redesign/primitives";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

const SKELETON_SECTIONS = [
  { id: "list" as const, label: "고객 목록", icon: Users },
  { id: "automation" as const, label: "자동화", icon: Workflow },
];

export default function ClientsLoading() {
  return (
    <MobileDetailSheet
      data-component="mobile_clients_loading_detail-sheet"
      name="clients"
      isOpen={false}
      onClose={() => {}}
      list={
        <div
          className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
          data-component="mobile_clients_loading_list-content"
          data-slot="clients-content"
        >
          <MobileSectionNav
            data-component="mobile_clients_loading_section-nav"
            ariaLabel="고객 섹션"
            items={SKELETON_SECTIONS}
            activeId="list"
            onSelect={() => {}}
          />
          <ListCard
            data-component="mobile_clients_loading_list-card"
            title="고객 목록"
            count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
            filters={[
              { label: "전체", count: "", skeleton: true },
              { label: "계약서 필요", count: "", skeleton: true },
              { label: "신규", count: "", skeleton: true },
            ]}
            activeFilter="전체"
          >
            <ListRowsSkeleton
              data-component="mobile_clients_loading_skeleton_rows"
              rowCount={6}
            />
          </ListCard>
        </div>
      }
      detail={<div className="detail-body" />}
    />
  );
}
