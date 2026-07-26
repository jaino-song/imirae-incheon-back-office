"use client";

import { useState } from "react";

import { MessageTriggerList } from "@/components/app/mobile-redesign/MessageTriggerList";
import { MessageTriggerEditor } from "@/components/app/mobile-redesign/MessageTriggerEditor";
import { ClientRegistrationPolicySettings } from "@/components/app/mobile-redesign/ClientRegistrationPolicySettings";
import { MessageSectionNav } from "@/components/app/mobile-redesign/MessageSectionNav";
import { ListCard } from "@/components/app/mobile-redesign/primitives";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import type { MessageTriggerRule } from "@/features/message-triggers/types";
import "@/components/app/mobile-redesign/redesign.css";

/**
 * Canonical data-component base for the /messages/automation route. The
 * editor pane lives in MessageTriggerEditor and continues this path.
 */
const TRIGGERS_SHEET_BASE = "mobile_messages_triggers_detail-sheet";
const TRIGGERS_LIST_BASE = `${TRIGGERS_SHEET_BASE}_stack_list-page_shell`;

export function MessagesTriggersPage() {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<MessageTriggerRule | null>(null);

  const openEditor = (rule: MessageTriggerRule | null) => {
    setEditingRule(rule);
    setIsEditorOpen(true);
  };

  const closeEditor = () => {
    setIsEditorOpen(false);
    setEditingRule(null);
  };

  return (
    <MobileDetailSheet
      data-component={TRIGGERS_SHEET_BASE}
      name="message-triggers"
      isOpen={isEditorOpen}
      onClose={closeEditor}
      list={(
        <section
          data-component={TRIGGERS_LIST_BASE}
          data-slot="messages-page"
          className="messages-page"
        >
          <div
            className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
            data-component={`${TRIGGERS_LIST_BASE}_content`}
            data-slot="messages-content"
          >
            <MessageSectionNav
              data-component={`${TRIGGERS_LIST_BASE}_content_section-nav`}
              activeId="triggers"
            />
            <ListCard
              data-component={`${TRIGGERS_LIST_BASE}_content_list-card`}
              title="자동 전송"
              actionLabel="+ 규칙"
              onActionClick={() => openEditor(null)}
              filters={[]}
              beforeScroll={<ClientRegistrationPolicySettings />}
            >
              <MessageTriggerList onEdit={openEditor} />
            </ListCard>
          </div>
        </section>
      )}
      detail={isEditorOpen ? <MessageTriggerEditor rule={editingRule} onClose={closeEditor} /> : null}
    />
  );
}
