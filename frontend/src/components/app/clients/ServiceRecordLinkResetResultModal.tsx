"use client";

import { Input } from "@/components/ui/input";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";

interface ServiceRecordLinkResetResultModalProps {
    open: boolean;
    serviceRecordUrl: string;
    onClose: () => void;
    onCopy: (serviceRecordUrl: string) => void;
}

export function ServiceRecordLinkResetResultModal({
    open,
    serviceRecordUrl,
    onClose,
    onCopy,
}: ServiceRecordLinkResetResultModalProps) {
    return (
        <TwoButtonModal
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onClose();
            }}
            dataComponent="desktop_clients-detail_reset-service-record-link_result"
            title="제공기록지 링크가 재설정되었습니다"
            description="메시지는 발송되지 않았습니다. 아래 링크를 복사해 직접 전달해 주세요."
            isDescriptionVisuallyHidden={false}
            size="detail"
            cancelLabel="닫기"
            approvalLabel="링크 복사"
            onApprove={() => onCopy(serviceRecordUrl)}
        >
            <div className="px-6 py-4">
                <label
                    htmlFor="reset-service-record-link-url"
                    className="mb-2 block text-sm font-medium text-v3-text"
                >
                    제공기록지 링크
                </label>
                <Input
                    id="reset-service-record-link-url"
                    data-component="desktop_clients-detail_reset-service-record-link_url"
                    value={serviceRecordUrl}
                    readOnly
                />
            </div>
        </TwoButtonModal>
    );
}
