import { ConfigService } from "@nestjs/config";

import { LinkMirroredEformsignDocByPhoneUsecase } from "application/usecases/eformsign-doc/link-mirrored-eformsign-doc-by-phone.usecase";

function contractDetail() {
    return {
        id: "doc-1",
        document_number: "DOC-1",
        template: { id: "contract-template", name: "계약서" },
        document_name: "산모신생아 건강관리 계약서",
        creator: { recipient_type: "01", id: "staff@example.com", name: "담당자" },
        created_date: Date.parse("2026-07-20T00:00:00.000Z"),
        updated_date: Date.parse("2026-07-21T00:00:00.000Z"),
        current_status: {
            status_type: "072",
            step_type: "06",
            step_index: "3",
            step_name: "완료",
            step_recipients: [],
            step_group: 3,
        },
        fields: [
            { id: "이용자 성명", value: "김고객", type: "text" },
            { id: "이용자 주소", value: "서울시 중구", type: "text" },
            { id: "이용자 생년월일", value: "920304", type: "text" },
            { id: "계약 시작일", value: "2026-08-01", type: "date" },
            { id: "계약 종료일", value: "2026-08-14", type: "date" },
            { id: "서비스 비용", value: "1,500,000", type: "text" },
            { id: "정부지원금", value: "1,000,000", type: "text" },
            { id: "본인부담금", value: "500,000", type: "text" },
        ],
        recipients: [{
            recipient_type: "02",
            name: "김고객",
            sms: "010-1234-5678",
        }],
    };
}

function contractDetailWithProviders() {
    const detail = contractDetail();
    detail.fields = [
        ...detail.fields,
        { id: "제공인력 1 성명", value: "박관리사", type: "text" },
        { id: "제공인력 1 연락처", value: "010-5555-1111", type: "text" },
        { id: "제공인력 2 성명", value: "최관리사", type: "text" },
        { id: "제공인력 2 연락처", value: "01055552222", type: "text" },
    ];
    return detail;
}

function contractDetailWithoutDates() {
    const detail = contractDetail();
    detail.fields = detail.fields.filter(
        (field) => field.id !== "계약 시작일" && field.id !== "계약 종료일",
    );
    return detail;
}

function mirroredDocument(overrides: Record<string, unknown> = {}) {
    return {
        id: 11,
        documentId: "doc-1",
        documentKind: null,
        serviceRecordCaseId: null,
        templateId: "contract-template",
        templateName: null,
        stepRecipientSms: "고객 010-1234-5678",
        customerPhone: null,
        detailPayload: null,
        statusType: "072",
        branchId: null,
        clientId: null,
        createdDate: new Date("2026-07-20T00:00:00.000Z"),
        ...overrides,
    };
}

function expectedMirrorGeneration() {
    return {
        detailSourceUpdatedDate: new Date("2026-07-21T00:00:00.000Z"),
        detailSyncedAt: new Date("2026-07-21T00:01:00.000Z"),
    };
}

