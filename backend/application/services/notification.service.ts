import { Injectable, Inject, Logger } from "@nestjs/common";
import {
    SubscribePushUsecase,
    UnsubscribePushUsecase,
    SendNotificationUsecase,
    GetNotificationsUsecase,
    MarkNotificationReadUsecase,
    GetVapidKeyUsecase,
} from "application/usecases/notification";
import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";
import { NotificationEntity } from "domain/entities/notification.entity";
import { UserEntity } from "domain/entities/user.entity";
import { IUserRepository, USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { EMAIL_PORT, EmailPort } from "domain/ports/email.port";
import { SystemSettingService } from "./system-setting.service";
import { isNotificationEmailEnabled } from "application/constants/notification";

const EMAIL_SEND_INTERVAL_MS = 600;

interface NotificationEmailTemplateContext {
    ctaUrl: string;
    ctaLabel: string;
}

/**
 * One line item of the per-branch daily digest. The scheduler builds these from its
 * repository queries; the digest is delivered as a single notification row, a single
 * push and a single email per branch user, no matter how many sections there are.
 */
export interface DailyDigestSection {
    key: string;
    label: string;
    description: string;
    count: number;
    /** Korean counter suffix used in the push/notification summary line ("건" / "명"). */
    unit: string;
    url: string;
    /**
     * Optional per-item detail lines rendered under the section — e.g. a list of client names,
     * or a composite line like "recipient · template — reason". Each entry renders on its own
     * line and is HTML-escaped the same way the rest of the digest is.
     */
    details?: string[];
}

@Injectable()
export class NotificationService {
    private readonly logger = new Logger(NotificationService.name);
    private emailSendQueue: Promise<void> = Promise.resolve();
    private nextEmailSendAt = 0;

    constructor(
        private readonly subscribePushUsecase: SubscribePushUsecase,
        private readonly unsubscribePushUsecase: UnsubscribePushUsecase,
        private readonly sendNotificationUsecase: SendNotificationUsecase,
        private readonly getNotificationsUsecase: GetNotificationsUsecase,
        private readonly markNotificationReadUsecase: MarkNotificationReadUsecase,
        private readonly getVapidKeyUsecase: GetVapidKeyUsecase,
        @Inject(USER_REPOSITORY)
        private readonly userRepository: IUserRepository,
        @Inject(EMAIL_PORT)
        private readonly emailPort: EmailPort,
        private readonly systemSettingService: SystemSettingService,
    ) {}

    private escapeHtml(value: string): string {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    private async sendEmailNotificationToUser(
        userId: string,
        title: string,
        body: string,
    ) {
        if (!isNotificationEmailEnabled()) {
            return;
        }

        const user = await this.userRepository.findById(userId);
        if (!user?.email) {
            return;
        }

        const isEnabled = await this.systemSettingService.getUserEmailNotificationsEnabled(user.id);
        if (!isEnabled) {
            return;
        }

        const recipientEmail = user.email;
        const recipientName = this.escapeHtml(user.name ?? "사용자");
        const safeTitle = this.escapeHtml(title);
        const safeBody = this.escapeHtml(body).replace(/\n/g, "<br />");

        try {
            await this.enqueueEmailSend(async () => {
                await this.emailPort.send({
                    to: recipientEmail,
                    subject: `[아가잼잼] ${title}`,
                    text: `${user.name ?? "사용자"}님, 새로운 알림이 도착했습니다.\n\n${title}\n${body}`,
                    html: `
                      <div style="font-family: Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; line-height: 1.6; color: #17304d;">
                        <p style="margin: 0 0 12px;">${recipientName}님, 새로운 알림이 도착했습니다.</p>
                        <h1 style="margin: 0 0 12px; font-size: 18px; color: #12366a;">${safeTitle}</h1>
                        <p style="margin: 0;">${safeBody}</p>
                      </div>
                    `,
                });
            });
        } catch (error) {
            this.logger.error(
                `Failed to send notification email to user ${user.id}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    private async sendEmailNotificationsToUsers(
        userIds: string[],
        title: string,
        body: string,
    ) {
        for (const userId of userIds) {
            await this.sendEmailNotificationToUser(userId, title, body);
        }
    }

    private enqueueEmailSend(task: () => Promise<void>): Promise<void> {
        const queuedSend = this.emailSendQueue.then(async () => {
            const waitMs = Math.max(0, this.nextEmailSendAt - Date.now());
            if (waitMs > 0) {
                await this.delay(waitMs);
            }

            try {
                await task();
            } finally {
                this.nextEmailSendAt = Date.now() + EMAIL_SEND_INTERVAL_MS;
            }
        });

        this.emailSendQueue = queuedSend.catch(() => undefined);

        return queuedSend;
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    private async hasExistingNotification(
        branchid: string,
        userId: string,
        dedupe: { type: string; documentId: string },
    ): Promise<boolean> {
        const notifications = await this.getNotificationsUsecase.execute(branchid, userId, {
            limit: 100,
            offset: 0,
        });

        return notifications.some((notification) =>
            notification.data?.["type"] === dedupe.type &&
            notification.data?.["documentId"] === dedupe.documentId
        );
    }

    // VAPID Key
    getVapidPublicKey(): string {
        return this.getVapidKeyUsecase.execute();
    }

    // Push Subscription
    subscribePush(
        userId: string,
        endpoint: string,
        p256dhKey: string,
        authKey: string,
        userAgent?: string,
    ): Promise<PushSubscriptionEntity> {
        return this.subscribePushUsecase.execute(userId, endpoint, p256dhKey, authKey, userAgent);
    }

    unsubscribePush(endpoint: string): Promise<void> {
        return this.unsubscribePushUsecase.execute(endpoint);
    }

    // Send Notifications
    async sendNotification(
        branchid: string,
        userId: string,
        title: string,
        body: string,
        data?: Record<string, unknown>,
    ): Promise<NotificationEntity> {
        const notification = await this.sendNotificationUsecase.execute(branchid, { userId, title, body, data });
        await this.sendEmailNotificationToUser(userId, title, body);
        return notification;
    }

    async broadcastNotification(
        title: string,
        body: string,
        data?: Record<string, unknown>,
    ): Promise<{ sent: number; failed: number }> {
        const result = await this.sendNotificationUsecase.broadcast({ title, body, data });
        const users = await this.userRepository.findByRoles(["owner", "admin", "manager", "user"]);
        await this.sendEmailNotificationsToUsers(users.map((user) => user.id), title, body);
        return result;
    }

    // Get Notifications
    getNotifications(
        branchid: string,
        userId: string,
        options?: { limit?: number; offset?: number },
    ): Promise<NotificationEntity[]> {
        return this.getNotificationsUsecase.execute(branchid, userId, options);
    }

    getUnreadNotifications(branchid: string, userId: string): Promise<NotificationEntity[]> {
        return this.getNotificationsUsecase.getUnread(branchid, userId);
    }

    countUnreadNotifications(branchid: string, userId: string): Promise<number> {
        return this.getNotificationsUsecase.countUnread(branchid, userId);
    }

    // Mark as Read
    markAsRead(
        branchid: string,
        notificationId: number,
        userId: string
    ): Promise<NotificationEntity> {
        return this.markNotificationReadUsecase.execute(branchid, notificationId, userId);
    }

    markAllAsRead(branchid: string, userId: string): Promise<void> {
        return this.markNotificationReadUsecase.markAllAsRead(branchid, userId);
    }

    /**
     * Daily digest: one notification row + one push + one email per branch user,
     * carrying every section collected for that branch. Recipients are branch-scoped
     * (owners included) — never the global role list.
     */
    async sendDailyDigestToBranchUsers(
        branchid: string,
        branchName: string,
        sections: DailyDigestSection[],
        emailTemplateContext: NotificationEmailTemplateContext,
    ): Promise<{ sent: number; failed: number }> {
        if (sections.length === 0) {
            return { sent: 0, failed: 0 };
        }

        const users = await this.userRepository.findNotificationRecipientsByBranchId(branchid);
        const uniqueUsers = Array.from(new Map(users.map((user) => [user.id, user])).values());
        if (uniqueUsers.length === 0) {
            return { sent: 0, failed: 0 };
        }

        const title = `오늘 확인할 알림이 ${sections.length}건 있습니다`;
        const summary = sections.map((section) => `${section.label} ${section.count}${section.unit}`).join(" · ");
        const body = `[${branchName}] ${summary} 지금 확인해 보세요.`;
        const data = { type: "daily-summary", url: sections.length === 1 ? sections[0]!.url : "/", sections };

        const results = await Promise.allSettled(uniqueUsers.map(async (user) => {
            await this.sendNotificationUsecase.execute(branchid, { userId: user.id, title, body, data });
            return this.sendDailyDigestEmailToUser(user, branchName, title, sections, emailTemplateContext);
        }));

        let sent = 0;
        let failed = 0;
        let emailsSent = 0;
        let emailsSkipped = 0;
        let emailsFailed = 0;
        for (const result of results) {
            if (result.status === "fulfilled") {
                sent++;
                if (result.value === "sent") {
                    emailsSent++;
                } else if (result.value === "skipped") {
                    emailsSkipped++;
                } else {
                    emailsFailed++;
                }
                continue;
            }

            failed++;
            this.logger.error(
                `Failed to send daily digest for branch ${branchid}`,
                result.reason instanceof Error ? result.reason.stack : String(result.reason),
            );
        }

        const emailLog = `daily digest emails for branch ${branchid}: ${emailsSent} sent, ${emailsSkipped} skipped, ${emailsFailed} failed`;
        if (emailsFailed === 0) {
            this.logger.log(emailLog);
        } else {
            this.logger.warn(emailLog);
        }

        return { sent, failed };
    }

    private async sendDailyDigestEmailToUser(
        user: UserEntity,
        branchName: string,
        title: string,
        sections: DailyDigestSection[],
        emailTemplateContext: NotificationEmailTemplateContext,
    ): Promise<"sent" | "skipped" | "failed"> {
        if (!isNotificationEmailEnabled()) {
            return "skipped";
        }

        if (!user.email) {
            return "skipped";
        }

        try {
            const isEnabled = await this.systemSettingService.getUserEmailNotificationsEnabled(user.id);
            if (!isEnabled) {
                return "skipped";
            }

            const recipientEmail = user.email;
            const recipientName = user.name ?? "사용자";
            const safeRecipientName = this.escapeHtml(recipientName);
            const safeBranchName = this.escapeHtml(branchName);
            const safeCtaUrl = this.escapeHtml(emailTemplateContext.ctaUrl);
            const safeCtaLabel = this.escapeHtml(emailTemplateContext.ctaLabel);

            const sectionsHtml = sections.map((section) => {
                const detailsHtml = section.details && section.details.length > 0
                    ? `<p style="margin: 4px 0 0; color: #4a6382;">${section.details.map((detail) => this.escapeHtml(detail)).join("<br />")}</p>`
                    : "";
                return `
                        <div style="margin: 0 0 20px;">
                          <h2 style="margin: 0 0 4px; font-size: 16px; color: #12366a;">${this.escapeHtml(section.label)}</h2>
                          <p style="margin: 0;">${this.escapeHtml(section.description)}</p>
                          ${detailsHtml}
                        </div>`;
            }).join("");

            const html = `
                      <div style="font-family: Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif; line-height: 1.6; color: #17304d;">
                        <p style="margin: 0 0 20px;">${safeRecipientName}님, 오늘 ${safeBranchName}에서 확인이 필요한 알림 ${sections.length}건을 정리했어요.</p>${sectionsHtml}
                        <p style="margin: 24px 0 0;">
                          <a href="${safeCtaUrl}" style="display: inline-block; padding: 12px 20px; background-color: #12366a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">${safeCtaLabel}</a>
                        </p>
                      </div>
                    `;

            const textLines = [
                `${recipientName}님, 오늘 ${branchName}에서 확인이 필요한 알림 ${sections.length}건을 정리했어요.`,
                "",
            ];
            for (const section of sections) {
                textLines.push(`[${section.label}] ${section.description}`);
                if (section.details && section.details.length > 0) {
                    textLines.push(section.details.join("\n"));
                }
                textLines.push("");
            }
            textLines.push(`${emailTemplateContext.ctaLabel}: ${emailTemplateContext.ctaUrl}`);

            await this.enqueueEmailSend(async () => {
                await this.emailPort.send({
                    to: recipientEmail,
                    subject: `[아가잼잼] ${title}`,
                    text: textLines.join("\n"),
                    html,
                });
            });
            return "sent";
        } catch (error) {
            this.logger.error(
                `Failed to send daily digest email to user ${user.id}`,
                error instanceof Error ? error.stack : String(error),
            );
            return "failed";
        }
    }

    async sendToBranchUsers(
        branchid: string,
        title: string,
        body: string,
        data?: Record<string, unknown>,
        options?: { dedupe?: { type: string; documentId: string } },
    ): Promise<{ sent: number; failed: number }> {
        const users = await this.userRepository.findNotificationRecipientsByBranchId(branchid);
        const uniqueUsers = Array.from(new Map(users.map((user) => [user.id, user])).values());
        if (uniqueUsers.length === 0) {
            return { sent: 0, failed: 0 };
        }

        const results = await Promise.allSettled(uniqueUsers.map(async (user) => {
            if (options?.dedupe) {
                const exists = await this.hasExistingNotification(branchid, user.id, options.dedupe);
                if (exists) {
                    return "skipped" as const;
                }
            }

            await this.sendNotification(branchid, user.id, title, body, data);
            return "sent" as const;
        }));

        let sent = 0;
        let failed = 0;
        for (const result of results) {
            if (result.status === "fulfilled") {
                if (result.value === "sent") {
                    sent++;
                }
                continue;
            }

            failed++;
            this.logger.error(
                `Failed to send branch notification for branch ${branchid}`,
                result.reason instanceof Error ? result.reason.stack : String(result.reason),
            );
        }

        return { sent, failed };
    }
}
