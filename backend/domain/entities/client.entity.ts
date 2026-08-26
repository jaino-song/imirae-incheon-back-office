import { computeServiceStatus, ServiceStatusType } from "domain/value-objects/service-status.vo";

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
        return this.serviceStatus !== computed;
    }

    static create(
        props: CreateClientProps,
    ): ClientEntity {
        return new ClientEntity(
            0,
            props.name,
            props.address,
            props.phone,
            props.type,
            props.duration,
            props.fullPrice,
            props.grant,
            props.actualPrice,
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
        );
    }

    update(props: UpdateClientProps): void {
        // Optional means omitted/preserve; null is an explicit clear for a
        // nullable column. Checking against undefined keeps those states
        // distinct without spreading a partial patch over persisted values.
        if (props.name !== undefined) this.name = props.name;
        if (props.address !== undefined) this.address = props.address;
        if (props.phone !== undefined) this.phone = props.phone;
        if (props.type !== undefined) this.type = props.type;
        if (props.duration !== undefined) this.duration = props.duration;
        if (props.fullPrice !== undefined) this.fullPrice = props.fullPrice;
        if (props.grant !== undefined) this.grant = props.grant;
        if (props.actualPrice !== undefined) this.actualPrice = props.actualPrice;
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
    ): ClientEntity {
        return new ClientEntity(
            id,
            name,
            address,
            phone,
            type,
            duration,
            fullPrice,
            grant,
            actualPrice,
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
        );
    }
}
