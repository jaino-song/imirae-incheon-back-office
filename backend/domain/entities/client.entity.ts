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
    birthDate?: Date | null;
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
        public birthDate: Date | null = null,
        public createdAt: Date | null = null,
        public areaId: string | null = null,
        // Owning tenant; populated by ClientMapper on reads so downstream
        // consumers (e.g. message log rows) can scope records to the branch.
        public branchId: string | null = null,
        public suppressGreetingSms: boolean = false,
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
            props.birthDate ?? null,
            props.createdAt ?? new Date(),
            props.areaId ?? null,
            null,
            props.suppressGreetingSms ?? false,
        );
    }

    update(props: UpdateClientProps): void {
        this.name = props.name ?? this.name;
        this.address = props.address ?? this.address;
        this.phone = props.phone ?? this.phone;
        this.type = props.type ?? this.type;
        this.duration = props.duration ?? this.duration;
        this.fullPrice = props.fullPrice ?? this.fullPrice;
        this.grant = props.grant ?? this.grant;
        this.actualPrice = props.actualPrice ?? this.actualPrice;
        this.startDate = props.startDate ?? this.startDate;
        this.endDate = props.endDate ?? this.endDate;
        this.careCenter = props.careCenter ?? this.careCenter;
        this.voucherClient = props.voucherClient ?? this.voucherClient;
        this.birthday = props.birthday ?? this.birthday;
        this.dueDate = props.dueDate ?? this.dueDate;
        this.birthDate = props.birthDate ?? this.birthDate;
        this.serviceStatus = props.serviceStatus ?? this.serviceStatus;
        this.breastPump = props.breastPump ?? this.breastPump;
        this.eDocId = props.eDocId ?? this.eDocId;
        if ("areaId" in props) this.areaId = props.areaId ?? null;
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
            birthDate,
            createdAt,
            areaId,
            branchId,
            suppressGreetingSms,
        );
    }
}
