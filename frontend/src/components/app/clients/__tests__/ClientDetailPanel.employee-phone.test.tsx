import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { ClientDetailPanel } from "../ClientDetailPanel";
import type { Client } from "@/lib/client/types";
import { eformsignApi } from "@/services/api";

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: () => "ko",
}));

jest.mock("@/features/clients/hooks/use-clients", () => ({
    useApproveScheduleChange: () => ({ isPending: false, mutateAsync: jest.fn() }),
    useRejectScheduleChange: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
    useMessageHistory: () => ({ data: [], isError: false, isLoading: false }),
}));

jest.mock("@/features/service-records/hooks/use-service-records", () => ({
    useClientServiceRecords: () => ({ data: undefined, isError: false, isLoading: false }),
}));

jest.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: {
        getDocumentsByClientId: jest.fn().mockResolvedValue([]),
    },
}));

const mockGetDocumentsByClientId = eformsignApi.getDocumentsByClientId as jest.Mock;

jest.mock("@/components/app/messages/MessageHistoryDetailPanel", () => ({
    getMessageHistoryTimestamp: () => "",
    MessageHistoryDetailPanel: () => null,
    MESSAGE_HISTORY_STATUS_META: {},
    normalizeMessageHistoryRecord: (record: unknown) => record,
}));

jest.mock("../ClientServiceRecordsTab", () => ({
    ClientServiceRecordsTab: () => null,
}));

jest.mock("@/components/app/v3", () => ({
    AnimatedSlotList: () => null,
    AnimatedSlotListItemContent: () => null,
    DetailEmptyState: () => null,
    DetailPanel: ({ children }: { children: ReactNode }) => <main>{children}</main>,
    DetailTabPanels: ({
        activeTab,
        panels,
    }: {
        activeTab: string;
        panels: Array<{ key: string; children: ReactNode }>;
    }) => <>{panels.find((panel) => panel.key === activeTab)?.children}</>,
    DetailTabs: () => null,
    InfoCard: ({ children }: { children: ReactNode }) => <section>{children}</section>,
    InfoRow: ({ label, value }: { label: string; value: ReactNode }) => (
        <div>
            <span>{label}</span>
            <span>{value}</span>
        </div>
    ),
    StatusBadge: () => null,
}));

const client: Client = {
    id: 1,
    name: "고객",
    birthday: null,
    dueDate: null,
    address: null,
    phone: null,
    primaryEmployee: {
        id: 10,
        name: "주 담당 인력",
        phone: "01011112222",
    },
    secondaryEmployee: {
        id: 20,
        name: "보조 담당 인력",
        phone: "01033334444",
    },
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: null,
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
};

describe("ClientDetailPanel employee phones", () => {
    beforeEach(() => {
        mockGetDocumentsByClientId.mockReset().mockResolvedValue([]);
    });

    function renderPanel(detailClient: Client = client) {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });

        return {
            ...render(
            <QueryClientProvider client={queryClient}>
                <ClientDetailPanel client={detailClient} trailing={null} />
            </QueryClientProvider>,
            ),
            queryClient,
        };
    }

    it("should render both currently assigned employee phone numbers", () => {
        renderPanel();

        expect(screen.getByText("주 담당 인력 연락처")).toBeInTheDocument();
        expect(screen.getByText("010-1111-2222")).toBeInTheDocument();
        expect(screen.getByText("보조 담당 인력 연락처")).toBeInTheDocument();
        expect(screen.getByText("010-3333-4444")).toBeInTheDocument();
    });

    it("should show employee phone rows with a dash when phone numbers are missing", () => {
        renderPanel({
            ...client,
            primaryEmployee: {
                ...client.primaryEmployee!,
                phone: null,
            },
            secondaryEmployee: null,
        });

        expect(screen.getByText("주 담당 인력 연락처").closest("div")).toHaveTextContent("-");
        expect(screen.getByText("보조 담당 인력 연락처").closest("div")).toHaveTextContent("-");
    });

    it("exposes the stored local contract status without a remote sync", async () => {
        mockGetDocumentsByClientId.mockResolvedValueOnce([{
            documentId: "contract-document-1",
            createdDate: "2026-07-18",
            updatedDate: "2026-07-18",
            statusType: "doc_tempsave",
            statusDetail: "대기",
            stepType: "participant",
            stepIndex: "0",
            stepName: "이용자",
            stepRecipientType: "sms",
            stepRecipientName: "고객",
            stepRecipientSms: "01027700718",
            expiredDate: "",
            expired: false,
            clientId: client.id,
            documentKind: "contract",
            employeeScheduleId: null,
            templateId: null,
        }]);
        const { queryClient } = renderPanel();

        await waitFor(() => expect(queryClient.getQueryData(["eformsign-docs", "client", client.id])).toEqual([
            expect.objectContaining({
                documentId: "contract-document-1",
                statusDetail: "대기",
                stepName: "이용자",
            }),
        ]));
    });

    it("falls back to the client document status for its current local document", async () => {
        mockGetDocumentsByClientId.mockResolvedValueOnce([{
            documentId: "contract-document-1",
            createdDate: "2026-07-18",
            updatedDate: "2026-07-18",
            statusType: "doc_tempsave",
            statusDetail: "대기",
            stepType: "participant",
            stepIndex: "0",
            stepName: "이용자",
            stepRecipientType: "sms",
            stepRecipientName: "고객",
            stepRecipientSms: "01027700718",
            expiredDate: "",
            expired: false,
            clientId: client.id,
            documentKind: "contract",
            employeeScheduleId: null,
            templateId: null,
        }]);
        const { queryClient } = renderPanel({
            ...client,
            eDocId: "contract-document-1",
            documentStatus: "requested",
        });

        await waitFor(() => expect(queryClient.getQueryData(["eformsign-docs", "client", client.id])).toEqual([
            expect.objectContaining({
                documentId: "contract-document-1",
                statusDetail: "검토 필요",
                stepName: "검토 필요",
            }),
        ]));
    });
});
