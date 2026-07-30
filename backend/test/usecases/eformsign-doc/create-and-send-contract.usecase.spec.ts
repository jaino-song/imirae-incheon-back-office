import { CreateAndSendContractUsecase } from "application/usecases/eformsign-doc/create-and-send-contract.usecase";

describe("CreateAndSendContractUsecase", () => {
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
            assertAssignedClient: jest.fn().mockRejectedValue(
                new Error("고객의 제공인력 배정을 먼저 저장해 주세요."),
            ),
        };
        const usecase = new CreateAndSendContractUsecase(
            eformsignClient as never,
            clientRepository as never,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            assignmentGuard as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 55,
            templateId: "template-1",
        })).resolves.toEqual({
            success: false,
            error: "고객의 제공인력 배정을 먼저 저장해 주세요.",
        });

        expect(assignmentGuard.assertAssignedClient).toHaveBeenCalledWith("branch-1", 55);
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
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            { execute: jest.fn().mockRejectedValue(new Error("local db unavailable")) } as never,
            { assertAssignedClient: jest.fn() } as never,
        );

        await expect(usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
        })).resolves.toEqual(expect.objectContaining({
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
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            { execute: persistDocument } as never,
            { assertAssignedClient: jest.fn() } as never,
        );

        await usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
            templateName: "표준계약서",
        });

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
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            { execute: persistDocument } as never,
            { assertAssignedClient: jest.fn() } as never,
        );

        await usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
            templateName: "표준계약서",
        });

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
            { execute: jest.fn().mockResolvedValue({ oauth_token: { access_token: "token" } }) } as never,
            { execute: jest.fn().mockResolvedValue({ documentId: "remote-1" }) } as never,
            { assertAssignedClient: jest.fn() } as never,
        );

        await usecase.execute("branch-1", {
            clientId: 7,
            templateId: "template-1",
            templateName: "표준계약서",
        });

        // `client` has no email column, so the recipient must be identifiable by phone only.
        expect(createDocument).toHaveBeenCalledWith(
            "token",
            expect.objectContaining({
                recipient: { name: "김고객", sms: "010-1111-2222" },
            }),
        );
    });
});
