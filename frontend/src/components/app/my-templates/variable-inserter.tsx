"use client";

import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface VariableInserterProps {
    onInsert: (key: string) => void;
}

const PRESET_VARIABLES = [
    { key: "name", label: "이름" },
    { key: "phone", label: "연락처" },
    { key: "address", label: "주소" },
    { key: "startDate", label: "시작일" },
    { key: "endDate", label: "종료일" },
    { key: "area", label: "지역" },
    { key: "voucherType", label: "바우처유형" },
    { key: "fullPrice", label: "총금액" },
    { key: "actualPrice", label: "본인부담금" },
    { key: "employeeName", label: "직원명" },
];

export const VariableInserter = ({ onInsert }: VariableInserterProps) => {
    const handleAddCustom = () => {
        const key = prompt("변수 키를 입력하세요 (영문 권장):");
        if (key) {
            onInsert(key.trim());
        }
    };

    return (
        <div data-component="desktop_my-templates_variable-inserter" className="flex flex-row flex-wrap gap-2">
            {PRESET_VARIABLES.map((v) => (
                <Badge
                    key={v.key}
                    variant="outline"
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                    onClick={() => onInsert(v.key)}
                >
                    {v.label}
                </Badge>
            ))}
            <Badge
                variant="outline"
                className="cursor-pointer hover:bg-secondary hover:text-secondary-foreground transition-colors"
                onClick={handleAddCustom}
            >
                <Plus className="h-3 w-3 mr-1" />
                커스텀 변수
            </Badge>
        </div>
    );
};
