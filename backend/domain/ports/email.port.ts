export const EMAIL_PORT = Symbol('EmailPort');

export type EmailDeliveryFailureStage = 'pre_send' | 'unknown';

/**
 * A provider failure may be known to have happened before the outbound
 * request crossed the provider boundary, or may be ambiguous after it did.
 * The outbox can retry only the former.
 */
export class EmailProviderError extends Error {
    constructor(
        message: string,
        public readonly stage: EmailDeliveryFailureStage,
    ) {
        super(message);
        this.name = 'EmailProviderError';
    }
}

export interface EmailSendOptions {
    /** Stable key persisted with the durable outbox row. */
    idempotencyKey?: string;
}

export interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

export interface EmailPort {
    /**
     * Send an email
     * @param options Email options including recipient, subject, and content
     * @returns Promise resolving to the message ID or similar identifier
     */
    send(options: EmailOptions): Promise<string>;

    /**
     * Send a verification email
     * @param to Recipient email address
     * @param name Recipient name (optional)
     * @param verificationUrl URL to verify email
     */
    sendVerificationEmail(
        to: string,
        name: string | null,
        verificationUrl: string,
        options?: EmailSendOptions,
    ): Promise<string>;

    /**
     * Send a password reset email
     * @param to Recipient email address
     * @param name Recipient name (optional)
     * @param resetUrl URL to reset password
     */
    sendPasswordResetEmail(
        to: string,
        name: string | null,
        resetUrl: string,
        options?: EmailSendOptions,
    ): Promise<string>;
}
