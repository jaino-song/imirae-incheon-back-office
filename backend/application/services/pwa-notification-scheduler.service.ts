import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DailyDigestSection, NotificationService } from "./notification.service";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { BRANCH_REPOSITORY, IBranchRepository } from "domain/repositories/branch.repository.interface";

const DAYS_THRESHOLD = 7;

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
    ) {}

    @Cron("0 9 * * *", { timeZone: "Asia/Seoul" })
    async sendDailySummaryNotifications(): Promise<void> {
        this.logger.log("[PWA Scheduler] Starting daily summary notifications...");

        const branches = await this.branchRepository.findAllActive();

        for (const org of branches) {
            this.logger.log(`[PWA Scheduler] Processing org: ${org.name} (${org.id})`);
            await this.sendBranchDigest(org.id, org.name);
        }

        this.logger.log("[PWA Scheduler] Daily summary notifications completed");
    }

    /**
     * Collect every condition for one branch first, then hand the whole set to the
     * notification service as a single digest — one in-app row, one push and one email
     * per branch user, rather than one send per condition (or per client).
     */
    private async sendBranchDigest(branchId: string, branchName: string): Promise<void> {
        const [upcoming, ending, incompleteContracts, contractsNotSent] = await Promise.all([
            this.collect(branchId, "upcoming services", () =>
                this.clientRepository.findStartingWithinDays(branchId, DAYS_THRESHOLD)),
            this.collect(branchId, "ending services", () =>
                this.clientRepository.findEndingWithinDays(branchId, DAYS_THRESHOLD)),
            this.collect(branchId, "incomplete contracts", () =>
                this.clientRepository.findWithIncompleteContractsStartingWithinDays(branchId, DAYS_THRESHOLD)),
            this.collect(branchId, "contracts not sent", () =>
                this.clientRepository.findWithoutContractSentStartingWithinDays(branchId, DAYS_THRESHOLD)),
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
                clientNames: contractsNotSent.map((client) => client.name),
            });
        }

        if (sections.length === 0) {
            this.logger.log(`[PWA Scheduler] Nothing to report for branch ${branchId}`);
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
        } catch (error) {
            this.logger.error(
                `[PWA Scheduler] Failed to send daily digest for branch ${branchId}`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    /**
     * A failing query drops its own section only — the rest of the digest still goes out.
     */
    private async collect(
        branchId: string,
        label: string,
        query: () => Promise<ClientEntity[]>,
    ): Promise<ClientEntity[]> {
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
