import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { PrismaService } from "infrastructure/database/prisma.service";

const MESSAGE_TEMPLATE_LOCK_NAMESPACE = "babyjamjam:message-template-automation";

/**
 * Serializes changes to a system template with activation of rules that use it.
 * The advisory lock is transaction-scoped, so the protected write must use the
 * transaction passed to the callback and commits before the lock is released.
 */
@Injectable()
export class MessageTemplateAutomationLockService {
    constructor(private readonly prisma: PrismaService) {}

    async runExclusive<T>(
        templateKey: SystemTemplateKey,
        work: (transaction: Prisma.TransactionClient) => Promise<T>,
        transaction?: Prisma.TransactionClient,
    ): Promise<T> {
        const runWithLock = async (lockTransaction: Prisma.TransactionClient): Promise<T> => {
            await lockTransaction.$executeRaw(Prisma.sql`
                SELECT pg_advisory_xact_lock(
                    hashtextextended(${`${MESSAGE_TEMPLATE_LOCK_NAMESPACE}:${templateKey}`}, 0)
                )
            `);
            return work(lockTransaction);
        };

        if (transaction) {
            return runWithLock(transaction);
        }

        return this.prisma.$transaction(runWithLock, {
            maxWait: 5_000,
            timeout: 15_000,
        });
    }
}
