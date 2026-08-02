"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";

import { MessageSenderApprovalModal } from "@/components/app/messages/MessageSenderApprovalModal";
import { settingsApi } from "@/services/api";

const MESSAGE_SENDER_APPROVAL_QUERY_KEY = ["settings", "message-sender-approval"] as const;

interface MessagesPermissionGuardState {
  isLoading: boolean;
  needsSenderApproval: boolean;
}

const MessagesPermissionGuardContext = createContext<MessagesPermissionGuardState>({
  isLoading: false,
  needsSenderApproval: false,
});

export function useMessagesPermissionGuard() {
  return useContext(MessagesPermissionGuardContext);
}

export function MessagesPermissionGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isSettingsRoute = pathname?.startsWith("/messages/settings") ?? false;
  const isLegacySenderApprovalRoute =
    pathname?.startsWith("/messages/sender-approval") ?? false;
  const isReadOnlyRoute = pathname === "/messages/scheduled" || pathname === "/messages/history";
  const isNewMessageRoute = pathname === "/messages/new";
  const isPermissionExemptRoute =
    isSettingsRoute || isLegacySenderApprovalRoute || isReadOnlyRoute;

  const { data: senderApproval, isLoading } = useQuery({
    queryKey: MESSAGE_SENDER_APPROVAL_QUERY_KEY,
    queryFn: settingsApi.getMessageSenderApproval,
    enabled: !isPermissionExemptRoute,
  });

  const needsSenderApproval = Boolean(senderApproval && !senderApproval.isApproved);
  const isApprovalPending = senderApproval?.approvalStatus === "pending";
  const needsRequestPermission = Boolean(
    senderApproval && !senderApproval.isApproved && !senderApproval.canRequest,
  );
  const shouldShowApprovalModal =
    !isPermissionExemptRoute && !isNewMessageRoute && needsSenderApproval;
  const isPermissionCheckLoading = !isPermissionExemptRoute && isLoading;

  const handleApprovalModalCancel = () => {
    router.replace("/all");
  };

  const handleApprovalRequest = () => {
    if (needsRequestPermission) {
      handleApprovalModalCancel();
      return;
    }

    router.push("/messages/settings");
  };

  if (isPermissionCheckLoading) {
    return (
      <div
        data-component="mobile_messages_permission-guard_loading"
        className="flex min-h-screen items-center justify-center"
        role="status"
        aria-live="polite"
      >
        메시지 권한 확인 중...
      </div>
    );
  }

  return (
    <MessagesPermissionGuardContext.Provider
      value={{
        isLoading: !isPermissionExemptRoute && isLoading,
        needsSenderApproval,
      }}
    >
      {children}
      <MessageSenderApprovalModal
        open={shouldShowApprovalModal}
        isApprovalPending={isApprovalPending}
        onOpenChange={(open) => {
          if (!open) handleApprovalModalCancel();
        }}
        needsRequestPermission={needsRequestPermission}
        onCancel={handleApprovalModalCancel}
        onRequest={handleApprovalRequest}
      />
    </MessagesPermissionGuardContext.Provider>
  );
}
