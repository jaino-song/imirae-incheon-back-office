"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ReceiptSendConfirmDialogProps {
  open: boolean;
  customerName: string;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  dataComponent: string;
}

/**
 * Confirms a manual "서비스 종료 안내" receipt-link SMS before it is sent.
 * Manual sends are NOT deduped on the backend, so this confirmation step is
 * the only guard against a stray click resending the message.
 */
export function ReceiptSendConfirmDialog({
  open,
  customerName,
  isPending,
  onConfirm,
  onOpenChange,
  dataComponent,
}: ReceiptSendConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        // Guard escape/outside-click/close-button dismissal the same way the
        // cancel button is disabled while pending: a send in flight must not
        // be silently abandoned (and re-openable to a stray double-send).
        if (!nextOpen && !isPending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent data-component={`${dataComponent}_dialogs_receipt-send-confirm`}>
        <DialogHeader>
          <DialogTitle>서비스 종료 안내 문자를 보낼까요?</DialogTitle>
          <DialogDescription>
            {customerName ? `${customerName} 산모님께 ` : ""}
            본인부담금 영수증 링크가 담긴 문자를 1분 내 발송합니다. 링크는 30일간 유효하며, 산모님이 생년월일로 본인 확인 후 열람합니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            취소
          </Button>
          <Button
            variant="positive"
            onClick={onConfirm}
            disabled={isPending}
            data-component={`${dataComponent}_dialogs_receipt-send-confirm_submit`}
          >
            {isPending ? "발송 예약 중…" : "발송하기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
