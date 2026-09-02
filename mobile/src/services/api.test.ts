import { AxiosError } from "axios";

type ApiModule = typeof import("./api");

function createAxiosServerError(status: number): AxiosError {
    return new AxiosError(
        `Request failed with status code ${status}`,
        undefined,
        undefined,
        undefined,
        {
            config: {
                headers: {},
            } as never,
            data: {
                error: "stubbed upstream failure",
            },
            headers: {},
            status,
            statusText: "Server Error",
        },
    );
}

async function loadApiModule(): Promise<{
    apiModule: ApiModule;
    mockGet: jest.Mock;
    mockPost: jest.Mock;
    mockPut: jest.Mock;
}> {
    jest.resetModules();

    const mockGet = jest.fn();
    const mockPost = jest.fn();
    const mockPut = jest.fn();

    jest.doMock("@/lib/api/client", () => ({
        api: {
            delete: jest.fn(),
            get: mockGet,
            post: mockPost,
            put: mockPut,
        },
    }));
    jest.doMock("@/lib/env", () => ({
        PUBLIC_BACKEND_BASE_URL: "http://localhost:3001",
    }));
    jest.doMock("@/lib/safe-storage", () => ({
        safeStorageSetItem: jest.fn(),
    }));

    return {
        apiModule: await import("./api"),
        mockGet,
        mockPost,
        mockPut,
    };
}

describe("settingsApi notification preferences", () => {
    it("uses the authenticated notification preference endpoints", async () => {
        const { apiModule, mockGet, mockPut } = await loadApiModule();
        const savedPreferences = { emailNotificationsEnabled: false };
        mockGet.mockResolvedValue({ data: { emailNotificationsEnabled: true } });
        mockPut.mockResolvedValue({ data: savedPreferences });

        await expect(apiModule.settingsApi.getNotificationPreferences()).resolves.toEqual({
            emailNotificationsEnabled: true,
        });
        await expect(apiModule.settingsApi.updateNotificationPreferences(false)).resolves.toEqual(
            savedPreferences,
        );

        expect(mockGet).toHaveBeenCalledWith("/settings/notification-preferences");
        expect(mockPut).toHaveBeenCalledWith(
            "/settings/notification-preferences",
            { emailNotificationsEnabled: false },
        );
    });
});

