import type { EformsignContractClientCandidateResponse } from "@babyjamjam/shared/types/eformsign";

import type { ClientFormData } from "@/features/clients/types";
import { formatKoreanPhoneNumber, normalizeKoreanPhoneLookupKey } from "@/lib/phone";

/**
 * 계약서 후보 응답을 ClientFormDialog 생성 모드 프리필로 변환한다.
 * 폼 상태는 빈 문자열/false 기본값을 쓰므로 null을 그대로 넘기지 않는다.
 */
export function contractCandidateToClientPrefill(
    candidate: EformsignContractClientCandidateResponse,
    now: Date = new Date(),
): Partial<ClientFormData> {
    const normalizedPhone = normalizeKoreanPhoneLookupKey(candidate.phone ?? "");
    const today = localDateOnly(now);
    return {
        name: candidate.name ?? "",
        phone: formatKoreanPhoneNumber(normalizedPhone),
        address: candidate.address ?? "",
        birthday: candidate.birthday ?? "",
        dueDate: candidate.dueDate ?? "",
        startDate: candidate.startDate ?? "",
        endDate: candidate.endDate ?? "",
        primaryEmployeeId: candidate.primaryEmployeeId,
        secondaryEmployeeId: candidate.secondaryEmployeeId,
        type: candidate.type ?? "",
        duration: candidate.duration,
        fullPrice: candidate.fullPrice ?? "",
        grant: candidate.grant ?? "",
        actualPrice: candidate.actualPrice ?? "",
        careCenter: candidate.careCenter ?? false,
        voucherClient: candidate.voucherClient,
        breastPump: candidate.breastPump,
        serviceStatus: candidate.startDate && candidate.startDate < today
            ? "active"
            : "pre_booking",
    };
}

function localDateOnly(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
