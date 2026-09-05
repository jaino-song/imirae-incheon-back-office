import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import {
    CLIENT_RETENTION_BLOCKED,
    CLIENT_RETENTION_BLOCKED_MESSAGE,
    RetentionDeleteBlockedError,
    ScopedDeleteNotFoundError,
} from "domain/errors/retention-delete-blocked.error";

// Keep the legacy export names for callers that imported them directly while
// making the wire-level contract explicit and stable.
export const CLIENT_DELETE_CONFLICT_CODE = CLIENT_RETENTION_BLOCKED;
export const CLIENT_DELETE_CONFLICT_MESSAGE = CLIENT_RETENTION_BLOCKED_MESSAGE;

function isForeignKeyViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

@Injectable()
export class DeleteClientUsecase {
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    async execute(branchid: string, id: number): Promise<void> {
        const client = await this.clientRepository.findById(branchid, id);
        if (!client) {
            throw new NotFoundException(`고객을 찾을 수 없습니다. (id: ${id})`);
        }

        try {
            await this.clientRepository.delete(branchid, id);
        } catch (error) {
            if (error instanceof ScopedDeleteNotFoundError) {
                throw new NotFoundException(`고객을 찾을 수 없습니다. (id: ${id})`);
            }

            if (error instanceof RetentionDeleteBlockedError) {
                throw new ConflictException({
                    code: CLIENT_RETENTION_BLOCKED,
                    message: CLIENT_RETENTION_BLOCKED_MESSAGE,
                });
            }

            // Defense-in-depth for any relation not covered by the document-
            // preservation migration. The API route only exposes this coded,
            // allowlisted message and never forwards raw database details.
            if (isForeignKeyViolation(error)) {
                throw new ConflictException({
                    code: CLIENT_RETENTION_BLOCKED,
                    message: CLIENT_RETENTION_BLOCKED_MESSAGE,
                });
            }
            throw error;
        }
    }
}
