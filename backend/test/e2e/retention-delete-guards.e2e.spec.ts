import { NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { DeleteClientUsecase } from "application/usecases/client/delete-client.usecase";
import { DeleteEmployeeScheduleUsecase } from "application/usecases/employee-schedule/delete-employee-schedule.usecase";
import {
    CLIENT_RETENTION_BLOCKED,
    SCHEDULE_RETENTION_BLOCKED,
    RetentionDeleteBlockedError,
    ScopedDeleteNotFoundError,
} from "domain/errors/retention-delete-blocked.error";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";

const describeE2E = process.env["E2E_RETENTION_DELETE_GUARDS"] === "1" ? describe : describe.skip;

const prisma = new PrismaClient();
const clientRepository = new SbClientRepository(prisma as never);
const scheduleRepository = new SbEmployeeScheduleRepository(prisma as never);
const deleteClient = new DeleteClientUsecase(clientRepository);
const deleteSchedule = new DeleteEmployeeScheduleUsecase(scheduleRepository);

type BranchFixture = { id: string; slug: string };

function utcDate(offsetDays = 0): Date {
    const value = new Date();
    value.setUTCHours(0, 0, 0, 0);
    value.setUTCDate(value.getUTCDate() + offsetDays);
    return value;
}

function isRetentionBlocked(error: unknown, code: string): boolean {
    return error instanceof RetentionDeleteBlockedError && error.code === code;
}

describeE2E("retention-sensitive destructive deletes (real PostgreSQL)", () => {
    let branch: BranchFixture;
    let employeeId: number;
    let sequence = 0;

    const unique = (prefix: string): string => `${prefix}-${process.pid}-${Date.now()}-${sequence++}`;

    const createClient = async (branchId = branch.id) => prisma.client.create({
        data: {
            name: unique("retention-client"),
            duration: 1,
            voucherClient: false,
            branchId,
        },
    });

    const createSchedule = async (
        clientId: number,
        startDate = utcDate(2),
        branchId = branch.id,
    ) => prisma.employee_schedule.create({
        data: {
            primaryEmployeeId: employeeId,
            clientId,
            branchId,
            workAddress: "retention E2E",
            startDate,
            endDate: utcDate(8),
        },
    });

    const createRule = async () => prisma.message_trigger_rule.create({
        data: {
            id: unique("retention-rule"),
            branchId: branch.id,
            name: "retention guard rule",
            eventType: "RETENTION_E2E",
            offsetType: "IMMEDIATE",
            offsetDays: 0,
            recipientType: "CLIENT",
            templateKey: "retention.e2e",
            isDefault: false,
            jobsStale: false,
        },
    });

    const createEformsignDoc = async (values: { clientId?: number; employeeScheduleId?: number } = {}) => {
        const now = new Date();
        return prisma.eformsign_doc.create({
            data: {
                documentId: unique("retention-document"),
                createdDate: now,
                updatedDate: now,
                statusType: "completed",
                statusDetail: "completed",
                stepType: "final",
                stepIndex: "1",
                stepName: "final",
                stepRecipientType: "client",
                stepRecipientName: "retention",
                stepRecipientSms: "01000000000",
                expiredDate: new Date(now.getTime() + 86_400_000),
                branchId: branch.id,
                ...values,
            },
        });
    };

    const createMessageTriggerJob = async (values: { clientId?: number; employeeScheduleId?: number } = {}) => {
        const rule = await createRule();
        return prisma.message_trigger_job.create({
            data: {
                branchId: branch.id,
                ruleId: rule.id,
                scheduledFor: new Date(),
                recipientType: "client",
                templateKey: "retention.e2e",
                dedupeKey: unique("retention-job"),
                ...values,
            },
        });
    };

    beforeAll(async () => {
        await prisma.$connect();
        const created = await prisma.branch.create({
            data: { name: "Retention delete E2E", slug: unique("retention-branch") },
            select: { id: true, slug: true },
        });
        branch = created;

        const maxEmployee = await prisma.employee.aggregate({ _max: { id: true } });
        employeeId = Math.min((maxEmployee._max.id ?? 0) + 101, 32700);
        await prisma.employee.create({
            data: {
                id: employeeId,
                name: "Retention employee",
                workArea: ["E2E"],
                phone: `010${String(Date.now()).slice(-8)}`,
                grade: "E2E",
                branchId: branch.id,
            },
        });
    });

    afterEach(async () => {
        // Remove child rows before their parent rows. Every query is branch
        // scoped, so this cleanup cannot touch another tenant in a reused DB.
        await prisma.message_log.deleteMany({ where: { branchId: branch.id } });
        await prisma.message_trigger_job.deleteMany({ where: { branchId: branch.id } });
        await prisma.message_trigger_rule.deleteMany({ where: { branchId: branch.id } });
        await prisma.schedule_change_request.deleteMany({ where: { branchId: branch.id } });
        await prisma.service_record_day.deleteMany({ where: { branchId: branch.id } });
        await prisma.service_record_token.deleteMany({ where: { branchId: branch.id } });
        await prisma.service_record_assignment.deleteMany({ where: { branchId: branch.id } });
        await prisma.service_record.deleteMany({ where: { branchId: branch.id } });
        await prisma.eformsign_doc.deleteMany({ where: { branchId: branch.id } });
        await prisma.eformsign_document_job.deleteMany({ where: { branchId: branch.id } });
        await prisma.client_draft.deleteMany({ where: { branchId: branch.id } });
        await prisma.call_record.deleteMany({ where: { branchId: branch.id } });
        await prisma.service_record_case.deleteMany({ where: { branchId: branch.id } });
        await prisma.employee_schedule.deleteMany({ where: { branchId: branch.id } });
        await prisma.client.deleteMany({ where: { branchId: branch.id } });
    });

    afterAll(async () => {
        await prisma.employee.deleteMany({ where: { branchId: branch.id } });
        await prisma.branch.delete({ where: { id: branch.id } });
        await prisma.$disconnect();
    });

    describe("client deletion", () => {
        it("deletes a dependency-free client", async () => {
            const client = await createClient();

            await deleteClient.execute(branch.id, client.id);

            await expect(prisma.client.findUnique({ where: { id: client.id } })).resolves.toBeNull();
        });

        it.each([
            ["schedule", async (clientId: number) => createSchedule(clientId)],
            ["service record case", async (clientId: number) => prisma.service_record_case.create({
                data: { branchId: branch.id, clientId },
            })],
            ["eformsign document", async (clientId: number) => createEformsignDoc({ clientId })],
            ["eformsign document job", async (clientId: number) => prisma.eformsign_document_job.create({
                data: {
                    branchId: branch.id,
                    clientId,
                    jobType: "create",
                    source: "retention-e2e",
                    requestKey: unique("retention-doc-job"),
                },
            })],
            ["call record", async (clientId: number) => prisma.call_record.create({
                data: {
                    branchId: branch.id,
                    driveFileId: unique("retention-call"),
                    fileName: "retention-call.wav",
                    transcript: {},
                    matchedClientId: clientId,
                },
            })],
            ["client draft", async (clientId: number) => {
                const call = await prisma.call_record.create({
                    data: {
                        branchId: branch.id,
                        driveFileId: unique("retention-draft-call"),
                        fileName: "retention-draft.wav",
                        transcript: {},
                    },
                });
                return prisma.client_draft.create({
                    data: {
                        callRecordId: call.id,
                        branchId: branch.id,
                        type: "retention",
                        proposals: {},
                        requestSummary: "retention",
                        clientId,
                    },
                });
            }],
            ["schedule change request", async (clientId: number) => {
                const schedule = await createSchedule(clientId);
                return prisma.schedule_change_request.create({
                    data: {
                        branchId: branch.id,
                        scheduleId: schedule.id,
                        clientId,
                        sessionIndex: 1,
                        fromDate: utcDate(1),
                        toDate: utcDate(2),
                        oldEndDate: utcDate(8),
                        newEndDate: utcDate(9),
                    },
                });
            }],
            ["message trigger job", async (clientId: number) => createMessageTriggerJob({ clientId })],
            ["message log", async (clientId: number) => prisma.message_log.create({
                data: {
                    branchId: branch.id,
                    provider: "e2e",
                    templateKey: "retention.e2e",
                    receiver: "01000000000",
                    messageBody: "retention",
                    clientId,
                },
            })],
        ])("returns CLIENT_RETENTION_BLOCKED for a retained %s", async (_label, createDependency) => {
            const client = await createClient();
            await createDependency(client.id);

            await expect(deleteClient.execute(branch.id, client.id)).rejects.toMatchObject({
                response: {
                    code: CLIENT_RETENTION_BLOCKED,
                },
                status: 409,
            });
            await expect(prisma.client.findUnique({ where: { id: client.id } })).resolves.not.toBeNull();
        });

        it("blocks a client whose canonical e_doc_id still points at a retained document", async () => {
            const document = await createEformsignDoc();
            const client = await prisma.client.create({
                data: {
                    name: unique("retention-edoc-client"),
                    duration: 1,
                    voucherClient: false,
                    branchId: branch.id,
                    eDocId: document.documentId,
                },
            });

            await expect(deleteClient.execute(branch.id, client.id)).rejects.toMatchObject({
                response: {
                    code: CLIENT_RETENTION_BLOCKED,
                },
                status: 409,
            });
            await expect(prisma.client.findUnique({ where: { id: client.id } })).resolves.not.toBeNull();
        });

        it("does not delete a client or mutate dependencies when the branch is wrong", async () => {
            const foreign = await prisma.branch.create({
                data: { name: "Foreign branch", slug: unique("foreign-branch") },
                select: { id: true },
            });
            const client = await createClient();

            await expect(deleteClient.execute(foreign.id, client.id)).rejects.toBeInstanceOf(NotFoundException);
            await expect(prisma.client.findUnique({ where: { id: client.id } })).resolves.not.toBeNull();
            await prisma.branch.delete({ where: { id: foreign.id } });
        });

        it("serializes a concurrent schedule insertion against client deletion", async () => {
            const client = await createClient();
            const scheduleInsert = prisma.employee_schedule.create({
                data: {
                    primaryEmployeeId: employeeId,
                    clientId: client.id,
                    branchId: branch.id,
                    workAddress: "race",
                    startDate: utcDate(2),
                    endDate: utcDate(8),
                },
            });
            const results = await Promise.allSettled([
                clientRepository.delete(branch.id, client.id),
                scheduleInsert,
            ]);
            const deleteResult = results[0];
            const insertResult = results[1];
            const remainingClient = await prisma.client.findUnique({ where: { id: client.id } });
            const schedules = await prisma.employee_schedule.findMany({ where: { clientId: client.id } });

            const deleteWon = deleteResult?.status === "fulfilled"
                && insertResult?.status === "rejected"
                && remainingClient === null
                && schedules.length === 0;
            const insertWon = insertResult?.status === "fulfilled"
                && deleteResult?.status === "rejected"
                && isRetentionBlocked(deleteResult.reason, CLIENT_RETENTION_BLOCKED)
                && remainingClient !== null
                && schedules.length === 1;
            expect(deleteWon || insertWon).toBe(true);
        });
    });

    describe("schedule deletion", () => {
        it("deletes only a future dependency-free schedule", async () => {
            const client = await createClient();
            const schedule = await createSchedule(client.id, utcDate(2));

            await deleteSchedule.execute(branch.id, schedule.id);

            await expect(prisma.employee_schedule.findUnique({ where: { id: schedule.id } })).resolves.toBeNull();
        });

        it.each([0, -1])("blocks a schedule that starts on date offset %i", async (offset) => {
            const client = await createClient();
            const schedule = await createSchedule(client.id, utcDate(offset));

            await expect(deleteSchedule.execute(branch.id, schedule.id)).rejects.toMatchObject({
                response: {
                    code: SCHEDULE_RETENTION_BLOCKED,
                },
                status: 409,
            });
            await expect(prisma.employee_schedule.findUnique({ where: { id: schedule.id } })).resolves.not.toBeNull();
        });

        it.each([
            ["service record", async (scheduleId: number) => prisma.service_record.create({
                data: { branchId: branch.id, scheduleId },
            })],
            ["service record day", async (scheduleId: number) => prisma.service_record_day.create({
                data: {
                    branchId: branch.id,
                    scheduleId,
                    sessionIndex: 1,
                    serviceDate: utcDate(1),
                    answers: {},
                },
            })],
            ["service record token", async (scheduleId: number) => prisma.service_record_token.create({
                data: {
                    branchId: branch.id,
                    scheduleId,
                    employeeId,
                    linkTokenHash: unique("retention-link"),
                    expectedPhoneHash: "expected",
                    expiresAt: new Date(Date.now() + 86_400_000),
                },
            })],
            ["service record assignment", async (scheduleId: number) => {
                const serviceCase = await prisma.service_record_case.create({
                    data: { branchId: branch.id },
                });
                return prisma.service_record_assignment.create({
                    data: {
                        branchId: branch.id,
                        serviceRecordCaseId: serviceCase.id,
                        scheduleId,
                        employeeNameSnapshot: "retention",
                        startDate: utcDate(1),
                        endDate: utcDate(8),
                    },
                });
            }],
            ["schedule change request", async (scheduleId: number) => {
                const schedule = await prisma.employee_schedule.findUniqueOrThrow({ where: { id: scheduleId } });
                return prisma.schedule_change_request.create({
                    data: {
                        branchId: branch.id,
                        scheduleId,
                        clientId: schedule.clientId,
                        sessionIndex: 1,
                        fromDate: utcDate(1),
                        toDate: utcDate(2),
                        oldEndDate: utcDate(8),
                        newEndDate: utcDate(9),
                    },
                });
            }],
            ["eformsign document", async (scheduleId: number) => createEformsignDoc({ employeeScheduleId: scheduleId })],
            ["message trigger job", async (scheduleId: number) => createMessageTriggerJob({ employeeScheduleId: scheduleId })],
        ])("returns SCHEDULE_RETENTION_BLOCKED for a retained %s", async (_label, createDependency) => {
            const client = await createClient();
            const schedule = await createSchedule(client.id, utcDate(2));
            await createDependency(schedule.id);

            await expect(deleteSchedule.execute(branch.id, schedule.id)).rejects.toMatchObject({
                response: {
                    code: SCHEDULE_RETENTION_BLOCKED,
                },
                status: 409,
            });
            await expect(prisma.employee_schedule.findUnique({ where: { id: schedule.id } })).resolves.not.toBeNull();
        });

        it("does not delete a schedule when the branch is wrong", async () => {
            const client = await createClient();
            const schedule = await createSchedule(client.id);
            const foreign = await prisma.branch.create({
                data: { name: "Foreign schedule branch", slug: unique("foreign-schedule-branch") },
                select: { id: true },
            });

            await expect(deleteSchedule.execute(foreign.id, schedule.id)).rejects.toBeInstanceOf(NotFoundException);
            await expect(prisma.employee_schedule.findUnique({ where: { id: schedule.id } })).resolves.not.toBeNull();
            await prisma.branch.delete({ where: { id: foreign.id } });
        });

        it("serializes a concurrent dependency insertion against schedule deletion", async () => {
            const client = await createClient();
            const schedule = await createSchedule(client.id, utcDate(2));
            const dependencyInsert = prisma.service_record_day.create({
                data: {
                    branchId: branch.id,
                    scheduleId: schedule.id,
                    sessionIndex: 1,
                    serviceDate: utcDate(1),
                    answers: {},
                },
            });
            const results = await Promise.allSettled([
                scheduleRepository.delete(branch.id, schedule.id),
                dependencyInsert,
            ]);
            const deleteResult = results[0];
            const insertResult = results[1];
            const remainingSchedule = await prisma.employee_schedule.findUnique({ where: { id: schedule.id } });
            const days = await prisma.service_record_day.findMany({ where: { scheduleId: schedule.id } });

            const deleteWon = deleteResult?.status === "fulfilled"
                && insertResult?.status === "rejected"
                && remainingSchedule === null
                && days.length === 0;
            const insertWon = insertResult?.status === "fulfilled"
                && deleteResult?.status === "rejected"
                && isRetentionBlocked(deleteResult.reason, SCHEDULE_RETENTION_BLOCKED)
                && remainingSchedule !== null
                && days.length === 1;
            expect(deleteWon || insertWon).toBe(true);
        });
    });

    it("maps a branch-scoped missing client from the repository to 404", async () => {
        await expect(deleteClient.execute(branch.id, 999_999_999)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("keeps repository errors coded even when the domain use case is bypassed", async () => {
        const client = await createClient();
        await createSchedule(client.id);

        await expect(clientRepository.delete(branch.id, client.id)).rejects.toMatchObject({
            code: CLIENT_RETENTION_BLOCKED,
        });
        await expect(scheduleRepository.delete(branch.id, 999_999_999)).rejects.toBeInstanceOf(ScopedDeleteNotFoundError);
    });
});
