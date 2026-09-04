import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useParams } from "next/navigation";

import ReceiptLinkPage from "../page";

jest.mock("next/navigation", () => ({
    useParams: jest.fn(),
}));

const mockUseParams = useParams as jest.Mock;
const MAX_LOCK_REFRESH_DELAY_MS = 30 * 60 * 1000;

// F3: deliberately NOT the page's BRANCH_FALLBACK constant ("인천 아이미래로") — a fixture
// equal to the fallback would still pass even if the page ignored status.branchName
// entirely and always rendered the fallback.
const STATUS_VERIFY = {
    ok: true,
    state: "pending",
    branchName: "서울 아이미래로",
    expiresAt: "2026-10-03T00:00:00.000Z",
    remainingAttempts: 5,
    lockedUntil: null,
};

const STATUS_VERIFIED = {
    ...STATUS_VERIFY,
    state: "verified",
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
        jest.useRealTimers();
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

    it("resumes the image screen when a verified status has a valid receipt access cookie", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFIED);
            if (href.endsWith("/access")) return jsonResponse(200, { ok: true, clientName: "김산모" });
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);

        expect(await screen.findByRole("link", { name: "이미지 저장" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "산모님 영수증" })).toBeInTheDocument();
        expect(screen.getByRole("img", { name: "산모님 본인부담금 영수증" })).toHaveAttribute(
            "src",
            "/api/receipt/efr_t/image",
        );
        expect(screen.queryByText("산모 산모님 영수증")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("산모 생년월일")).not.toBeInTheDocument();
        expect(global.fetch).toHaveBeenNthCalledWith(2, "/api/receipt/efr_t/access", { cache: "no-store" });
        expect(global.fetch).not.toHaveBeenCalledWith("/api/receipt/efr_t/image", expect.anything());
    });

    it("falls back to birthday verification when a verified status has a stale receipt access cookie", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFIED);
            if (href.endsWith("/access")) return jsonResponse(401, { reason: "access_required" });
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);

        expect(await screen.findByLabelText("산모 생년월일")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "이미지 저장" })).not.toBeInTheDocument();
        expect(global.fetch).toHaveBeenNthCalledWith(2, "/api/receipt/efr_t/access", { cache: "no-store" });
    });

    it("shows the safe invalid-link screen when a verified-session image probe fails", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFIED);
            if (href.endsWith("/access")) {
                return jsonResponse(500, {
                    message: "connect ECONNREFUSED db-primary.internal:5432",
                });
            }
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);

        expect(await screen.findByRole("heading", { name: "사용할 수 없는 링크입니다" })).toBeInTheDocument();
        expect(screen.queryByText(/db-primary\.internal/)).not.toBeInTheDocument();
    });

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

    it("re-checks status and unlocks the open screen when lockedUntil elapses", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-09-03T00:30:00.000Z"));
        let statusFetchCount = 0;
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) {
                statusFetchCount += 1;
                return jsonResponse(
                    200,
                    statusFetchCount === 1
                        ? {
                              ...STATUS_VERIFY,
                              remainingAttempts: 0,
                              lockedUntil: "2026-09-03T01:00:00.000Z",
                          }
                        : STATUS_VERIFY,
                );
            }
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);

        expect(await screen.findByText(/5회 연속 틀려 .*까지 확인이 잠겼습니다\./)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "확인하기" })).toBeDisabled();

        await act(async () => {
            await jest.advanceTimersByTimeAsync(30 * 60 * 1000);
        });

        await waitFor(() => expect(screen.getByLabelText("산모 생년월일")).toBeEnabled());
        expect(screen.getByRole("button", { name: "확인하기" })).toBeEnabled();
        expect(statusFetchCount).toBe(2);
    });

    it("keeps re-checking a server lock when the client clock is ahead", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-09-03T01:05:00.000Z"));
        let statusFetchCount = 0;
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) {
                statusFetchCount += 1;
                return jsonResponse(
                    200,
                    statusFetchCount < 3
                        ? {
                              ...STATUS_VERIFY,
                              remainingAttempts: 0,
                              lockedUntil: "2026-09-03T01:00:00.000Z",
                          }
                        : STATUS_VERIFY,
                );
            }
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);

        expect(await screen.findByText(/5회 연속 틀려 .*까지 확인이 잠겼습니다\./)).toBeInTheDocument();

        await act(async () => {
            await jest.advanceTimersByTimeAsync(0);
        });
        expect(statusFetchCount).toBe(1);

        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_000);
        });
        expect(statusFetchCount).toBe(2);
        expect(screen.getByRole("button", { name: "확인하기" })).toBeDisabled();

        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_000);
        });

        await waitFor(() => expect(screen.getByLabelText("산모 생년월일")).toBeEnabled());
        expect(statusFetchCount).toBe(3);
    });

    it("re-checks within the server maximum lock duration when the client clock is behind", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-09-03T00:00:00.000Z"));
        const setTimeoutSpy = jest.spyOn(window, "setTimeout");
        let statusFetchCount = 0;
        global.fetch = jest.fn(async () => {
            statusFetchCount += 1;
            return jsonResponse(200, {
                ...STATUS_VERIFY,
                remainingAttempts: 0,
                lockedUntil: "2026-10-03T00:00:00.000Z",
            });
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        await screen.findByText(/5회 연속 틀려 .*까지 확인이 잠겼습니다\./);

        const scheduledDelays = setTimeoutSpy.mock.calls.map(([, delay]) => delay);
        setTimeoutSpy.mockRestore();
        expect(scheduledDelays).toContain(MAX_LOCK_REFRESH_DELAY_MS);
        expect(scheduledDelays.every((delay) => typeof delay !== "number" || delay <= MAX_LOCK_REFRESH_DELAY_MS)).toBe(
            true,
        );

        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_000);
        });
        expect(statusFetchCount).toBe(1);

        await act(async () => {
            await jest.advanceTimersByTimeAsync(MAX_LOCK_REFRESH_DELAY_MS - 1_000);
        });
        expect(statusFetchCount).toBe(2);
    });

    it("cancels recurring lock refreshes when the screen unmounts", async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-09-03T01:05:00.000Z"));
        let statusFetchCount = 0;
        global.fetch = jest.fn(async () => {
            statusFetchCount += 1;
            return jsonResponse(200, {
                ...STATUS_VERIFY,
                remainingAttempts: 0,
                lockedUntil: "2026-09-03T01:00:00.000Z",
            });
        }) as unknown as typeof fetch;

        const { unmount } = render(<ReceiptLinkPage />);
        await screen.findByText(/5회 연속 틀려 .*까지 확인이 잠겼습니다\./);

        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_000);
        });
        expect(statusFetchCount).toBe(2);

        unmount();
        await jest.advanceTimersByTimeAsync(10_000);

        expect(statusFetchCount).toBe(2);
    });

    // F3: a page that ignores status.branchName entirely and always falls back would
    // otherwise pass every other test above (they all use a non-fallback branchName).
    it("falls back to the default branch name when /status returns an empty branchName (F3)", async () => {
        global.fetch = jest.fn(async () => jsonResponse(200, { ...STATUS_VERIFY, branchName: "" })) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);

        await screen.findByLabelText("산모 생년월일");
        expect(screen.getByText("인천 아이미래로")).toBeInTheDocument();
    });

    // F2: non-410 !response.ok from /status must show the invalid-link screen.
    it("shows the invalid-link screen when /status answers a non-410 error status (F2)", async () => {
        global.fetch = jest.fn(async () => jsonResponse(404, { reason: "not_found" })) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);

        await screen.findByRole("heading", { name: "사용할 수 없는 링크입니다" });
    });

    async function reachVerifyScreenAndSubmit(birthday: string) {
        const input = await screen.findByLabelText("산모 생년월일");
        fireEvent.change(input, { target: { value: birthday } });
        fireEvent.click(screen.getByRole("button", { name: "확인하기" }));
    }

    // F2 — mutant guard: `if (response.status === 423 && body.lockedUntil)` → `if (false)`
    // would fall through to the generic error message instead of the lock screen.
    it("shows the lock screen and disables the button when verify answers 423 with lockedUntil (F2)", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) {
                return jsonResponse(423, { reason: "locked", lockedUntil: "2026-09-03T01:00:00.000Z" });
            }
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        await reachVerifyScreenAndSubmit("940315");

        await screen.findByText(/까지 확인이 잠겼습니다/);
        expect(screen.getByRole("button", { name: "확인하기" })).toBeDisabled();
    });

    it("shows the expiry screen when verify answers 410 (F2)", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) return jsonResponse(410, { reason: "expired" });
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        await reachVerifyScreenAndSubmit("940315");

        await screen.findByRole("heading", { name: "링크 유효기간이 지났습니다" });
    });

    it("shows the format message when verify answers 400 invalid_format (F2)", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) return jsonResponse(400, { reason: "invalid_format" });
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        await reachVerifyScreenAndSubmit("940315");

        await screen.findByText("생년월일 6자리(YYMMDD)를 입력해 주세요.");
    });

    it("shows the generic error message when verify answers an unrecognised status (F2)", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) return jsonResponse(502, { reason: "unknown" });
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        await reachVerifyScreenAndSubmit("940315");

        await screen.findByText("확인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.");
    });

    it("shows the network-error message when the verify fetch throws (F2)", async () => {
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) throw new Error("network down");
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        await reachVerifyScreenAndSubmit("940315");

        await screen.findByText("네트워크 연결을 확인해 주세요.");
    });

    it("shows the format message without calling verify when the birthday is not 6 or 8 digits (F2)", async () => {
        let verifyCalled = false;
        global.fetch = jest.fn(async (url: unknown) => {
            const href = String(url);
            if (href.endsWith("/status")) return jsonResponse(200, STATUS_VERIFY);
            if (href.endsWith("/verify")) {
                verifyCalled = true;
                return jsonResponse(200, { ok: true, clientName: "김산모" });
            }
            throw new Error(`unexpected fetch: ${href}`);
        }) as unknown as typeof fetch;

        render(<ReceiptLinkPage />);
        await reachVerifyScreenAndSubmit("12345");

        await screen.findByText("생년월일 6자리(YYMMDD)를 입력해 주세요.");
        expect(verifyCalled).toBe(false);
    });
});
