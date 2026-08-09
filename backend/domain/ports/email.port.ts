export const EMAIL_PORT = Symbol('EmailPort');

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
    ): Promise<string>;
}
