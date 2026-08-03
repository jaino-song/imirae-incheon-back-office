import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EmployeeScheduleAgentCapabilitiesProvider } from "application/usecases/employee-schedule/employee-schedule-agent-capabilities.provider";
import { EmployeeAgentCapabilitiesProvider } from "application/usecases/employee/employee-agent-capabilities.provider";
import { VoucherAgentCapabilitiesProvider } from "application/usecases/voucher-price-info/voucher-agent-capabilities.provider";
import { BankAccountAgentCapabilitiesProvider } from "application/usecases/bank-account-info/bank-account-agent-capabilities.provider";
import { EformsignAgentCapabilitiesProvider } from "application/usecases/eformsign-doc/eformsign-agent-capabilities.provider";

const context = {
    principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
    sessionId: "session-a", traceId: "trace-a", locale: "ko",
};

describe("Release A domain read capabilities", () => {
    it("keeps employee contact data out of the model result", async () => {
        const list = { execute: jest.fn().mockResolvedValue([{ id: 1, name: "관리사", phone: "010-1234-5678", grade: "A", workArea: ["서울"], openToNextWork: true }]) };
        const find = { execute: jest.fn() };
        const provider = new EmployeeAgentCapabilitiesProvider(list as never, find as never);
        const capability = provider.getCapabilities().find(({ meta }) => meta.name === "employees.search")!;
        const output = await capability.execute(context, { query: "서울" });
        expect(output).toEqual({ employees: [{ id: 1, name: "관리사", grade: "A", workArea: ["서울"], openToNextWork: true }] });
        expect(list.execute).toHaveBeenCalledWith("branch-a");
    });

    it("filters schedules by date without returning work addresses", async () => {
        const list = { execute: jest.fn().mockResolvedValue([{ id: 1, clientId: 10, primaryEmployeeId: 2, secondaryEmployeeId: null, workAddress: "비공개", startDate: new Date("2026-08-01T00:00:00Z"), endDate: new Date("2026-08-10T00:00:00Z"), replaced: false }]) };
        const provider = new EmployeeScheduleAgentCapabilitiesProvider(list as never);
        const capability = provider.getCapabilities()[0]!;
        const output = await capability.execute(context, { date: "2026-08-03" });
        expect(output).toMatchObject({ schedules: [{ id: 1, clientId: 10 }] });
        expect(JSON.stringify(output)).not.toContain("비공개");
        expect(list.execute).toHaveBeenCalledWith("branch-a");
    });

    it("orders filtered schedules by start date, end date, and id before limiting the result", async () => {
        const schedule = (id: number, startDate: string, endDate: string) => ({
            id,
            clientId: id,
            primaryEmployeeId: 2,
            secondaryEmployeeId: null,
            startDate: new Date(`${startDate}T00:00:00Z`),
            endDate: new Date(`${endDate}T00:00:00Z`),
            replaced: false,
        });
        const nonMatching = [
            schedule(1, "2026-07-01", "2026-07-02"),
            schedule(2, "2026-08-20", "2026-08-21"),
        ];
        const firstEndDateGroup = Array.from({ length: 20 }, (_, index) => schedule(200 + index + 1, "2026-08-01", "2026-08-09"));
        const secondEndDateGroup = Array.from({ length: 20 }, (_, index) => schedule(100 + index + 1, "2026-08-01", "2026-08-10"));
        const laterStartDateGroup = Array.from({ length: 20 }, (_, index) => schedule(300 + index + 1, "2026-08-02", "2026-08-03"));
        const list = {
            execute: jest.fn().mockResolvedValue([
                ...laterStartDateGroup.slice().reverse(),
                ...nonMatching,
                ...secondEndDateGroup.slice().reverse(),
                ...firstEndDateGroup.slice().reverse(),
            ]),
        };
        const provider = new EmployeeScheduleAgentCapabilitiesProvider(list as never);
        const capability = provider.getCapabilities()[0]!;

        const output = await capability.execute(context, { date: "2026-08-03" }) as { schedules: Array<{ id: number }> };

        expect(output.schedules).toHaveLength(50);
        expect(output.schedules.map(({ id }) => id)).toEqual([
            ...Array.from({ length: 20 }, (_, index) => 201 + index),
            ...Array.from({ length: 20 }, (_, index) => 101 + index),
            ...Array.from({ length: 10 }, (_, index) => 301 + index),
        ]);
        expect(output.schedules.some(({ id }) => id === 1 || id === 2)).toBe(false);
    });

    it("serializes bigint voucher durations for the UI contract", async () => {
        const list = { execute: jest.fn().mockResolvedValue([{ id: 1, type: "A", duration: BigInt(10), fullPrice: "100", grant: "50", actualPrice: "50", year: 2026 }]) };
        const provider = new VoucherAgentCapabilitiesProvider(list as never);
        const output = await provider.getCapabilities()[0]!.execute(context, { year: 2026 });
        expect(output).toEqual({ items: [{ id: 1, type: "A", duration: "10", fullPrice: "100", grant: "50", actualPrice: "50", year: 2026 }] });
    });

    it("masks bank account numbers before model execution", async () => {
        const list = { executeForBranch: jest.fn().mockResolvedValue([{ area: "서울", bankName: "은행", accNum: "123-456-7890" }]) };
        const provider = new BankAccountAgentCapabilitiesProvider(list as never);
        const output = await provider.getCapabilities()[0]!.execute(context, {});
        expect(output).toEqual({ accounts: [{ area: "서울", bankName: "은행", accountLast4: "7890" }] });
        expect(list.executeForBranch).toHaveBeenCalledWith("branch-a");
    });

    it("uses branch-scoped active contract rows and the shared display classifier", async () => {
        const active = EformsignDocEntity.create({
            documentId: "doc-active", documentName: "계약서", createdDate: new Date("2026-08-01T00:00:00Z"),
            statusType: "050", statusDetail: "완료", stepType: "05", stepIndex: "1", stepName: "이용자",
            stepRecipientType: "05", stepRecipientName: "이용자", stepRecipientSms: "010-0000-0000", expiredDate: new Date("2026-12-01T00:00:00Z"), expired: false, clientId: 10,
        });
        const deleted = EformsignDocEntity.create({
            documentId: "doc-deleted", createdDate: new Date("2026-08-01T00:00:00Z"), statusType: "deleted", statusDetail: "삭제", stepType: "05", stepIndex: "1", stepName: "이용자",
            stepRecipientType: "05", stepRecipientName: "이용자", stepRecipientSms: "010-0000-0000", expiredDate: new Date("2026-12-01T00:00:00Z"), expired: false, clientId: 10,
        });
        const find = { execute: jest.fn().mockResolvedValue([active, deleted]) };
        const provider = new EformsignAgentCapabilitiesProvider(find as never);
        const output = await provider.getCapabilities()[0]!.execute(context, { clientId: 10 });
        expect(output).toMatchObject({ documents: [{ documentId: "doc-active", status: "completed" }] });
        expect(find.execute).toHaveBeenCalledWith("branch-a", 10);
    });
});
