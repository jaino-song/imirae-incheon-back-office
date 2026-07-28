import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useParams } from "next/navigation";

import ServiceRecordPage from "../[token]/page";
import { isoDateInKorea } from "@/lib/date/business-days";

jest.mock("next/navigation", () => ({
    useParams: jest.fn(),
}));

jest.mock("@/components/app/ui/ApprovalTwoButtonModal", () => ({
    ApprovalTwoButtonModal: () => null,
}));

jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({
    MobileTwoButtonModal: ({
        "data-component": dataComponent,
        open,
        title,
        description,
        loading,
        confirmLabel,
        confirmDisabled,
    }: {
        "data-component"?: string;
        open: boolean;
        title: string;
        description?: string;
        loading?: boolean;
        confirmLabel: string;
        confirmDisabled?: boolean;
    }) => open ? (
        <div
            role="dialog"
            aria-busy={loading}
            data-component={dataComponent}
        >
            <h2>{title}</h2>
            <p>{description}</p>
            <button disabled={loading || confirmDisabled}>{confirmLabel}</button>
        </div>
    ) : null,
}));

jest.mock("@/components/app/ui/NotificationOneButtonModal", () => ({
    NotificationOneButtonModal: ({
        "data-component": dataComponent,
        open,
        title,
        description,
    }: {
        "data-component"?: string;
        open: boolean;
        title: string;
        description: string;
    }) => open ? (
        <div role="alertdialog" data-component={dataComponent}>
            <h2>{title}</h2>
            <p>{description}</p>
        </div>
    ) : null,
}));

jest.mock("@/components/app/service-record/SignaturePad", () => ({
    SignaturePad: () => null,
}));

const mockUseParams = useParams as jest.Mock;
const fetchMock = jest.fn();

function deferredResponse() {
    let resolve!: (response: Response) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<Response>((resolver, rejecter) => {
        resolve = resolver;
        reject = rejecter;
    });
    return { promise, resolve, reject };
}

function jsonResponse(data: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
    } as Response;
}

const serviceRecordContext = {
    org: { name: "테스트 제공기관" },
    employee: { id: 1, name: "제공인력" },
    client: { id: 2, name: "이용자" },
    totalSessions: 1,
    startDate: "2026-07-17",
    header: null,
    sessions: [],
    recordStatus: "IN_PROGRESS",
    pendingScheduleChange: null,
};

