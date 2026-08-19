import { Injectable } from "@nestjs/common";

import {
    extractEformsignContractClientPrefillCandidate,
    formatNormalizedKoreanPhone,
    toEformsignDocumentDetail,
} from "application/utils/eformsign-contract-client-candidate";
import { normalizePhone } from "application/utils/normalize-phone";
import { PrismaService } from "infrastructure/database/prisma.service";

/**
 * Byte-identical copy of EformsignContractClientCandidateResponse in
 * packages/shared/src/types/eformsign.ts. The backend build cannot import
 * workspace TypeScript; change both declarations together.
 */
export interface EformsignContractClientCandidateResponse {
    documentId: string;
    extracted: boolean;
    name: string | null;
    phone: string | null;
    address: string | null;
    birthday: string | null;
    dueDate: string | null;
    startDate: string | null;
    endDate: string | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    careCenter: boolean | null;
    voucherClient: boolean;
    breastPump: boolean;
}

/**
 * 미연결 계약서에서 고객 등록 폼 프리필용 후보를 읽어온다.
 * 자동 등록(LinkMirroredEformsignDocByPhoneUsecase)과 같은 필드·별칭 테이블을
 * 사용하되, 등록 폼에서는 전화번호를 검증하지 못해도 다른 상세 필드를 보존한다.
 * 전화번호는 고객 수신자로 검증된 상세 번호 또는 신뢰 가능한 customerPhone만
 * 국내 형식으로 정규화하며 legacy SMS 번호는 사용하지 않는다.
 * Caller MUST apply the branch guard (see EformsignController.getDocumentClientCandidate)
 * before calling; this method performs no tenant scoping.
 */
@Injectable()
export class GetContractClientCandidateUsecase {
    constructor(private readonly prisma: PrismaService) {}

    async execute(
        documentId: string,
    ): Promise<EformsignContractClientCandidateResponse | null> {
        const document = await this.prisma.eformsign_doc.findUnique({
            where: { documentId },
            select: {
                documentId: true,
                detailPayload: true,
                customerName: true,
                customerPhone: true,
            },
        });
        if (!document) return null;

        const detail = toEformsignDocumentDetail(document.detailPayload);
        const candidate = detail
            ? extractEformsignContractClientPrefillCandidate(detail)
            : null;
        const phone = formattedKoreanPhone(
            candidate?.phone ?? document.customerPhone,
        );
        if (!candidate) {
            return {
                documentId: document.documentId,
                extracted: false,
                name: null,
                phone,
                address: null,
                birthday: null,
                dueDate: null,
                startDate: null,
                endDate: null,
                type: null,
                duration: null,
                fullPrice: null,
                grant: null,
                actualPrice: null,
                careCenter: null,
                voucherClient: false,
                breastPump: false,
            };
        }

        return {
            documentId: document.documentId,
            extracted: true,
            name: candidate.name,
            phone,
            address: candidate.address,
            birthday: candidate.birthday,
            dueDate: toDateOnly(candidate.dueDate),
            startDate: toDateOnly(candidate.startDate),
            endDate: toDateOnly(candidate.endDate),
            type: candidate.type,
            duration: candidate.duration,
            fullPrice: candidate.fullPrice,
            grant: candidate.grant,
            actualPrice: candidate.actualPrice,
            careCenter: candidate.careCenter,
            voucherClient: candidate.voucherClient,
            breastPump: candidate.breastPump,
        };
    }
}

function formattedKoreanPhone(phone: string | null): string | null {
    const normalized = normalizePhone(phone);
    return normalized ? formatNormalizedKoreanPhone(normalized) : null;
}

// 추출기가 만드는 Date는 UTC 자정 기준(Date.UTC)이므로 toISOString 절단이 안전하다.
function toDateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}
