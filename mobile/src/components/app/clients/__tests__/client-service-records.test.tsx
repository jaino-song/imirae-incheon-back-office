import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ClientServiceRecords } from "../client-service-records";
import type { Client } from "@/lib/client/types";
import type {
    ServiceRecordAssignment,
    ServiceRecordCase,
    ServiceRecordOverview,
} from "@babyjamjam/shared/types/service-record";

const mockMutateAsync = jest.fn();
const TEST_COMPONENT =
    "mobile_clients_detail-sheet_stack_detail-page_content_tab-panel_service-records_content";

jest.mock("@/hooks/useServiceRecords", () => ({
    useSendServiceRecordLink: () => ({
        isPending: false,
        mutateAsync: mockMutateAsync,
    }),
}));

jest.mock("@/hooks/use-toast", () => ({
    toast: jest.fn(),
}));

const client = {
    id: 100,
    name: "고명순",
} as Client;

function createAssignment(
    scheduleId: number,
    status: ServiceRecordAssignment["link"]["status"],
    sessions: ServiceRecordAssignment["sessions"] = [],
): ServiceRecordAssignment {
    return {
        scheduleId,
        startDate: "2099-07-16T00:00:00+09:00",
        endDate: "2099-07-30T00:00:00+09:00",
        replaced: false,
        employee: {
            id: scheduleId,
            name: `제공${scheduleId}`,
            phone: "01012345678",
        },
        link: {
            status,
            scheduledFor: status === "scheduled" ? "2099-07-16T15:00:00+09:00" : null,
            sentCount: status === "none" ? 0 : 1,
            lastSentAt: status === "sent" ? "2099-07-16T15:02:00+09:00" : null,
            token: status === "none" ? null : {
                issuedAt: "2099-07-16T15:00:00+09:00",
                verifiedAt: status === "sent" ? "2099-07-16T15:10:00+09:00" : null,
                expiresAt: "2099-07-30T20:00:00+09:00",
                state: "active",
            },
        },
        header: null,
        totalSessions: Math.max(1, sessions.length),
        sessions,
        signatureDoc: null,
    };
}

function createRecord(status: string): ServiceRecordCase {
    return {
        id: "record-1",
        status,
        startDate: "2099-07-16T00:00:00+09:00",
        endDate: "2099-07-30T00:00:00+09:00",
        totalSessions: 1,
        completedAt: "2099-07-30T18:00:00+09:00",
        finalizationDueAt: null,
        finalizedAt: "2099-07-30T18:30:00+09:00",
        documentsCompletedAt: "2099-07-30T19:00:00+09:00",
        lastError: null,
        header: null,
        sessions: [],
        signatureDocs: [],
    };
}

function renderComponent(
    overview: ServiceRecordOverview,
    options: { isRefreshing?: boolean; onRefresh?: () => void } = {},
) {
    return render(
        <ClientServiceRecords
            data-component={TEST_COMPONENT}
            client={client}
            activeTab="serviceRecords"
            overview={overview}
            isLoading={false}
            isError={false}
            isRefreshing={options.isRefreshing}
            onRefresh={options.onRefresh}
        />,
    );
}