describe("ServiceRecordPage authentication restoration", () => {
    beforeEach(() => {
        mockUseParams.mockReturnValue({ token: "link-token" });
        fetchMock.mockReset();
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/link-token");
        global.fetch = fetchMock as typeof fetch;
    });

    it("restores a verified visit from the server cookie before showing identity verification", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse(serviceRecordContext));

        render(<ServiceRecordPage />);

        await waitFor(() => {
            expect(document.querySelector('[data-component="mobile_service-record_wizard_body_service-title"]'))
                .toHaveTextContent("서비스 기본정보");
        });
        expect(screen.queryByText("제공인력 본인 확인")).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/service-record/link-token/link");
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "/api/service-record/link-token/context",
            expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }),
        );
    });

    it("shows completion when every service session has been submitted", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                header: {
                    momName: "김산모",
                    momBirth: "900101",
                    babyName: "김아기",
                    babyBirth: "260714",
                    babyWeight: "3.2",
                    deliveryType: "자연분만",
                },
                sessions: [{
                    sessionIndex: 1,
                    serviceDate: "2026-07-17",
                    locked: true,
                    momApproval: "approved",
                }],
                recordStatus: "WAITING_FOR_END",
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록지 제출이 완료되었습니다.")).toBeInTheDocument();
        expect(screen.getByText("최종 제출 완료")).toBeInTheDocument();
    });

    it("shows identity verification when no valid server cookie is available", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공인력 본인 확인")).toBeInTheDocument();
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });

    it("returns a verified revisit to the service-record overview instead of an in-progress daily draft", async () => {
        const user = userEvent.setup();
        window.sessionStorage.setItem("daily-service-record-draft:link-token", JSON.stringify({
            header: { momName: "홍길동" },
            day: 1,
            pageIdx: 2,
            draft: { notes: "작성 중인 기록" },
        }));
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                totalSessions: 2,
                header: { momName: "홍길동" },
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        expect(document.querySelector('[data-component="mobile_service-record_wizard_body_day-title"]')).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "기록 시작" }));
        expect(document.querySelector('[data-component="mobile_service-record_wizard_body_day-title"]'))
            .toHaveTextContent("서비스 기록");
        expect(screen.getByDisplayValue("작성 중인 기록")).toBeInTheDocument();
    });

    it("limits 기타서비스 to 40 characters and 특이사항 to 80 characters", async () => {
        const user = userEvent.setup();
        window.sessionStorage.setItem("daily-service-record-draft:link-token", JSON.stringify({
            header: { momName: "홍길동" },
            day: 1,
            pageIdx: 2,
            draft: {
                _date: isoDateInKorea(),
                etcService: "",
                notes: "",
            },
        }));
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                totalSessions: 2,
                header: { momName: "홍길동" },
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "기록 시작" }));

        const etcService = screen.getByPlaceholderText("추가사항에 대한 기록 필요 시 기재");
        const notes = screen.getByPlaceholderText("서비스 제공 관련 특이사항 기록 필요 시 기재");

        expect(etcService).toHaveAttribute("maxlength", "40");
        expect(notes).toHaveAttribute("maxlength", "80");

        await user.type(etcService, ` ${"기".repeat(40)}`);
        await user.type(notes, ` ${"특".repeat(80)}`);

        expect(etcService).toHaveValue(` ${"기".repeat(39)}`);
        expect(notes).toHaveValue(` ${"특".repeat(79)}`);
    });

    it("allows entry for a different service date while showing a warning", async () => {
        const user = userEvent.setup();
        window.sessionStorage.setItem("daily-service-record-draft:link-token", JSON.stringify({
            header: { momName: "홍길동" },
            day: 1,
            pageIdx: 0,
            draft: {
                _date: "2026-07-20",
                perineum: ["이상없음"],
                breast: ["이상없음"],
                excretion: ["이상없음"],
                sitzBath: "실시",
                meals_meal: "1",
                meals_snack: "1",
            },
        }));
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                totalSessions: 2,
                header: { momName: "홍길동" },
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "기록 시작" }));

        expect(document.querySelector('[data-component="mobile_service-record_wizard_body_date-mismatch-notice"]'))
            .toHaveTextContent("서비스 제공일자(2026.07.20)가 오늘과 달라요. 한번 더 확인해 주세요.");
        expect(screen.getAllByRole("button", { name: /이상없음/ })[0]).toBeEnabled();
        expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
    });

    it("does not allow navigation back to submitted service information from the overview", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                header: { momName: "홍길동" },
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        expect(document.querySelector('[data-component="mobile_service-record_wizard_body_overview-back"]')).not.toBeInTheDocument();
    });

    it("opens a loading schedule-change modal before the preview request resolves", async () => {
        const user = userEvent.setup();
        const previewResponse = deferredResponse();
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                header: { momName: "홍길동" },
            }))
            .mockReturnValueOnce(previewResponse.promise);

        render(<ServiceRecordPage />);

        await user.click(await screen.findByRole("button", { name: "서비스 일정 변경" }));

        expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
        expect(screen.getByRole("heading", { name: "서비스 일정 변경" })).toBeInTheDocument();
        expect(screen.getByText("변경 가능한 일정을 확인하고 있어요.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "불러오는 중…" })).toBeDisabled();

        previewResponse.resolve(jsonResponse({
            sessionIndex: 1,
            fromDate: "2026-07-20",
            toDate: "2026-07-21",
        }));

        expect(await screen.findByRole("heading", { name: "1회차 서비스 일정을 조정할까요?" }))
            .toBeInTheDocument();
        expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "false");
        expect(screen.getByRole("button", { name: "승인 요청" })).toBeEnabled();
    });

    it("closes the loading modal and shows the existing error notice when preview loading fails", async () => {
        const user = userEvent.setup();
        const previewResponse = deferredResponse();
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                header: { momName: "홍길동" },
            }))
            .mockReturnValueOnce(previewResponse.promise);

        render(<ServiceRecordPage />);

        await user.click(await screen.findByRole("button", { name: "서비스 일정 변경" }));
        expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");

        previewResponse.reject(new Error("network unavailable"));

        expect(await screen.findByRole("alertdialog")).toHaveTextContent("일정 변경 정보를 불러오지 못했습니다.");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("maps daily pages to browser history so Back restores the previous wizard page", async () => {
        const user = userEvent.setup();
        window.sessionStorage.setItem("daily-service-record-draft:link-token", JSON.stringify({
            header: { momName: "홍길동" },
            day: 1,
            pageIdx: 0,
            draft: {
                _date: isoDateInKorea(),
                perineum: ["이상없음"],
                breast: ["이상없음"],
                excretion: ["이상없음"],
                sitzBath: "실시",
                meals_meal: "1",
                meals_snack: "1",
            },
        }));
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                totalSessions: 2,
                header: { momName: "홍길동" },
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        expect(window.location.search).toBe("?step=overview");

        await user.click(screen.getByRole("button", { name: "기록 시작" }));
        expect(document.querySelector('[data-component="mobile_service-record_wizard_body_day-title"]'))
            .toHaveTextContent("산모 기록");
        expect(window.location.search).toBe("?step=day&day=1&page=0");

        await user.click(screen.getByRole("button", { name: "다음" }));
        expect(document.querySelector('[data-component="mobile_service-record_wizard_body_day-title"]'))
            .toHaveTextContent("신생아 기록");
        expect(window.location.search).toBe("?step=day&day=1&page=1");

        act(() => window.history.back());
        await waitFor(() => {
            expect(document.querySelector('[data-component="mobile_service-record_wizard_body_day-title"]'))
                .toHaveTextContent("산모 기록");
        });
        expect(window.location.search).toBe("?step=day&day=1&page=0");

        act(() => window.history.back());
        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        expect(window.location.search).toBe("?step=overview");
    });
});
