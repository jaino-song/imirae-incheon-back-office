import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function TemplatesLoading() {
  return (
    <div
      data-component="mobile_messages_templates_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <div data-component="mobile_messages_templates_loading_section-nav" className="shrink-0">
        <MessageSectionNav
          data-component="mobile_messages_templates_loading_section-nav_nav"
          activeId="templates"
        />
      </div>

      <ListCard
        data-component="mobile_messages_templates_loading_list-card"
        title="템플릿 내역"
        count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
        filters={[
          { label: "전체", count: "", skeleton: true },
          { label: "기본 템플릿", count: "", skeleton: true },
          { label: "지점 템플릿", count: "", skeleton: true },
        ]}
        activeFilter="전체"
      >
        <ListRowsSkeleton
          data-component="mobile_messages_templates_loading_skeleton_rows"
          rowCount={6}
        />
      </ListCard>
    </div>
  );
}
