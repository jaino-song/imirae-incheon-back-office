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

    // C1(b): the <img>'s error event carries no status code — onError must probe the image
    // endpoint itself (fetch(imageSrc)) and branch on the response status, not
    // unconditionally re-run the status check (which would tear down an otherwise-healthy
    // verified session on any transient image hiccup, e.g. a flaky connection or a 5xx).
    async function verifyAndReachImageScreen(): Promise<HTMLImageElement> {
        const input = await screen.findByLabelText("산모 생년월일");
        fireEvent.change(input, { target: { value: "940315" } });
        fireEvent.click(screen.getByRole("button", { name: "확인하기" }));
        return (await screen.findByRole("img", {
            name: "김산모 산모님 본인부담금 영수증",
        })) as HTMLImageElement;
    }

    it("re-checks status and returns to the verify screen when the image fetch answers 401 (stale/absent access cookie) (C1)", async () => {
        let imageFetchCount = 0;
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) return jsonResponse(200, { ok: true, clientName: "김산모" });
            if (href.includes("/image")) {
                imageFetchCount += 1;
                return jsonResponse(401, { reason: "access_required" });
            }
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        const image = await verifyAndReachImageScreen();

        fireEvent.error(image);

        await screen.findByLabelText("산모 생년월일");
        expect(screen.queryByRole("heading", { name: "김산모 산모님 영수증" })).not.toBeInTheDocument();
        expect(imageFetchCount).toBe(1);
    });

    it("shows the expired screen when the image fetch answers 410 (C1)", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) return jsonResponse(200, { ok: true, clientName: "김산모" });
            if (href.includes("/image")) return jsonResponse(410, { reason: "expired" });
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        const image = await verifyAndReachImageScreen();

        fireEvent.error(image);

        await screen.findByRole("heading", { name: "링크 유효기간이 지났습니다" });
    });

    it("stays on the image screen and retries the <img> exactly once on a transient image error (5xx) — a second error does not fetch or retry again (C1)", async () => {
        let imageFetchCount = 0;
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) return jsonResponse(200, { ok: true, clientName: "김산모" });
            if (href.includes("/image")) {
                imageFetchCount += 1;
                return jsonResponse(500, { error: "upstream failure" });
            }
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        const image = await verifyAndReachImageScreen();

        fireEvent.error(image);

        await waitFor(() => expect(imageFetchCount).toBe(1));
        await waitFor(() => expect(image.src).toContain("r=1"));
        // Still on the image screen — no broken-image copy exists, so it's simply retried.
        expect(screen.getByRole("heading", { name: "김산모 산모님 영수증" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "이미지 저장" })).toBeInTheDocument();

        // Mutant guard: reverting onError to an unconditional loadStatus() would make THIS
        // second error (or even the first) tear down the image screen back to "verify",
        // since /status itself is healthy in this scenario.
        fireEvent.error(image);
        expect(imageFetchCount).toBe(1);
        expect(image.src).toContain("r=1");
        expect(screen.getByRole("heading", { name: "김산모 산모님 영수증" })).toBeInTheDocument();
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
