import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard, ListRowsSkeleton } from "@/components/app/mobile-redesign/primitives";
import "@/components/app/mobile-redesign/redesign.css";

export default function MessageHistoryLoading() {
  return (
    <div
      data-component="mobile_messages_history_loading_shell"
      className="mobile-shell-content flex flex-col gap-4 p-4"
    >
      <div data-component="mobile_messages_history_loading_section-nav" className="shrink-0">
        <MessageSectionNav
          data-component="mobile_messages_history_loading_section-nav_nav"
          activeId="history"
        />
      </div>

      <ListCard
        data-component="mobile_messages_history_loading_list-card"
        title="메시지 전송 내역"
        count={<span className="inline-block h-4 w-8 rounded bg-v3-dim-white animate-pulse" />}
        filters={["전체", "발송 성공", "발송 실패"]}
        activeFilter="전체"
      >
        <ListRowsSkeleton
          data-component="mobile_messages_history_loading_skeleton_rows"
          rowCount={6}
        />
      </ListCard>
    </div>
  );
}
