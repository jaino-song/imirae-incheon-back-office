import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { maskEmail } from 'application/utils/mask';
import { EmailPort, EmailOptions } from '../../domain/ports/email.port';

// Published Resend template IDs
const TEMPLATE_IDS = {
    EMAIL_VERIFICATION: 'f0c6da72-cf5e-418a-94b5-b55c5558ceac',
    PASSWORD_RESET: '5cf0eeff-f03c-4eca-a422-5ad28ef414ec',
} as const;

const DEFAULT_FROM_EMAIL = 'admin@babyjamjam.com';
const SENDER_DISPLAY_NAME = '아가잼잼 어드민';

const formatSenderAddress = (sender: string): string =>
    sender.includes('<') ? sender : `${SENDER_DISPLAY_NAME} <${sender}>`;

@Injectable()
export class ResendEmailAdapter implements EmailPort {
    private readonly resend: Resend | null;
    private readonly fromEmail: string;
    private readonly logger = new Logger(ResendEmailAdapter.name);

    constructor() {
        const apiKey = process.env['RESEND_API_KEY'];
        if (!apiKey) {
            this.logger.warn('RESEND_API_KEY not configured. Email sending will be disabled.');
            this.resend = null;
        } else {
            this.resend = new Resend(apiKey);
        }
        this.fromEmail = formatSenderAddress(process.env['RESEND_FROM_EMAIL'] || DEFAULT_FROM_EMAIL);
    }

    async send(options: EmailOptions): Promise<string> {
        if (!this.resend) {
            this.logger.warn(`Email not sent (no API key): to=${maskEmail(options.to)}, subject=${options.subject}`);
            return 'disabled';
        }

        try {
            const response = await this.resend.emails.send({
                from: this.fromEmail,
                to: options.to,
                subject: options.subject,
                html: options.html,
                text: options.text,
            });

            if (response.error) {
                this.logger.error(`Failed to send email: ${response.error.message}`);
                throw new Error(response.error.message);
            }

            this.logger.log(`Email sent successfully to ${maskEmail(options.to)}, ID: ${response.data?.id}`);
            return response.data?.id || '';
        } catch (error) {
            this.logger.error(`Failed to send email to ${maskEmail(options.to)}:`, error);
            throw error;
        }
    }

    async sendVerificationEmail(
        to: string,
        name: string | null,
        verificationUrl: string,
    ): Promise<string> {
        return this.sendWithTemplate({
            to,
            templateId: TEMPLATE_IDS.EMAIL_VERIFICATION,
            variables: {
                NAME: name || '사용자',
                VERIFICATION_URL: verificationUrl,
                EXPIRY_HOURS: 24,
            },
        });
    }

    async sendPasswordResetEmail(
        to: string,
        name: string | null,
        resetUrl: string,
    ): Promise<string> {
        return this.sendWithTemplate({
            to,
            templateId: TEMPLATE_IDS.PASSWORD_RESET,
            variables: {
                NAME: name || '사용자',
                RESET_URL: resetUrl,
                EXPIRY_HOURS: 1,
            },
        });
    }

    private async sendWithTemplate(options: {
        to: string;
        templateId: string;
        variables: Record<string, string | number>;
    }): Promise<string> {
        if (!this.resend) {
            this.logger.warn(`Email not sent (no API key): to=${maskEmail(options.to)}, template=${options.templateId}`);
            return 'disabled';
        }

        try {
            const response = await this.resend.emails.send({
                from: this.fromEmail,
                to: options.to,
                template: {
                    id: options.templateId,
                    variables: options.variables,
                },
            });

            if (response.error) {
                this.logger.error(`Failed to send template email: ${response.error.message}`);
                throw new Error(response.error.message);
            }

            this.logger.log(`Template email sent to ${maskEmail(options.to)}, ID: ${response.data?.id}`);
            return response.data?.id || '';
        } catch (error) {
            this.logger.error(`Failed to send template email to ${maskEmail(options.to)}:`, error);
            throw error;
        }
    }
}
