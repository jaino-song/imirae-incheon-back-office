import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

@Injectable()
export class DeleteClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(id: number): Promise<void> {
        const client = await this.clientRepository.findById(id);
        if (!client) {
            throw new NotFoundException(`Client with id ${id} not found`);
        }

        await this.clientRepository.delete(id);
    }
}
