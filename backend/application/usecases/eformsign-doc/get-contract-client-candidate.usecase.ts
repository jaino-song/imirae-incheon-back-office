import { Injectable } from "@nestjs/common";

import { CreateEmployeeUsecase } from "application/usecases/employee/create-employee.usecase";

import {
    EformsignContractClientPrefillCandidate,
    extractEformsignContractClientPrefillCandidate,
    formatNormalizedKoreanPhone,
    toEformsignDocumentDetail,
} from "application/utils/eformsign-contract-client-candidate";
import { normalizePhone } from "application/utils/normalize-phone";
import { countBusinessDaysKr } from "domain/utils/business-days";
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
    primaryEmployeeId: number | null;
    secondaryEmployeeId: number | null;
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
 * Caller MUST apply the document branch guard (see
 * EformsignController.getDocumentClientCandidate) before calling. Related
 * employee lookup remains explicitly scoped to that same branch here.
 */
@Injectable()
export class GetContractClientCandidateUsecase {
    constructor(
        private readonly prisma: PrismaService,
        private readonly createEmployee: CreateEmployeeUsecase,
    ) {}

    async execute(
        documentId: string,
        branchId?: string,
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
        const employeeIds = candidate
            ? await this.resolveProviderEmployeeIds(candidate, branchId)
            : { primaryEmployeeId: null, secondaryEmployeeId: null };
        const resolvedProvider = {
            primary: employeeIds.primaryEmployeeId !== null,
            secondary: employeeIds.secondaryEmployeeId !== null,
        };
        const voucherSelection = candidate
            ? await this.resolveVoucherSelection(candidate, resolvedProvider.primary)
            : null;
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
                primaryEmployeeId: null,
                secondaryEmployeeId: null,
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
            ...employeeIds,
                type: voucherSelection?.type ?? candidate.type,
                duration: voucherSelection?.duration ?? candidate.duration,
            fullPrice: candidate.fullPrice,
            grant: candidate.grant,
            actualPrice: candidate.actualPrice,
            careCenter: candidate.careCenter,
            voucherClient: candidate.voucherClient,
            breastPump: candidate.breastPump,
        };
    }

    private async resolveProviderEmployeeIds(
        candidate: EformsignContractClientPrefillCandidate,
        branchId?: string,
    ): Promise<{ primaryEmployeeId: number | null; secondaryEmployeeId: number | null }> {
        if (!branchId) {
            return { primaryEmployeeId: null, secondaryEmployeeId: null };
        }

        const providers = [
            { name: candidate.primaryProviderName, phone: candidate.primaryProviderPhone },
            { name: candidate.secondaryProviderName, phone: candidate.secondaryProviderPhone },
        ];
        const filters = providers.flatMap(({ name, phone }) => [
            ...(name ? [{ name: name.trim() }] : []),
            ...(phone ? [
                { phone },
                { phone: formatNormalizedKoreanPhone(phone) },
            ] : []),
        ]);
        if (filters.length === 0) {
            return { primaryEmployeeId: null, secondaryEmployeeId: null };
        }

        const employees = await this.prisma.employee.findMany({
            where: {
                branchId,
                deletedAt: null,
                OR: filters,
            },
            select: { id: true, name: true, phone: true },
        });
        const resolve = (provider: typeof providers[number]): number | null => {
            const phoneMatches = provider.phone
                ? employees.filter((employee) => normalizePhone(employee.phone) === provider.phone)
                : [];
            if (phoneMatches.length === 1) return phoneMatches[0]!.id;

            const normalizedName = provider.name?.trim();
            const nameMatches = normalizedName
                ? employees.filter((employee) => employee.name.trim() === normalizedName)
                : [];
            return nameMatches.length === 1 ? nameMatches[0]!.id : null;
        };

        return {
            primaryEmployeeId:
                resolve(providers[0]!) ?? await this.createMissingProvider(branchId, providers[0]!),
            secondaryEmployeeId: resolve(providers[1]!),
        };
    }

    private async createMissingProvider(
        branchId: string,
        provider: { name: string | null; phone: string | null },
    ): Promise<number | null> {
        if (!branchId || !provider.name || !provider.phone) return null;

        try {
            const employee = await this.createEmployee.execute(
                branchId,
                provider.name.trim(),
                ["미지정"],
                formatNormalizedKoreanPhone(provider.phone),
                "스탠다드",
                true,
            );
            return employee.id;
        } catch (error) {
            // A concurrent registration can win the unique phone constraint. Re-read
            // the canonical row instead of failing the read-only-looking prefill.
            if (!(error instanceof Error && error.message.includes("Unique constraint"))) throw error;
            const existing = await this.prisma.employee.findFirst({
                where: {
                    branchId,
                    phone: formatNormalizedKoreanPhone(provider.phone),
                    deletedAt: null,
                },
                select: { id: true },
            });
            return existing?.id ?? null;
        }
    }

    private async resolveVoucherSelection(
        candidate: EformsignContractClientPrefillCandidate,
        hasResolvedPrimaryProvider = false,
    ): Promise<{ type: string; duration: number } | null> {
        if (!candidate.voucherClient || (candidate.type && candidate.duration)) return null;
        const year = (candidate.startDate ?? candidate.endDate)?.getUTCFullYear();
        const amounts = [candidate.fullPrice, candidate.grant, candidate.actualPrice]
            .filter((value): value is string => Boolean(value));
        if (!year || amounts.length < 2) return null;

        const businessDayDuration = candidate.startDate && candidate.endDate
            ? countBusinessDaysKr(
                candidate.startDate.toISOString().slice(0, 10),
                candidate.endDate.toISOString().slice(0, 10),
            )
            : null;

        const priceRows = await this.prisma.voucher_price_info.findMany({
            where: { year },
            select: {
                type: true,
                duration: true,
                fullPrice: true,
                grant: true,
                actualPrice: true,
            },
        });
        const matches = priceRows.filter((row) => {
            if (!row.type || row.duration == null) return false;
            if (candidate.type && row.type !== candidate.type) return false;
            if (candidate.duration && Number(row.duration) !== candidate.duration) return false;
            if (!candidate.duration && !hasResolvedPrimaryProvider && businessDayDuration && Number(row.duration) !== businessDayDuration) return false;
            return (
                (!candidate.fullPrice || numericAmount(row.fullPrice) === candidate.fullPrice)
                && (!candidate.grant || numericAmount(row.grant) === candidate.grant)
                && (!candidate.actualPrice || numericAmount(row.actualPrice) === candidate.actualPrice)
            );
        });
        if (matches.length !== 1) return null;
        const match = matches[0]!;
        const duration = Number(match.duration);
        return Number.isSafeInteger(duration) && duration > 0
            ? { type: match.type!, duration }
            : null;
    }
}

function numericAmount(value: string | null): string | null {
    const digits = value?.replace(/\D/g, "") ?? "";
    return digits || null;
}

function formattedKoreanPhone(phone: string | null): string | null {
    const normalized = normalizePhone(phone);
    return normalized ? formatNormalizedKoreanPhone(normalized) : null;
}

// 추출기가 만드는 Date는 UTC 자정 기준(Date.UTC)이므로 toISOString 절단이 안전하다.
function toDateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}
