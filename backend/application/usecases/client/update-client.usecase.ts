import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

type UpdateClientParams = {
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
    startDate?: Date | null;
    endDate?: Date | null;
    careCenter?: boolean;
    voucherClient?: boolean;
};

@Injectable()
export class UpdateClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(id: number, updates: UpdateClientParams): Promise<ClientEntity> {
        const client = await this.clientRepository.findById(id);
        if (!client) {
            throw new NotFoundException(`Client with id ${id} not found`);
        }

        client.update(updates);
        return this.clientRepository.update(client);
    }
}
