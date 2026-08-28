import {
    computeServiceStatus,
    isAutomaticServiceStatusTransitionAllowed,
    ServiceStatusType,
} from "domain/value-objects/service-status.vo";
import { normalizePhone } from "domain/utils/normalize-phone";
import { normalizeKoreanWon } from "domain/value-objects/money.vo";
import { countBusinessDaysKr } from "domain/utils/business-days";

interface UpdateClientProps {
    name?: string;
    address?: string | null;
    phone?: string | null;
    type?: string | null;
    duration?: number | null;
    fullPrice?: string | null;
    grant?: string | null;
    actualPrice?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
    careCenter?: boolean | null;
    voucherClient?: boolean;
    birthday?: string | null;
    dueDate?: Date | null;
    birthDate?: Date | null;
    serviceStatus?: string | null;
    breastPump?: boolean;
    eDocId?: string | null;
    areaId?: string | null;
}

interface CreateClientProps {
    name: string;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: Date | null;
    endDate: Date | null;
    careCenter: boolean | null;
    voucherClient: boolean;
    birthday: string | null;
    dueDate: Date | null;
    birthDate: Date | null;
    serviceStatus: string | null;
    breastPump: boolean;
    eDocId: string | null;
    areaId?: string | null;
    createdAt?: Date | null;
    suppressGreetingSms?: boolean;
}

function deriveCreatedClientDuration(
    startDate: Date | null,
    endDate: Date | null,
    suppliedDuration: number | null | undefined,
): number | null {
    if (!startDate || !endDate) {
        // A pre-booking may carry an explicit policy duration before both
        // calendar endpoints are known. There is no date-derived value to
        // contradict it yet; once the range is completed, the branch below
        // derives and verifies the canonical count.
        return suppliedDuration ?? null;
    }

    if (
        Number.isNaN(startDate.getTime())
        || Number.isNaN(endDate.getTime())
        || startDate.getTime() > endDate.getTime()
    ) {
        throw new Error("서비스 시작일은 종료일보다 늦을 수 없습니다.");
    }

    const derivedDuration = countBusinessDaysKr(
        startDate.toISOString().slice(0, 10),
        endDate.toISOString().slice(0, 10),
    );
    if (derivedDuration === null) {
        throw new Error("서비스 기간을 계산할 수 없습니다.");
    }
    if (
        suppliedDuration !== undefined
        && (!Number.isSafeInteger(suppliedDuration) || suppliedDuration !== derivedDuration)
    ) {
        throw new Error(
            `duration must equal the Korean business-day count (${derivedDuration}) for the submitted service period`,
        );
    }
    return derivedDuration;
}

export class ClientEntity {
    constructor(
        public readonly id: number,
        public name: string,
        public address: string | null,
        public phone: string | null,
        public type: string | null,
        public duration: number | null,
        public fullPrice: string | null,
        public grant: string | null,
        public actualPrice: string | null,
        public startDate: Date | null,
        public endDate: Date | null,
        public careCenter: boolean | null,
        public voucherClient: boolean,
        public birthday: string | null,
        public serviceStatus: string | null,
        public breastPump: boolean,
        public eDocId: string | null,
        public dueDate: Date | null = null,
        public createdAt: Date | null = null,
        public areaId: string | null = null,
        // Owning tenant; populated by ClientMapper on reads so downstream
        // consumers (e.g. message log rows) can scope records to the branch.
        public branchId: string | null = null,
        public suppressGreetingSms: boolean = false,
        public birthDate: Date | null = null,
        /** Canonical identity key; display formatting remains in `phone`. */
        public phoneNormalized: string | null = normalizePhone(phone),
    ) {}

    isGoingToCareCenter(): boolean {
        return this.careCenter === true;
    }

    isVoucherClient(): boolean {
        return this.voucherClient;
    }

    /**
     * Compute the current service status based on dates
     * Returns the computed status without modifying the entity
     */
    computeCurrentStatus(): ServiceStatusType {
        return computeServiceStatus(this.serviceStatus, this.startDate, this.endDate);
    }

    /**
     * Check if the stored status differs from the computed status
     * If true, the status should be updated in the database
     */
    needsStatusUpdate(): boolean {
        const computed = this.computeCurrentStatus();
        return isAutomaticServiceStatusTransitionAllowed(this.serviceStatus, computed);
    }

    static create(
        props: CreateClientProps,
    ): ClientEntity {
        const duration = deriveCreatedClientDuration(
            props.startDate,
            props.endDate,
            props.duration,
        );
        return new ClientEntity(
            0,
            props.name,
            props.address,
            props.phone,
            props.type,
            duration,
            normalizeKoreanWon(props.fullPrice),
            normalizeKoreanWon(props.grant),
            normalizeKoreanWon(props.actualPrice),
            props.startDate,
            props.endDate,
            props.careCenter,
            props.voucherClient,
            props.birthday,
            props.serviceStatus,
            props.breastPump,
            props.eDocId,
            props.dueDate,
            props.createdAt ?? new Date(),
            props.areaId ?? null,
            null,
            props.suppressGreetingSms ?? false,
            props.birthDate,
            normalizePhone(props.phone),
        );
    }