describe("LinkMirroredEformsignDocByPhoneUsecase", () => {
    function setup(document = mirroredDocument()) {
        const transaction = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            $queryRaw: jest.fn().mockResolvedValue([{ id: 11 }]),
            eformsign_doc: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findUnique: jest.fn().mockImplementation(({ where }) =>
                    Promise.resolve(
                        where.documentId === document.documentId
                            ? document
                            : null,
                    )),
            },
            client: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 21,
                    branchId: "branch-1",
                    eDocId: null,
                }),
                findMany: jest.fn().mockResolvedValue([{
                    id: 21,
                    branchId: "branch-1",
                    phone: "010-1234-5678",
                    eDocId: null,
                }]),
                create: jest.fn().mockResolvedValue({ id: 31 }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            message_trigger_rule: {
                upsert: jest.fn().mockResolvedValue(undefined),
            },
            message_trigger_job: {
                upsert: jest.fn().mockResolvedValue(undefined),
            },
            area: {
                findMany: jest.fn().mockResolvedValue([]),
            },
            employee: {
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockResolvedValue({ id: 71 }),
            },
            employee_schedule: {
                create: jest.fn().mockResolvedValue({ id: 91 }),
                // No active schedule overlaps by default, so the automatic
                // assignment path runs the real invariant check.
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([{
                id: "automation-intent-1",
                scheduled_for: new Date("2026-07-21T00:02:00.000Z"),
            }]),
            client: {
                findUnique: jest.fn().mockResolvedValue({ name: "김고객" }),
            },
            user: {
                findFirst: jest.fn().mockResolvedValue(null),
            },
            branch: {
                findMany: jest.fn().mockResolvedValue([
                    { id: "branch-1" },
                ]),
                findUnique: jest.fn().mockResolvedValue({
                    smsSenderApprovalStatus: "approved",
                }),
            },
            message_trigger_job: {
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            eformsign_doc: {
                findUnique: jest.fn().mockResolvedValue(document),
            },
            $transaction: jest.fn((
                work: (tx: typeof transaction) => Promise<unknown>,
            ) => work(transaction)),
        };
        const config = {
            get: jest.fn().mockReturnValue(undefined),
        } as unknown as ConfigService;
        const settings = {
            getClientAutoRegistrationEnabled: jest.fn().mockResolvedValue(true),
            getGreetingOnAutoRegistrationEnabled: jest.fn().mockResolvedValue(false),
            getEformsignTemplateBranch: jest.fn().mockResolvedValue(null),
        };
        const messageTrigger = {
            ensureDefaultRulesForBranch: jest.fn().mockResolvedValue(undefined),
            syncClientRulesForClient: jest.fn().mockResolvedValue(undefined),
        };
        const serviceRecordLifecycle = {
            ensureForClient: jest.fn().mockResolvedValue(undefined),
        };
        const notificationService = {
            sendToBranchUsers: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }),
        };
        return {
            document,
            transaction,
            prisma,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            notificationService,
            usecase: new LinkMirroredEformsignDocByPhoneUsecase(
                prisma as never,
                config,
                settings as never,
                messageTrigger as never,
                serviceRecordLifecycle as never,
                notificationService as never,
            ),
        };
    }

    it("rejects a malformed mirrored customer phone before auto-registration or linking", async () => {
        const document = mirroredDocument({
            customerPhone: "not-a-phone",
        });
        const { transaction, settings, usecase } = setup(document);

        await expect(usecase.execute("doc-1")).rejects.toThrow("올바른 국내 전화번호 형식이 아닙니다.");

        expect(settings.getClientAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it("claims a later-mirrored legacy document for the one exact phone match", async () => {
        const { transaction, usecase } = setup();

        await expect(usecase.execute("doc-1")).resolves.toBe("linked");

        expect(transaction.client.findMany).toHaveBeenCalledWith({
            where: {
                phone: { not: null },
                branchId: { not: null },
                OR: [{ phone: { endsWith: "5678" } }],
            },
            select: {
                id: true,
                branchId: true,
                phone: true,
                eDocId: true,
            },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    branchId: "branch-1",
                    clientId: 21,
                    documentKind: "contract",
                },
            }),
        );
        expect(transaction.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 21,
                branchId: "branch-1",
                eDocId: null,
            },
            data: { eDocId: "doc-1" },
        });
    });

    it("limits a completed-status mirror to an existing client without completion effects", async () => {
        const document = mirroredDocument({ statusType: "072" });
        const {
            transaction,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);

        await expect(usecase.execute("doc-1", {
            linkExistingOnly: true,
        })).resolves.toBe("linked");

        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    branchId: "branch-1",
                    clientId: 21,
                    documentKind: "contract",
                },
            }),
        );
        expect(transaction.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 21,
                branchId: "branch-1",
                eDocId: null,
            },
            data: { eDocId: "doc-1" },
        });
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(settings.getClientAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(settings.getGreetingOnAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("does not guess when the normalized phone matches multiple clients", async () => {
        const { transaction, usecase } = setup();
        transaction.client.findMany.mockResolvedValue([
            {
                id: 21,
                branchId: "branch-1",
                phone: "010-1234-5678",
                eDocId: null,
            },
            {
                id: 22,
                branchId: "branch-2",
                phone: "+82 10 1234 5678",
                eDocId: null,
            },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("ambiguous");
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it("keeps the client pointer on a newer contract", async () => {
        const { document, transaction, usecase } = setup();
        transaction.client.findMany.mockResolvedValue([{
            id: 21,
            branchId: "branch-1",
            phone: "010-1234-5678",
            eDocId: "newer-doc",
        }]);
        transaction.eformsign_doc.findUnique.mockImplementation(({ where }) =>
            Promise.resolve(
                where.documentId === document.documentId
                    ? document
                    : { createdDate: new Date("2026-07-21T00:00:00.000Z") },
            ));

        await expect(usecase.execute("doc-1")).resolves.toBe("linked");

        expect(transaction.client.updateMany).not.toHaveBeenCalled();
    });

    it("repairs the client contract pointer for an already assigned document", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const { transaction, usecase } = setup(document);

        await expect(usecase.execute("doc-1")).resolves.toBe("linked");

        expect(transaction.client.findUnique).toHaveBeenCalledWith({
            where: { id: 21 },
            select: {
                id: true,
                branchId: true,
                eDocId: true,
            },
        });
        expect(transaction.client.updateMany).toHaveBeenCalledWith({
            where: {
                id: 21,
                branchId: "branch-1",
                eDocId: null,
            },
            data: { eDocId: "doc-1" },
        });
    });

    it("does not repair an assigned document after the expected mirror generation loses its fence", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const {
            transaction,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.$queryRaw.mockResolvedValue([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            {
                detailSourceUpdatedDate: new Date("2026-07-21T00:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-21T00:01:00.000Z"),
            },
        )).resolves.toBe("mirror_not_ready");

        expect(transaction.client.findUnique).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("creates a client once from a completed, branch-owned contract", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            prisma,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(settings.getClientAutoRegistrationEnabled).toHaveBeenCalledWith("branch-1");
        expect(settings.getGreetingOnAutoRegistrationEnabled).toHaveBeenCalledWith("branch-1");
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                name: "김고객",
                phone: "010-1234-5678",
                address: "서울시 중구",
                birthday: "920304",
                branchId: "branch-1",
                eDocId: "doc-1",
                suppressGreetingSms: true,
                voucherClient: true,
            }),
            select: { id: true },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith({
            where: {
                id: 11,
                branchId: "branch-1",
                clientId: null,
            },
            data: {
                branchId: "branch-1",
                clientId: 31,
                documentKind: "contract",
                customerPhone: "01012345678",
                autoRegisteredClient: true,
            },
        });
        expect(transaction.message_trigger_rule.upsert).toHaveBeenCalledTimes(1);
        expect(transaction.message_trigger_job.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({
                    branchId: "branch-1",
                    clientId: 31,
                    ruleId: "system:message_automation_intent",
                    status: "failed",
                }),
            }),
        );
        expect(messageTrigger.ensureDefaultRulesForBranch)
            .toHaveBeenCalledWith("branch-1");
        expect(messageTrigger.syncClientRulesForClient)
            .toHaveBeenCalledWith(
                "branch-1",
                31,
                true,
                true,
                {
                    stableBatchAt: new Date("2026-07-21T00:02:00.000Z"),
                    preserveExisting: true,
                },
            );
        expect(prisma.message_trigger_job.deleteMany).toHaveBeenCalledWith({
            where: expect.objectContaining({
                id: "automation-intent-1",
                ruleId: "system:message_automation_intent",
            }),
        });
        expect(serviceRecordLifecycle.ensureForClient)
            .toHaveBeenCalledWith(31);
    });

    it("resolves the area from the contract template name", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            templateName: "인천 아이미래로 남동구 계약서",
            detailPayload: contractDetail(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.area.findMany.mockResolvedValue([
            { id: "seogu", koreanName: "서구", branchId: null },
            { id: "namdong", koreanName: "남동구", branchId: "branch-1" },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.area.findMany).toHaveBeenCalledWith({
            where: { OR: [{ branchId: "branch-1" }, { branchId: null }] },
            select: { id: true, koreanName: true, branchId: true },
        });
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ areaId: "namdong" }),
            select: { id: true },
        });
    });

    it("keeps the area empty when the template name matches no area", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            templateName: "인천 아이미래로 남동구 계약서",
            detailPayload: contractDetail(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.area.findMany.mockResolvedValue([
            { id: "bupyeong", koreanName: "부평구", branchId: "branch-1" },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ areaId: null }),
            select: { id: true },
        });
    });

    it("assigns contract caretakers by phone match and persists both automation intents", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([
            { id: 55, name: "박관리사", phone: "010-5555-1111" },
            { id: 56, name: "최관리사", phone: "01055552222" },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee.create).not.toHaveBeenCalled();
        expect(transaction.employee_schedule.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                primaryEmployeeId: 55,
                secondaryEmployeeId: 56,
                workAddress: "서울시 중구",
                clientId: 31,
                branchId: "branch-1",
            }),
            select: { id: true },
        });
        expect(transaction.message_trigger_job.upsert).toHaveBeenCalledTimes(2);
        expect(transaction.message_trigger_job.upsert).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                create: expect.objectContaining({ employeeScheduleId: 91 }),
            }),
        );
    });

    it("creates missing caretakers from the contract before assigning them", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([]);
        transaction.employee.create
            .mockResolvedValueOnce({ id: 71 })
            .mockResolvedValueOnce({ id: 72 });

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee.create).toHaveBeenNthCalledWith(1, {
            data: expect.objectContaining({
                name: "박관리사",
                phone: "010-5555-1111",
                workArea: ["미지정"],
                grade: "스탠다드",
                openToNextWork: true,
                branchId: "branch-1",
            }),
            select: { id: true },
        });
        expect(transaction.employee_schedule.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                primaryEmployeeId: 71,
                secondaryEmployeeId: 72,
            }),
            select: { id: true },
        });
    });

    it("stores the canonical phone on a caretaker it auto-creates", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        // phone_normalized carries the uniqueness constraint and every phone
        // lookup; a null here would hide the row from both.
        expect(transaction.employee.create).toHaveBeenNthCalledWith(1, {
            data: expect.objectContaining({
                phone: "010-5555-1111",
                phoneNormalized: "01055551111",
            }),
            select: { id: true },
        });
    });

    it("skips the automatic assignment when it would double-book a caretaker", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([]);
        transaction.employee_schedule.findFirst.mockResolvedValue({
            id: 55,
            clientId: 12,
            primaryEmployeeId: 71,
            secondaryEmployeeId: null,
        });

        // The conflict skips the assignment; the client is still registered.
        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee_schedule.create).not.toHaveBeenCalled();
        expect(transaction.client.create).toHaveBeenCalled();
    });

    it("skips caretaker assignment when the contract has no service dates", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithoutDates(),
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee.findMany).not.toHaveBeenCalled();
        expect(transaction.employee_schedule.create).not.toHaveBeenCalled();
        expect(transaction.client.create).toHaveBeenCalled();
    });

    it("notifies staff when an auto-registered client has no caretaker assignment", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, notificationService, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee_schedule.create).not.toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).toHaveBeenCalledWith(
            "branch-1",
            "제공인력 지정 필요",
            "김고객 산모님의 제공인력 지정이 필요합니다.",
            expect.objectContaining({
                type: "eformsign_assignment_required",
                documentId: "doc-1",
                clientId: 31,
                url: "/clients?id=31",
            }),
            expect.objectContaining({
                dedupe: expect.objectContaining({
                    type: "eformsign_assignment_required",
                    documentId: "doc-1",
                }),
            }),
        );
    });

    it("does not notify when caretakers were assigned during registration", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetailWithProviders(),
        });
        const { transaction, notificationService, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.employee.findMany.mockResolvedValue([
            { id: 55, name: "박관리사", phone: "010-5555-1111" },
            { id: 56, name: "최관리사", phone: "01055552222" },
        ]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.employee_schedule.create).toHaveBeenCalled();
        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("does not notify for historical imports with suppressed automation", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, notificationService, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1", {
            suppressOutboundAutomation: true,
        })).resolves.toBe("created");

        expect(notificationService.sendToBranchUsers).not.toHaveBeenCalled();
    });

    it("keeps the registration successful when the assignment notification fails", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, notificationService, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        notificationService.sendToBranchUsers.mockRejectedValue(new Error("push provider down"));

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.client.create).toHaveBeenCalled();
    });

    it("does not create a client for a completed mirror in existing-only mode", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1", {
            linkExistingOnly: true,
        })).resolves.toBe("disabled");

        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(settings.getClientAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(settings.getGreetingOnAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(transaction.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(transaction.message_trigger_job.upsert).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("does not initialize lifecycle while repairing an assigned mirror in existing-only mode", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const { serviceRecordLifecycle, usecase } = setup(document);

        await expect(usecase.execute("doc-1", {
            linkExistingOnly: true,
        })).resolves.toBe("linked");

        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("creates and initializes a historical client without outbound automation", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            settings,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        settings.getGreetingOnAutoRegistrationEnabled.mockResolvedValue(true);

        await expect(usecase.execute("doc-1", {
            suppressOutboundAutomation: true,
        })).resolves.toBe("created");

        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "branch-1",
                eDocId: "doc-1",
                suppressGreetingSms: true,
            }),
            select: { id: true },
        });
        expect(settings.getGreetingOnAutoRegistrationEnabled).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(transaction.message_trigger_rule.upsert).not.toHaveBeenCalled();
        expect(transaction.message_trigger_job.upsert).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(31);
    });

    it("does not mutate a stale mirror generation after the parent-row fence loses", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.$queryRaw.mockResolvedValue([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            {
                detailSourceUpdatedDate: new Date("2026-07-21T00:00:00.000Z"),
                detailSyncedAt: new Date("2026-07-21T00:01:00.000Z"),
            },
        )).resolves.toBe("mirror_not_ready");

        expect(transaction.$queryRaw).toHaveBeenCalledTimes(1);
        const [fenceQuery] = transaction.$queryRaw.mock.calls[0];
        expect(fenceQuery.strings.join(" ")).toContain("FOR UPDATE");
        expect(fenceQuery.strings.join(" ")).toContain("eformsign_doc_file");
        expect(fenceQuery.strings.join(" "))
            .toContain("permanent_purge_requested_at IS NULL");
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(transaction.client.updateMany).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("locks a partial detail generation without requiring final files", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            statusType: "020",
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.$queryRaw.mockResolvedValue([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            {
                ...expectedMirrorGeneration(),
                readiness: "detail",
            },
        )).resolves.toBe("mirror_not_ready");

        const [fenceQuery] = transaction.$queryRaw.mock.calls[0];
        const sql = fenceQuery.strings.join(" ");
        expect(sql).toContain("detail_payload IS NOT NULL");
        expect(sql).toContain("permanent_purge_requested_at IS NULL");
        expect(sql).not.toContain("sync_status = 'ready'");
        expect(sql).not.toContain("eformsign_doc_file");
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("does not initialize lifecycle after an assigned link when the post-link generation recheck loses", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            clientId: 21,
        });
        const {
            transaction,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.$queryRaw
            .mockResolvedValueOnce([{ id: 11 }])
            .mockResolvedValueOnce([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            expectedMirrorGeneration(),
        )).resolves.toBe("mirror_not_ready");

        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
        expect(transaction.client.updateMany).toHaveBeenCalledTimes(1);
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
    });

    it("does not initialize lifecycle or message automation after a created link when the post-link generation recheck loses", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        transaction.$queryRaw
            .mockResolvedValueOnce([{ id: 11 }])
            .mockResolvedValueOnce([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            expectedMirrorGeneration(),
        )).resolves.toBe("mirror_not_ready");

        expect(transaction.client.create).toHaveBeenCalledTimes(1);
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledTimes(1);
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
        expect(serviceRecordLifecycle.ensureForClient).not.toHaveBeenCalled();
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
        expect(messageTrigger.syncClientRulesForClient).not.toHaveBeenCalled();
    });

    it("runs created-link lifecycle and message automation while the second generation lock is held", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute(
            "doc-1",
            undefined,
            expectedMirrorGeneration(),
        )).resolves.toBe("created");

        expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(
            31,
            transaction,
        );
        expect(messageTrigger.ensureDefaultRulesForBranch)
            .toHaveBeenCalledWith("branch-1");
        expect(messageTrigger.syncClientRulesForClient)
            .toHaveBeenCalledWith(
                "branch-1",
                31,
                true,
                true,
                {
                    stableBatchAt: new Date("2026-07-21T00:02:00.000Z"),
                    preserveExisting: true,
                },
            );
    });

    it("propagates an expected-generation lifecycle failure so completion can retry", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            messageTrigger,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        serviceRecordLifecycle.ensureForClient.mockRejectedValue(new Error("lifecycle unavailable"));

        await expect(usecase.execute(
            "doc-1",
            undefined,
            expectedMirrorGeneration(),
        )).rejects.toThrow("lifecycle unavailable");

        expect(transaction.client.create).toHaveBeenCalledTimes(1);
        expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
        expect(messageTrigger.ensureDefaultRulesForBranch).not.toHaveBeenCalled();
    });

    it("does not create a client when branch auto-registration is disabled", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            statusType: "002",
        });
        const { transaction, settings, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);
        settings.getClientAutoRegistrationEnabled.mockResolvedValue(false);

        await expect(usecase.execute("doc-1")).resolves.toBe("disabled");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("creates a client for a branchless contract when exactly one active branch enables auto-registration", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const {
            transaction,
            settings,
            serviceRecordLifecycle,
            usecase,
        } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(settings.getClientAutoRegistrationEnabled)
            .toHaveBeenCalledWith("branch-1");
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "branch-1",
                eDocId: "doc-1",
            }),
            select: { id: true },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith({
            where: {
                id: 11,
                branchId: null,
                clientId: null,
            },
            data: {
                branchId: "branch-1",
                clientId: 31,
                autoRegisteredClient: true,
                documentKind: "contract",
                customerPhone: "01012345678",
            },
        });
        expect(serviceRecordLifecycle.ensureForClient).toHaveBeenCalledWith(31);
    });

    it("uses only an explicitly active global branch for auto-registration", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        const candidates = [
            { id: "branch-null", isActive: null },
            { id: "branch-false", isActive: false },
            { id: "branch-true", isActive: true },
        ];
        prisma.branch.findMany.mockImplementation(({ where }) =>
            Promise.resolve(
                candidates
                    .filter((branch) => branch.isActive === where.isActive)
                    .map(({ id }) => ({ id })),
            ),
        );
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(prisma.branch.findMany).toHaveBeenCalledWith({
            where: { isActive: true },
            select: { id: true },
        });
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-true" }),
            select: { id: true },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ branchId: "branch-true" }),
            }),
        );
    });

    it("does not auto-register or link from null or false global branch candidates", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        const candidates = [
            { id: "branch-null", isActive: null },
            { id: "branch-false", isActive: false },
        ];
        prisma.branch.findMany.mockImplementation(({ where }) =>
            Promise.resolve(
                candidates
                    .filter((branch) => branch.isActive === where.isActive)
                    .map(({ id }) => ({ id })),
            ),
        );
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");

        expect(prisma.branch.findMany).toHaveBeenCalledWith({
            where: { isActive: true },
            select: { id: true },
        });
        expect(transaction.client.create).not.toHaveBeenCalled();
        expect(transaction.eformsign_doc.updateMany).not.toHaveBeenCalled();
    });

    it("does not guess a branch when multiple active branches enable auto-registration", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        prisma.branch.findMany.mockResolvedValue([
            { id: "branch-1" },
            { id: "branch-2" },
        ]);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("resolves a branchless contract from the branch its template is registered to", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, settings, usecase } = setup(document);
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-2",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(settings.getEformsignTemplateBranch)
            .toHaveBeenCalledWith("contract-template");
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-2" }),
            select: { id: true },
        });
        // The template answered, so the creator-membership fallback never runs.
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it("leaves a contract created before its template mapping took effect unregistered", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            createdDate: new Date("2026-06-30T23:59:59.000Z"),
        });
        const { prisma, transaction, settings, usecase } = setup(document);
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-2",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        prisma.user.findFirst.mockResolvedValue({
            ownedBranches: [],
            userBranches: [],
        });
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");

        expect(settings.getEformsignTemplateBranch)
            .toHaveBeenCalledWith("contract-template");
        // Out of window means fall through to the creator fallback, not short-circuit.
        expect(prisma.user.findFirst).toHaveBeenCalled();
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("does not auto-register through a template mapping to a branch that disabled it", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { transaction, settings, usecase } = setup(document);
        settings.getEformsignTemplateBranch.mockResolvedValue({
            branchId: "branch-2",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        });
        settings.getClientAutoRegistrationEnabled.mockResolvedValue(false);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");

        expect(settings.getClientAutoRegistrationEnabled)
            .toHaveBeenCalledWith("branch-2");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("resolves a branchless contract from the eformsign creator's one branch membership", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        prisma.user.findFirst.mockResolvedValue({
            ownedBranches: [],
            userBranches: [{ branch: { id: "branch-2" } }],
        });
        prisma.branch.findMany.mockResolvedValue([
            { id: "branch-1" },
            { id: "branch-2" },
        ]);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-2" }),
            select: { id: true },
        });
        expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });

    it("uses only an explicitly active creator membership for auto-registration", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        const candidates = [
            { id: "branch-null", isActive: null },
            { id: "branch-false", isActive: false },
            { id: "branch-true", isActive: true },
        ];
        prisma.user.findFirst.mockImplementation(({ select }) =>
            Promise.resolve({
                ownedBranches: candidates
                    .filter(
                        (branch) =>
                            branch.isActive
                            === select.ownedBranches.where.isActive,
                    )
                    .map(({ id }) => ({ id })),
                userBranches: candidates
                    .filter(
                        (branch) =>
                            branch.isActive
                            === select.userBranches.where.branch.isActive,
                    )
                    .map(({ id }) => ({ branch: { id } })),
            }),
        );
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");

        expect(prisma.user.findFirst).toHaveBeenCalledWith({
            where: {
                email: {
                    equals: "staff@example.com",
                    mode: "insensitive",
                },
            },
            select: {
                ownedBranches: {
                    where: { isActive: true },
                    select: { id: true },
                },
                userBranches: {
                    where: { branch: { isActive: true } },
                    select: { branch: { select: { id: true } } },
                },
            },
        });
        expect(transaction.client.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ branchId: "branch-true" }),
            select: { id: true },
        });
        expect(transaction.eformsign_doc.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ branchId: "branch-true" }),
            }),
        );
        expect(prisma.branch.findMany).not.toHaveBeenCalled();
    });

    it("fails closed when a known eformsign creator has no active branch candidates", async () => {
        const document = mirroredDocument({
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
        });
        const { prisma, transaction, usecase } = setup(document);
        prisma.user.findFirst.mockResolvedValue({
            ownedBranches: [],
            userBranches: [],
        });
        prisma.branch.findMany.mockResolvedValue([{ id: "branch-1" }]);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("no_branch");

        expect(prisma.branch.findMany).not.toHaveBeenCalled();
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it("does not create a client when the contract service period is inverted", async () => {
        const detail = contractDetail();
        detail.fields = detail.fields?.map((field) => {
            if (field.id === "계약 시작일") {
                return { ...field, value: "2026-08-20" };
            }
            if (field.id === "계약 종료일") {
                return { ...field, value: "2026-08-14" };
            }
            return field;
        });
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: detail,
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("skipped");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it.each([
        "002",
        "010",
        "020",
        "030",
        "043",
        "060",
        "062",
        "063",
        "064",
        "070",
    ])("creates a client from document creation onward at status %s", async (statusType) => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            statusType,
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("created");
        expect(transaction.client.create).toHaveBeenCalledTimes(1);
    });

    it("does not create a client from a temporary save", async () => {
        const document = mirroredDocument({
            branchId: "branch-1",
            customerPhone: "01012345678",
            detailPayload: contractDetail(),
            statusType: "001",
        });
        const { transaction, usecase } = setup(document);
        transaction.client.findMany.mockResolvedValue([]);

        await expect(usecase.execute("doc-1")).resolves.toBe("not_completed");
        expect(transaction.client.create).not.toHaveBeenCalled();
    });

    it.each(["011", "042", "080"])(
        "does not create a client from terminal-negative status %s",
        async (statusType) => {
            const document = mirroredDocument({
                branchId: "branch-1",
                customerPhone: "01012345678",
                detailPayload: contractDetail(),
                statusType,
            });
            const { transaction, usecase } = setup(document);
            transaction.client.findMany.mockResolvedValue([]);

            await expect(usecase.execute("doc-1")).resolves.toBe("not_completed");
            expect(transaction.client.create).not.toHaveBeenCalled();
        },
    );

    it("never links service-record documents as customer contracts", async () => {
        const { prisma, usecase } = setup();
        prisma.eformsign_doc.findUnique.mockResolvedValue(
            mirroredDocument({ documentKind: "service_record_snapshot" }),
        );

        await expect(usecase.execute("doc-1")).resolves.toBe("skipped");
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
