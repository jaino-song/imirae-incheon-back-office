import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

type UpdateClientParams = {
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
};

@Injectable()
export class UpdateClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(
        branchid: string,
        id: number,
        updates: UpdateClientParams
    ): Promise<ClientEntity> {
        const client = await this.clientRepository.findById(branchid, id);
        if (!client) {
            throw new NotFoundException(`Client with id ${id} not found`);
        }

        client.update(updates);
        return this.clientRepository.update(branchid, client);
    }
}
