import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ClientServiceRecordsTab } from "../ClientServiceRecordsTab";
import type {
    ServiceRecordAssignment,
    ServiceRecordOverview,
    ServiceRecordSession,
} from "@/features/service-records/types";

const mutateAsync = jest.fn();
const toast = jest.fn();
const TEST_COMPONENT = "desktop_clients-detail_panel_service-records";

jest.mock("@/features/service-records/hooks/use-service-records", () => ({
    useSendServiceRecordLink: () => ({
        isPending: false,
        mutateAsync,
    }),
}));

jest.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast }),
}));

function createAssignment(
    scheduleId: number,
    status: ServiceRecordAssignment["link"]["status"],
): ServiceRecordAssignment {
    return {
        scheduleId,
        startDate: "2026-07-01T00:00:00.000Z",
        endDate: "2026-07-05T00:00:00.000Z",
        replaced: false,
        employee: {
            id: scheduleId,
            name: `제공${scheduleId}`,
            phone: "01012345678",
        },
        link: {
            status,
            scheduledFor: status === "scheduled" ? "2026-07-01T15:00:00+09:00" : null,
            sentCount: status === "sent" ? 1 : 0,
            lastSentAt: status === "sent" ? "2026-07-01T15:02:00+09:00" : null,
            token: {
                issuedAt: "2026-07-01T14:00:00+09:00",
                verifiedAt: status === "sent" ? "2026-07-01T15:10:00+09:00" : null,
                expiresAt: "2026-07-05T20:00:00+09:00",
                state: "active",
            },
        },
        header: null,
        totalSessions: 1,
        sessions: [],
        signatureDoc: null,
    };
}

function createSession(sessionIndex: number): ServiceRecordSession {
    const serviceDate = sessionIndex === 1 ? "2026-07-01" : "2026-07-02";
    return {
        sessionIndex,
        serviceDate: `${serviceDate}T00:00:00.000Z`,
        locked: false,
        submittedAt: null,
        updatedAt: `${serviceDate}T10:00:00.000Z`,
        answers: {},
        etcService: null,
        notes: null,
        paymentConfirmed: false,
        hasMomApproval: false,
    };
}

