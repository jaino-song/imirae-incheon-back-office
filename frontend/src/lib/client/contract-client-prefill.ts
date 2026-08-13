import type { EformsignContractClientCandidateResponse } from "@babyjamjam/shared/types/eformsign";

import type { ClientFormData } from "@/features/clients/types";

/**
 * 계약서 후보 응답을 ClientFormDialog 생성 모드 프리필로 변환한다.
 * 폼 상태는 빈 문자열/false 기본값을 쓰므로 null을 그대로 넘기지 않는다.
 */
export function contractCandidateToClientPrefill(
    candidate: EformsignContractClientCandidateResponse,
): Partial<ClientFormData> {
    return {
        name: candidate.name ?? "",
        phone: candidate.phone ?? "",
        address: candidate.address ?? "",
        birthday: candidate.birthday ?? "",
        dueDate: candidate.dueDate ?? "",
        startDate: candidate.startDate ?? "",
        endDate: candidate.endDate ?? "",
        type: candidate.type ?? "",
        duration: candidate.duration,
        fullPrice: candidate.fullPrice ?? "",
        grant: candidate.grant ?? "",
        actualPrice: candidate.actualPrice ?? "",
        careCenter: candidate.careCenter ?? false,
        voucherClient: candidate.voucherClient,
        breastPump: candidate.breastPump,
    };
}
