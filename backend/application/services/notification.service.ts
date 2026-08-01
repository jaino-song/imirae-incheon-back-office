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
import { IUserRepository, USER_REPOSITORY } from "domain/repositories/user.repository.interface";
import { EMAIL_PORT, EmailPort } from "domain/ports/email.port";
import { SystemSettingService } from "./system-setting.service";
import { isNotificationEmailEnabled } from "application/constants/notification";

const EMAIL_SEND_INTERVAL_MS = 600;

interface NotificationEmailTemplateContext {
    ctaUrl: string;
    ctaLabel: string;
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
        emailTemplateContext?: NotificationEmailTemplateContext,
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
                if (emailTemplateContext) {
                    await this.emailPort.sendNotificationEmail({
                        to: recipientEmail,
                        name: recipientName,
                        title,
                        body: safeBody,
                        ctaUrl: emailTemplateContext.ctaUrl,
                        ctaLabel: emailTemplateContext.ctaLabel,
                    });
                    return;
                }

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
        emailTemplateContext?: NotificationEmailTemplateContext,
    ) {
        for (const userId of userIds) {
            await this.sendEmailNotificationToUser(userId, title, body, emailTemplateContext);
        }
    }

    private enqueueEmailSend(task: () => Promise<void>): Promise<void> {
        const queuedSend = this.emailSendQueue.then(async () => {
            const waitMs = Math.max(0, this.nextEmailSendAt - Date.now());
            if (waitMs > 0) {
                await this.delay(waitMs);
            }

            await task();
            this.nextEmailSendAt = Date.now() + EMAIL_SEND_INTERVAL_MS;
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

    async sendToRoles(
        roles: string[],
        title: string,
        body: string,
        data?: Record<string, unknown>,
        emailTemplateContext?: NotificationEmailTemplateContext,
    ): Promise<{ sent: number; failed: number }> {
        const users = await this.userRepository.findByRoles(roles);
        if (users.length === 0) {
            return { sent: 0, failed: 0 };
        }
        const userIds = users.map(u => u.id);
        const result = await this.sendNotificationUsecase.sendToUsers({ userIds, title, body, data });
        await this.sendEmailNotificationsToUsers(userIds, title, body, emailTemplateContext);
        return result;
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
