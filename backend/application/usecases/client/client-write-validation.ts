import { BadRequestException, ConflictException } from "@nestjs/common";

import { normalizePhone } from "application/utils/normalize-phone";
import { ClientEntity } from "domain/entities/client.entity";
import { IClientRepository } from "domain/repositories/client.repository.interface";
import { isServiceStatus, SERVICE_STATUS_VALUES } from "domain/value-objects/service-status.vo";

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

/**
 * Parse a client calendar date without allowing timezone offsets to change
 * the submitted day. Client date columns are calendar dates, not instants.
 */
export function parseClientDate(value: string | null | undefined): Date | null | undefined {
    if (value === undefined || value === null) return value;

    const calendarDate = value.slice(0, 10);
    const parsed = new Date(`${calendarDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== calendarDate) {
        throw new BadRequestException("Invalid calendar date");
    }
    return parsed;
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
    const { normalizedPhone, existingClient } = await findClientByNormalizedPhone(repository, branchId, phone);
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
