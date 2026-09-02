import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface AdminAuditActor {
    userId?: string | null;
    globalRole?: string | null;
    branchRole?: string | null;
}

export interface AdminAuditEventInput {
    actor?: AdminAuditActor | null;
    tenantId?: string | null;
    branchId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    outcome: "success" | "rejected" | "failed";
    reason?: string | null;
    correlationId?: string | null;
    source?: string | null;
}

type AuditClient = PrismaService | Prisma.TransactionClient;

const SENSITIVE_KEY = /(?:password|secret|token|credential|authorization|cookie|private.?key|provider.?key|access.?key|api.?key|client.?secret|refresh.?token|bank|account.?number|acc.?num|phone|address|email|message|content|document|kakao|profile|name)/i;
const REDACTED = "[REDACTED]";

/**
 * Keep audit payloads useful for authority review while making accidental
 * credential/PII disclosure impossible by default.  Callers should pass
 * summaries (IDs, roles, statuses and counts), never full domain entities.
 */
export function redactAuditPayload(value: unknown, key?: string): Prisma.InputJsonValue | null {
    if (value === null || value === undefined) return null;
    if (key && SENSITIVE_KEY.test(key)) return REDACTED;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactAuditPayload(item) ?? null) as Prisma.InputJsonValue;
    }
    if (typeof value === "object") {
        const result: Record<string, Prisma.InputJsonValue | null> = {};
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
            result[childKey] = redactAuditPayload(childValue, childKey);
        }
        return result as Prisma.InputJsonValue;
    }
    return String(value);
}

@Injectable()
export class AdminAuditEventWriter {
    constructor(private readonly prisma: PrismaService) {}

    async append(client: AuditClient, input: AdminAuditEventInput): Promise<void> {
        const actor = input.actor ?? undefined;
        await client.admin_audit_event.create({
            data: {
                actorUserId: actor?.userId ?? null,
                actorGlobalRole: actor?.globalRole ?? null,
                actorBranchRole: actor?.branchRole ?? null,
                tenantId: input.tenantId ?? input.branchId ?? null,
                branchId: input.branchId ?? null,
                action: input.action,
                targetType: input.targetType,
                targetId: input.targetId ?? null,
                beforePayload: input.before === undefined ? undefined : toJsonValue(redactAuditPayload(input.before)),
                afterPayload: input.after === undefined ? undefined : toJsonValue(redactAuditPayload(input.after)),
                outcome: input.outcome,
                reason: input.reason ?? null,
                correlationId: input.correlationId ?? randomUUID(),
                source: input.source ?? "backend",
            },
        });
    }

    async appendInTransaction(
        transaction: Prisma.TransactionClient,
        input: AdminAuditEventInput,
    ): Promise<void> {
        return this.append(transaction, input);
    }

    /** Keep the injected Prisma reference explicit for DI/liveness checks. */
    get client(): PrismaService {
        return this.prisma;
    }
}

function toJsonValue(value: Prisma.InputJsonValue | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return value === null ? Prisma.JsonNull : value;
}
