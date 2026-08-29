import { ResendEmailAdapter } from "infrastructure/adapters/resend-email.adapter";

const mockResendSend = jest.fn();

jest.mock("resend", () => ({
    Resend: jest.fn().mockImplementation(() => ({
        emails: { send: mockResendSend },
    })),
}));

describe("ResendEmailAdapter idempotency", () => {
    const originalApiKey = process.env["RESEND_API_KEY"];
    const originalFrom = process.env["RESEND_FROM_EMAIL"];

    afterEach(() => {
        jest.clearAllMocks();
        if (originalApiKey === undefined) delete process.env["RESEND_API_KEY"];
        else process.env["RESEND_API_KEY"] = originalApiKey;
        if (originalFrom === undefined) delete process.env["RESEND_FROM_EMAIL"];
        else process.env["RESEND_FROM_EMAIL"] = originalFrom;
    });

    it("passes the durable idempotency key to Resend", async () => {
        process.env["RESEND_API_KEY"] = "test-key";
        mockResendSend.mockResolvedValue({ data: { id: "resend-message-1" }, error: null });

        const adapter = new ResendEmailAdapter();
        await expect(adapter.sendVerificationEmail(
            "member@example.com",
            "Member",
            "https://example.com/verify",
            { idempotencyKey: "auth-email:stable-key" },
        )).resolves.toBe("resend-message-1");

        expect(mockResendSend).toHaveBeenCalledWith(
            expect.objectContaining({
                template: expect.objectContaining({ id: expect.any(String) }),
            }),
            { idempotencyKey: "auth-email:stable-key" },
        );
    });

    it("reports missing provider configuration as a retryable pre-send failure", async () => {
        delete process.env["RESEND_API_KEY"];

        const adapter = new ResendEmailAdapter();

        await expect(adapter.sendPasswordResetEmail(
            "member@example.com",
            "Member",
            "https://example.com/reset",
            { idempotencyKey: "auth-email:stable-key" },
        )).rejects.toMatchObject({
            name: "EmailProviderError",
            stage: "pre_send",
        });
    });
});
