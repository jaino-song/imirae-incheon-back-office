import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import type { Prisma } from "@prisma/client";

export type UpdateClientParams = {
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

export class ClientTargetVersionMismatchError extends Error {
    constructor() {
        super("Client changed after approval; review a new proposal");
        this.name = "ClientTargetVersionMismatchError";
    }
}

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
        assertNonNullableClientPatch(updates);
        const client = await this.clientRepository.findById(branchid, id);
        if (!client) {
            throw new NotFoundException(`Client with id ${id} not found`);
        }

        client.update(updates);
        return this.clientRepository.update(branchid, client);
    }

    /**
     * Approval-bound update. The repository acquires the client row lock,
     * compares the exact target hash and mutates before releasing the lock.
     * This method intentionally has no unlocked fallback.
     */
    async executeApprovedTarget(
        branchid: string,
        id: number,
        updates: UpdateClientParams,
        expectedTargetVersion: string,
        transaction?: Prisma.TransactionClient,
    ): Promise<ClientEntity> {
        assertNonNullableClientPatch(updates);
        const updated = await this.clientRepository.updateIfTargetVersion(
            branchid,
            id,
            expectedTargetVersion,
            updates,
            transaction,
        );
        if (updated) return updated;
        // A null result is intentionally treated as an approval conflict. The
        // repository performed the existence check and target comparison while
        // holding the row lock; do not add an unlocked read or update fallback.
        throw new ClientTargetVersionMismatchError();
    }
}

function assertNonNullableClientPatch(updates: UpdateClientParams): void {
    for (const field of ["name", "voucherClient", "breastPump"] as const) {
        if (Object.prototype.hasOwnProperty.call(updates, field) && updates[field] === null) {
            throw new BadRequestException(`${field} cannot be null`);
        }
    }
}
