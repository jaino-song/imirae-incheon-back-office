import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import type { AgentContext } from "application/agent/agent-context";
import type { AgentFormField } from "@babyjamjam/shared";
import { SendNotificationUsecase } from "./send-notification.usecase";
import { AgentActionCertainFailureError, AgentActionUncertainError } from "application/agent/action-coordinator.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { createHash } from "node:crypto";
import { recordAgentActionEffect } from "application/agent/agent-action-effect-receipt";
import { maskEmail, maskPhone } from "application/utils/mask";

const TestSchema = z.object({ userId: z.string().uuid(), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500) });
const OutputSchema = z.object({
    status: z.enum(["disabled", "no-subscriptions", "delivered", "partial", "failed", "uncertain"]),
    notificationId: z.union([z.string(), z.number()]).optional(),
    subscriptions: z.number().int().nonnegative().optional(),
    delivered: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
});
const NOTIFICATION_FIELDS: AgentFormField[] = [
    { name: "userId", label: "사용자 ID", type: "text", required: true },
    { name: "title", label: "제목", type: "text", required: true },
    { name: "body", label: "내용", type: "textarea", required: true },
];

type NotificationIdentity = {
    name: string | null;
    phone: string | null;
    email: string | null;
};

type NotificationTarget = NotificationIdentity & {
    membershipId: string | null;
    role: string | null;
    joinedAt: Date | null;
};

type NotificationTargetSnapshot = {
    userId: string;
    name: string;
    maskedContact: string;
};

function safeMaskedContact(phone: string | null | undefined, email: string | null | undefined): string {
    const maskedPhone = maskPhone(phone);
    if (typeof phone === "string" && phone.trim() && typeof maskedPhone === "string" && maskedPhone !== phone) {
        return maskedPhone;
    }

    const maskedEmail = maskEmail(email);
    if (typeof email === "string" && email.trim() && typeof maskedEmail === "string" && maskedEmail !== email) {
        return maskedEmail;
    }

    return "연락처 미등록";
}

