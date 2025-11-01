import { Injectable } from "@nestjs/common";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsUsecase,
    UpdateClientUsecase,
} from "application/usecases/client";
import { ClientEntity } from "domain/entities/client.entity";

@Injectable()
export class ClientService {
    constructor(
        private readonly createClientUsecase: CreateClientUsecase,
        private readonly findClientByIdUsecase: FindClientByIdUsecase,
        private readonly listClientsUsecase: ListClientsUsecase,
        private readonly updateClientUsecase: UpdateClientUsecase,
        private readonly deleteClientUsecase: DeleteClientUsecase,
    ) {}

    create(params: {
        name: string;
        primaryEmployeeId: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter: boolean;
        voucherClient: boolean;
    }): Promise<ClientEntity> {
        return this.createClientUsecase.execute({
            name: params.name,
            primaryEmployeeId: params.primaryEmployeeId,
            secondaryEmployeeId: params.secondaryEmployeeId ?? null,
            address: params.address ?? null,
            phone: params.phone ?? null,
            type: params.type ?? null,
            duration: params.duration ?? null,
            fullPrice: params.fullPrice ?? null,
            grant: params.grant ?? null,
            actualPrice: params.actualPrice ?? null,
            startDate: params.startDate ? new Date(params.startDate) : null,
            endDate: params.endDate ? new Date(params.endDate) : null,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
        });
    }

    findAll(): Promise<ClientEntity[]> {
        return this.listClientsUsecase.execute();
    }

    findById(id: number): Promise<ClientEntity | null> {
        return this.findClientByIdUsecase.execute(id);
    }

    update(id: number, params: {
        name?: string;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter?: boolean;
        voucherClient?: boolean;
    }): Promise<ClientEntity> {
        return this.updateClientUsecase.execute(id, {
            name: params.name,
            primaryEmployeeId: params.primaryEmployeeId,
            secondaryEmployeeId: params.secondaryEmployeeId,
            address: params.address,
            phone: params.phone,
            type: params.type,
            duration: params.duration,
            fullPrice: params.fullPrice,
            grant: params.grant,
            actualPrice: params.actualPrice,
            startDate: params.startDate === undefined ? undefined : params.startDate ? new Date(params.startDate) : null,
            endDate: params.endDate === undefined ? undefined : params.endDate ? new Date(params.endDate) : null,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
        });
    }

    delete(id: number): Promise<void> {
        return this.deleteClientUsecase.execute(id);
    }
}
