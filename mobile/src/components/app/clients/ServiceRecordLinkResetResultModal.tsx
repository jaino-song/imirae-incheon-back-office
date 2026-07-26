"use client";

import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { Textarea } from "@/components/ui/textarea";

interface ServiceRecordLinkResetResultModalProps {
    "data-component": string;
    open: boolean;
    serviceRecordUrl: string;
    onClose: () => void;
    onCopy: (serviceRecordUrl: string) => void;
}

export function ServiceRecordLinkResetResultModal({
    "data-component": dataComponent,
    open,
    serviceRecordUrl,
    onClose,
    onCopy,
}: ServiceRecordLinkResetResultModalProps) {
    return (
        <ApprovalTwoButtonModal
            open={open}
            data-component={dataComponent}
            title="제공기록지 링크가 재설정되었습니다"
            description="메시지는 발송되지 않았습니다. 아래 링크를 복사해 직접 전달해 주세요."
            isDescriptionVisuallyHidden={false}
            size="detail"
            cancelLabel="닫기"
            approvalLabel="링크 복사"
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onClose();
            }}
            onApprove={() => onCopy(serviceRecordUrl)}
        >
            <div className="space-y-2 pt-5">
                <label htmlFor="reset-service-record-link-url" className="block text-[13px] font-semibold text-v3-text">
                    제공기록지 링크
                </label>
                <Textarea
                    id="reset-service-record-link-url"
                    data-component={`${dataComponent}_url`}
                    value={serviceRecordUrl}
                    readOnly
                    rows={3}
                    className="min-h-[76px] resize-none break-all bg-white text-xs leading-5"
                />
            </div>
        </ApprovalTwoButtonModal>
    );
}
