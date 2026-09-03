import { BadRequestException, ConflictException } from "@nestjs/common";
import { validate } from "class-validator";

import { EMPLOYEE_SCHEDULE_OVERLAP_CODE } from "application/policies/employee-schedule-invariants.policy";
import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "application/services/service-record-lifecycle.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { addBusinessDaysKr } from "domain/utils/business-days";
import { PrismaService } from "infrastructure/database/prisma.service";
import { UpsertSessionDto } from "interface/dto/service-record-entry.dto";

const CASE_ID = "case-1";
const BRANCH_ID = "11111111-1111-1111-1111-111111111111";
const SERVICE_DATE = new Date("2026-07-01T00:00:00.000Z");
const SIGNATURE = "data:image/png;base64,aGVsbG8=";

const context = {
    tokenId: "token-1",
    branchId: BRANCH_ID,
    scheduleId: 10,
    employeeId: 20,
    serviceRecordCaseId: CASE_ID,
};

function createRecord(overrides: Record<string, unknown> = {}) {
    return {
        id: CASE_ID,
        branchId: BRANCH_ID,
        status: SERVICE_RECORD_CASE_STATUS.IN_PROGRESS,
        requiredSessionCount: 5,
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        endDate: new Date("2026-07-31T00:00:00.000Z"),
        formVersion: 1,
        momName: "김산모",
        momBirth: "900101",
        babyName: "아기",
        babyBirth: "260701",
        deliveryType: "자연분만",
        babyWeight: "3.2",
        createdAt: new Date("2026-06-01T00:00:00.000Z"),
        updatedAt: new Date("2026-06-01T00:00:00.000Z"),
        ...overrides,
    };
}

function createDay(overrides: Record<string, unknown> = {}) {
    return {
        id: "day-1",
        branchId: BRANCH_ID,
        scheduleId: 10,
        serviceRecordCaseId: CASE_ID,
        caseSessionIndex: 1,
        sessionIndex: 1,
        employeeId: 20,
        employeeNameSnapshot: "제공자",
        formVersion: 1,
        serviceDate: SERVICE_DATE,
        answers: {},
        etcService: null,
        notes: null,
        paymentConfirmed: true,
        momApproval: "approved",
        locked: true,
        submittedAt: new Date("2026-07-01T01:00:00.000Z"),
        clientSignature: SIGNATURE,
        clientSignedAt: new Date("2026-07-01T01:00:00.000Z"),
        ...overrides,
    };
}

function createDto(overrides: Partial<UpsertSessionDto> = {}): UpsertSessionDto {
    return {
        serviceDate: SERVICE_DATE.toISOString(),
        answers: {},
        paymentConfirmed: true,
        momApproval: "approved",
        clientSignature: SIGNATURE,
        ...overrides,
    };
}

