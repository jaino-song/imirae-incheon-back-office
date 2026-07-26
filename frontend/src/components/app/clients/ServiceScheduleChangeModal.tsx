"use client";

import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { Input } from "@/components/ui/input";

interface ServiceScheduleChangeModalProps {
    open: boolean;
    sessionIndex: number;
    currentDate: string;
    minimumDate: string;
    selectedDate: string;
    isPending: boolean;
    onDateChange: (date: string) => void;
    onClose: () => void;
    onSubmit: () => void;
}

export function ServiceScheduleChangeModal({
    open,
    sessionIndex,
    currentDate,
    minimumDate,
    selectedDate,
    isPending,
    onDateChange,
    onClose,
    onSubmit,
}: ServiceScheduleChangeModalProps) {
    const isPostponed = selectedDate > currentDate;

    return (
        <TwoButtonModal
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onClose();
            }}
            dataComponent="desktop_clients-detail_service-schedule-change-modal"
            title="서비스 일정 변경"
            description={`${sessionIndex}회차 서비스 제공 날짜를 조정합니다.`}
            isDescriptionVisuallyHidden={false}
            size="detail"
            approvalLabel="일정 변경"
            pendingLabel="변경 중..."
            approvalDisabled={!isPostponed}
            isPending={isPending}
            onApprove={onSubmit}
        >
            <div className="space-y-2 py-4">
                <label
                    htmlFor="service-schedule-change-date"
                    className="block text-sm font-medium text-v3-text-primary"
                >
                    {sessionIndex}회차 서비스 제공 날짜
                </label>
                <Input
                    id="service-schedule-change-date"
                    type="date"
                    min={minimumDate}
                    value={selectedDate}
                    disabled={isPending}
                    onChange={(event) => onDateChange(event.target.value)}
                />
            </div>
        </TwoButtonModal>
    );
}
