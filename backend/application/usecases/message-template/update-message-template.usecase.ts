import { Inject, Injectable, BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { MessageTemplateEntity, TemplateVariable } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository, MESSAGE_TEMPLATE_REPOSITORY } from "domain/repositories/message-template.repository.interface";

export type UpdateMessageTemplateParams = {
    name?: string;
    content?: string;
    variables?: TemplateVariable[];
};

@Injectable()
export class UpdateMessageTemplateUsecase {
    constructor(
        @Inject(MESSAGE_TEMPLATE_REPOSITORY)
        private readonly messageTemplateRepository: IMessageTemplateRepository,
    ) {}

    async execute(
        branchid: string,
        id: string,
        params: UpdateMessageTemplateParams
    ): Promise<MessageTemplateEntity> {
        const existing = await this.messageTemplateRepository.findById(branchid, id);
        if (!existing) {
            throw new NotFoundException(`Template with id ${id} not found`);
        }

        existing.update(params);

        const validation = existing.validateVariables();
        if (!validation.valid) {
            throw new BadRequestException(validation.errors.join(", "));
        }

        return this.messageTemplateRepository.update(branchid, existing);
    }

    /**
     * Apply an approved update without a second read. The inspected snapshot
     * is reconstructed locally and the repository performs the branch-scoped
     * updatedAt CAS at the mutation linearization point.
     */
    async executeApproved(
        branchid: string,
        id: string,
        params: UpdateMessageTemplateParams,
        expectedUpdatedAt: Date,
        targetSnapshot: Record<string, unknown> | undefined,
    ): Promise<MessageTemplateEntity> {
        const snapshotId = targetSnapshot?.["id"];
        const name = targetSnapshot?.["name"];
        const content = targetSnapshot?.["content"];
        const variables = targetSnapshot?.["variables"];
        const createdAtValue = targetSnapshot?.["createdAt"];
        const updatedAtValue = targetSnapshot?.["updatedAt"];
        if (
            snapshotId !== id
            || typeof name !== "string"
            || typeof content !== "string"
            || !Array.isArray(variables)
            || typeof createdAtValue !== "string"
            || typeof updatedAtValue !== "string"
            || Number.isNaN(new Date(createdAtValue).getTime())
            || Number.isNaN(new Date(updatedAtValue).getTime())
            || new Date(updatedAtValue).getTime() !== expectedUpdatedAt.getTime()
        ) {
            throw new ConflictException("Message template approval snapshot is missing or stale");
        }

        const existing = MessageTemplateEntity.reconstitute(
            id,
            name,
            content,
            variables as TemplateVariable[],
            new Date(createdAtValue),
            new Date(updatedAtValue),
        );
        existing.update(params);

        const validation = existing.validateVariables();
        if (!validation.valid) {
            throw new BadRequestException(validation.errors.join(", "));
        }

        const updated = await this.messageTemplateRepository.updateIfVersionMatches(
            branchid,
            id,
            expectedUpdatedAt,
            existing,
        );
        if (!updated) {
            throw new ConflictException("Message template changed after approval");
        }
        return updated;
    }
}