function createHarness(options: {
    existing?: ReturnType<typeof createDay> | null;
    transactionRecord?: ReturnType<typeof createRecord>;
    updateSignature?: (args: Record<string, unknown>) => Promise<{ count: number }>;
    schedule?: Record<string, unknown>;
    employeeScheduleFindFirst?: jest.Mock;
    ensureForClient?: jest.Mock;
    extendExpiryForCase?: jest.Mock;
} = {}) {
    const aggregate = createRecord();
    const existing = options.existing === undefined ? null : options.existing;
    const transactionRecord = options.transactionRecord ?? aggregate;
    const upsert = jest.fn().mockImplementation(({ create, update }) => Promise.resolve({
        ...(existing ?? createDay({ locked: false, submittedAt: null, clientSignature: null, clientSignedAt: null })),
        ...(existing ? update : create),
    }));
    const updateMany = jest.fn(options.updateSignature ?? (() => Promise.resolve({
        count: existing?.clientSignature ? 0 : 1,
    })));
    const schedule = options.schedule ?? { primaryEmployee: { name: "제공자" } };
    const scheduleUpdate = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...schedule, ...data }));
    // Track the extension's end-date write separately from the object
    // `service_record_case.findUnique` returns, and only surface it to a
    // *subsequent* findUnique call after `ensureForClient` has run (the
    // point at which upsertSession performs its post-extension re-read).
    // A prior version of this harness mutated `transactionRecord` in place
    // and had every findUnique call resolve that same shared object, so the
    // extended end date was visible even if the re-read line were deleted
    // entirely -- the mutation checks below exist to guard against that.
    let pendingEndDate: Date | undefined;
    let visibleEndDate = transactionRecord.endDate as Date | undefined;
    const clientUpdate = jest.fn().mockImplementation(({ data }: { data: { endDate?: Date } }) => {
        if (data.endDate !== undefined) pendingEndDate = data.endDate;
        return Promise.resolve({});
    });
    const caseFindUnique = jest.fn().mockImplementation(() =>
        Promise.resolve({ ...transactionRecord, endDate: visibleEndDate }));
    const ensureForClientInner = options.ensureForClient ?? jest.fn().mockResolvedValue(null);
    const ensureForClient = jest.fn(async (...args: unknown[]) => {
        if (pendingEndDate !== undefined) visibleEndDate = pendingEndDate;
        return ensureForClientInner(...(args as [number, unknown]));
    });
    const transactionClient = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: CASE_ID }]),
        service_record_case: {
            findUnique: caseFindUnique,
        },
        employee_schedule: {
            findUnique: jest.fn().mockResolvedValue(schedule),
            update: scheduleUpdate,
            ...(options.employeeScheduleFindFirst ? { findFirst: options.employeeScheduleFindFirst } : {}),
        },
        client: {
            update: clientUpdate,
        },
        service_record_day: {
            findUnique: jest.fn().mockResolvedValue(existing),
            upsert,
            updateMany,
        },
    };
    const prisma = {
        service_record_case: {
            findFirst: jest.fn().mockResolvedValue(aggregate),
        },
        $transaction: jest.fn((callback: (tx: typeof transactionClient) => Promise<unknown>) =>
            callback(transactionClient)),
    };
    const lifecycle = {
        recompute: jest.fn().mockResolvedValue(transactionRecord),
        ensureForClient,
    };
    const tokenService = {
        extendExpiryForCase: options.extendExpiryForCase ?? jest.fn().mockResolvedValue(undefined),
    };
    const service = new ServiceRecordEntryService(
        prisma as unknown as PrismaService,
        tokenService as unknown as ServiceRecordTokenService,
        lifecycle as unknown as ServiceRecordLifecycleService,
    );

    return {
        service,
        prisma,
        transactionClient,
        upsert,
        updateMany,
        lifecycle,
        tokenService,
        scheduleUpdate,
        clientUpdate,
    };
}

function createConcurrentHarness() {
    type SessionWrite = Partial<ReturnType<typeof createDay>> & { locked: boolean };

    let persistedDay: ReturnType<typeof createDay> | null = null;
    let dayReadCount = 0;
    let caseLockObserved = false;
    let caseLockHeld = false;
    const lockQueries: unknown[] = [];
    const caseLockWaiters: Array<() => void> = [];
    let releaseSecondDayRead: (() => void) | undefined;
    const secondDayRead = new Promise<void>((resolve) => {
        releaseSecondDayRead = resolve;
    });
    let releaseSubmitWrite: (() => void) | undefined;
    const submitWrite = new Promise<void>((resolve) => {
        releaseSubmitWrite = resolve;
    });

    const acquireCaseLock = async () => {
        if (caseLockHeld) {
            await new Promise<void>((resolve) => caseLockWaiters.push(resolve));
        }
        caseLockHeld = true;
    };
    const releaseCaseLock = () => {
        const next = caseLockWaiters.shift();
        if (next) {
            next();
            return;
        }
        caseLockHeld = false;
    };

    const caseModel = {
        findUnique: jest.fn().mockResolvedValue(createRecord()),
    };
    const scheduleModel = {
        findUnique: jest.fn().mockResolvedValue({ primaryEmployee: { name: "제공자" } }),
    };
    const dayModel = {
        findUnique: jest.fn(async () => {
            dayReadCount += 1;
            if (dayReadCount === 2) releaseSecondDayRead?.();
            return persistedDay ? { ...persistedDay } : null;
        }),
        upsert: jest.fn(async ({ create, update }: { create: SessionWrite; update: SessionWrite }) => {
            const data = persistedDay ? update : create;
            if (data.locked && !caseLockObserved) {
                await secondDayRead;
            }
            if (data.locked) {
                persistedDay = { ...(persistedDay ?? createDay({ locked: false, clientSignature: null, clientSignedAt: null })), ...data };
                releaseSubmitWrite?.();
            } else {
                await submitWrite;
                persistedDay = { ...(persistedDay ?? createDay({ locked: false, clientSignature: null, clientSignedAt: null })), ...data };
            }
            return persistedDay;
        }),
        updateMany: jest.fn(async ({ data }: { data: Partial<ReturnType<typeof createDay>> }) => {
            if (!persistedDay || persistedDay.clientSignature) return { count: 0 };
            persistedDay = { ...persistedDay, ...data };
            return { count: 1 };
        }),
    };
    const lifecycle = { recompute: jest.fn().mockResolvedValue(createRecord()) };
    const prisma = {
        service_record_case: {
            findFirst: jest.fn().mockResolvedValue(createRecord()),
        },
        $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
            let acquired = false;
            const tx = {
                $queryRaw: jest.fn(async (query: unknown) => {
                    lockQueries.push(query);
                    caseLockObserved = true;
                    await acquireCaseLock();
                    acquired = true;
                    return [{ id: CASE_ID }];
                }),
                service_record_case: caseModel,
                employee_schedule: scheduleModel,
                service_record_day: dayModel,
            };
            try {
                return await callback(tx);
            } finally {
                if (acquired) releaseCaseLock();
            }
        }),
    };
    const service = new ServiceRecordEntryService(
        prisma as unknown as PrismaService,
        {} as ServiceRecordTokenService,
        lifecycle as unknown as ServiceRecordLifecycleService,
    );

    return { service, prisma, dayModel, lockQueries, getPersistedDay: () => persistedDay };
}

