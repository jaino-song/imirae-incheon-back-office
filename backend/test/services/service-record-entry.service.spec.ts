import { BadRequestException, ConflictException } from "@nestjs/common";
import { validate } from "class-validator";

import { ServiceRecordEntryService } from "application/services/service-record-entry.service";
import {
    SERVICE_RECORD_CASE_STATUS,
    ServiceRecordLifecycleService,
} from "application/services/service-record-lifecycle.service";
import { ServiceRecordTokenService } from "application/services/service-record-token.service";
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
    const transactionClient = {
        service_record_case: {
            findUnique: jest.fn().mockResolvedValue(transactionRecord),
        },
        employee_schedule: {
            findUnique: jest.fn().mockResolvedValue({ primaryEmployee: { name: "제공자" } }),
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
    const lifecycle = { recompute: jest.fn().mockResolvedValue(transactionRecord) };
    const service = new ServiceRecordEntryService(
        prisma as unknown as PrismaService,
        {} as ServiceRecordTokenService,
        lifecycle as unknown as ServiceRecordLifecycleService,
    );

    return { service, prisma, transactionClient, upsert, updateMany };
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

    it("allows a locked session to be edited and resubmitted", async () => {
        const existing = createDay();
        const { service, upsert } = createHarness({ existing });

        await expect(service.upsertSession(context, 1, createDto({ notes: "수정" }), true)).resolves.toEqual(
            expect.objectContaining({ notes: "수정", locked: true }),
        );
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ notes: "수정", locked: true }),
        }));
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
        const existing = createDay({ clientSignature: SIGNATURE, clientSignedAt: signedAt });
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

    it("rejects changing serviceDate when resubmitting a locked session", async () => {
        const { service, upsert } = createHarness({ existing: createDay() });

        await expectException(service.upsertSession(
            context,
            1,
            createDto({ serviceDate: "2026-07-02T00:00:00.000Z" }),
            true,
        ), BadRequestException, "SERVICE_DATE_IMMUTABLE");
        expect(upsert).not.toHaveBeenCalled();
    });

    it("grandfathers a locked legacy session with no signature", async () => {
        const existing = createDay({ clientSignature: null, clientSignedAt: null });
        const { service, updateMany } = createHarness({ existing });

        await expect(service.upsertSession(
            context,
            1,
            createDto({ clientSignature: undefined }),
            true,
        )).resolves.toEqual(expect.objectContaining({ locked: true }));
        expect(updateMany).not.toHaveBeenCalled();
    });

    it("ignores a signature on draft save and preserves prior locked state", async () => {
        const existing = createDay({ clientSignature: null, clientSignedAt: null });
        const { service, upsert, updateMany } = createHarness({ existing });

        await service.upsertSession(context, 1, createDto(), false);

        expect(updateMany).not.toHaveBeenCalled();
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ locked: true }),
        }));
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