    update(props: UpdateClientProps): void {
        // Optional means omitted/preserve; null is an explicit clear for a
        // nullable column. Checking against undefined keeps those states
        // distinct without spreading a partial patch over persisted values.
        const hasServiceDateUpdate = props.startDate !== undefined || props.endDate !== undefined;
        const nextStartDate = props.startDate === undefined ? this.startDate : props.startDate;
        const nextEndDate = props.endDate === undefined ? this.endDate : props.endDate;
        const hadIncompleteServicePeriod = !this.startDate || !this.endDate;
        let derivedDuration: number | null | undefined;

        // Validate and derive the complete service-period patch before
        // mutating any field. This keeps an invalid date/duration proposal from
        // partially changing the in-memory aggregate.
        if (nextStartDate && nextEndDate) {
            // Date-derived duration is the write authority for every mutation
            // while the period is complete, including unrelated profile
            // updates. A caller may repeat the canonical value but cannot
            // replace it (or clear it with null).
            derivedDuration = deriveCreatedClientDuration(nextStartDate, nextEndDate, props.duration);
            if (
                hasServiceDateUpdate
                && props.duration === undefined
                && hadIncompleteServicePeriod
                && this.duration !== null
                && this.duration !== derivedDuration
            ) {
                throw new Error(
                    `duration must equal the Korean business-day count (${derivedDuration}) for the submitted service period`,
                );
            }
        } else if (hasServiceDateUpdate) {
            // A complete date range is the only authoritative source for a
            // duration. Clearing either endpoint therefore clears any old
            // persisted duration instead of leaving a stale value behind.
            if (props.duration !== undefined && props.duration !== null) {
                throw new Error("duration requires a complete service period");
            }
            derivedDuration = null;
        }

        if (props.name !== undefined) this.name = props.name;
        if (props.address !== undefined) this.address = props.address;
        if (props.phone !== undefined) {
            this.phone = props.phone;
            this.phoneNormalized = normalizePhone(props.phone);
        }
        if (props.type !== undefined) this.type = props.type;
        if (nextStartDate && nextEndDate) {
            this.duration = derivedDuration!;
        } else if (hasServiceDateUpdate) {
            this.duration = null;
        } else if (props.duration !== undefined) {
            this.duration = props.duration;
        }
        if (props.fullPrice !== undefined) this.fullPrice = normalizeKoreanWon(props.fullPrice);
        if (props.grant !== undefined) this.grant = normalizeKoreanWon(props.grant);
        if (props.actualPrice !== undefined) this.actualPrice = normalizeKoreanWon(props.actualPrice);
        if (props.startDate !== undefined) this.startDate = props.startDate;
        if (props.endDate !== undefined) this.endDate = props.endDate;
        if (props.careCenter !== undefined) this.careCenter = props.careCenter;
        if (props.voucherClient !== undefined) this.voucherClient = props.voucherClient;
        if (props.birthday !== undefined) this.birthday = props.birthday;
        if (props.dueDate !== undefined) this.dueDate = props.dueDate;
        if (props.birthDate !== undefined) this.birthDate = props.birthDate;
        if (props.serviceStatus !== undefined) this.serviceStatus = props.serviceStatus;
        if (props.breastPump !== undefined) this.breastPump = props.breastPump;
        if (props.eDocId !== undefined) this.eDocId = props.eDocId;
        if (props.areaId !== undefined) this.areaId = props.areaId;
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        id: number,
        name: string,
        address: string | null,
        phone: string | null,
        type: string | null,
        duration: number | null,
        fullPrice: string | null,
        grant: string | null,
        actualPrice: string | null,
        startDate: Date | null,
        endDate: Date | null,
        careCenter: boolean | null,
        voucherClient: boolean,
        birthday: string | null,
        dueDate: Date | null,
        serviceStatus: string | null,
        breastPump: boolean,
        eDocId: string | null,
        createdAt: Date | null = null,
        areaId: string | null = null,
        branchId: string | null = null,
        suppressGreetingSms: boolean = false,
        birthDate: Date | null = null,
        phoneNormalized?: string | null,
    ): ClientEntity {
        return new ClientEntity(
            id,
            name,
            address,
            phone,
            type,
            duration,
            // Normalize legacy rows on read so a previously formatted value
            // remains usable while all subsequent writes use the canonical
            // ungrouped representation.
            normalizeKoreanWon(fullPrice),
            normalizeKoreanWon(grant),
            normalizeKoreanWon(actualPrice),
            startDate,
            endDate,
            careCenter,
            voucherClient,
            birthday,
            serviceStatus,
            breastPump,
            eDocId,
            dueDate,
            createdAt,
            areaId,
            branchId,
            suppressGreetingSms,
            birthDate,
            phoneNormalized,
        );
    }
}