describe("eformsignApi.authenticate", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("stops automatic retries after three upstream 5xx failures", async () => {
        const { apiModule, mockPost } = await loadApiModule();
        mockPost.mockRejectedValue(createAxiosServerError(503));

        await expect(apiModule.eformsignApi.authenticate(1)).rejects.toBeInstanceOf(AxiosError);
        await expect(apiModule.eformsignApi.authenticate(2)).rejects.toBeInstanceOf(
            apiModule.EformsignAuthAutoRetryStoppedError,
        );

        jest.setSystemTime(new Date("2026-06-07T00:00:30.001Z"));
        await expect(apiModule.eformsignApi.authenticate(3)).rejects.toBeInstanceOf(AxiosError);
        jest.setSystemTime(new Date("2026-06-07T00:01:00.002Z"));
        await expect(apiModule.eformsignApi.authenticate(4)).rejects.toBeInstanceOf(AxiosError);

        await expect(apiModule.eformsignApi.authenticate(5)).rejects.toBeInstanceOf(
            apiModule.EformsignAuthAutoRetryStoppedError,
        );
        expect(mockPost).toHaveBeenCalledTimes(3);
    });

    it("allows forced retries and resets the automatic circuit after a success", async () => {
        const { apiModule, mockPost } = await loadApiModule();
        mockPost
            .mockRejectedValueOnce(createAxiosServerError(503))
            .mockRejectedValueOnce(createAxiosServerError(503))
            .mockRejectedValueOnce(createAxiosServerError(503))
            .mockResolvedValueOnce({ data: { success: true } })
            .mockResolvedValueOnce({ data: { success: true } });

        await expect(apiModule.eformsignApi.authenticate(1)).rejects.toBeInstanceOf(AxiosError);
        jest.setSystemTime(new Date("2026-06-07T00:00:30.001Z"));
        await expect(apiModule.eformsignApi.authenticate(2)).rejects.toBeInstanceOf(AxiosError);
        jest.setSystemTime(new Date("2026-06-07T00:01:00.002Z"));
        await expect(apiModule.eformsignApi.authenticate(3)).rejects.toBeInstanceOf(AxiosError);
        await expect(apiModule.eformsignApi.authenticate(4)).rejects.toBeInstanceOf(
            apiModule.EformsignAuthAutoRetryStoppedError,
        );

        await expect(
            apiModule.eformsignApi.authenticate(5, { force: true }),
        ).resolves.toEqual({ success: true });
        await expect(apiModule.eformsignApi.authenticate(6)).resolves.toEqual({ success: true });
        expect(mockPost).toHaveBeenCalledTimes(5);
    });

    it("resumes automatic retries after the stop cooldown elapses", async () => {
        // Review finding: a permanent stop stranded read-only document views
        // (no force-auth action available) until a full page reload.
        const { apiModule, mockPost } = await loadApiModule();
        mockPost
            .mockRejectedValueOnce(createAxiosServerError(503))
            .mockRejectedValueOnce(createAxiosServerError(503))
            .mockRejectedValueOnce(createAxiosServerError(503))
            .mockResolvedValueOnce({ data: { success: true } });

        await expect(apiModule.eformsignApi.authenticate(1)).rejects.toBeInstanceOf(AxiosError);
        jest.setSystemTime(new Date("2026-06-07T00:00:30.001Z"));
        await expect(apiModule.eformsignApi.authenticate(2)).rejects.toBeInstanceOf(AxiosError);
        jest.setSystemTime(new Date("2026-06-07T00:01:00.002Z"));
        await expect(apiModule.eformsignApi.authenticate(3)).rejects.toBeInstanceOf(AxiosError);
        await expect(apiModule.eformsignApi.authenticate(4)).rejects.toBeInstanceOf(
            apiModule.EformsignAuthAutoRetryStoppedError,
        );

        // Five minutes after the pause began, background auth tries again
        // on its own and a success clears the breaker entirely.
        jest.setSystemTime(new Date("2026-06-07T00:06:00.003Z"));
        await expect(apiModule.eformsignApi.authenticate(5)).resolves.toEqual({ success: true });
        expect(mockPost).toHaveBeenCalledTimes(4);
    });
});

describe("eformsignApi.finalizeHeadless", () => {
    it("keeps the client timeout above the mobile proxy timeout", async () => {
        const { apiModule, mockPost } = await loadApiModule();
        mockPost.mockResolvedValue({ data: { ok: true } });

        await apiModule.eformsignApi.finalizeHeadless("doc-1", undefined, "progress-1");

        expect(mockPost).toHaveBeenCalledWith(
            "/eformsign-docs/finalize-headless",
            {
                documentId: "doc-1",
                prefillEndDate: undefined,
                progressId: "progress-1",
            },
            { timeout: 180_000 },
        );
    });

    it("continues an advanced provider step until the document is completed", async () => {
        const { apiModule, mockPost } = await loadApiModule();
        mockPost
            .mockResolvedValueOnce({ data: { ok: true, completed: false, durationMs: 700 } })
            .mockResolvedValueOnce({ data: { ok: true, completed: true, durationMs: 900 } });

        await expect(apiModule.eformsignApi.finalizeHeadless("doc-1"))
            .resolves.toEqual({ ok: true, completed: true, durationMs: 1_600 });
        expect(mockPost).toHaveBeenCalledTimes(2);
    });

    it("fails closed when the provider keeps advancing beyond the bounded workflow", async () => {
        const { apiModule, mockPost } = await loadApiModule();
        mockPost.mockResolvedValue({ data: { ok: true, completed: false, durationMs: 700 } });

        await expect(apiModule.eformsignApi.finalizeHeadless("doc-1"))
            .resolves.toEqual({
                ok: false,
                reason: "provider_workflow_incomplete",
                fallbackHint: "manual_check",
                durationMs: 2_100,
            });
        expect(mockPost).toHaveBeenCalledTimes(3);
    });
});