describe("ClientServiceRecords", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockMutateAsync.mockResolvedValue(undefined);
    });

    it("renders the main link states", () => {
        renderComponent({
            assignments: [
                createAssignment(1, "none"),
                createAssignment(2, "sent"),
                createAssignment(3, "failed"),
            ],
        });

        expect(screen.getByText("발송 전")).toBeInTheDocument();
        expect(screen.getByText("발송됨")).toBeInTheDocument();
        expect(screen.getByText("발송 실패")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "링크 수동 전송" })).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "메시지 재전송" })).toHaveLength(2);
        expect(screen.queryAllByText(/메시지 재전송 시/)).toHaveLength(0);
    });

    it("uses the document lifecycle as the visible status once a record exists", () => {
        const { container } = renderComponent({
            record: createRecord("COMPLETED"),
            assignments: [createAssignment(1, "sent")],
        });

        const statusCard = container.querySelector(
            `[data-component="${TEST_COMPONENT}_status-card"]`,
        );

        expect(statusCard).toHaveTextContent("제공기록지 진행 상태");
        expect(statusCard).toHaveTextContent("완료");
        expect(statusCard).toHaveTextContent("전자문서 생성");
        expect(screen.queryByText("발송됨")).not.toBeInTheDocument();
    });

    it("maps completed signature status text to desktop-equivalent label", () => {
        const record = createRecord("COMPLETED");
        record.signatureDocs = [{
            documentId: "service-record-document-1",
            statusDetail: "COMPLETED",
            stepName: "완료",
            createdDate: "2099-07-30T18:30:00+09:00",
            updatedDate: "2099-07-30T19:00:00+09:00",
            snapshotChunkIndex: 1,
        }];

        const { container } = renderComponent({
            record,
            assignments: [createAssignment(1, "sent")],
        });

        const documentCard = container.querySelector(
            `[data-component="${TEST_COMPONENT}_signature-card"]`,
        );

        expect(documentCard).toHaveTextContent("제공기록지 전자문서 1");
        expect(documentCard).toHaveTextContent("서명 완료");
        expect(documentCard).toHaveTextContent("service-record-document-1");
    });

    it("normalizes uppercase completed document statuses", () => {
        const record = createRecord("COMPLETED");
        record.signatureDocs = [{
            documentId: "service-record-document-uppercase",
            statusDetail: "COMPLETED",
            stepName: "완료",
            createdDate: "2099-07-30T18:30:00+09:00",
            updatedDate: "2099-07-30T19:00:00+09:00",
            snapshotChunkIndex: 1,
        }];

        renderComponent({ record, assignments: [createAssignment(1, "sent")] });

        expect(screen.getByText("서명 완료")).toBeInTheDocument();
        expect(screen.queryByText("COMPLETED")).not.toBeInTheDocument();
    });

    it("shows the document lifecycle even when no assignment remains", () => {
        renderComponent({
            record: createRecord("DOCUMENTS_CREATED"),
            assignments: [],
        });

        expect(screen.getByText("기관 검토 중")).toBeInTheDocument();
        expect(screen.queryByText("제공기록지 배정 정보가 없습니다.")).not.toBeInTheDocument();
    });

    it("places the refresh action before the submission progress and refreshes the data", async () => {
        const user = userEvent.setup();
        const onRefresh = jest.fn();
        renderComponent({
            assignments: [createAssignment(1, "sent")],
        }, { onRefresh });

        const refreshButton = screen.getByRole("button", { name: "제공기록 새로고침" });
        const progress = screen.getByText("0/1 제출완료");

        expect(
            refreshButton.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        await user.click(refreshButton);

        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("opens a confirmation modal before resending a link", async () => {
        const user = userEvent.setup();
        renderComponent({
            assignments: [
                createAssignment(2, "sent"),
            ],
        });

        await user.click(screen.getByRole("button", { name: "메시지 재전송" }));

        expect(screen.getByRole("dialog", { name: "제공기록지 메시지를 재전송하시겠습니까?" })).toBeInTheDocument();
        expect(screen.getByText("기존 링크가 그대로 포함된 메시지를 다시 전송합니다.")).toBeInTheDocument();
        expect(mockMutateAsync).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "메시지 재전송" }));

        await waitFor(() => {
            expect(mockMutateAsync).toHaveBeenCalledWith({
                scheduleId: 2,
                clientId: 100,
            });
        });
    });

    it("opens a submitted session detail from the session list", async () => {
        const user = userEvent.setup();
        renderComponent({
            assignments: [
                createAssignment(1, "sent", [
                    {
                        sessionIndex: 1,
                        serviceDate: "2099-07-16T00:00:00+09:00",
                        locked: true,
                        submittedAt: "2099-07-16T18:42:00+09:00",
                        updatedAt: "2099-07-16T18:42:00+09:00",
                        answers: {
                            perineum: ["열상"],
                            breast: ["이상없음"],
                            meals_meal: 3,
                            meals_snack: 1,
                        },
                        etcService: "피부 트러블 없음",
                        notes: "산모 회복 양호",
                        paymentConfirmed: true,
                        hasMomApproval: true,
                    },
                ]),
            ],
        });

        await user.click(screen.getByText(/1회차 ·/));

        expect(screen.getByText("1회차 제공기록")).toBeInTheDocument();
        const backButton = screen.getByRole("button", { name: "목록으로" });
        expect(backButton).toBeInTheDocument();
        expect(backButton.querySelector("span")).toHaveTextContent("‹");
        expect(screen.getByText("완료")).toBeInTheDocument();
        expect(screen.queryByText("✓ 완료")).not.toBeInTheDocument();
    });

    it("opens an empty detail for an unsubmitted session", async () => {
        const user = userEvent.setup();
        renderComponent({
            assignments: [
                createAssignment(1, "sent"),
            ],
        });

        await user.click(screen.getByRole("button", { name: /1회차/ }));

        expect(screen.getByText("1회차 제공기록")).toBeInTheDocument();
        expect(screen.getAllByText("-").length).toBeGreaterThan(0);
        expect(screen.getByRole("button", { name: "목록으로" })).toBeInTheDocument();
    });

    it("resets the mobile detail scroll before opening a session", async () => {
        const user = userEvent.setup();
        const animationFrame = jest.spyOn(window, "requestAnimationFrame")
            .mockImplementation((callback) => {
                callback(0);
                return 1;
            });

        const { container } = render(
            <div className="detail-body">
                <ClientServiceRecords
                    data-component={TEST_COMPONENT}
                    client={client}
                    activeTab="serviceRecords"
                    overview={{ assignments: [createAssignment(1, "sent")] }}
                    isLoading={false}
                    isError={false}
                />
            </div>,
        );
        const scrollContainer = container.querySelector(".detail-body") as HTMLDivElement;
        scrollContainer.scrollTop = 480;

        await user.click(screen.getByRole("button", { name: /1회차/ }));

        expect(scrollContainer.scrollTop).toBe(0);
        expect(screen.getByText("1회차 제공기록")).toBeInTheDocument();
        animationFrame.mockRestore();
    });
});