function exceptionCode(error: unknown): unknown {
    if (error instanceof BadRequestException || error instanceof ConflictException) {
        return error.getResponse();
    }
    return null;
}

async function expectException(
    promise: Promise<unknown>,
    exceptionType: typeof BadRequestException | typeof ConflictException,
    code: string,
): Promise<void> {
    try {
        await promise;
        throw new Error(`Expected ${exceptionType.name}`);
    } catch (error) {
        expect(error).toBeInstanceOf(exceptionType);
        expect(exceptionCode(error)).toEqual({ code });
    }
}

describe("ServiceRecordEntryService.upsertSession", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("allows an unlocked session to be edited and submitted", async () => {
        const existing = createDay({ locked: false, clientSignature: null, clientSignedAt: null });
        const { service, upsert } = createHarness({ existing });

        await expect(service.upsertSession(context, 1, createDto({ notes: "수정" }), true)).resolves.toEqual(
            expect.objectContaining({ notes: "수정", locked: true }),
        );
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ notes: "수정", locked: true }),
        }));
    });

    it.each([
        ["draft save", false, SERVICE_RECORD_CASE_STATUS.IN_PROGRESS],
        ["submit", true, SERVICE_RECORD_CASE_STATUS.IN_PROGRESS],
        ["draft save", false, SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE],
        ["submit", true, SERVICE_RECORD_CASE_STATUS.READY_TO_FINALIZE],
    ])("rejects a locked session during %s while the case is %s", async (_operation, lock, status) => {
        const existing = createDay();
        const { service, prisma, upsert, updateMany, lifecycle } = createHarness({
            existing,
            transactionRecord: createRecord({ status }),
        });

        await expectException(
            service.upsertSession(context, 1, createDto({ notes: "변조" }), lock),
            ConflictException,
            "SERVICE_RECORD_SESSION_LOCKED",
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(upsert).not.toHaveBeenCalled();
        expect(updateMany).not.toHaveBeenCalled();
        expect(lifecycle.recompute).not.toHaveBeenCalled();
    });

    it("accepts 기타서비스 40자와 특이사항 80자를 정확히 입력할 수 있다", async () => {
        const { service, upsert } = createHarness();
        const etcService = "기".repeat(40);
        const notes = "특".repeat(80);

        await service.upsertSession(context, 1, createDto({ etcService, notes }), true);

        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ etcService, notes }),
        }));
    });

    it.each([
        ["기타서비스", { etcService: ` ${"기".repeat(40)}` }, 40],
        ["특이사항", { notes: ` ${"특".repeat(80)}` }, 80],
    ])("%s 길이 계산에 앞 공백을 포함한다", async (_label, fields, maxLength) => {
        const { service, upsert } = createHarness();

        await expect(service.upsertSession(
            context,
            1,
            createDto(fields),
            true,
        )).rejects.toThrow(`입력값은 ${maxLength}자를 넘을 수 없습니다.`);
        expect(upsert).not.toHaveBeenCalled();
    });

    it.each([
        SERVICE_RECORD_CASE_STATUS.FINALIZING,
        SERVICE_RECORD_CASE_STATUS.FINALIZATION_FAILED,
        SERVICE_RECORD_CASE_STATUS.DOCUMENTS_CREATED,
        SERVICE_RECORD_CASE_STATUS.COMPLETED,
    ])("rejects %s after rechecking status inside the transaction", async (status) => {
        const { service, prisma, upsert } = createHarness({
            transactionRecord: createRecord({ status }),
        });

        await expectException(
            service.upsertSession(context, 1, createDto(), true),
            ConflictException,
            "SERVICE_RECORD_FINALIZED",
        );
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(upsert).not.toHaveBeenCalled();
    });

    it("requires a signature for the first submission of a never-locked session", async () => {
        const { service, upsert } = createHarness({ existing: null });

        await expectException(service.upsertSession(
            context,
            1,
            createDto({ clientSignature: undefined }),
            true,
        ), BadRequestException, "CLIENT_SIGNATURE_REQUIRED");
        expect(upsert).not.toHaveBeenCalled();
    });

    it("silently preserves an existing signature and signed timestamp", async () => {
        const signedAt = new Date("2026-07-01T01:00:00.000Z");
        const existing = createDay({ locked: false, clientSignature: SIGNATURE, clientSignedAt: signedAt });
        const { service, upsert, updateMany } = createHarness({
            existing,
            updateSignature: async () => ({ count: 0 }),
        });

        await service.upsertSession(context, 1, createDto({
            clientSignature: "data:image/png;base64,d29ybGQ=",
        }), true);

        const updateData = upsert.mock.calls[0][0].update;
        expect(updateData).not.toHaveProperty("clientSignature");
        expect(updateData).not.toHaveProperty("clientSignedAt");
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                serviceRecordCaseId: CASE_ID,
                caseSessionIndex: 1,
                clientSignature: null,
            },
            data: {
                clientSignature: "data:image/png;base64,d29ybGQ=",
                clientSignedAt: expect.any(Date),
            },
        });
        expect(existing.clientSignature).toBe(SIGNATURE);
        expect(existing.clientSignedAt).toBe(signedAt);
    });

    it("uses a null-signature conditional write so only one concurrent first signature wins", async () => {
        let persistedSignature: string | null = null;
        const writeCounts: number[] = [];
        const updateSignature = async (args: Record<string, unknown>) => {
            const data = args["data"] as { clientSignature: string };
            const count = persistedSignature === null ? 1 : 0;
            if (count === 1) persistedSignature = data.clientSignature;
            writeCounts.push(count);
            return { count };
        };
        const { service, updateMany } = createHarness({ existing: null, updateSignature });

        await Promise.all([
            service.upsertSession(context, 1, createDto({ clientSignature: SIGNATURE }), true),
            service.upsertSession(context, 1, createDto({
                clientSignature: "data:image/png;base64,d29ybGQ=",
            }), true),
        ]);

        expect(writeCounts).toEqual([1, 0]);
        expect(updateMany).toHaveBeenCalledTimes(2);
        expect(updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: expect.objectContaining({ clientSignature: null }),
        }));
        expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: expect.objectContaining({ clientSignature: null }),
        }));
    });

    it("refuses a stale draft after a concurrent submission locks the session", async () => {
        const { service, dayModel, lockQueries, getPersistedDay } = createConcurrentHarness();
        const submit = service.upsertSession(context, 1, createDto(), true);
        const draft = service.upsertSession(context, 1, createDto({ notes: "stale draft" }), false);

        await expect(submit).resolves.toEqual(expect.objectContaining({ locked: true }));
        await expect(draft).rejects.toMatchObject({
            response: { code: "SERVICE_RECORD_SESSION_LOCKED" },
        });
        expect(dayModel.upsert).toHaveBeenCalledTimes(1);
        expect(lockQueries).toHaveLength(2);
        for (const query of lockQueries) {
            expect((query as { strings: string[] }).strings.join(" ")).toContain("FOR UPDATE");
        }
        expect(getPersistedDay()).toEqual(expect.objectContaining({ locked: true }));
    });

    it("records clientSignedAt only on the first successful signature write", async () => {
        jest.useFakeTimers({ now: new Date("2026-07-01T02:00:00.000Z") });
        let persistedSignedAt: Date | null = null;
        const updateSignature = async (args: Record<string, unknown>) => {
            const data = args["data"] as { clientSignedAt: Date };
            if (persistedSignedAt) return { count: 0 };
            persistedSignedAt = data.clientSignedAt;
            return { count: 1 };
        };
        const { service } = createHarness({ existing: null, updateSignature });

        await service.upsertSession(context, 1, createDto(), true);
        jest.setSystemTime(new Date("2026-07-01T03:00:00.000Z"));
        await service.upsertSession(context, 1, createDto({
            clientSignature: "data:image/png;base64,d29ybGQ=",
        }), true);

        expect(persistedSignedAt).toEqual(new Date("2026-07-01T02:00:00.000Z"));
    });

    it("rejects changing any field when resubmitting a locked session", async () => {
        const { service, upsert } = createHarness({ existing: createDay() });

        await expectException(service.upsertSession(
            context,
            1,
            createDto({ serviceDate: "2026-07-02T00:00:00.000Z" }),
            true,
        ), ConflictException, "SERVICE_RECORD_SESSION_LOCKED");
        expect(upsert).not.toHaveBeenCalled();
    });

    it("does not grandfather a locked legacy session with no signature", async () => {
        const existing = createDay({ clientSignature: null, clientSignedAt: null });
        const { service, updateMany } = createHarness({ existing });

        await expectException(service.upsertSession(
            context,
            1,
            createDto({ clientSignature: undefined }),
            true,
        ), ConflictException, "SERVICE_RECORD_SESSION_LOCKED");
        expect(updateMany).not.toHaveBeenCalled();
    });

    it("ignores a signature on draft save while the session remains unlocked", async () => {
        const existing = createDay({ locked: false, clientSignature: null, clientSignedAt: null });
        const { service, upsert, updateMany } = createHarness({ existing });

        await service.upsertSession(context, 1, createDto(), false);

        expect(updateMany).not.toHaveBeenCalled();
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ locked: false }),
        }));
    });

    it("extends the schedule and client end date, re-syncs the case, and extends the token when a session date runs past the current end date", async () => {
        // A single-session case (requiredSessionCount 1) keeps the math
        // simple: the required end date for session 1 is the service date
        // itself. Saving it later than the current end date must postpone
        // the schedule/client/case/token end dates while leaving the
        // contracted session count untouched.
        const transactionRecord = createRecord({
            requiredSessionCount: 1,
            endDate: new Date("2026-07-05T00:00:00.000Z"),
        });
        const schedule = {
            id: 10,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-07-05T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const ensureForClient = jest.fn().mockResolvedValue(null);
        const extendExpiryForCase = jest.fn().mockResolvedValue(undefined);
        const { service, scheduleUpdate, clientUpdate, upsert } = createHarness({
            existing: null,
            transactionRecord,
            schedule,
            ensureForClient,
            extendExpiryForCase,
        });
        const newEndDate = new Date("2026-07-10T00:00:00.000Z");

        const result = await service.upsertSession(
            context,
            1,
            createDto({ serviceDate: "2026-07-10T00:00:00.000Z" }),
            false,
        );

        expect(result).toEqual(expect.objectContaining({ sessionIndex: 1 }));
        expect(scheduleUpdate).toHaveBeenCalledWith({
            where: { id: 10 },
            data: { endDate: newEndDate },
        });
        expect(clientUpdate).toHaveBeenCalledWith({
            where: { id: 100 },
            data: { endDate: newEndDate },
        });
        expect(ensureForClient).toHaveBeenCalledWith(100, expect.anything());
        expect(extendExpiryForCase).toHaveBeenCalledWith(
            CASE_ID,
            new Date("2026-07-17T11:00:00.000Z"),
            expect.anything(),
        );
        // requiredSessionCount is never touched by the extension.
        expect(transactionRecord.requiredSessionCount).toBe(1);
        expect(upsert).toHaveBeenCalled();
    });

    it("extends the end date by the correct remaining-session count mid-contract (requiredSessionCount 15, session 13)", async () => {
        // Regression coverage for the extension arithmetic: n = total -
        // sessionIndex is the number of Korean business days still owed
        // AFTER this session. total=15, sessionIndex=13 -> n=2, so saving
        // session 13 on 2026-08-31 (the current end date) must push the end
        // date to 2026-09-02 (2 business days later), not 2026-09-01 or
        // 2026-09-03.
        const transactionRecord = createRecord({
            requiredSessionCount: 15,
            endDate: new Date("2026-08-31T00:00:00.000Z"),
        });
        const schedule = {
            id: 10,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-08-31T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const ensureForClient = jest.fn().mockResolvedValue(null);
        const extendExpiryForCase = jest.fn().mockResolvedValue(undefined);
        const { service, transactionClient, scheduleUpdate, clientUpdate } = createHarness({
            existing: null,
            transactionRecord,
            schedule,
            ensureForClient,
            extendExpiryForCase,
        });
        transactionClient.service_record_day.findUnique.mockImplementation(
            ({ where }: { where: { serviceRecordCaseId_caseSessionIndex: { caseSessionIndex: number } } }) => {
                const idx = where.serviceRecordCaseId_caseSessionIndex.caseSessionIndex;
                if (idx === 12) {
                    return Promise.resolve(createDay({
                        caseSessionIndex: 12,
                        sessionIndex: 12,
                        serviceDate: new Date("2026-08-28T00:00:00.000Z"),
                        locked: true,
                    }));
                }
                return Promise.resolve(null);
            },
        );
        const newEndDate = new Date("2026-09-02T00:00:00.000Z");

        const result = await service.upsertSession(
            context,
            13,
            createDto({ serviceDate: "2026-08-31T00:00:00.000Z" }),
            false,
        );

        expect(result).toEqual(expect.objectContaining({ sessionIndex: 13 }));
        expect(scheduleUpdate).toHaveBeenCalledWith({
            where: { id: 10 },
            data: { endDate: newEndDate },
        });
        expect(clientUpdate).toHaveBeenCalledWith({
            where: { id: 100 },
            data: { endDate: newEndDate },
        });
        expect(extendExpiryForCase).toHaveBeenCalledWith(
            CASE_ID,
            new Date("2026-09-09T11:00:00.000Z"),
            expect.anything(),
        );
        expect(transactionRecord.requiredSessionCount).toBe(15);
    });

    it("re-reads the case after extending the end date instead of relying on a stale snapshot", async () => {
        // requiredSessionCount 15, old endDate 2026-08-31. Saving session 14
        // at service date 2026-09-01 extends the end date to 2026-09-02 (1
        // remaining business day). The save's own "cannot exceed the end
        // date" guard runs AFTER the extension and must see the NEW end
        // date: 2026-09-01 exceeds the OLD end date (2026-08-31) but not the
        // new one, so this save must succeed. If the post-extension re-read
        // is ever dropped, this guard would compare against the stale
        // 2026-08-31 snapshot and wrongly reject the save.
        const transactionRecord = createRecord({
            requiredSessionCount: 15,
            endDate: new Date("2026-08-31T00:00:00.000Z"),
        });
        const schedule = {
            id: 10,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-08-31T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const { service, transactionClient } = createHarness({
            existing: null,
            transactionRecord,
            schedule,
        });
        transactionClient.service_record_day.findUnique.mockImplementation(
            ({ where }: { where: { serviceRecordCaseId_caseSessionIndex: { caseSessionIndex: number } } }) => {
                const idx = where.serviceRecordCaseId_caseSessionIndex.caseSessionIndex;
                if (idx === 13) {
                    return Promise.resolve(createDay({
                        caseSessionIndex: 13,
                        sessionIndex: 13,
                        serviceDate: new Date("2026-08-31T00:00:00.000Z"),
                        locked: true,
                    }));
                }
                return Promise.resolve(null);
            },
        );

        await expect(service.upsertSession(
            context,
            14,
            createDto({ serviceDate: "2026-09-01T00:00:00.000Z" }),
            false,
        )).resolves.toEqual(expect.objectContaining({ sessionIndex: 14 }));
    });

    it("does not extend the end date when the service date fits within the current schedule", async () => {
        const schedule = {
            id: 10,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-07-31T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const ensureForClient = jest.fn().mockResolvedValue(null);
        const extendExpiryForCase = jest.fn().mockResolvedValue(undefined);
        const existing = createDay({ locked: false, clientSignature: null, clientSignedAt: null });
        const { service, scheduleUpdate, clientUpdate } = createHarness({
            existing,
            schedule,
            ensureForClient,
            extendExpiryForCase,
        });

        await service.upsertSession(context, 1, createDto({ notes: "정상 범위" }), false);

        expect(scheduleUpdate).not.toHaveBeenCalled();
        expect(clientUpdate).not.toHaveBeenCalled();
        expect(ensureForClient).not.toHaveBeenCalled();
        expect(extendExpiryForCase).not.toHaveBeenCalled();
    });

    it("rejects the upsert with a Korean conflict message when extending the end date would overlap another active schedule", async () => {
        const transactionRecord = createRecord({
            requiredSessionCount: 1,
            endDate: new Date("2026-07-05T00:00:00.000Z"),
        });
        const schedule = {
            id: 10,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            endDate: new Date("2026-07-05T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const employeeScheduleFindFirst = jest.fn().mockResolvedValue({
            id: 99,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
        });
        const { service, upsert } = createHarness({
            existing: null,
            transactionRecord,
            schedule,
            employeeScheduleFindFirst,
        });

        await expect(service.upsertSession(
            context,
            1,
            createDto({ serviceDate: "2026-07-10T00:00:00.000Z" }),
            false,
        )).rejects.toMatchObject({
            response: {
                code: EMPLOYEE_SCHEDULE_OVERLAP_CODE,
                message: "다음 배정 일정과 겹쳐 종료일을 연장할 수 없습니다. 관리자에게 문의해 주세요.",
            },
        });
        expect(upsert).not.toHaveBeenCalled();
    });

    it("allows a caregiver to save a session while the case is AWAITING_COMPLETION, inside the link grace window", async () => {
        // Regression coverage for the link-expiry grace period: a case that
        // has already reached AWAITING_COMPLETION (end date passed, session
        // still owed) must not block the caregiver's write. AWAITING_COMPLETION
        // is intentionally absent from the blocked-status list in
        // upsertSession -- only FINALIZING/FINALIZATION_FAILED/
        // DOCUMENTS_CREATED/COMPLETED are. The wall-clock "now" (2026-09-05,
        // three days after the end date) is enforced at the link/token layer,
        // not here -- upsertSession itself does no time-based rejection.
        const transactionRecord = createRecord({
            status: SERVICE_RECORD_CASE_STATUS.AWAITING_COMPLETION,
            requiredSessionCount: 15,
            endDate: new Date("2026-09-02T00:00:00.000Z"),
        });
        const schedule = {
            id: 10,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-08-01T00:00:00.000Z"),
            endDate: new Date("2026-09-02T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const ensureForClient = jest.fn().mockResolvedValue(null);
        const extendExpiryForCase = jest.fn().mockResolvedValue(undefined);
        const { service, transactionClient } = createHarness({
            existing: null,
            transactionRecord,
            schedule,
            ensureForClient,
            extendExpiryForCase,
        });
        transactionClient.service_record_day.findUnique.mockImplementation(
            ({ where }: { where: { serviceRecordCaseId_caseSessionIndex: { caseSessionIndex: number } } }) => {
                const idx = where.serviceRecordCaseId_caseSessionIndex.caseSessionIndex;
                if (idx === 13) {
                    return Promise.resolve(createDay({
                        caseSessionIndex: 13,
                        sessionIndex: 13,
                        serviceDate: new Date("2026-08-28T00:00:00.000Z"),
                        locked: true,
                    }));
                }
                return Promise.resolve(null);
            },
        );

        await expect(service.upsertSession(
            context,
            14,
            createDto({ serviceDate: "2026-09-02T00:00:00.000Z" }),
            false,
        )).resolves.toEqual(expect.objectContaining({ sessionIndex: 14 }));
    });

    it("auto-extends the end date for an AWAITING_COMPLETION case when a grace-window save runs past it", async () => {
        // Companion to the previous test: saving session 14 (of 15) two days
        // after the current end date must push the end date out by the
        // correct remaining-session math (addBusinessDaysKr(serviceDate, 1))
        // rather than being rejected as "Service date cannot exceed the
        // service end date" -- the post-extension re-read (see the
        // "re-reads the case" test above) is what makes that guard see the
        // new end date instead of the stale one.
        const transactionRecord = createRecord({
            status: SERVICE_RECORD_CASE_STATUS.AWAITING_COMPLETION,
            requiredSessionCount: 15,
            endDate: new Date("2026-09-02T00:00:00.000Z"),
        });
        const schedule = {
            id: 10,
            clientId: 100,
            primaryEmployeeId: 20,
            secondaryEmployeeId: null,
            startDate: new Date("2026-08-01T00:00:00.000Z"),
            endDate: new Date("2026-09-02T00:00:00.000Z"),
            replaced: false,
            primaryEmployee: { name: "제공자" },
        };
        const ensureForClient = jest.fn().mockResolvedValue(null);
        const extendExpiryForCase = jest.fn().mockResolvedValue(undefined);
        const { service, transactionClient, scheduleUpdate, clientUpdate } = createHarness({
            existing: null,
            transactionRecord,
            schedule,
            ensureForClient,
            extendExpiryForCase,
        });
        transactionClient.service_record_day.findUnique.mockImplementation(
            ({ where }: { where: { serviceRecordCaseId_caseSessionIndex: { caseSessionIndex: number } } }) => {
                const idx = where.serviceRecordCaseId_caseSessionIndex.caseSessionIndex;
                if (idx === 13) {
                    return Promise.resolve(createDay({
                        caseSessionIndex: 13,
                        sessionIndex: 13,
                        serviceDate: new Date("2026-08-28T00:00:00.000Z"),
                        locked: true,
                    }));
                }
                return Promise.resolve(null);
            },
        );
        const newEndDate = new Date(`${addBusinessDaysKr("2026-09-04", 1)}T00:00:00.000Z`);

        const result = await service.upsertSession(
            context,
            14,
            createDto({ serviceDate: "2026-09-04T00:00:00.000Z" }),
            false,
        );

        expect(result).toEqual(expect.objectContaining({ sessionIndex: 14 }));
        expect(scheduleUpdate).toHaveBeenCalledWith({
            where: { id: 10 },
            data: { endDate: newEndDate },
        });
        expect(clientUpdate).toHaveBeenCalledWith({
            where: { id: 100 },
            data: { endDate: newEndDate },
        });
        expect(extendExpiryForCase).toHaveBeenCalledWith(
            CASE_ID,
            getServiceRecordTokenExpiresAt(newEndDate),
            expect.anything(),
        );
    });
});

describe("UpsertSessionDto.clientSignature", () => {
    it("rejects malformed or decoded signatures larger than 192KB", async () => {
        const invalidValues = [
            "aGVsbG8=",
            "data:image/png;base64,not-valid***",
            `data:image/png;base64,${Buffer.alloc(192 * 1024 + 1).toString("base64")}`,
        ];

        for (const clientSignature of invalidValues) {
            const dto = Object.assign(new UpsertSessionDto(), createDto({ clientSignature }));
            const errors = await validate(dto);
            expect(errors.some((error) => error.property === "clientSignature")).toBe(true);
        }
    });

    it("accepts a PNG data URI whose decoded body is exactly 192KB", async () => {
        const dto = Object.assign(new UpsertSessionDto(), createDto({
            clientSignature: `data:image/png;base64,${Buffer.alloc(192 * 1024).toString("base64")}`,
        }));

        await expect(validate(dto)).resolves.toHaveLength(0);
    });
});

describe("UpsertSessionDto service-record text limits", () => {
    it("accepts 기타서비스 40자와 특이사항 80자", async () => {
        const dto = Object.assign(new UpsertSessionDto(), createDto({
            etcService: "기".repeat(40),
            notes: "특".repeat(80),
        }));

        await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it.each([
        ["etcService", { etcService: ` ${"기".repeat(40)}` }],
        ["notes", { notes: ` ${"특".repeat(80)}` }],
    ])("rejects %s when a leading space exceeds its limit", async (property, fields) => {
        const dto = Object.assign(new UpsertSessionDto(), createDto(fields));
        const errors = await validate(dto);

        expect(errors.some((error) => error.property === property)).toBe(true);
    });
});
