import { Injectable } from "@nestjs/common";

import { VoucherPriceInfoEntity } from "domain/entities/voucher-price-info.entity";
import { FindVoucherPriceInfoByTypeUsecase } from "./find-voucher-price-info-by-type.usecase";

export const VOUCHER_SERVICE_VARIANTS = ["단축형", "표준형", "연장형"] as const;
export type VoucherServiceVariant = (typeof VOUCHER_SERVICE_VARIANTS)[number];

export interface ResolveVoucherServiceSelectionInput {
    type?: string | null;
    startDate?: Date | string | null;
    serviceStartDate?: Date | string | null;
    duration?: number | bigint | string | null;
}

export interface VoucherServiceSelection {
    type: string;
    duration: number;
    fullPrice: string;
    grant: string;
    actualPrice: string;
}

export class VoucherServiceSelectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = VoucherServiceSelectionError.name;
    }
}

export interface ParsedVoucherServiceLabel {
    canonicalType: string;
    variant: VoucherServiceVariant | undefined;
}

const SEPARATOR_PATTERN = /[\s\-_‐‑‒–—―]+/gu;
const VARIANT_PATTERN = /(단축형|단축|표준형|표준|연장형|연장)$/u;
const VOUCHER_TYPE_PATTERN = /^[A-Z][가-힣]*\d+형$/u;

function compactVoucherLabel(value: string): string {
    return value.normalize("NFKC").toUpperCase().replace(SEPARATOR_PATTERN, "");
}

function canonicalVariant(value: string): VoucherServiceVariant | undefined {
    if (value === "단축" || value === "단축형") return "단축형";
    if (value === "표준" || value === "표준형") return "표준형";
    if (value === "연장" || value === "연장형") return "연장형";
    return undefined;
}

export function parseVoucherServiceLabel(value: string | null | undefined): ParsedVoucherServiceLabel | null {
    if (typeof value !== "string" || value.trim().length === 0) return null;

    const compact = compactVoucherLabel(value);
    const variantMatch = compact.match(VARIANT_PATTERN);
    const variantToken = variantMatch?.[1];
    const variant = variantToken ? canonicalVariant(variantToken) : undefined;
    const base = variantToken ? compact.slice(0, -variantToken.length) : compact;
    if (!VOUCHER_TYPE_PATTERN.test(base)) return null;

    return { canonicalType: base, variant };
}

export function isVoucherServiceLabel(value: string | null | undefined): boolean {
    return parseVoucherServiceLabel(value) !== null;
}

