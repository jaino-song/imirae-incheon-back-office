import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DailyDigestSection, NotificationService } from "./notification.service";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { BRANCH_REPOSITORY, IBranchRepository } from "domain/repositories/branch.repository.interface";
import {
    IMessageTriggerJobRepository,
    MESSAGE_TRIGGER_JOB_REPOSITORY,
} from "domain/repositories/message-trigger-job.repository.interface";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MESSAGE_TRIGGER_TEMPLATE_CATALOG } from "domain/constants/message-trigger-catalog";
import { SystemSettingService } from "./system-setting.service";

const DAYS_THRESHOLD = 7;

// Initial lookback for branches that do not have a successful digest watermark yet.
// After the first successful run, each branch resumes from its persisted boundary.
const UNDELIVERED_MESSAGES_WINDOW_MS = 24 * 60 * 60 * 1000;

// Sane upper bound on how many undelivered-message lines the digest email lists — matches the
// magnitude findHistoryByBranch already uses as its default for a similarly-shaped branch-scoped
// job query, rather than leaving this unbounded.
const UNDELIVERED_MESSAGES_LIMIT = 50;

// Resolve the login URL from the same per-env vars auth.controller's resolveFrontendURL uses,
// so the email CTA stays in sync with the deployed frontend domain. Fallback covers test/dev
// runs where the env vars are not set; production picks up PRODUCTION_FRONTEND_URL.
function resolveNotificationLoginUrl(): string {
    const nodeEnv = process.env['NODE_ENV'];
    const base = nodeEnv === "production" ? process.env['PRODUCTION_FRONTEND_URL']
        : nodeEnv === "preview" ? process.env['PREVIEW_FRONTEND_URL']
        : process.env['DEVELOPMENT_FRONTEND_URL'];
    const normalized = (base ?? "https://admin.babyjamjam.com").trim().replace(/\/+$/, "");
    return `${normalized}/login`;
}

const NOTIFICATION_EMAIL_CONTEXT = {
    ctaUrl: resolveNotificationLoginUrl(),
    ctaLabel: "로그인해서 확인하기",
};

@Injectable()
export class PwaNotificationSchedulerService {
    private readonly logger = new Logger(PwaNotificationSchedulerService.name);

    constructor(
        private readonly notificationService: NotificationService,
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
        @Inject(BRANCH_REPOSITORY)
        private readonly branchRepository: IBranchRepository,
        @Inject(MESSAGE_TRIGGER_JOB_REPOSITORY)
        private readonly messageTriggerJobRepository: IMessageTriggerJobRepository,
        private readonly systemSettingService: SystemSettingService,
    ) {}

    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async sendDailySummaryNotifications(): Promise<void> {
        this.logger.log("[PWA Scheduler] Starting daily summary notifications...");

        const runStartedAt = new Date(Date.now());
        const branches = await this.branchRepository.findAllActive();

        for (const org of branches) {
            this.logger.log(`[PWA Scheduler] Processing org: ${org.name} (${org.id})`);
            try {
                const persistedWatermark = await this.systemSettingService
                    .getPwaUndeliveredDigestWatermark(org.id);
                const undeliveredSince = persistedWatermark
                    ?? new Date(runStartedAt.getTime() - UNDELIVERED_MESSAGES_WINDOW_MS);
                await this.sendBranchDigest(org.id, org.name, undeliveredSince, runStartedAt);
            } catch (error) {
                this.logger.error(
                    `[PWA Scheduler] Failed to process branch ${org.id}`,
                    error instanceof Error ? error.stack : String(error),
                );
            }
        }

        this.logger.log("[PWA Scheduler] Daily summary notifications completed");
    }