describe("ClientServiceRecordsTab", () => {
    beforeEach(() => {
        mutateAsync.mockReset();
        toast.mockReset();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("keeps the service-record card containers mounted while loading", () => {
        const { container } = render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                clientId={100}
                isLoading
                isError={false}
            />,
        );

        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}"]`),
        ).toBeInTheDocument();
        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_overview-grid"]`),
        ).toBeInTheDocument();
        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_overview-grid_status-card"]`),
        ).toHaveTextContent("제공기록지 진행 상태");
        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_overview-grid_header-card"]`),
        ).toHaveTextContent("서비스 기본정보");
        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_overview-grid_link-card"]`),
        ).toHaveTextContent("제공기록지 작성 링크");
        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_sessions"]`),
        ).toHaveTextContent("회차별 제공기록");
        expect(container.querySelectorAll('[data-slot="skeleton"].animate-pulse').length).toBeGreaterThan(0);
        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_skeleton-card"]`),
        ).not.toBeInTheDocument();
    });

    it("refreshes the session records and exposes the loading state", () => {
        const onRefresh = jest.fn();
        const assignment = createAssignment(1, "none");
        const { rerender } = render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
                isRefreshing={false}
                onRefresh={onRefresh}
            />,
        );

        const refreshButton = screen.getByRole("button", { name: "제공기록 새로고침" });
        expect(refreshButton.nextElementSibling).toHaveTextContent("0/1 제출완료");

        fireEvent.click(refreshButton);

        expect(onRefresh).toHaveBeenCalledTimes(1);

        rerender(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
                isRefreshing
                onRefresh={onRefresh}
            />,
        );

        const refreshingButton = screen.getByRole("button", { name: "제공기록 새로고침 중" });
        expect(refreshingButton).toBeDisabled();
        expect(refreshingButton).toHaveAttribute("aria-busy", "true");
        expect(refreshingButton.querySelector("svg")).toHaveClass(
            "service-record-refresh-icon--spinning",
        );
    });

    it("keeps card containers mounted while replacing only text values during refresh", () => {
        const assignment = createAssignment(1, "none");
        const { container, rerender } = render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
                isRefreshing={false}
                isTextRefreshing={false}
            />,
        );

        const linkCard = container.querySelector<HTMLElement>(
            `[data-component="${TEST_COMPONENT}_overview-grid_link-card"]`,
        );
        const sessionsCard = container.querySelector<HTMLElement>(
            `[data-component="${TEST_COMPONENT}_sessions"]`,
        );

        expect(linkCard).toHaveTextContent("제공1");
        expect(sessionsCard).toBeInTheDocument();

        rerender(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
                isRefreshing={false}
                isTextRefreshing
            />,
        );

        expect(linkCard).toBeInTheDocument();
        expect(sessionsCard).toBeInTheDocument();
        expect(linkCard).not.toHaveTextContent("제공1");
        expect(linkCard).toHaveTextContent("제공인력 이름");
        expect(linkCard).toHaveTextContent("링크 수동 전송");
        expect(container.querySelectorAll('[data-slot="skeleton"].animate-pulse').length)
            .toBeGreaterThan(0);
    });

    it("renders the main link states", () => {
        const overview: ServiceRecordOverview = {
            assignments: [
                createAssignment(1, "none"),
                createAssignment(2, "scheduled"),
                createAssignment(3, "sent"),
            ],
        };

        render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={overview}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getByText("발송 전")).toBeInTheDocument();
        expect(screen.getByText("발송 예약")).toBeInTheDocument();
        expect(screen.getByText("발송됨")).toBeInTheDocument();
        expect(screen.getAllByText("제공기록지 작성 링크")).toHaveLength(3);
    });

    it("shows a failure toast when manual sending resolves without a sent job", async () => {
        mutateAsync.mockResolvedValue({
            ok: false,
            jobId: "job-manual",
            status: "pending",
            scheduledFor: "2026-07-01T15:00:00+09:00",
        });

        render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [createAssignment(1, "none")] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "링크 수동 전송" }));

        await waitFor(() => {
            expect(toast).toHaveBeenCalledWith({
                variant: "destructive",
                description: "제공기록지 링크 발송에 실패했어요",
            });
        });
        expect(toast).not.toHaveBeenCalledWith({
            variant: "success",
            description: "제공기록지 링크를 보냈어요",
        });
    });

    it("presends the manual-send layout while sending, then switches to resend after refresh", async () => {
        let resolveSend!: (value: {
            ok: boolean;
            jobId: string;
            status: "sent";
            scheduledFor: string;
        }) => void;
        mutateAsync.mockImplementation(() => new Promise((resolve) => {
            resolveSend = resolve;
        }));

        const assignment = createAssignment(1, "none");
        const { rerender } = render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "링크 수동 전송" }));

        const sendingButton = screen.getByRole("button", { name: "발송 중..." });
        expect(sendingButton).toBeDisabled();
        expect(sendingButton).not.toHaveAttribute("data-width", "lg");
        expect(screen.getByText(/서비스 시작일 15:00에 자동 발송됩니다/)).toBeInTheDocument();

        resolveSend({
            ok: true,
            jobId: "job-manual",
            status: "sent",
            scheduledFor: "2026-07-01T15:00:00+09:00",
        });

        await waitFor(() => {
            expect(toast).toHaveBeenCalledWith({
                variant: "success",
                description: "제공기록지 링크를 보냈어요",
            });
        });

        rerender(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [createAssignment(1, "sent")] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        const resendButton = screen.getByRole("button", { name: "메시지 재전송" });
        expect(resendButton).toHaveAttribute("data-width", "lg");
        expect(screen.queryByText(/서비스 시작일 15:00에 자동 발송됩니다/)).not.toBeInTheDocument();
    });

    it("labels rejected manual sends as failures while preserving the server detail", async () => {
        mutateAsync.mockRejectedValue({
            response: {
                data: { message: "수신자 전화번호가 없습니다" },
            },
        });

        render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [createAssignment(1, "none")] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "링크 수동 전송" }));

        await waitFor(() => {
            expect(toast).toHaveBeenCalledWith({
                variant: "destructive",
                description: "제공기록지 링크 발송에 실패했어요: 수신자 전화번호가 없습니다",
            });
        });
    });

    it("normalizes uppercase completed document statuses", () => {
        const assignment = createAssignment(1, "sent");
        assignment.signatureDoc = {
            documentId: "service-record-document-uppercase",
            statusDetail: "COMPLETED",
            stepName: "완료",
            createdDate: "2026-07-05T18:30:00+09:00",
            updatedDate: "2026-07-05T19:00:00+09:00",
            snapshotChunkIndex: 1,
        };

        render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getByText("서명 완료")).toBeInTheDocument();
        expect(screen.queryByText("COMPLETED")).not.toBeInTheDocument();
    });

    it("uses the Korean business-day calendar for empty session placeholders", () => {
        const assignment = {
            ...createAssignment(1, "none"),
            startDate: "2026-09-23T00:00:00.000Z",
            endDate: "2026-09-29T00:00:00.000Z",
            totalSessions: 2,
        };

        render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getByText("예정일 2026.09.23")).toBeInTheDocument();
        expect(screen.getByText("예정일 2026.09.29")).toBeInTheDocument();
        expect(screen.queryByText("예정일 2026.09.24")).not.toBeInTheDocument();
    });

    it("shows an alert from 18:00 KST on the second service date when sessions one and two are unwritten", () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-07-02T18:00:00+09:00").getTime());
        const assignment = {
            ...createAssignment(1, "sent"),
            endDate: "2026-07-02T00:00:00.000Z",
            totalSessions: 2,
        };

        const { container } = render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getByRole("alert")).toHaveTextContent("제공기록지 작성 확인이 필요해요");
        expect(screen.getByRole("alert")).toHaveTextContent(
            "2회차 서비스 제공일 오후 6시가 지났지만 1·2회차 제공기록이 작성되지 않았어요",
        );
        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_sessions_missing-record-alert"]`),
        ).toBeInTheDocument();
    });

    it("reveals the missing-record alert at 18:00 KST while the service-record tab stays open", () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-07-02T17:59:59+09:00"));
        const assignment = {
            ...createAssignment(1, "sent"),
            endDate: "2026-07-02T00:00:00.000Z",
            totalSessions: 2,
        };

        render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.queryByRole("alert")).not.toBeInTheDocument();

        act(() => {
            jest.advanceTimersByTime(1_000);
        });

        expect(screen.getByRole("alert")).toHaveTextContent("제공기록지 작성 확인이 필요해요");
    });

    it.each([1, 2])(
        "keeps the missing-record alert hidden when session %s already has a record",
        (sessionIndex) => {
            jest.spyOn(Date, "now").mockReturnValue(new Date("2026-07-02T18:00:00+09:00").getTime());
            const assignment = {
                ...createAssignment(1, "sent"),
                endDate: "2026-07-02T00:00:00.000Z",
                totalSessions: 2,
                sessions: [createSession(sessionIndex)],
            };

            render(
                <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                    overview={{ assignments: [assignment] }}
                    clientId={100}
                    isLoading={false}
                    isError={false}
                />,
            );

            expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        },
    );

    it("keeps the missing-record alert hidden for replaced assignments when the active assignment is written", () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-07-02T18:00:00+09:00").getTime());
        const replacedAssignment = {
            ...createAssignment(1, "sent"),
            endDate: "2026-07-02T00:00:00.000Z",
            totalSessions: 2,
            replaced: true,
        };
        const activeAssignment = {
            ...createAssignment(2, "sent"),
            endDate: "2026-07-02T00:00:00.000Z",
            totalSessions: 2,
            sessions: [createSession(1)],
        };

        render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [replacedAssignment, activeAssignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows one missing-record alert for the active assignment when replaced and active assignments are unwritten", () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-07-02T18:00:00+09:00").getTime());
        const replacedAssignment = {
            ...createAssignment(1, "sent"),
            endDate: "2026-07-02T00:00:00.000Z",
            totalSessions: 2,
            replaced: true,
        };
        const activeAssignment = {
            ...createAssignment(2, "sent"),
            endDate: "2026-07-02T00:00:00.000Z",
            totalSessions: 2,
        };

        render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [replacedAssignment, activeAssignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getAllByRole("alert")).toHaveLength(1);
    });

    it("shows actual-period slots separately from preserved outside-period records", () => {
        const assignment = createAssignment(1, "none");
        const outsideSession: ServiceRecordSession = {
            sessionIndex: 7,
            serviceDate: "2026-08-11T00:00:00.000Z",
            locked: false,
            submittedAt: null,
            updatedAt: "2026-08-10T10:00:00.000Z",
            answers: {},
            etcService: null,
            notes: null,
            paymentConfirmed: false,
            hasMomApproval: false,
        };
        const overview: ServiceRecordOverview = {
            record: {
                id: "case-1",
                status: "IN_PROGRESS",
                startDate: "2026-08-03T00:00:00.000Z",
                endDate: "2026-08-10T00:00:00.000Z",
                totalSessions: 6,
                completedAt: null,
                finalizationDueAt: "2026-08-10T20:00:00+09:00",
                finalizedAt: null,
                documentsCompletedAt: null,
                lastError: null,
                header: null,
                sessions: [outsideSession],
                signatureDocs: [],
            },
            assignments: [assignment],
        };

        const { container } = render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={overview}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_sessions"]`),
        ).toHaveTextContent("0/6 제출완료");
        expect(screen.getAllByText("기간 외 기록")).toHaveLength(2);
        expect(screen.getByText(/7회차 · 2026.08.11/)).toBeInTheDocument();
        expect(screen.queryByText("예정일 2026.08.11")).not.toBeInTheDocument();
        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_out-of-period-sessions"]`),
        ).toBeInTheDocument();
    });

    it("keeps saved overflow records visible when legacy period dates are missing", () => {
        const overflowSession: ServiceRecordSession = {
            sessionIndex: 2,
            serviceDate: "2026-08-04T00:00:00.000Z",
            locked: false,
            submittedAt: null,
            updatedAt: "2026-08-04T10:00:00.000Z",
            answers: {},
            etcService: null,
            notes: null,
            paymentConfirmed: false,
            hasMomApproval: false,
        };
        const overview: ServiceRecordOverview = {
            record: {
                id: "case-without-dates",
                status: "IN_PROGRESS",
                startDate: null,
                endDate: null,
                totalSessions: 1,
                completedAt: null,
                finalizationDueAt: null,
                finalizedAt: null,
                documentsCompletedAt: null,
                lastError: null,
                header: null,
                sessions: [overflowSession],
                signatureDocs: [],
            },
            assignments: [createAssignment(1, "none")],
        };

        render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={overview}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getAllByText("기간 외 기록")).toHaveLength(2);
        expect(screen.getByText(/2회차 · 2026.08.04/)).toBeInTheDocument();
    });

    it("opens unsubmitted sessions with empty detail values", () => {
        const assignment = createAssignment(1, "none");
        const { container } = render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={{ assignments: [assignment] }}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        const trigger = screen.getByRole("button", { name: /1회차/ });
        expect(trigger).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(trigger);

        expect(trigger).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText("산모 기록")).toBeInTheDocument();
        expect(screen.getByText("신생아 기록")).toBeInTheDocument();
        expect(screen.getByText("서비스 기록")).toBeInTheDocument();
        expect(screen.getByText("산모 서명")).toBeInTheDocument();
        const detail = container.querySelector(
            `[data-component="${TEST_COMPONENT}_sessions_list_row_detail"]`,
        );
        expect(detail).toBeInTheDocument();
        const motherSectionMarker = screen.getByText("산모 기록").querySelector("span");
        expect(motherSectionMarker).toHaveClass("bg-v3-purple");
        expect(motherSectionMarker).not.toHaveClass("bg-v3-burgundy");
        const emptyValues = detail!.querySelectorAll(
            `[data-component="${TEST_COMPONENT}_sessions_list_row_detail_field_empty-value"]`,
        );
        expect(emptyValues.length).toBeGreaterThan(0);
        expect(Array.from(emptyValues).every((value) => value.textContent === "-")).toBe(true);
    });

    it("renders one continuous client record across provider replacements", () => {
        const first = { ...createAssignment(1, "sent"), replaced: true };
        const second = createAssignment(2, "sent");
        const overview: ServiceRecordOverview = {
            record: {
                id: "case-1",
                status: "IN_PROGRESS",
                startDate: "2026-07-01T00:00:00.000Z",
                endDate: "2026-07-10T00:00:00.000Z",
                totalSessions: 2,
                completedAt: null,
                finalizationDueAt: "2026-07-10T20:00:00+09:00",
                finalizedAt: null,
                documentsCompletedAt: null,
                lastError: null,
                header: {
                    momName: "산모",
                    momBirth: "960414",
                    babyName: "신생아",
                    babyBirth: "260626",
                    deliveryType: "자연분만",
                    babyWeight: "2.6",
                    createdAt: "2026-07-01T09:00:00.000Z",
                    updatedAt: "2026-07-01T09:00:00.000Z",
                },
                sessions: [
                    {
                        sessionIndex: 1,
                        serviceDate: "2026-07-01T00:00:00.000Z",
                        locked: true,
                        submittedAt: "2026-07-01T10:00:00.000Z",
                        updatedAt: "2026-07-01T10:00:00.000Z",
                        answers: {
                            perineum: ["이상없음"],
                            sitzBath: "실시",
                        },
                        etcService: null,
                        notes: null,
                        paymentConfirmed: true,
                        hasMomApproval: true,
                        employeeName: "제공1",
                        formVersion: 1,
                    },
                    {
                        sessionIndex: 2,
                        serviceDate: "2026-07-02T00:00:00.000Z",
                        locked: false,
                        submittedAt: null,
                        updatedAt: "2026-07-02T10:00:00.000Z",
                        answers: {},
                        etcService: null,
                        notes: null,
                        paymentConfirmed: false,
                        hasMomApproval: false,
                        employeeName: "제공2",
                        formVersion: 1,
                    },
                ],
                signatureDocs: [],
            },
            assignments: [first, second],
        };

        const { container } = render(
            <ClientServiceRecordsTab data-component={TEST_COMPONENT}
                overview={overview}
                clientId={100}
                isLoading={false}
                isError={false}
            />,
        );

        expect(screen.getAllByText("제공기록지 작성 링크")).toHaveLength(1);
        expect(screen.getAllByText("서비스 기본정보")).toHaveLength(1);
        expect(screen.getAllByText("회차별 제공기록")).toHaveLength(1);
        expect(screen.getByText("제공인력 배정 이력")).toBeInTheDocument();
        expect(screen.getByText(/1회차 ·/)).toBeInTheDocument();
        expect(screen.getByText(/2회차 ·/)).toBeInTheDocument();
        expect(screen.queryByText("계약 회차를 누르면 기록 상세가 열립니다")).not.toBeInTheDocument();
        expect(
            container.querySelector(`[data-component="${TEST_COMPONENT}_progress"]`),
        ).not.toBeInTheDocument();

        const overviewGrid = container.querySelector<HTMLElement>(
            `[data-component="${TEST_COMPONENT}_overview-grid"]`,
        );
        expect(overviewGrid).toHaveClass(
            "grid",
            "grid-cols-1",
            "items-stretch",
            "lg:grid-cols-3",
            "[&>*]:content-start",
        );

        const overviewCards = Array.from(overviewGrid!.children) as HTMLElement[];
        expect(overviewCards).toHaveLength(3);
        expect(overviewCards[0]).toHaveTextContent("제공기록지 진행 상태");
        expect(overviewCards[0]).toHaveTextContent("전자문서 생성-");
        expect(overviewCards[1]).toHaveTextContent("서비스 기본정보");
        expect(overviewCards[1]).toHaveTextContent("1996.04.14");
        expect(overviewCards[2]).toHaveTextContent("제공기록지 작성 링크");
        expect(container).not.toHaveTextContent("양식 v1");
        expect(container).not.toHaveTextContent("제출 시점의 양식 스냅샷");
        expect(
            overviewCards[2].querySelector(
                `[data-component="${TEST_COMPONENT}_overview-grid_link-card_head_caption"]`,
            ),
        ).not.toBeInTheDocument();
        expect(overviewCards[2].querySelectorAll(`[data-component="${TEST_COMPONENT}_overview-grid_link-card_row"]`)).toHaveLength(4);
        expect(overviewCards[2]).toHaveTextContent("제공인력 이름");
        expect(overviewCards[2]).toHaveTextContent("제공인력 연락처");
        expect(overviewCards[2]).toHaveTextContent("메시지 최근 발송");
        expect(overviewCards[2]).toHaveTextContent("제공기록지 본인 인증");
        expect(overviewCards[2]).toHaveTextContent("완료");
        expect(overviewCards[2]).not.toHaveTextContent("링크 만료");
        const resendButton = screen.getByRole("button", { name: "메시지 재전송" });
        expect(resendButton).toHaveClass("w-full");
        expect(resendButton).toHaveAttribute("data-variant", "positive");
        expect(overviewCards[2]).not.toHaveTextContent("기존 링크가 그대로 전송됩니다.");
        expect(overviewCards[0].querySelector(`[data-component="${TEST_COMPONENT}_overview-grid_status-card_row"] > span`)).toHaveClass(
            "text-[calc(12px*var(--glint-ui-scale,1))]",
        );
        expect(overviewCards[0].querySelector('[data-slot="status-badge"]')).not.toBeInTheDocument();
        expect(
            overviewCards[1].querySelector(
                `[data-component="${TEST_COMPONENT}_overview-grid_header-card_head_title-row"] [data-slot="status-badge"]`,
            ),
        ).not.toBeInTheDocument();
        expect(
            overviewCards[2].querySelector(
                `[data-component="${TEST_COMPONENT}_overview-grid_link-card_head_title-row"] [data-slot="status-badge"]`,
            ),
        ).not.toBeInTheDocument();
        const sessionDetail = container.querySelector<HTMLElement>(
            `[data-component="${TEST_COMPONENT}_sessions_list_row_detail"]`,
        );
        expect(sessionDetail).toBeInTheDocument();
        const sessionValues = sessionDetail!.querySelectorAll(
            `[data-component="${TEST_COMPONENT}_sessions_list_row_detail_field_value"]`,
        );
        expect(sessionValues.length).toBeGreaterThan(0);
        sessionValues.forEach((value) => {
            expect(value).toHaveClass(
                "text-[calc(12px*var(--glint-ui-scale,1))]",
                "font-medium",
                "text-v3-dark",
            );
        });
        expect(within(sessionDetail!).getByText("이상없음")).not.toHaveClass(
            "rounded-[8px]",
            "bg-v3-dim-white",
        );
        expect(within(sessionDetail!).getByText("실시")).not.toHaveClass(
            "rounded-[8px]",
            "bg-v3-primary-light",
        );
        expect(sessionDetail).not.toHaveTextContent("✓");
        expect(within(sessionDetail!).getByText("완료")).not.toHaveClass("text-v3-green");
        expect(within(sessionDetail!).getByText("서명함")).not.toHaveClass("text-v3-green");
        const headerCaption = overviewCards[1].querySelector<HTMLElement>(
            `[data-component="${TEST_COMPONENT}_overview-grid_header-card_body_caption"]`,
        );
        expect(headerCaption).toHaveClass("mt-auto", "text-right");
        expect(
            overviewCards[1].querySelector(
                `[data-component="${TEST_COMPONENT}_overview-grid_header-card_head"] [data-component="${TEST_COMPONENT}_overview-grid_header-card_body_caption"]`,
            ),
        ).not.toBeInTheDocument();
    });
});
