import { ServiceRecordLinkReconciliationService } from "application/services/service-record-link-reconciliation.service";
import {
    SERVICE_RECORD_LINK_RESCHEDULED_REASON,
    SERVICE_RECORD_LINK_RULE_ID,
    SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
} from "domain/constants/service-record-link-message";
import { MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON } from "domain/constants/message-automation-policy";
import { PrismaService } from "infrastructure/database/prisma.service";
import { createSchedulerLeaseMock } from "../utils/mocks/scheduler-lease.mock";

describe("ServiceRecordLinkReconciliationService", () => {
    const createPrisma = () => ({
        branch: {
            findMany: jest.fn().mockResolvedValue([{ id: "branch-1" }]),
        },
        message_trigger_job: {
            findMany: jest.fn(),
        },
    });

    const createMarker = (scheduleId: number, phone: string) => ({
        id: `marker-${scheduleId}`,
        employeeSchedule: {
            id: scheduleId,
            primaryEmployee: { phone },
        },
    });

    const createLinkService = () => ({
        scheduleForServiceStart: jest.fn().mockResolvedValue(true),
    });

    it("repairs only durable retry markers and safe internal cancellations", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        prisma.message_trigger_job.findMany.mockResolvedValue([
            createMarker(10, "010-1111-2222"),
            createMarker(11, ""),
            createMarker(12, "02-1234-5678"),
            createMarker(13, "01099998888"),
        ]);
        const service = new ServiceRecordLinkReconciliationService(
            prisma as unknown as PrismaService,
            linkService as never,
            createSchedulerLeaseMock(),
        );

        await expect(
            service.reconcileMissingJobs(new Date("2026-08-20T02:00:00.000Z")),
        ).resolves.toBe(2);

        expect(prisma.branch.findMany).toHaveBeenCalledWith({
            where: { smsSenderApprovalStatus: "approved" },
            select: { id: true },
        });
        expect(prisma.message_trigger_job.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                branchId: { in: ["branch-1"] },
                ruleId: SERVICE_RECORD_LINK_RULE_ID,
                dedupeKey: { not: { contains: ":manual:" } },
                canceledByUser: false,
                OR: [
                    {
                        status: "failed",
                        cancelReason: SERVICE_RECORD_LINK_SCHEDULING_RETRY_REASON,
                        nextAttemptAt: { lte: new Date("2026-08-20T02:00:00.000Z") },
                    },
                    {
                        status: "canceled",
                        cancelReason: {
                            in: [
                                SERVICE_RECORD_LINK_RESCHEDULED_REASON,
                                MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON,
                            ],
                        },
                    },
                ],
                employeeSchedule: expect.objectContaining({
                    is: expect.objectContaining({
                        branchId: { in: ["branch-1"] },
                        replaced: false,
                        startDate: { gte: new Date("2026-08-20T00:00:00.000Z") },
                    }),
                }),
            }),
            orderBy: [
                { nextAttemptAt: "asc" },
                { updatedAt: "asc" },
                { id: "asc" },
            ],
            take: 100,
        }));
        expect(linkService.scheduleForServiceStart.mock.calls).toEqual([
            [10],
            [13],
        ]);
    });

    it("does not infer opt-in from a schedule that has no trigger job", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        prisma.message_trigger_job.findMany.mockResolvedValue([]);
        const service = new ServiceRecordLinkReconciliationService(
            prisma as unknown as PrismaService,
            linkService as never,
            createSchedulerLeaseMock(),
        );

        await expect(service.reconcileMissingJobs()).resolves.toBe(0);

        const where = prisma.message_trigger_job.findMany.mock.calls[0]?.[0].where;
        expect(where.employeeSchedule.is.messageTriggerJobs.none).toBeDefined();
        expect(linkService.scheduleForServiceStart).not.toHaveBeenCalled();
    });

    it("waits for sender approval before repairing an approval-canceled marker", async () => {
        const prisma = createPrisma();
        prisma.branch.findMany.mockResolvedValue([]);
        const linkService = createLinkService();
        const service = new ServiceRecordLinkReconciliationService(
            prisma as unknown as PrismaService,
            linkService as never,
            createSchedulerLeaseMock(),
        );

        await expect(service.reconcileMissingJobs()).resolves.toBe(0);

        expect(prisma.message_trigger_job.findMany).not.toHaveBeenCalled();
        expect(linkService.scheduleForServiceStart).not.toHaveBeenCalled();
    });

    it("continues with the remaining schedules when one repair attempt fails", async () => {
        const prisma = createPrisma();
        prisma.message_trigger_job.findMany.mockResolvedValue([
            createMarker(10, "01011112222"),
            createMarker(11, "01033334444"),
        ]);
        const linkService = {
            scheduleForServiceStart: jest.fn()
                .mockRejectedValueOnce(new Error("token unavailable"))
                .mockResolvedValueOnce(true),
        };
        const service = new ServiceRecordLinkReconciliationService(
            prisma as unknown as PrismaService,
            linkService as never,
            createSchedulerLeaseMock(),
        );

        await expect(
            service.reconcileMissingJobs(new Date("2026-08-20T02:00:00.000Z")),
        ).resolves.toBe(1);
        expect(linkService.scheduleForServiceStart.mock.calls).toEqual([
            [10],
            [11],
        ]);
    });

    it("paginates past 100 invalid phones so a later valid marker is not starved", async () => {
        const prisma = createPrisma();
        const firstPage = Array.from({ length: 100 }, (_, index) => createMarker(index + 1, "invalid"));
        prisma.message_trigger_job.findMany
            .mockResolvedValueOnce(firstPage)
            .mockResolvedValueOnce([createMarker(101, "010-9999-8888")]);
        const linkService = createLinkService();
        const service = new ServiceRecordLinkReconciliationService(
            prisma as unknown as PrismaService,
            linkService as never,
            createSchedulerLeaseMock(),
        );

        await expect(service.reconcileMissingJobs()).resolves.toBe(1);

        expect(prisma.message_trigger_job.findMany).toHaveBeenCalledTimes(2);
        expect(prisma.message_trigger_job.findMany.mock.calls[1]?.[0]).toEqual(
            expect.objectContaining({ cursor: { id: "marker-100" }, skip: 1 }),
        );
        expect(linkService.scheduleForServiceStart).toHaveBeenCalledWith(101);
    });

    it("attempts a later due marker after the first 100 valid markers back off", async () => {
        const prisma = createPrisma();
        const firstReferenceDate = new Date("2026-08-20T02:00:00.000Z");
        const markerState = Array.from({ length: 201 }, (_, index) => ({
            scheduleId: index + 1,
            nextAttemptAt: firstReferenceDate,
            updatedAt: new Date(firstReferenceDate.getTime() + index),
        }));
        const attemptedScheduleIds: number[] = [];
        let referenceDate = firstReferenceDate;

        prisma.message_trigger_job.findMany.mockImplementation(async (query) => {
            const dueAt = query.where.OR[0].nextAttemptAt.lte as Date;
            return markerState
                .filter((marker) => marker.nextAttemptAt.getTime() <= dueAt.getTime())
                .sort((left, right) => (
                    left.nextAttemptAt.getTime() - right.nextAttemptAt.getTime()
                    || left.updatedAt.getTime() - right.updatedAt.getTime()
                    || left.scheduleId - right.scheduleId
                ))
                .slice(0, 100)
                .map((marker) => createMarker(marker.scheduleId, "01011112222"));
        });
        const linkService = {
            scheduleForServiceStart: jest.fn().mockImplementation(async (scheduleId: number) => {
                attemptedScheduleIds.push(scheduleId);
                const marker = markerState.find((candidate) => candidate.scheduleId === scheduleId);
                if (marker) {
                    marker.nextAttemptAt = new Date(referenceDate.getTime() + 10 * 60 * 1000);
                    marker.updatedAt = new Date(referenceDate.getTime());
                }
                throw new Error("token unavailable");
            }),
        };
        const service = new ServiceRecordLinkReconciliationService(
            prisma as unknown as PrismaService,
            linkService as never,
            createSchedulerLeaseMock(),
        );

        for (const currentReferenceDate of [
            firstReferenceDate,
            new Date("2026-08-20T02:05:00.000Z"),
            new Date("2026-08-20T02:10:00.000Z"),
        ]) {
            referenceDate = currentReferenceDate;
            await expect(service.reconcileMissingJobs(currentReferenceDate)).resolves.toBe(0);
        }

        expect(attemptedScheduleIds.slice(0, 100)).toEqual(
            Array.from({ length: 100 }, (_, index) => index + 1),
        );
        expect(attemptedScheduleIds.slice(100, 200)).toEqual(
            Array.from({ length: 100 }, (_, index) => index + 101),
        );
        expect(attemptedScheduleIds[200]).toBe(201);
    });

    it("does not count a marker that another instance already claimed", async () => {
        const prisma = createPrisma();
        prisma.message_trigger_job.findMany.mockResolvedValue([
            createMarker(10, "01011112222"),
        ]);
        const linkService = {
            scheduleForServiceStart: jest.fn().mockResolvedValue(false),
        };
        const service = new ServiceRecordLinkReconciliationService(
            prisma as unknown as PrismaService,
            linkService as never,
            createSchedulerLeaseMock(),
        );

        await expect(service.reconcileMissingJobs()).resolves.toBe(0);
    });

    it("skips the run when the scheduler lease is not held", async () => {
        const prisma = createPrisma();
        const linkService = createLinkService();
        const service = new ServiceRecordLinkReconciliationService(
            prisma as unknown as PrismaService,
            linkService as never,
            createSchedulerLeaseMock(false),
        );

        await service.repairMissingJobs();

        expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });
});
