import { CreateAndSendContractUsecase } from "application/usecases/eformsign-doc/create-and-send-contract.usecase";

const TEST_PRINCIPAL = { branchId: "branch-1", globalRole: "owner" };
const createBoundary = () => ({
    withCredentials: jest.fn((
        _principal: unknown,
        _capability: unknown,
        operation: (credentials: { accessToken: string; refreshToken: string }) => unknown,
    ) => operation({ accessToken: "token", refreshToken: "refresh-token" })),
});

describe("CreateAndSendContractUsecase", () => {
    it("rejects a malformed persisted client phone before assignment, credentials, or provider work", async () => {
        const createDocument = jest.fn();
        const withCredentials = createBoundary();
        const assignmentGuard = { assertLiveAssignedClient: jest.fn() };
        const usecase = new CreateAndSendContractUsecase(
            { createDocument } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 55,
                name: "잘못된 고객",
                phone: "not-a-phone",
            }) } as never,
            withCredentials as never,
            { execute: jest.fn() } as never,
            assignmentGuard as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 55,
            templateId: "template-1",
        }, TEST_PRINCIPAL)).resolves.toEqual({
            success: false,
            error: "고객 연락처가 유효하지 않습니다",
        });

        expect(assignmentGuard.assertLiveAssignedClient).not.toHaveBeenCalled();
        expect(withCredentials.withCredentials).not.toHaveBeenCalled();
        expect(createDocument).not.toHaveBeenCalled();
    });

    it("does not create an external document for an unassigned client", async () => {
        const eformsignClient = { createDocument: jest.fn() };
        const clientRepository = {
            findById: jest.fn().mockResolvedValue({
                id: 55,
                name: "송진호",
                phone: "010-1111-2222",
            }),
        };
        const assignmentGuard = {
            assertLiveAssignedClient: jest.fn().mockRejectedValue(
                new Error("고객의 제공인력 배정을 먼저 저장해 주세요."),
            ),
        };
        const usecase = new CreateAndSendContractUsecase(
            eformsignClient as never,
            clientRepository as never,
            createBoundary() as never,
            { execute: jest.fn() } as never,
            assignmentGuard as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 55,
            templateId: "template-1",
        }, TEST_PRINCIPAL)).resolves.toEqual({
            success: false,
            error: "고객의 제공인력 배정을 먼저 저장해 주세요.",
        });

        expect(assignmentGuard.assertLiveAssignedClient).toHaveBeenCalledWith("branch-1", 55);
        expect(eformsignClient.createDocument).not.toHaveBeenCalled();
    });

    it("returns the remote document id when local persistence fails", async () => {
        const usecase = new CreateAndSendContractUsecase(
            { createDocument: jest.fn().mockResolvedValue({ documentId: "remote-1" }) } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 7,
                name: "김고객",
                phone: "010-1111-2222",
                startDate: null,
                endDate: null,
            }) } as never,
            createBoundary() as never,
            { execute: jest.fn().mockRejectedValue(new Error("local db unavailable")) } as never,
            { assertLiveAssignedClient: jest.fn() } as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
        }, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({
            success: false,
            remoteDocumentId: "remote-1",
        }));
    });

    // This used to assert that the name sent to eformsign is the name persisted locally. The
    // contract template sets title_change=false — it names the document itself and rejects an
    // explicit name with 4000010 — so no name is sent at all now. The invariant it was
    // protecting survives in a new form: the mirror row must carry the title eformsign actually
    // assigned, never one only we believe in.
    it("persists the document name eformsign assigned", async () => {
        const createDocument = jest.fn().mockResolvedValue({
            documentId: "remote-1",
            documentName: "김고객____남동구 계약서",
        });
        const persistDocument = jest.fn().mockResolvedValue({ documentId: "remote-1" });
        const usecase = new CreateAndSendContractUsecase(
            { createDocument } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 7,
                name: "김고객",
                phone: "010-1111-2222",
                startDate: null,
                endDate: null,
            }) } as never,
            createBoundary() as never,
            { execute: persistDocument } as never,
            { assertLiveAssignedClient: jest.fn() } as never,
        );

        await usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
            templateName: "표준계약서",
        }, TEST_PRINCIPAL);

        expect(createDocument).toHaveBeenCalledWith(
            "token",
            expect.not.objectContaining({ documentName: expect.anything() }),
        );
        expect(persistDocument).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                documentName: "김고객____남동구 계약서",
                templateName: "표준계약서",
                customerName: "김고객",
            }),
        );
    });

    it("falls back to its own label when eformsign returns no document name", async () => {
        const createDocument = jest.fn().mockResolvedValue({ documentId: "remote-1" });
        const persistDocument = jest.fn().mockResolvedValue({ documentId: "remote-1" });
        const usecase = new CreateAndSendContractUsecase(
            { createDocument } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 7,
                name: "김고객",
                phone: "010-1111-2222",
                startDate: null,
                endDate: null,
            }) } as never,
            createBoundary() as never,
            { execute: persistDocument } as never,
            { assertLiveAssignedClient: jest.fn() } as never,
        );

        await usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
            templateName: "표준계약서",
        }, TEST_PRINCIPAL);

        expect(persistDocument).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({ documentName: "표준계약서 - 김고객" }),
        );
    });

    it("sends the participant recipient by phone alone", async () => {
        const createDocument = jest.fn().mockResolvedValue({ documentId: "remote-1" });
        const usecase = new CreateAndSendContractUsecase(
            { createDocument } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 7,
                name: "김고객",
                phone: "010-1111-2222",
                startDate: null,
                endDate: null,
            }) } as never,
            createBoundary() as never,
            { execute: jest.fn().mockResolvedValue({ documentId: "remote-1" }) } as never,
            { assertLiveAssignedClient: jest.fn() } as never,
        );

        await usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
            templateName: "표준계약서",
        }, TEST_PRINCIPAL);

        // `client` has no email column, so the recipient must be identifiable by phone only.
        expect(createDocument).toHaveBeenCalledWith(
            "token",
            expect.objectContaining({
                recipient: { name: "김고객", sms: "010-1111-2222" },
            }),
        );
    });

    it("uses the approved client snapshot instead of re-reading mutable client data", async () => {
        const createDocument = jest.fn().mockResolvedValue({ documentId: "remote-approved" });
        const findById = jest.fn().mockResolvedValue({
            id: 7,
            name: "변경된 고객",
            phone: "010-9999-9999",
            address: "변경된 주소",
            birthday: "991231",
            startDate: new Date("2026-09-01T00:00:00.000Z"),
            endDate: new Date("2026-09-30T00:00:00.000Z"),
            fullPrice: "900000",
            grant: "100000",
            actualPrice: "800000",
            duration: 30,
        });
        const snapshot = {
            id: 7,
            name: "승인 당시 고객",
            phone: "010-1111-2222",
            address: "승인 당시 주소",
            birthday: "900101",
            startDate: "2026-08-03T00:00:00.000Z",
            endDate: "2026-08-17T00:00:00.000Z",
            fullPrice: "100,000원",
            grant: "50,000원",
            actualPrice: "50,000",
            duration: 15,
            fallbackDate: "2026-08-04T01:02:03.000Z",
        };
        const usecase = new CreateAndSendContractUsecase(
            { createDocument } as never,
            { findById } as never,
            createBoundary() as never,
            { execute: jest.fn().mockResolvedValue({ documentId: "remote-approved" }) } as never,
            { assertLiveAssignedClient: jest.fn() } as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: snapshot.id,
            templateId: "template-1",
            templateName: "표준계약서",
            idempotencyKey: "action-approved",
            clientSnapshot: snapshot,
            clientTargetVersion: "target-approved",
        }, TEST_PRINCIPAL)).resolves.toEqual({ success: true, documentId: "remote-approved" });

        expect(findById).not.toHaveBeenCalled();
        expect(createDocument).toHaveBeenCalledWith("token", expect.objectContaining({
            recipient: { name: "승인 당시 고객", sms: "010-1111-2222" },
            prefillFields: expect.arrayContaining([
                { id: "이용자 생년월일", value: "900101" },
                { id: "이용자 주소", value: "승인 당시 주소" },
                { id: "계약 시작 년도", value: "26" },
                { id: "계약 종료 일", value: "17" },
                { id: "본인부담금 수령 년도", value: "26" },
                { id: "본인부담금 수령 월", value: "08" },
                { id: "본인부담금 수령 일", value: "04" },
                { id: "서비스 비용", value: "100000" },
                { id: "정부지원금", value: "50000" },
                { id: "본인부담금", value: "50000" },
                { id: "서비스 가격", value: "100000" },
            ]),
            idempotencyKey: "action-approved",
        }));
    });

    it("does not cross the provider boundary for an uncertain durable intent", async () => {
        const credentialBoundary = createBoundary();
        const createDocument = jest.fn();
        const dispatchBoundary = {
            claim: jest.fn().mockResolvedValue({
                disposition: "uncertain",
                intent: { id: "intent-uncertain", providerDocumentId: null },
            }),
        };
        const usecase = new CreateAndSendContractUsecase(
            { createDocument } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 7,
                name: "김고객",
                phone: "010-1111-2222",
                startDate: null,
                endDate: null,
            }) } as never,
            credentialBoundary as never,
            { execute: jest.fn() } as never,
            { assertLiveAssignedClient: jest.fn().mockResolvedValue({ scheduleId: 13 }) } as never,
            dispatchBoundary as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
            idempotencyKey: "request-1",
        }, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({
            success: false,
            uncertain: true,
        }));

        expect(credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(createDocument).not.toHaveBeenCalled();
    });

    it("repairs the local mirror and client link before accepting an already-accepted replay", async () => {
        const credentialBoundary = createBoundary();
        const createDocument = jest.fn();
        const repairMirror = jest.fn().mockResolvedValue({ documentId: "remote-existing" });
        const dispatchBoundary = {
            claim: jest.fn().mockResolvedValue({
                disposition: "already_accepted",
                intent: {
                    id: "intent-accepted",
                    providerDocumentId: "remote-existing",
                },
            }),
        };
        const usecase = new CreateAndSendContractUsecase(
            { createDocument } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 7,
                name: "김고객",
                phone: "010-1111-2222",
                startDate: null,
                endDate: null,
            }) } as never,
            credentialBoundary as never,
            { execute: repairMirror } as never,
            { assertLiveAssignedClient: jest.fn().mockResolvedValue({ scheduleId: 13 }) } as never,
            dispatchBoundary as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
            templateName: "표준계약서",
            idempotencyKey: "request-accepted",
            clientTargetVersion: "target-accepted",
        }, TEST_PRINCIPAL)).resolves.toEqual({
            success: true,
            documentId: "remote-existing",
        });

        expect(repairMirror).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                documentId: "remote-existing",
                documentName: "표준계약서 - 김고객",
                clientId: 7,
                linkToClient: true,
                documentKind: "contract",
                templateId: "template-1",
                templateName: "표준계약서",
                customerName: "김고객",
                clientTargetVersion: "target-accepted",
                preserveExistingMirrorProjection: true,
            }),
        );
        expect(credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(createDocument).not.toHaveBeenCalled();
    });

    it("keeps an accepted replay explicitly reconciliation-required when mirror repair warns", async () => {
        const credentialBoundary = createBoundary();
        const createDocument = jest.fn();
        const repairMirror = jest.fn().mockResolvedValue({
            documentId: "remote-existing",
            warnings: ["client_link_failed"],
        });
        const dispatchBoundary = {
            claim: jest.fn().mockResolvedValue({
                disposition: "already_accepted",
                intent: {
                    id: "intent-accepted",
                    providerDocumentId: "remote-existing",
                },
            }),
        };
        const usecase = new CreateAndSendContractUsecase(
            { createDocument } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 7,
                name: "김고객",
                phone: "010-1111-2222",
                startDate: null,
                endDate: null,
            }) } as never,
            credentialBoundary as never,
            { execute: repairMirror } as never,
            { assertLiveAssignedClient: jest.fn().mockResolvedValue({ scheduleId: 13 }) } as never,
            dispatchBoundary as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
            idempotencyKey: "request-accepted",
        }, TEST_PRINCIPAL)).resolves.toEqual({
            success: false,
            error: "계약서 발송 결과 확인이 필요합니다",
            remoteDocumentId: "remote-existing",
            uncertain: true,
        });
        expect(credentialBoundary.withCredentials).not.toHaveBeenCalled();
        expect(createDocument).not.toHaveBeenCalled();
    });

    it("persists an accepted durable intent before local mirror persistence", async () => {
        const createDocument = jest.fn().mockResolvedValue({ documentId: "remote-1" });
        const persistDocument = jest.fn().mockResolvedValue({ documentId: "remote-1" });
        const dispatchBoundary = {
            claim: jest.fn().mockResolvedValue({
                disposition: "claimed",
                intent: {
                    id: "intent-1",
                    businessKey: "provider-key",
                    providerDocumentId: null,
                },
            }),
            markAccepted: jest.fn().mockResolvedValue({ status: "accepted" }),
            markUncertain: jest.fn(),
            releaseBeforeSend: jest.fn(),
        };
        const usecase = new CreateAndSendContractUsecase(
            { createDocument } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 7,
                name: "김고객",
                phone: "010-1111-2222",
                startDate: null,
                endDate: null,
            }) } as never,
            createBoundary() as never,
            { execute: persistDocument } as never,
            { assertLiveAssignedClient: jest.fn().mockResolvedValue({ scheduleId: 13 }) } as never,
            dispatchBoundary as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
        }, TEST_PRINCIPAL)).resolves.toEqual({ success: true, documentId: "remote-1" });

        expect(dispatchBoundary.claim).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-1",
            assignmentId: 13,
            action: "create",
        }));
        expect(createDocument).toHaveBeenCalledWith("token", expect.objectContaining({
            idempotencyKey: "provider-key",
        }));
        expect(dispatchBoundary.markAccepted).toHaveBeenCalledWith(
            expect.objectContaining({ id: "intent-1" }),
            "remote-1",
            expect.objectContaining({ documentName: null }),
        );
        expect(dispatchBoundary.markAccepted.mock.invocationCallOrder[0])
            .toBeLessThan(persistDocument.mock.invocationCallOrder[0]!);
    });

    it("records provider uncertainty instead of making a retryable success claim", async () => {
        const providerError = new Error("provider timeout");
        const dispatchBoundary = {
            claim: jest.fn().mockResolvedValue({
                disposition: "claimed",
                intent: {
                    id: "intent-1",
                    businessKey: "provider-key",
                    providerDocumentId: null,
                },
            }),
            markAccepted: jest.fn(),
            markUncertain: jest.fn().mockResolvedValue({ status: "uncertain" }),
            releaseBeforeSend: jest.fn(),
        };
        const usecase = new CreateAndSendContractUsecase(
            { createDocument: jest.fn().mockRejectedValue(providerError) } as never,
            { findById: jest.fn().mockResolvedValue({
                id: 7,
                name: "김고객",
                phone: "010-1111-2222",
                startDate: null,
                endDate: null,
            }) } as never,
            createBoundary() as never,
            { execute: jest.fn() } as never,
            { assertLiveAssignedClient: jest.fn().mockResolvedValue({ scheduleId: 13 }) } as never,
            dispatchBoundary as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
        }, TEST_PRINCIPAL)).resolves.toEqual(expect.objectContaining({
            success: false,
            uncertain: true,
        }));
        expect(dispatchBoundary.markUncertain).toHaveBeenCalledWith(
            expect.objectContaining({ id: "intent-1" }),
            "provider timeout",
            undefined,
        );
        expect(dispatchBoundary.releaseBeforeSend).not.toHaveBeenCalled();
    });
});
