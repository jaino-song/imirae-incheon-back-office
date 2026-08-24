import { MessageTemplateAutomationLockService } from "application/services/message-template-automation-lock.service";
import { SystemTemplateKey } from "domain/constants/system-template-registry";

type Deferred = {
    promise: Promise<void>;
    resolve: () => void;
};

const deferred = (): Deferred => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

describe("MessageTemplateAutomationLockService", () => {
    it("serializes a template edit and rule activation for the same template key", async () => {
        const lockTails = new Map<string, Promise<void>>();
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (
                work: (transaction: { $executeRaw: (query: unknown) => Promise<number> }) => Promise<unknown>,
            ) => {
                let releaseLock: (() => void) | undefined;
                const transaction = {
                    $executeRaw: jest.fn().mockImplementation(async (query: {
                        values?: unknown[];
                    }) => {
                        const key = String(query.values?.[0]);
                        const previous = lockTails.get(key) ?? Promise.resolve();
                        const next = deferred();
                        lockTails.set(key, previous.then(() => next.promise));
                        await previous;
                        releaseLock = next.resolve;
                        return 1;
                    }),
                };
                try {
                    return await work(transaction);
                } finally {
                    releaseLock?.();
                }
            }),
        };
        const service = new MessageTemplateAutomationLockService(prisma as never);
        const releaseTemplateEdit = deferred();
        const templateEditEntered = deferred();
        const order: string[] = [];

        const templateEdit = service.runExclusive(
            SystemTemplateKey.SERVICE_INFO,
            async () => {
                order.push("template-edit:start");
                templateEditEntered.resolve();
                await releaseTemplateEdit.promise;
                order.push("template-edit:end");
            },
        );
        await templateEditEntered.promise;

        const ruleActivation = service.runExclusive(
            SystemTemplateKey.SERVICE_INFO,
            async () => {
                order.push("rule-activation:start");
            },
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(order).toEqual(["template-edit:start"]);

        releaseTemplateEdit.resolve();
        await Promise.all([templateEdit, ruleActivation]);

        expect(order).toEqual([
            "template-edit:start",
            "template-edit:end",
            "rule-activation:start",
        ]);
        const firstTransaction = prisma.$transaction.mock.calls[0]?.[0];
        expect(firstTransaction).toEqual(expect.any(Function));
    });

    it("holds the advisory lock in a caller-owned transaction", async () => {
        const transaction = {
            $executeRaw: jest.fn().mockResolvedValue(1),
        };
        const prisma = { $transaction: jest.fn() };
        const service = new MessageTemplateAutomationLockService(prisma as never);
        const work = jest.fn().mockResolvedValue("created");

        await expect(service.runExclusive(
            SystemTemplateKey.GREETING,
            work,
            transaction as never,
        )).resolves.toBe("created");

        expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
        const query = transaction.$executeRaw.mock.calls[0]?.[0] as {
            strings?: readonly string[];
            values?: unknown[];
        };
        expect(query.strings?.join(" ")).toContain("pg_advisory_xact_lock");
        expect(query.values).toContain(
            "babyjamjam:message-template-automation:GREETING",
        );
        expect(work).toHaveBeenCalledWith(transaction);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
