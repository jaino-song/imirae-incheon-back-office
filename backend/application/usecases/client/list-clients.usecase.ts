import { Inject, Injectable } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

@Injectable()
export class ListClientsUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    execute(): Promise<ClientEntity[]> {
        return this.clientRepository.findAll();
    }
}
