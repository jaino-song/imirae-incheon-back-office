"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "@/services/api";
import { MessageApprovalRequiredNotice } from "@/components/app/messages/MessageApprovalRequiredNotice";

export function MessageApprovalGate({
  children,
  dataComponent,
}: {
  children: ReactNode;
  dataComponent: string;
}) {
  const { data: senderApproval, isLoading } = useQuery({
    queryKey: ["settings", "message-sender-approval"],
    queryFn: settingsApi.getMessageSenderApproval,
  });

  if (isLoading || senderApproval?.isApproved) {
    return <>{children}</>;
  }

  return (
    <div
      data-component={dataComponent}
      className="flex h-full min-h-0 flex-1 items-center justify-center"
    >
      <MessageApprovalRequiredNotice dataComponent={`${dataComponent}_notice`} />
    </div>
  );
}
