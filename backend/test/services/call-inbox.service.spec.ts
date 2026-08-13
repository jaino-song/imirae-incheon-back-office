import { BadRequestException, ConflictException, NotFoundException, NotImplementedException } from "@nestjs/common";
import { CallInboxService } from "application/services/call-inbox.service";
import { createHash } from "node:crypto";

describe("CallInboxService", () => {
    const prisma = {
        $transaction: jest.fn(),
        call_record: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        client_draft: {
            findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(),
            update: jest.fn(), updateMany: jest.fn(),
        },
        client: { findMany: jest.fn(), findFirst: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (callback: (transaction: never) => Promise<unknown>) => callback(prisma as never));
    const clientService = { create: jest.fn(), update: jest.fn() };
    let service: CallInboxService;

    const pendingDraft = {
        id: "draft-1", branchId: "branch-1", type: "NEW_CLIENT", status: "PENDING",
        clientId: null, callRecordId: "rec-1",
        proposals: [{ field: "name", value: "김서연", evidence: "e", confidence: "high" }],
        requestSummary: "신규 문의",
        callRecord: { id: "rec-1", callerPhone: "01048217763", callerName: "김서연" },
    };

    beforeEach(() => {
        jest.resetAllMocks();
        prisma.$transaction.mockImplementation(async (callback: (transaction: never) => Promise<unknown>) => callback(prisma as never));
        prisma.client.findMany.mockResolvedValue([]);
        prisma.client_draft.update.mockResolvedValue({});
        prisma.call_record.update.mockResolvedValue({});
        service = new CallInboxService(prisma as never, clientService as never);
    });

    it("confirmNewClient: creates via ClientService, marks CONFIRMED, links call record", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.create.mockResolvedValue({ id: 77 });

        const result = await service.confirmNewClient("branch-1", "user-1", "draft-1", {
            fields: { name: "김서연", careCenter: false, voucherClient: true, breastPump: false },
            suppressGreetingSms: false,
        });

        expect(result).toEqual({ clientId: 77 });
        expect(clientService.create).toHaveBeenCalledWith("branch-1", expect.objectContaining({
            name: "김서연", careCenter: false, voucherClient: true, breastPump: false,
            suppressGreetingSms: false,
        }));
        expect(prisma.client_draft.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "draft-1" },
            data: expect.objectContaining({ status: "CONFIRMED", clientId: 77, reviewedById: "user-1" }),
        }));
        expect(prisma.call_record.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ matchedClientId: 77 }),
        }));
    });

    it("confirmNewClient: passes 출산일 to ClientService.create", async () => {
        // The create call maps fields one by one, so a column left out of that
        // mapping is silently dropped even when the reviewer filled it in.
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.create.mockResolvedValue({ id: 77 });

        await service.confirmNewClient("branch-1", "user-1", "draft-1", {
            fields: {
                name: "김서연", careCenter: false, voucherClient: true, breastPump: false,
                dueDate: "2026-09-15", birthDate: "2026-08-05",
            },
        });

        expect(clientService.create).toHaveBeenCalledWith("branch-1", expect.objectContaining({
            dueDate: "2026-09-15",
            birthDate: "2026-08-05",
        }));
    });

    it("confirmNewClient: 409 when draft loses the PENDING->CONFIRMING race", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 0 });

        await expect(
            service.confirmNewClient("branch-1", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(ConflictException);
        expect(clientService.create).not.toHaveBeenCalled();
    });

    it("confirmNewClient: rolls the lock back to PENDING when client creation throws", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.create.mockRejectedValue(new Error("areaId invalid"));

        await expect(
            service.confirmNewClient("branch-1", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow("areaId invalid");
        expect(prisma.client_draft.update).toHaveBeenCalledWith({
            where: { id: "draft-1" },
            data: { status: "PENDING", confirmingStartedAt: null },
        });
    });

    it("confirmNewClient: never rolls back to PENDING once the client was created (bookkeeping failure)", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.create.mockResolvedValue({ id: 77 });
        prisma.client_draft.update
            .mockRejectedValueOnce(new Error("db blip"))   // CONFIRMED write fails
            .mockResolvedValueOnce({});                     // re-assert succeeds

        const result = await service.confirmNewClient("branch-1", "user-1", "draft-1", {
            fields: { name: "김서연", careCenter: false, voucherClient: false, breastPump: false },
        });

        expect(result).toEqual({ clientId: 77 });
        const updateCalls = prisma.client_draft.update.mock.calls;
        expect(updateCalls.some(([args]: [{ data: { status?: string } }]) => args.data.status === "PENDING")).toBe(false);
        expect(updateCalls[updateCalls.length - 1]![0].data).toEqual(
            expect.objectContaining({ status: "CONFIRMED", clientId: 77 }),
        );
    });

    it("confirmNewClient: 404 for a draft in another branch", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(null);
        await expect(
            service.confirmNewClient("branch-2", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(NotFoundException);
    });

    it("confirmNewClient: 501 for CLIENT_UPDATE drafts (Phase 2)", async () => {
        prisma.client_draft.findFirst.mockResolvedValue({ ...pendingDraft, type: "CLIENT_UPDATE" });
        await expect(
            service.confirmNewClient("branch-1", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(NotImplementedException);
    });

    // ── confirmClientUpdate / confirm dispatch ────────────────────────────────

    const clientUpdateDraft = {
        ...pendingDraft,
        type: "CLIENT_UPDATE",
        clientId: 142,
    };

    it("confirmClientUpdate: applies allowlisted changes via ClientService.update and marks CONFIRMED", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.update.mockResolvedValue({});
        prisma.client_draft.update.mockResolvedValue({});

        const result = await service.confirm("branch-1", "user-1", "draft-1", {
            changes: { startDate: "2026-06-23", serviceStatus: "replacement_requested", hairColor: "x" },
        });

        expect(result).toEqual({ clientId: 142 });
        // hairColor must be dropped (not in PROPOSAL_FIELDS)
        expect(clientService.update).toHaveBeenCalledWith("branch-1", 142, {
            startDate: "2026-06-23",
            serviceStatus: "replacement_requested",
        });
        expect(prisma.client_draft.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "draft-1" },
            data: expect.objectContaining({ status: "CONFIRMED", reviewedById: "user-1" }),
        }));
    });

    it("confirmClientUpdate: carries 출산일 through the allowlist", async () => {
        // A "아기 낳았어요" call is the one that fills birthDate in. It reaches
        // the client only if PROPOSAL_FIELDS lists it — that set is both what
        // the extraction may propose and what a confirm is filtered against.
        prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.update.mockResolvedValue({});
        prisma.client_draft.update.mockResolvedValue({});

        await service.confirm("branch-1", "user-1", "draft-1", {
            changes: { birthDate: "2026-08-05" },
        });

        expect(clientService.update).toHaveBeenCalledWith("branch-1", 142, {
            birthDate: "2026-08-05",
        });
    });

    it("confirmClientUpdate: 409 when no client linked — clientId check happens BEFORE lock", async () => {
        const unlinkeddraft = { ...clientUpdateDraft, clientId: null };
        prisma.client_draft.findFirst.mockResolvedValue(unlinkeddraft);

        await expect(
            service.confirm("branch-1", "user-1", "draft-1", {
                changes: { startDate: "2026-06-23" },
            }),
        ).rejects.toThrow(ConflictException);
        expect(clientService.update).not.toHaveBeenCalled();
        expect(prisma.client_draft.updateMany).not.toHaveBeenCalled();
    });

    it("confirmClientUpdate: 400 when changes empty after allowlist filtering", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);

        await expect(
            service.confirm("branch-1", "user-1", "draft-1", { changes: { hairColor: "blonde" } }),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.client_draft.updateMany).not.toHaveBeenCalled();
        expect(clientService.update).not.toHaveBeenCalled();
    });

    it("confirmClientUpdate: 409 on lock race (updateMany count 0)", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 0 });

        await expect(
            service.confirm("branch-1", "user-1", "draft-1", { changes: { startDate: "2026-06-23" } }),
        ).rejects.toThrow(ConflictException);
        expect(clientService.update).not.toHaveBeenCalled();
    });

    it("confirmClientUpdate: rolls back to PENDING when ClientService.update throws", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.update.mockRejectedValue(new Error("serviceStatus invalid"));

        await expect(
            service.confirm("branch-1", "user-1", "draft-1", { changes: { startDate: "2026-06-23" } }),
        ).rejects.toThrow("serviceStatus invalid");
        expect(prisma.client_draft.update).toHaveBeenCalledWith({
            where: { id: "draft-1" },
            data: { status: "PENDING", confirmingStartedAt: null },
        });
    });

    it("confirmClientUpdate: stays CONFIRMED-path when bookkeeping fails after successful update", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.update.mockResolvedValue({});
        prisma.client_draft.update
            .mockRejectedValueOnce(new Error("db blip"))  // CONFIRMED write fails
            .mockResolvedValueOnce({});                    // re-assert succeeds

        const result = await service.confirm("branch-1", "user-1", "draft-1", {
            changes: { startDate: "2026-06-23" },
        });

        expect(result).toEqual({ clientId: 142 });
        const updateCalls = prisma.client_draft.update.mock.calls;
        expect(updateCalls.some(([args]: [{ data: { status?: string } }]) => args.data.status === "PENDING")).toBe(false);
        expect(updateCalls[updateCalls.length - 1]![0].data).toEqual(
            expect.objectContaining({ status: "CONFIRMED" }),
        );
    });

    describe("confirmApprovedTarget CLIENT_UPDATE preparation", () => {
        const expectedVersion = () => createHash("sha256").update(JSON.stringify(clientUpdateDraft)).digest("hex");

        it("rejects a null client linkage before claiming the draft", async () => {
            const draft = { ...clientUpdateDraft, clientId: null };
            prisma.client_draft.findFirst.mockResolvedValue(draft);

            await expect(service.confirmApprovedTarget("branch-1", "user-1", "draft-1", {
                changes: { startDate: "2026-06-23" },
            }, createHash("sha256").update(JSON.stringify(draft)).digest("hex"))).rejects.toThrow(ConflictException);

            expect(prisma.client_draft.updateMany).not.toHaveBeenCalled();
            expect(clientService.update).not.toHaveBeenCalled();
        });

        it("rejects unsupported-only changes before claiming the draft", async () => {
            prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);

            await expect(service.confirmApprovedTarget("branch-1", "user-1", "draft-1", {
                changes: { hairColor: "blonde" },
            }, expectedVersion())).rejects.toThrow(BadRequestException);

            expect(prisma.client_draft.updateMany).not.toHaveBeenCalled();
            expect(clientService.update).not.toHaveBeenCalled();
        });

        it("rejects an unknown draft type before claiming the draft", async () => {
            const draft = { ...clientUpdateDraft, type: "UNSUPPORTED" };
            prisma.client_draft.findFirst.mockResolvedValue(draft);

            await expect(service.confirmApprovedTarget("branch-1", "user-1", "draft-1", {
                changes: { startDate: "2026-06-23" },
            }, createHash("sha256").update(JSON.stringify(draft)).digest("hex"))).rejects.toThrow(BadRequestException);

            expect(prisma.client_draft.updateMany).not.toHaveBeenCalled();
            expect(clientService.update).not.toHaveBeenCalled();
        });

        it("rejects a target-version mismatch before claiming the draft", async () => {
            prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);

            await expect(service.confirmApprovedTarget("branch-1", "user-1", "draft-1", {
                changes: { startDate: "2026-06-23" },
            }, "stale-version")).rejects.toThrow(ConflictException);

            expect(prisma.client_draft.updateMany).not.toHaveBeenCalled();
            expect(clientService.update).not.toHaveBeenCalled();
        });

        it("validates, claims, and confirms the prepared changes", async () => {
            prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);
            prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
            clientService.update.mockResolvedValue({});

            await expect(service.confirmApprovedTarget("branch-1", "user-1", "draft-1", {
                changes: { startDate: "2026-06-23", hairColor: "ignored" },
            }, expectedVersion())).resolves.toEqual({ clientId: 142 });

            expect(prisma.client_draft.updateMany).toHaveBeenCalledWith({
                where: { id: "draft-1", branchId: "branch-1", status: "PENDING" },
                data: { status: "CONFIRMING", confirmingStartedAt: expect.any(Date) },
            });
            expect(clientService.update).toHaveBeenCalledWith("branch-1", 142, { startDate: "2026-06-23" });
            expect(prisma.client_draft.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: "draft-1" },
                data: expect.objectContaining({ status: "CONFIRMED", reviewedById: "user-1" }),
            }));
        });

        it("rolls a claimed draft back to PENDING when the client update fails", async () => {
            prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);
            prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
            clientService.update.mockRejectedValue(new Error("serviceStatus invalid"));

            await expect(service.confirmApprovedTarget("branch-1", "user-1", "draft-1", {
                changes: { serviceStatus: "invalid" },
            }, expectedVersion())).rejects.toThrow("serviceStatus invalid");

            expect(prisma.client_draft.update).toHaveBeenCalledWith({
                where: { id: "draft-1" },
                data: { status: "PENDING", confirmingStartedAt: null },
            });
        });

        it("contains bookkeeping failure after an approved client update", async () => {
            prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);
            prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
            clientService.update.mockResolvedValue({});
            prisma.client_draft.update
                .mockRejectedValueOnce(new Error("db blip"))
                .mockResolvedValueOnce({});

            await expect(service.confirmApprovedTarget("branch-1", "user-1", "draft-1", {
                changes: { startDate: "2026-06-23" },
            }, expectedVersion())).resolves.toEqual({ clientId: 142 });

            const updateCalls = prisma.client_draft.update.mock.calls;
            expect(updateCalls.some(([args]: [{ data: { status?: string } }]) => args.data.status === "PENDING")).toBe(false);
            expect(updateCalls[updateCalls.length - 1]![0].data).toEqual(
                expect.objectContaining({ status: "CONFIRMED", confirmingStartedAt: null }),
            );
        });
    });

    it("confirm dispatch: NEW_CLIENT without fields → 400", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);

        await expect(
            service.confirm("branch-1", "user-1", "draft-1", { changes: { startDate: "2026-06-23" } }),
        ).rejects.toThrow(BadRequestException);
    });

    it("confirm dispatch: CLIENT_UPDATE without changes → 400", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(clientUpdateDraft);

        await expect(
            service.confirm("branch-1", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(BadRequestException);
    });

    it("discard: PENDING → DISCARDED with reason; 409 when already reviewed", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });

        await service.discard("branch-1", "user-1", "draft-1", "오인식");
        expect(prisma.client_draft.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: "DISCARDED", discardReason: "오인식", reviewedById: "user-1" }),
        }));

        prisma.client_draft.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.discard("branch-1", "user-1", "draft-1", undefined)).rejects.toThrow(ConflictException);
    });

    it("listDrafts: computes hasLowConfidence, possibleDuplicate and phoneMatchesExistingClient", async () => {
        const rowBase = {
            ...pendingDraft,
            client: null,
            createdAt: new Date("2026-06-10T05:10:00Z"),
            callRecord: { id: "rec-1", callerPhone: "01048217763", callerName: "김서연", recordedAt: null },
        };
        prisma.client_draft.findMany.mockResolvedValue([
            { ...rowBase, proposals: [{ field: "address", value: "부평구", evidence: "e", confidence: "low" }] },
            {
                ...rowBase, id: "draft-2", callRecordId: "rec-2",
                callRecord: { id: "rec-2", callerPhone: "01048217763", callerName: "김서연", recordedAt: null },
            },
        ]);
        prisma.client_draft.count.mockResolvedValue(2);
        prisma.client.findMany.mockResolvedValue([{ id: 9, phone: "010-4821-7763" }]);

        const result = await service.listDrafts("branch-1", "PENDING", 1, 20);

        expect(result.data[0]!.hasLowConfidence).toBe(true);
        expect(result.data[0]!.possibleDuplicate).toBe(true);
        expect(result.data[0]!.phoneMatchesExistingClient).toBe(true);
        expect(result.total).toBe(2);
        expect(result.totalPages).toBe(1);
    });

    it("patchDraftApprovedTarget mutates only when the locked draft still matches", async () => {
        const draft = {
            id: "draft-atomic",
            branchId: "branch-1",
            status: "PENDING",
            proposals: [],
            updatedAt: new Date("2026-08-04T00:00:00.000Z"),
        };
        prisma.client_draft.findFirst.mockResolvedValue(draft);
        prisma.client_draft.update.mockResolvedValue({});
        const expected = createHash("sha256").update(JSON.stringify(draft)).digest("hex");

        await service.patchDraftApprovedTarget("branch-1", "draft-atomic", { proposals: [] }, expected);

        expect(prisma.client_draft.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "draft-atomic" },
            data: { proposals: [] },
        }));
    });

    it("patchDraftApprovedTarget rejects an interleaved target change before any mutation", async () => {
        const original = {
            id: "draft-race",
            branchId: "branch-1",
            status: "PENDING",
            proposals: [],
            updatedAt: new Date("2026-08-04T00:00:00.000Z"),
        };
        const changed = { ...original, proposals: [{ field: "name", value: "changed" }] };
        prisma.client_draft.findFirst.mockResolvedValue(changed);
        const expected = createHash("sha256").update(JSON.stringify(original)).digest("hex");

        await expect(service.patchDraftApprovedTarget("branch-1", "draft-race", { proposals: [] }, expected))
            .rejects.toThrow(ConflictException);
        expect(prisma.client_draft.update).not.toHaveBeenCalled();
    });
});