function parseYear(value: Date | string | null | undefined): number {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new VoucherServiceSelectionError("A valid service start date is required to resolve voucher pricing");
        }
        return value.getUTCFullYear();
    }

    if (typeof value !== "string") {
        throw new VoucherServiceSelectionError("A valid service start date is required to resolve voucher pricing");
    }

    const calendarDate = value.slice(0, 10);
    const parsed = new Date(`${calendarDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)
        || Number.isNaN(parsed.getTime())
        || parsed.toISOString().slice(0, 10) !== calendarDate) {
        throw new VoucherServiceSelectionError("A valid service start date is required to resolve voucher pricing");
    }
    return Number(calendarDate.slice(0, 4));
}

function parseSafeDuration(value: number | bigint | string | null | undefined): number | undefined {
    if (value === null || value === undefined || value === "") return undefined;

    if (typeof value === "bigint") {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
    }

    if (typeof value === "number") {
        return Number.isSafeInteger(value) && value > 0 ? value : undefined;
    }

    if (!/^\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function rowDuration(row: VoucherPriceInfoEntity): number {
    if (row.duration === null || row.duration === undefined) {
        throw new VoucherServiceSelectionError("Voucher price row is missing a service duration");
    }

    const duration = Number(row.duration);
    if (!Number.isSafeInteger(duration) || duration <= 0) {
        throw new VoucherServiceSelectionError("Voucher price row has an unsafe duration; duration must be a safe integer");
    }
    return duration;
}

function rowPrices(row: VoucherPriceInfoEntity): Pick<VoucherServiceSelection, "fullPrice" | "grant" | "actualPrice"> {
    if (typeof row.fullPrice !== "string" || typeof row.grant !== "string" || typeof row.actualPrice !== "string"
        || row.fullPrice.trim().length === 0 || row.grant.trim().length === 0 || row.actualPrice.trim().length === 0) {
        throw new VoucherServiceSelectionError("Voucher price row is missing an authoritative price value");
    }

    return {
        fullPrice: row.fullPrice,
        grant: row.grant,
        actualPrice: row.actualPrice,
    };
}

function selectRow(
    rows: VoucherPriceInfoEntity[],
    variant: VoucherServiceVariant | undefined,
    requestedDuration: number | undefined,
): { row: VoucherPriceInfoEntity; duration: number } {
    const candidates = rows.map((row) => ({ row, duration: rowDuration(row) }));
    const duplicateDuration = candidates.some(({ duration }, index) => candidates.findIndex((candidate) => candidate.duration === duration) !== index);
    if (duplicateDuration) {
        throw new VoucherServiceSelectionError("Voucher price rows contain duplicate durations; provide an exact unambiguous duration");
    }

    if (requestedDuration !== undefined) {
        const match = candidates.filter(({ duration }) => duration === requestedDuration);
        if (match.length !== 1) {
            throw new VoucherServiceSelectionError(`No voucher price row matches duration ${requestedDuration}; provide an exact service duration`);
        }
        const selected = match[0];
        if (!selected) {
            throw new VoucherServiceSelectionError(`No voucher price row matches duration ${requestedDuration}; provide an exact service duration`);
        }

        if (variant && candidates.length === VOUCHER_SERVICE_VARIANTS.length) {
            const sorted = [...candidates].sort((left, right) => left.duration - right.duration);
            const expectedIndex = VOUCHER_SERVICE_VARIANTS.indexOf(variant);
            if (sorted[expectedIndex]?.duration !== requestedDuration) {
                throw new VoucherServiceSelectionError(`Voucher variant ${variant} does not match the explicit duration ${requestedDuration}`);
            }
        }

        return selected;
    }

    if (!variant) {
        if (candidates.length !== 1) {
            throw new VoucherServiceSelectionError("Voucher type has multiple price rows; provide an explicit service duration");
        }
        const selected = candidates[0];
        if (!selected) {
            throw new VoucherServiceSelectionError("Voucher type has no usable price row; provide an explicit service duration");
        }
        return selected;
    }

    if (candidates.length !== VOUCHER_SERVICE_VARIANTS.length) {
        throw new VoucherServiceSelectionError(`Voucher variant ${variant} cannot be mapped safely from ${candidates.length} price rows; provide an explicit duration`);
    }

    const sorted = [...candidates].sort((left, right) => left.duration - right.duration);
    const selected = sorted[VOUCHER_SERVICE_VARIANTS.indexOf(variant)];
    if (!selected) {
        throw new VoucherServiceSelectionError(`Voucher variant ${variant} has no matching price row; provide an explicit duration`);
    }
    return selected;
}

@Injectable()
export class ResolveVoucherServiceSelectionUsecase {
    constructor(
        private readonly findVoucherPriceInfoByType: FindVoucherPriceInfoByTypeUsecase,
    ) {}

    async execute(input: ResolveVoucherServiceSelectionInput): Promise<VoucherServiceSelection> {
        const parsedLabel = parseVoucherServiceLabel(input.type);
        if (!parsedLabel) {
            throw new VoucherServiceSelectionError("Voucher type is missing or unrecognized; provide a canonical voucher type");
        }

        const year = parseYear(input.startDate ?? input.serviceStartDate);
        const rows = await this.findVoucherPriceInfoByType.execute(parsedLabel.canonicalType, year);
        if (rows.length === 0) {
            throw new VoucherServiceSelectionError(`No voucher price row found for type ${parsedLabel.canonicalType} in service year ${year}; check the type and start date`);
        }

        const requestedDuration = parseSafeDuration(input.duration);
        if (input.duration !== null && input.duration !== undefined && requestedDuration === undefined) {
            throw new VoucherServiceSelectionError("Service duration must be a positive safe integer");
        }

        const selected = selectRow(rows, parsedLabel.variant, requestedDuration);
        const prices = rowPrices(selected.row);
        return {
            type: parsedLabel.canonicalType,
            duration: selected.duration,
            ...prices,
        };
    }
}