    /**
     * Collect every condition for one branch first, then hand the whole set to the
     * notification service as a single digest — one in-app row, one push and one email
     * per branch user, rather than one send per condition (or per client).
     */
    private async sendBranchDigest(
        branchId: string,
        branchName: string,
        undeliveredSince: Date,
        runStartedAt: Date,
    ): Promise<void> {
        const [upcoming, ending, incompleteContracts, contractsNotSent, undelivered] = await Promise.all([
            this.collect(branchId, "upcoming services", () =>
                this.clientRepository.findStartingWithinDays(branchId, DAYS_THRESHOLD)),
            this.collect(branchId, "ending services", () =>
                this.clientRepository.findEndingWithinDays(branchId, DAYS_THRESHOLD)),
            this.collect(branchId, "incomplete contracts", () =>
                this.clientRepository.findWithIncompleteContractsStartingWithinDays(branchId, DAYS_THRESHOLD)),
            this.collect(branchId, "contracts not sent", () =>
                this.clientRepository.findWithoutContractSentStartingWithinDays(branchId, DAYS_THRESHOLD)),
            this.collectUndeliveredMessages(branchId, undeliveredSince, runStartedAt),
        ]);

        const sections: DailyDigestSection[] = [];

        if (upcoming.length > 0) {
            sections.push({
                key: "upcoming",
                label: "서비스 시작 예정",
                description: `7일 내에 시작 예정인 서비스가 ${upcoming.length}건 있어요.`,
                count: upcoming.length,
                unit: "건",
                url: "/clients/filtered?filter=starting-soon",
            });
        }

        if (ending.length > 0) {
            sections.push({
                key: "ending",
                label: "서비스 종료 예정",
                description: `7일 내에 종료 예정인 서비스가 ${ending.length}건 있어요.`,
                count: ending.length,
                unit: "건",
                url: "/clients/filtered?filter=ending-soon",
            });
        }

        if (incompleteContracts.length > 0) {
            sections.push({
                key: "incompleteContracts",
                label: "계약서 미완료",
                description: `서비스 시작 전인데 아직 완료되지 않은 계약서가 ${incompleteContracts.length}건 있어요.`,
                count: incompleteContracts.length,
                unit: "건",
                url: "/clients/filtered?filter=incomplete-contracts",
            });
        }

        if (contractsNotSent.length > 0) {
            sections.push({
                key: "contractsNotSent",
                label: "계약서 미발송",
                description: `아직 계약서가 발송되지 않은 고객이 ${contractsNotSent.length}명 있어요.`,
                count: contractsNotSent.length,
                unit: "명",
                url: "/clients/filtered?filter=no-contract",
                details: contractsNotSent.map((client) => client.name),
            });
        }

        if (undelivered.total > 0) {
            sections.push({
                key: "undeliveredMessages",
                label: "자동 전송 실패·취소",
                description: `이전 알림 이후 자동 전송 중 발송되지 못한 메시지가 ${undelivered.total}건 있어요. 필요하면 수동으로 발송해 주세요.`,
                count: undelivered.total,
                unit: "건",
                url: "/messages",
                details: undelivered.items.map((job) => this.formatUndeliveredMessageDetail(job)),
            });
        }

        if (sections.length === 0) {
            this.logger.log(`[PWA Scheduler] Nothing to report for branch ${branchId}`);
            if (undelivered.loaded) {
                await this.systemSettingService.setPwaUndeliveredDigestWatermark(branchId, runStartedAt);
            }
            return;
        }

        try {
            const result = await this.notificationService.sendDailyDigestToBranchUsers(
                branchId,
                branchName,
                sections,
                NOTIFICATION_EMAIL_CONTEXT,
            );
            this.logger.log(
                `[PWA Scheduler] Daily digest for branch ${branchId}: ${sections.length} sections, ${result.sent} sent, ${result.failed} failed`,
            );
            if (undelivered.loaded && result.sent > 0 && result.failed === 0) {
                await this.systemSettingService.setPwaUndeliveredDigestWatermark(branchId, runStartedAt);
            }
        } catch (error) {
            this.logger.error(
                `[PWA Scheduler] Failed to send daily digest for branch ${branchId}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    private async collectUndeliveredMessages(
        branchId: string,
        since: Date,
        until: Date,
    ): Promise<{ items: MessageTriggerJobEntity[]; total: number; loaded: boolean }> {
        try {
            const [items, total] = await Promise.all([
                this.messageTriggerJobRepository.findRecentUndeliveredByBranch(
                    branchId,
                    since,
                    until,
                    UNDELIVERED_MESSAGES_LIMIT,
                ),
                this.messageTriggerJobRepository.countRecentUndeliveredByBranch(
                    branchId,
                    since,
                    until,
                ),
            ]);
            return { items, total, loaded: true };
        } catch (error) {
            this.logger.error(
                `[PWA Scheduler] Failed to load undelivered messages for branch ${branchId}`,
                error instanceof Error ? error.stack : String(error),
            );
            return { items: [], total: 0, loaded: false };
        }
    }

    /**
     * One digest line per undelivered message: recipient · template label — reason. The
     * template label reuses the existing Korean catalog names; the reason is whatever
     * markFailed()/cancel() recorded in cancelReason (failure and cancellation share that
     * field). A missing recipient name falls back the same way the rest of this service does.
     * template_key is a free-form string column, not a DB enum, so a row can carry a key the
     * catalog doesn't recognize — fall back to a generic label instead of throwing, so one
     * bad row cannot take down this branch's digest (or the branches processed after it).
     */
    private formatUndeliveredMessageDetail(job: MessageTriggerJobEntity): string {
        const recipientName = job.payload.recipientName || "사용자";
        const templateLabel = MESSAGE_TRIGGER_TEMPLATE_CATALOG[job.templateKey]?.name ?? "메시지";
        const reason = job.cancelReason ?? "사유 미상";
        return `${recipientName} · ${templateLabel} — ${reason}`;
    }

    /**
     * A failing query drops its own section only — the rest of the digest still goes out.
     */
    private async collect<T>(
        branchId: string,
        label: string,
        query: () => Promise<T[]>,
    ): Promise<T[]> {
        try {
            return await query();
        } catch (error) {
            this.logger.error(
                `[PWA Scheduler] Failed to load ${label} for branch ${branchId}`,
                error instanceof Error ? error.stack : String(error),
            );
            return [];
        }
    }
}
