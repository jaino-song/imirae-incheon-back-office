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
      data-component="mobile_messages_triggers_detail-sheet"
      name="message-triggers"
      isOpen={isEditorOpen}
      onClose={closeEditor}
      list={(
        <section data-component="messages" className="messages-page">
          <div
            className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
            data-component="messages-content"
          >
            <MessageSectionNav activeId="triggers" />
            <ListCard
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
