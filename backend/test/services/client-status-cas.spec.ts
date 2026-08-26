import { ClientService } from "application/services/client.service";
import { ClientEntity } from "domain/entities/client.entity";

type AutomaticUpdateResult = "updated" | "stale";

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createClient(serviceStatus: string | null): ClientEntity {
    return new ClientEntity(
        1,
        "Client",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        new Date("2026-03-01T00:00:00.000Z"),
        new Date("2026-04-01T00:00:00.000Z"),
        false,
        true,
        null,
        serviceStatus,
        false,
        null,
    );
}

function createService(client: ClientEntity) {
    const prisma = {
        employee_schedule: { findMany: jest.fn().mockResolvedValue([]) },
        schedule_change_request: { findMany: jest.fn().mockResolvedValue([]) },
        eformsign_doc: { findMany: jest.fn().mockResolvedValue([]) },
        client: { update: jest.fn(), updateMany: jest.fn() },
    };
    const clientRepository = {
        updateServiceStatusIfCurrent: jest.fn<
            Promise<AutomaticUpdateResult>,
            [string, number, string | null, string]
        >().mockResolvedValue("updated"),
    };
    const listClientsUsecase = { execute: jest.fn().mockResolvedValue([client]) };
    const service = new ClientService(
        {} as never,
        {} as never,
        listClientsUsecase as never,
        {} as never,
        {} as never,
        {} as never,
        prisma as never,
        clientRepository as never,
        {} as never,
        {} as never,
        {} as never,
    );
    return { clientRepository, listClientsUsecase, prisma, service };
}

async function flushBackgroundWork(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("ClientService automatic service-status CAS", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-03-17T09:00:00.000Z"));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("sends the observed waiting status and computed active status to the repository boundary", async () => {
        const client = createClient("waiting");
        const { clientRepository, prisma, service } = createService(client);

        const result = await service.findAll("branch-1");
        await flushBackgroundWork();

        expect(result[0]?.serviceStatus).toBe("active");
        expect(clientRepository.updateServiceStatusIfCurrent).toHaveBeenCalledWith(
            "branch-1",
            1,
            "waiting",
            "active",
        );
        expect(prisma.client.update).not.toHaveBeenCalled();
    });

    it("does not let a late background write overwrite a manual terminal transition", async () => {
        const client = createClient("waiting");
        const { clientRepository, prisma, service } = createService(client);
        const deferred = createDeferred<AutomaticUpdateResult>();
        clientRepository.updateServiceStatusIfCurrent.mockReturnValueOnce(deferred.promise);

        await service.findAll("branch-1");
        client.serviceStatus = "terminated";
        deferred.resolve("stale");
        await flushBackgroundWork();

        expect(client.serviceStatus).toBe("terminated");
        expect(clientRepository.updateServiceStatusIfCurrent).toHaveBeenCalledTimes(1);
        expect(prisma.client.update).not.toHaveBeenCalled();
    });

    it.each(["completed", "terminated", "replacement_requested"])(
        "does not overwrite a manual %s transition after a background snapshot",
        async (manualStatus) => {
            const client = createClient("waiting");
            const { clientRepository, service } = createService(client);
            const deferred = createDeferred<AutomaticUpdateResult>();
            clientRepository.updateServiceStatusIfCurrent.mockReturnValueOnce(deferred.promise);

            await service.findAll("branch-1");
            client.serviceStatus = manualStatus;
            deferred.resolve("stale");
            await flushBackgroundWork();

            expect(client.serviceStatus).toBe(manualStatus);
        },
    );

    it("does not apply a stale second background generation after the first generation wins", async () => {
        const client = createClient("waiting");
        const { clientRepository, service } = createService(client);
        clientRepository.updateServiceStatusIfCurrent
            .mockResolvedValueOnce("updated")
            .mockResolvedValueOnce("stale");

        await service.findAll("branch-1");
        await flushBackgroundWork();
        client.serviceStatus = "active";
        client.endDate = new Date("2026-03-10T00:00:00.000Z");
        await service.findAll("branch-1");
        await flushBackgroundWork();

        expect(clientRepository.updateServiceStatusIfCurrent).toHaveBeenNthCalledWith(
            1,
            "branch-1",
            1,
            "waiting",
            "active",
        );
        expect(clientRepository.updateServiceStatusIfCurrent).toHaveBeenNthCalledWith(
            2,
            "branch-1",
            1,
            "active",
            "completed",
        );
    });

    it("leaves schedule, message-intent, service-record, outbox, and provider collaborators untouched on stale refusal", async () => {
        const client = createClient("waiting");
        const { clientRepository, prisma, service } = createService(client);
        clientRepository.updateServiceStatusIfCurrent.mockResolvedValue("stale");

        await service.findAll("branch-1");
        await flushBackgroundWork();

        expect(prisma.employee_schedule.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.schedule_change_request.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.eformsign_doc.findMany).toHaveBeenCalledTimes(1);
        expect(client.serviceStatus).toBe("waiting");
        expect(clientRepository.updateServiceStatusIfCurrent).toHaveBeenCalledTimes(1);
        expect(prisma.client.update).not.toHaveBeenCalled();
        expect(prisma.client.updateMany).not.toHaveBeenCalled();
    });
});
