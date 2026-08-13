import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import { MessageTemplateEntity, TemplateVariable } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository, MESSAGE_TEMPLATE_REPOSITORY } from "domain/repositories/message-template.repository.interface";
import type { Prisma } from "@prisma/client";

export type CreateMessageTemplateParams = {
    name: string;
    content: string;
    variables: TemplateVariable[];
};

@Injectable()
export class CreateMessageTemplateUsecase {
    constructor(
        @Inject(MESSAGE_TEMPLATE_REPOSITORY)
        private readonly messageTemplateRepository: IMessageTemplateRepository,
    ) {}

    async execute(
        branchid: string,
        params: CreateMessageTemplateParams,
        transaction?: Prisma.TransactionClient,
    ): Promise<MessageTemplateEntity> {
        const template = MessageTemplateEntity.create(params);

        const validation = template.validateVariables();
        if (!validation.valid) {
            throw new BadRequestException(validation.errors.join(", "));
        }

        return this.messageTemplateRepository.create(branchid, template, transaction);
    }
}
