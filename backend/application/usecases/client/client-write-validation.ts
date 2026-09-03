import { BadRequestException, ConflictException } from "@nestjs/common";

import { assertValidPhone, normalizePhone } from "application/utils/normalize-phone";
import { ClientEntity, clientDurationOutOfRangeMessage } from "domain/entities/client.entity";
import { IClientRepository } from "domain/repositories/client.repository.interface";
import { isServiceStatus, SERVICE_STATUS_VALUES } from "domain/value-objects/service-status.vo";
import {
    countBusinessDaysKr,
    UnsupportedKoreanHolidayYearError,
} from "domain/utils/business-days";

interface AreaLookup {
    area: {
        findFirst(args: {
            where: {
                id: string;
                OR: Array<{ branchId: string } | { branchId: null }>;
            };
            select: { id: true };
        }): Promise<{ id: string } | null>;
    };
}

export interface ClientDateUpdate {
    startDate?: Date | null;
    endDate?: Date | null;
}

export interface MergedClientServicePeriod {
    startDate: Date | null;
    endDate: Date | null;
}

export interface ClientPhoneMatch {
    normalizedPhone: string | null;
    existingClient: ClientEntity | null;
}

/** Validate a client write before any lookup or side effect. */
export function assertClientPhoneInput(phone: string | null | undefined): string | null {
    try {
        return assertValidPhone(phone);
    } catch (error) {
        if (error instanceof Error && error.name === "InvalidPhoneError") {
            throw new BadRequestException("Phone number must be a valid Korean phone number");
        }
        throw error;
    }
}

/**
 * Parse a client calendar date without allowing timezone offsets to change
 * the submitted day. Client date columns are calendar dates, not instants.
 */
export function parseClientDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined || value === null) return value;

    if (!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) {
        throw new BadRequestException("Invalid calendar date");
    }

    const calendarDate = value.slice(0, 10);
    const parsed = new Date(`${calendarDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== calendarDate) {
        throw new BadRequestException("Invalid calendar date");
    }
    return parsed;
}

/**
 * Derive a client's persisted duration from its authoritative calendar dates.
 * The count is inclusive and skips Korean weekends/holidays exactly as the
 * service-record lifecycle does. A missing endpoint remains nullable for
 * pre-booking clients that do not yet have a complete service period.
 */
export function deriveClientDuration(
    startDate: Date | null | undefined,
    endDate: Date | null | undefined,
): number | null {
    if (!startDate || !endDate) return null;
    if (
        Number.isNaN(startDate.getTime())
        || Number.isNaN(endDate.getTime())
        || startDate.getTime() > endDate.getTime()
    ) {
        throw new BadRequestException("서비스 시작일은 종료일보다 늦을 수 없습니다.");
    }

    try {
        const duration = countBusinessDaysKr(
            startDate.toISOString().slice(0, 10),
            endDate.toISOString().slice(0, 10),
        );
        if (duration === null) {
            throw new BadRequestException("서비스 기간을 계산할 수 없습니다.");
        }
        return duration;
    } catch (error) {
        if (error instanceof UnsupportedKoreanHolidayYearError) {
            throw new BadRequestException(error.message);
        }
        throw error;
    }
}

/**
 * Reject a caller-provided duration that cannot fit within the authoritative
 * dates. `duration` is the contracted session count and is authoritative
 * once set; the service period only needs to be long enough to contain it
 * (it may be longer, e.g. when a session is postponed and the end date is
 * extended while the session count stays fixed), so a supplied duration must
 * be <= the derived business-day count, not equal to it.
 */
export function assertClientDurationMatchesDates(
    suppliedDuration: number | null | undefined,
    derivedDuration: number | null,
): void {
    // Undefined means the caller omitted duration. Null is an explicit clear
    // and is only valid while no complete date range exists; once both dates
    // are present, every supplied value must fit within the derived count.
    if (suppliedDuration === undefined || derivedDuration === null) return;
    if (suppliedDuration === null || !Number.isSafeInteger(suppliedDuration) || suppliedDuration < 1 || suppliedDuration > derivedDuration) {
        throw new BadRequestException(clientDurationOutOfRangeMessage(derivedDuration));
    }
}

/**
 * Merge a partial service-period update with the persisted values and enforce
 * the canonical ordering rule. Null is an intentional absence of a date, so
 * ordering is only checked when both merged dates are present; equal dates are
 * valid.
 */
export function mergeAndValidateClientServicePeriod(
    existing: Pick<ClientEntity, "startDate" | "endDate"> | null,
    update: ClientDateUpdate,
): MergedClientServicePeriod {
    const startDate = update.startDate === undefined
        ? existing?.startDate ?? null
        : update.startDate;
    const endDate = update.endDate === undefined
        ? existing?.endDate ?? null
        : update.endDate;

    if (startDate && endDate && startDate > endDate) {
        throw new BadRequestException("서비스 시작일은 종료일보다 늦을 수 없습니다.");
    }

    return { startDate, endDate };
}

export function assertAllowedServiceStatus(status: string | null | undefined): void {
    if (status == null) return;

    if (!isServiceStatus(status)) {
        throw new BadRequestException(
            `serviceStatus must be one of: ${SERVICE_STATUS_VALUES.join(", ")}`,
        );
    }
}

/**
 * Validate an area without revealing whether a foreign-branch area exists.
 * A null branchId is the explicit global-area scope and is accepted here.
 */
export async function assertAllowedClientArea(
    prisma: AreaLookup,
    branchId: string,
    areaId: string | null | undefined,
): Promise<void> {
    if (!areaId) return;

    const area = await prisma.area.findFirst({
        where: {
            id: areaId,
            OR: [{ branchId: branchId }, { branchId: null }],
        },
        select: { id: true },
    });

    if (!area) {
        throw new BadRequestException("areaId must reference an available area");
    }
}

export async function findClientByNormalizedPhone(
    repository: Pick<IClientRepository, "findByPhone">,
    branchId: string,
    phone: string | null | undefined,
): Promise<ClientPhoneMatch> {
    const normalizedPhone = normalizePhone(phone ?? null);
    if (!normalizedPhone) return { normalizedPhone: null, existingClient: null };

    return {
        normalizedPhone,
        existingClient: await repository.findByPhone(branchId, normalizedPhone),
    };
}

/**
 * Reject a phone collision in the branch while allowing the current target to
 * keep its own normalized phone value.
 */
export async function assertPhoneAvailable(
    repository: Pick<IClientRepository, "findByPhone">,
    branchId: string,
    phone: string | null | undefined,
    currentClientId?: number,
): Promise<string | null> {
    const normalizedPhone = assertClientPhoneInput(phone);
    const existingClient = normalizedPhone
        ? await repository.findByPhone(branchId, normalizedPhone)
        : null;
    if (existingClient && existingClient.id !== currentClientId) {
        throw new ConflictException({
            statusCode: 409,
            code: "P2002",
            error: "Conflict",
            message: "A client with this phone already exists",
            field: "phone",
        });
    }
    return normalizedPhone;
}
