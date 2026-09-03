import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useParams } from "next/navigation";

import ReceiptLinkPage from "../page";

jest.mock("next/navigation", () => ({
    useParams: jest.fn(),
}));

const mockUseParams = useParams as jest.Mock;

const STATUS_VERIFY = {
    ok: true,
    state: "pending",
    branchName: "인천 아이미래로",
    expiresAt: "2026-10-03T00:00:00.000Z",
    remainingAttempts: 5,
    lockedUntil: null,
};

function jsonResponse(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as Response;
}

describe("ReceiptLinkPage", () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        mockUseParams.mockReturnValue({ token: "efr_t" });
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it("re-runs the status load when the receipt image fails to load, and shows the expired screen when status now answers 410 (F5)", async () => {
        let statusCallCount = 0;
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) {
                statusCallCount += 1;
                // First call (mount): verifiable. Second call (image onError, e.g. the
                // link was revoked mid-session): the link has since expired.
                if (statusCallCount === 1) return jsonResponse(200, STATUS_VERIFY);
                return jsonResponse(410, { reason: "expired" });
            }
            if (href.endsWith("/verify")) {
                return jsonResponse(200, { ok: true, clientName: "김산모" });
            }
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);

        const input = await screen.findByLabelText("산모 생년월일");
        fireEvent.change(input, { target: { value: "940315" } });
        fireEvent.click(screen.getByRole("button", { name: "확인하기" }));

        await screen.findByRole("heading", { name: "김산모 산모님 영수증" });
        const image = screen.getByRole("img", { name: "김산모 산모님 본인부담금 영수증" });

        fireEvent.error(image);

        await waitFor(() => expect(statusCallCount).toBe(2));
        await screen.findByRole("heading", { name: "링크 유효기간이 지났습니다" });
    });

    it("renders an aria-hidden clock icon on the expired screen (F9)", async () => {
        global.fetch = jest.fn(async () => jsonResponse(410, { reason: "expired" })) as unknown as typeof fetch;

        const { container } = render(<ReceiptLinkPage />);

        await screen.findByRole("heading", { name: "링크 유효기간이 지났습니다" });
        const icon = container.querySelector(".rcpt-icon-clock");
        expect(icon).not.toBeNull();
        expect(icon).toHaveAttribute("aria-hidden", "true");
    });

    it("renders an aria-hidden download icon inside the 이미지 저장 link (F9)", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) return jsonResponse(200, { ok: true, clientName: "김산모" });
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);

        const input = await screen.findByLabelText("산모 생년월일");
        fireEvent.change(input, { target: { value: "940315" } });
        fireEvent.click(screen.getByRole("button", { name: "확인하기" }));

        const saveLink = await screen.findByRole("link", { name: "이미지 저장" });
        const icon = saveLink.querySelector("svg.rcpt-icon");
        expect(icon).not.toBeNull();
        expect(icon).toHaveAttribute("aria-hidden", "true");
    });

    it("shows the 5-attempt warning box (not the neutral info box) on the locked screen (F9)", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) {
                return jsonResponse(200, {
                    ...STATUS_VERIFY,
                    remainingAttempts: 0,
                    lockedUntil: "2026-09-03T01:00:00.000Z",
                });
            }
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        const { container } = render(<ReceiptLinkPage />);

        await screen.findByRole("button", { name: "확인하기" });
        expect(await screen.findByText(/5회 연속 틀리면 30분 동안 확인이 잠깁니다/)).toBeInTheDocument();
        expect(container.querySelector(".rcpt-info")).toBeNull();
    });
});
