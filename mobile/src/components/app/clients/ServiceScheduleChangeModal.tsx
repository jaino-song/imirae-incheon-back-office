"use client";

import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";
import { Input } from "@/components/ui/input";

interface ServiceScheduleChangeModalProps {
    "data-component": string;
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

function formatTypedDate(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function isValidIsoDate(value: string): boolean {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year
        && date.getMonth() === month - 1
        && date.getDate() === day;
}

export function ServiceScheduleChangeModal({
    "data-component": dataComponent,
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
    const isPostponed = isValidIsoDate(selectedDate)
        && selectedDate >= minimumDate
        && selectedDate > currentDate;

    return (
        <ApprovalTwoButtonModal
            open={open}
            data-component={dataComponent}
            title="서비스 일정 변경"
            description={`${sessionIndex}회차 서비스 제공 날짜를 조정합니다.`}
            isDescriptionVisuallyHidden={false}
            size="detail"
            cancelLabel="취소"
            approvalLabel="일정 변경"
            pendingLabel="변경 중..."
            approvalDisabled={!isPostponed}
            isPending={isPending}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && !isPending) onClose();
            }}
            onApprove={onSubmit}
        >
            <div className="space-y-2 pt-5">
                <label htmlFor="service-schedule-change-date" className="block text-[13px] font-semibold text-v3-text-primary">
                    {sessionIndex}회차 서비스 제공 날짜
                </label>
                <Input
                    id="service-schedule-change-date"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={10}
                    placeholder="YYYY-MM-DD"
                    value={selectedDate}
                    disabled={isPending}
                    className="h-12 rounded-2xl bg-white px-4 text-base"
                    onChange={(event) => onDateChange(formatTypedDate(event.target.value))}
                />
            </div>
        </ApprovalTwoButtonModal>
    );
}