@Injectable()
@AgentCapabilityProvider()
export class NotificationAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly sendNotification: SendNotificationUsecase,
        private readonly prisma: PrismaService,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: {
                name: "notifications.test",
                domain: "notifications",
                version: "1.0.0",
                description: "Persist a test notification and attempt web push after explicit approval",
                risk: "external-side-effect",
                requiredRoles: ["owner", "admin"],
                renderer: "action-proposal",
                flagKey: "agent.capability.notifications.test",
                sideEffect: true,
                approvalPolicy: "strong",
                idempotencyPolicy: "action-id",
            },
            inputSchema: TestSchema,
            outputSchema: OutputSchema,
            classifyOutcome: (rawResult) => {
                const result = OutputSchema.parse(rawResult);
                if (result.status === "delivered") return { status: "succeeded" as const };
                if (result.status === "partial") {
                    return {
                        status: "uncertain" as const,
                        reason: "Web Push was delivered to only some subscriptions",
                    };
                }
                if (result.status === "uncertain") {
                    return { status: "uncertain" as const, reason: "Web Push delivery status is uncertain" };
                }
                return {
                    status: "failed" as const,
                    reason: `Web Push did not deliver: ${result.status}`,
                };
            },
            formFields: NOTIFICATION_FIELDS,
            inspect: async (context, rawInput) => {
                const input = TestSchema.parse(rawInput);
                const target = await this.resolveNotificationTarget(context.principal.branchId, input.userId);
                if (!target) throw new Error("Notification target is outside the current branch");
                const targetVersion = this.targetVersionFromTarget(context.principal.branchId, input.userId, target);
                const targetSnapshot = this.targetSnapshot(input.userId, target);
                return {
                    targetVersion,
                    targetSnapshot,
                    title: "테스트 알림 발송",
                    summary: `${targetSnapshot.name} (${targetSnapshot.maskedContact}) 사용자에게 테스트 알림을 발송합니다.`,
                    provider: "Web Push",
                };
            },
            execute: async (context, rawInput) => {
                const input = TestSchema.parse(rawInput);
                if (!context.actionId) throw new Error("Notification action identity is missing");
                const existing = await this.prisma.notification.findFirst({
                    where: {
                        branchId: context.principal.branchId,
                        data: { path: ["agentActionId"], equals: context.actionId },
                    },
                    select: { id: true, data: true },
                });
                if (existing) {
                    const outcome = this.persistedOutcome(existing.id, existing.data);
                    if (outcome.status === "uncertain") {
                        throw new AgentActionUncertainError("The persisted Web Push outcome is incomplete", { notificationId: existing.id });
                    }
                    return outcome;
                }
                const result = await this.sendNotification.executeWithOutcome(context.principal.branchId, {
                    ...input,
                    data: { agentActionId: context.actionId },
                });
                if (result.status === "uncertain") {
                    throw new AgentActionUncertainError("Web Push delivery status is uncertain", { notificationId: result.notification.id });
                }
                return { status: result.status, notificationId: result.notification.id, subscriptions: result.subscriptions, delivered: result.delivered, failed: result.failed };
            },
            executeApprovedTarget: async (context, rawInput, expectedTargetVersion) => {
                const input = TestSchema.parse(rawInput);
                if (!context.actionId) throw new Error("Notification action identity is missing");
                const existing = await this.prisma.notification.findFirst({
                    where: {
                        branchId: context.principal.branchId,
                        data: { path: ["agentActionId"], equals: context.actionId },
                    },
                    select: { id: true, data: true },
                });
                if (existing) {
                    const outcome = this.persistedOutcome(existing.id, existing.data);
                    if (outcome.status === "uncertain") {
                        throw new AgentActionUncertainError("The persisted Web Push outcome is incomplete", { notificationId: existing.id });
                    }
                    return outcome;
                }
                await this.stageApprovedNotificationTarget(context, input.userId, expectedTargetVersion, input);
                const result = await this.sendNotification.executeWithOutcome(context.principal.branchId, {
                    ...input,
                    data: { agentActionId: context.actionId },
                });
                if (result.status === "uncertain") {
                    throw new AgentActionUncertainError("Web Push delivery status is uncertain", { notificationId: result.notification.id });
                }
                return { status: result.status, notificationId: result.notification.id, subscriptions: result.subscriptions, delivered: result.delivered, failed: result.failed };
            },
            revalidate: async (context, rawInput, expectedTargetVersion) => {
                const input = TestSchema.parse(rawInput);
                const currentVersion = await this.notificationTargetVersion(context.principal.branchId, input.userId);
                return {
                    valid: currentVersion === expectedTargetVersion,
                    ...(currentVersion ? { currentVersion } : {}),
                    reason: currentVersion ? "Notification membership changed after proposal" : "Notification target left the branch",
                };
            },
            reconcile: async (context) => {
                if (!context.actionId) return { status: "uncertain" as const, reason: "Notification action identity is missing" };
                const existing = await this.prisma.notification.findFirst({
                    where: { branchId: context.principal.branchId, data: { path: ["agentActionId"], equals: context.actionId } },
                    select: { id: true, data: true },
                });
                if (!existing) return { status: "uncertain" as const, reason: "Notification record was not found" };
                const outcome = this.persistedOutcome(existing.id, existing.data);
                if (outcome.status === "uncertain" || outcome.status === "partial") {
                    return { status: "uncertain" as const, reason: "Persisted Web Push outcome remains uncertain" };
                }
                return outcome.status === "delivered"
                    ? { status: "succeeded" as const, result: outcome, reason: "Persisted delivery outcome loaded" }
                    : { status: "failed" as const, result: outcome, reason: `Persisted Web Push outcome: ${outcome.status}` };
            },
        }];
    }

    private persistedOutcome(notificationId: number, data: unknown) {
        const value = data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)["providerOutcome"]
            : null;
        const parsed = z.object({
            status: z.string(), subscriptions: z.number().int().nonnegative(),
            delivered: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
        }).safeParse(value);
        return parsed.success
            ? { notificationId, ...parsed.data }
            : { status: "uncertain", notificationId, subscriptions: 0, delivered: 0, failed: 0 };
    }

    private async notificationTargetVersion(branchId: string, userId: string): Promise<string | null> {
        const target = await this.resolveNotificationTarget(branchId, userId);
        return target ? this.targetVersionFromTarget(branchId, userId, target) : null;
    }

    private async resolveNotificationTarget(branchId: string, userId: string): Promise<NotificationTarget | null> {
        const [membership, branch] = await Promise.all([
            this.prisma.user_branch.findFirst({
                where: { userId, branchId },
                select: {
                    id: true,
                    role: true,
                    joinedAt: true,
                    user: { select: { name: true, phone: true, email: true } },
                },
            }),
            this.prisma.branch.findUnique({
                where: { id: branchId },
                select: {
                    ownerId: true,
                    owner: { select: { name: true, phone: true, email: true } },
                },
            }),
        ]);
        if (membership?.user) {
            return {
                membershipId: membership.id,
                role: membership.role,
                joinedAt: membership.joinedAt,
                name: membership.user.name,
                phone: membership.user.phone,
                email: membership.user.email,
            };
        }
        if (branch?.ownerId !== userId || !branch.owner) return null;
        return {
            membershipId: null,
            role: null,
            joinedAt: null,
            name: branch.owner.name,
            phone: branch.owner.phone,
            email: branch.owner.email,
        };
    }

    private targetSnapshot(userId: string, target: NotificationTarget): NotificationTargetSnapshot {
        const name = target.name?.trim();
        if (!name) throw new Error("Notification target name is unavailable");
        return {
            userId,
            name,
            maskedContact: safeMaskedContact(target.phone, target.email),
        };
    }

    private async stageApprovedNotificationTarget(
        context: AgentContext,
        userId: string,
        expectedTargetVersion: string,
        input: z.infer<typeof TestSchema>,
    ): Promise<void> {
        await this.prisma.$transaction(async (transaction) => {
            const rawTransaction = transaction as {
                $queryRawUnsafe?: (query: string, ...values: unknown[]) => Promise<unknown>;
            };
            if (typeof rawTransaction.$queryRawUnsafe === "function") {
                await rawTransaction.$queryRawUnsafe(
                    'SELECT "id" FROM "user_branch" WHERE "user_id" = $1 AND "branch_id" = $2 FOR UPDATE',
                    userId,
                    context.principal.branchId,
                );
                await rawTransaction.$queryRawUnsafe(
                    'SELECT "id" FROM "branch" WHERE "id" = $1 FOR UPDATE',
                    context.principal.branchId,
                );
            }
            const [membership, branch] = await Promise.all([
                transaction.user_branch.findFirst({
                    where: { userId, branchId: context.principal.branchId },
                    select: {
                        id: true,
                        role: true,
                        joinedAt: true,
                        user: { select: { name: true, phone: true, email: true } },
                    },
                }),
                transaction.branch.findUnique({
                    where: { id: context.principal.branchId },
                    select: {
                        ownerId: true,
                        owner: { select: { name: true, phone: true, email: true } },
                    },
                }),
            ]);
            const target = membership?.user
                ? {
                    membershipId: membership.id,
                    role: membership.role,
                    joinedAt: membership.joinedAt,
                    name: membership.user.name,
                    phone: membership.user.phone,
                    email: membership.user.email,
                }
                : branch?.ownerId === userId && branch.owner
                    ? {
                        membershipId: null,
                        role: null,
                        joinedAt: null,
                        name: branch.owner.name,
                        phone: branch.owner.phone,
                        email: branch.owner.email,
                    }
                    : null;
            const currentVersion = target
                ? this.targetVersionFromTarget(context.principal.branchId, userId, target)
                : null;
            if (!currentVersion || currentVersion !== expectedTargetVersion) {
                throw new AgentActionCertainFailureError("Notification membership changed after approval");
            }
            await recordAgentActionEffect(transaction, context, "notifications.test", "notification-target", input.userId, {
                status: "notification-authorized",
                userId: input.userId,
                targetVersion: expectedTargetVersion,
            });
        });
    }

    private targetVersionFromTarget(
        branchId: string,
        userId: string,
        target: NotificationTarget,
    ): string {
        return createHash("sha256").update(JSON.stringify({
            userId,
            branchId,
            membershipId: target.membershipId,
            role: target.role ?? "owner",
            joinedAt: target.joinedAt?.toISOString() ?? null,
            name: target.name,
            phone: target.phone,
            email: target.email,
        })).digest("hex");
    }
}
