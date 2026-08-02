import { Inject, Injectable } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import {
    ClientWithInitialSchedule,
    CLIENT_REPOSITORY,
    IClientRepository,
    InitialClientSchedule,
} from "domain/repositories/client.repository.interface";

type CreateClientParams = {
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
    eDocId?: string | null;
    areaId?: string | null;
};

@Injectable()
export class CreateClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    execute(branchid: string, params: CreateClientParams): Promise<ClientEntity> {
        const client = ClientEntity.create({
            ...params,
            eDocId: params.eDocId ?? null,
        });
        return this.clientRepository.create(branchid, client);
    }

    executeWithInitialSchedule(
        branchid: string,
        params: CreateClientParams,
        schedule: InitialClientSchedule,
    ): Promise<ClientWithInitialSchedule> {
        const client = ClientEntity.create({
            ...params,
            eDocId: params.eDocId ?? null,
        });
        return this.clientRepository.createWithInitialSchedule(branchid, client, schedule);
    }
}
