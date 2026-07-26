"use client";

import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard } from "@/components/app/mobile-redesign/primitives";

export { MESSAGE_NAVIGATION_ITEMS } from "@/components/app/mobile-redesign/MessageSectionNav";

import "@/components/app/mobile-redesign/redesign.css";

const AUTOMATION_BASE = "mobile_messages_automation_page";

export function MessagesAutomationPage() {
  return (
    <section
      data-component={AUTOMATION_BASE}
      data-slot="messages-page"
      className="messages-page"
    >
      <div
        className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
        data-component={`${AUTOMATION_BASE}_content`}
        data-slot="messages-content"
      >
        <MessageSectionNav
          data-component={`${AUTOMATION_BASE}_content_section-nav`}
          activeId="send"
        />

        <ListCard
          data-component={`${AUTOMATION_BASE}_content_list-card`}
          title="메시지"
          actionLabel="+ 새 메시지"
          actionHref="/messages/new"
          filters={[]}
        >
          <p className="message-navigation-intro">
            메시지 전송과 관리 기능을 한곳에서 이용할 수 있습니다.
          </p>
        </ListCard>
      </div>
    </section>
  );
}
