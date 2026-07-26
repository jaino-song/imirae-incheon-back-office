"use client";

import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";

interface MessageSenderApprovalModalProps {
  open: boolean;
  isApprovalPending?: boolean;
  needsRequestPermission: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onRequest: () => void;
}

export function MessageSenderApprovalModal({
  open,
  isApprovalPending = false,
  needsRequestPermission,
  onOpenChange,
  onCancel,
  onRequest,
}: MessageSenderApprovalModalProps) {
  const isConfirmOnly = isApprovalPending || needsRequestPermission;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-component="mobile_messages_sender-approval-modal_overlay"
          className="fixed inset-0 z-[200] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <DialogPrimitive.Content
          data-component="mobile_messages_sender-approval-modal_panel"
          className="fixed top-1/2 left-1/2 z-[201] grid w-[calc(100vw-2.5rem)] max-w-[340px] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-2xl border bg-background p-5 shadow-lg outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div
            className="flex flex-col gap-1.5 text-left"
            data-component="mobile_messages_sender-approval-modal_panel_header"
          >
            <DialogPrimitive.Title
              data-component="mobile_messages_sender-approval-modal_panel_header_title"
              className="text-base font-bold text-v3-dark"
            >
              {isApprovalPending
                ? "메시지 발송 신청 승인 대기중 입니다."
                : needsRequestPermission
                ? "지점장 또는 매니저 권한이 필요합니다."
                : "메시지 전송 권한이 필요합니다."}
            </DialogPrimitive.Title>
            {isConfirmOnly ? (
              <DialogPrimitive.Description
                data-component="mobile_messages_sender-approval-modal_panel_header_description"
                className="sr-only"
              >
                {isApprovalPending
                  ? "메시지 발송 신청이 승인 대기중입니다."
                  : "현재 계정은 메시지 발송 기능 신청 권한이 없습니다."}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description
                data-component="mobile_messages_sender-approval-modal_panel_header_description"
                className="text-[0.82rem] leading-relaxed text-v3-text-muted"
              >
                문자 발신번호 승인 신청을 완료해야 메시지를 발송할 수 있습니다.
              </DialogPrimitive.Description>
            )}
          </div>
          <div className="mt-2 flex gap-2" data-component="mobile_messages_sender-approval-modal_panel_actions">
            {isConfirmOnly ? (
              <Button type="button" variant="v3" className="flex-1" onClick={onCancel}>
                확인
              </Button>
            ) : (
              <>
                <Button type="button" variant="v3" className="flex-1" onClick={onRequest}>
                  신청하기
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
                  취소
                </Button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
