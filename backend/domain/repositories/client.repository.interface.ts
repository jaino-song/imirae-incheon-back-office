import { ClientEntity } from "domain/entities/client.entity";

export interface IClientRepository {
    findById(id: number): Promise<ClientEntity | null>;
    findAll(): Promise<ClientEntity[]>;
    create(client: ClientEntity): Promise<ClientEntity>;
    update(client: ClientEntity): Promise<ClientEntity>;
    delete(id: number): Promise<void>;
}

export const CLIENT_REPOSITORY = "CLIENT_REPOSITORY";
