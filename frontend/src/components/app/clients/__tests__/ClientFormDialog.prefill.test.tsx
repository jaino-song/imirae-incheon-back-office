import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { Client } from "@/lib/client/types";

import { ClientFormDialog } from "../ClientFormDialog";

let mockVoucherPriceInfos = [
    {
        id: 1,
        type: "A가1형",
        duration: "10",
        fullPrice: "1,464,000",
        grant: "1,002,000",
        actualPrice: "462,000",
    },
];

const mockOutOfPocketPriceInfos = [
    { id: 1, duration: 5, fullPrice: "815000" },
    { id: 2, duration: 10, fullPrice: "1620000" },
    { id: 3, duration: 15, fullPrice: "2425000" },
    { id: 4, duration: 20, fullPrice: "3240000" },
];

jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
    useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
    useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
    useVoucherPriceInfos: (type: string) => ({
        data: type ? mockVoucherPriceInfos : [],
        isLoading: false,
    }),
    useVoucherYears: () => ({ data: [2025, 2026], isLoading: false }),
    useOutOfPocketPriceInfos: () => ({
        data: mockOutOfPocketPriceInfos,
        isLoading: false,
        isError: false,
    }),
}));

jest.mock("@/stores/client-dialog-store", () => {
    const state = { prefillName: "", clearPrefillName: jest.fn() };

    return {
        useClientDialogStore: (selector: (value: typeof state) => unknown) => selector(state),
    };
});

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: () => "ko",
}));

jest.mock("../EmployeeAutocomplete", () => ({
    EmployeeAutocomplete: () => <div data-testid="employee-autocomplete" />,
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
    EmployeeFormDialog: () => null,
}));

jest.mock("@/lib/api/client", () => ({
    api: {
        get: jest.fn(),
    },
}));

const createClient = (overrides: Partial<Client> = {}): Client => ({
    id: 1,
    name: "저장된 고객",
    createdAt: "2026-01-01",
    birthday: "900101",
    dueDate: "2026-09-01",
    birthDate: null,
    address: "인천시 서구",
    phone: "010-1111-2222",
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: 10,
    fullPrice: "1500000",
    grant: "0",
    actualPrice: "1500000",
    startDate: "2026-08-01",
    endDate: "2026-08-05",
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: "waiting",
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
    ...overrides,
});

describe("ClientFormDialog prefill", () => {
    beforeEach(() => {
        mockVoucherPriceInfos = [
            {
                id: 1,
                type: "A가1형",
                duration: "10",
                fullPrice: "1,464,000",
                grant: "1,002,000",
                actualPrice: "462,000",
            },
        ];
    });

    it("applies create-mode prefill and preserves its price when duration unlocks pricing", async () => {
        render(
            <ClientFormDialog
                open
                onClose={jest.fn()}
                prefill={{
                    startDate: "2026-08-10",
                    fullPrice: "1000000",
                    grant: "",
                    actualPrice: "",
                }}
            />,
        );

        await waitFor(() => expect(screen.getByLabelText("시작일")).toHaveValue("260810"));

        fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "10" } });

        await waitFor(() => expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("1,000,000"));
    });

    it("uses stored client values instead of create-mode prefill in edit mode", async () => {
        render(
            <ClientFormDialog
                open
                client={createClient()}
                onClose={jest.fn()}
                prefill={{
                    startDate: "2026-08-10",
                    fullPrice: "1000000",
                    grant: "",
                    actualPrice: "",
                }}
            />,
        );

        await waitFor(() => {
            expect(screen.getByLabelText("시작일")).toHaveValue("260801");
            expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("1,500,000");
        });
        expect(screen.getByLabelText("시작일")).not.toHaveValue("260810");
        expect(screen.getByLabelText("총 서비스 금액")).not.toHaveValue("1,000,000");
    });

    it("auto-computes the end date for create-mode start date and duration prefill", async () => {
        render(
            <ClientFormDialog
                open
                onClose={jest.fn()}
                prefill={{ startDate: "2026-08-10", duration: 10 }}
            />,
        );

        await waitFor(() => expect(screen.getByLabelText("종료일")).not.toHaveValue(""));
    });

    it("applies a phone when prefill arrives after the dialog is already open", async () => {
        const { rerender } = render(
            <ClientFormDialog open onClose={jest.fn()} />,
        );

        rerender(
            <ClientFormDialog
                open
                onClose={jest.fn()}
                prefill={{ phone: "010-9876-5432" }}
            />,
        );

        await waitFor(() => expect(screen.getByLabelText("연락처")).toHaveValue("010-9876-5432"));
    });
});
