import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

export const LEGACY_CHAT_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export interface LegacyChatConfirmationContext {
    userId: string;
    branchId: string;
    sessionId: string;
}

export interface LegacyChatConfirmationToken {
    intentId: string;
    nonce: string;
}

export interface LegacyChatConfirmationIntentResponse extends LegacyChatConfirmationToken {
    toolName: string;
    confirmationExpiresAt: string;
    confirmationMessage?: string;
}

export interface ConsumedLegacyChatConfirmationIntent {
    id: string;
    userId: string;
    branchId: string;
    sessionId: string;
    toolName: string;
    payload: Record<string, unknown>;
    payloadHash: string;
}

type ConfirmationPayload = Record<string, unknown>;
const consumedIntentObjects = new WeakSet<object>();

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }

    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([key]) => key !== "confirmed")
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, canonicalize(nested)]),
        );
    }

    return value;
}

export function sanitizeLegacyChatToolPayload(payload: ConfirmationPayload): ConfirmationPayload {
    return canonicalize(payload) as ConfirmationPayload;
}

export function hashLegacyChatPayload(payload: ConfirmationPayload): string {
    return createHash("sha256")
        .update(JSON.stringify(sanitizeLegacyChatToolPayload(payload)))
        .digest("hex");
}

/** Remove account-like digit strings from legacy transcripts before they reach
 * the model or a client response. Operational SMS rendering keeps its own
 * server-side account data and does not use this chat transcript path. */
export function redactSensitiveLegacyChatContent(content: string): string {
    return content.replace(
        /((?:계좌(?:번호)?|account(?:\s*number)?|accnum|bank)[^\n]{0,80}?)(\d[\d\s-]{7,}\d)/gi,
        "$1[REDACTED]",
    );
}

export function isConsumedLegacyChatConfirmationIntent(value: object): boolean {
    return consumedIntentObjects.has(value);
}

function hashNonce(nonce: string): Buffer {
    return createHash("sha256").update(nonce).digest();
}

function constantTimeDigestEqual(leftHex: string, rightDigest: Buffer): boolean {
    const left = Buffer.from(leftHex, "hex");
    return left.length === rightDigest.length && timingSafeEqual(left, rightDigest);
}

@Injectable()
export class LegacyChatConfirmationService {
    constructor(private readonly prisma: PrismaService) {}

    async createIntent(
        context: LegacyChatConfirmationContext,
        toolName: string,
        payload: ConfirmationPayload,
        confirmationMessage?: string,
    ): Promise<LegacyChatConfirmationIntentResponse> {
        this.assertContext(context);
        const sanitizedPayload = sanitizeLegacyChatToolPayload(payload);
        const nonce = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + LEGACY_CHAT_CONFIRMATION_TTL_MS);
        const created = await this.prisma.legacy_chat_confirmation_intent.create({
            data: {
                userId: context.userId,
                branchId: context.branchId,
                sessionId: context.sessionId,
                toolName,
                payload: sanitizedPayload as never,
                payloadHash: hashLegacyChatPayload(sanitizedPayload),
                nonceHash: hashNonce(nonce).toString("hex"),
                expiresAt,
            },
            select: {
                id: true,
                expiresAt: true,
            },
        });

        return {
            intentId: created.id,
            nonce,
            toolName,
            confirmationExpiresAt: created.expiresAt.toISOString(),
            confirmationMessage,
        };
    }

    async consumeIntent(
        context: Omit<LegacyChatConfirmationContext, "sessionId"> & { sessionId?: string },
        token: LegacyChatConfirmationToken,
        expectedToolName?: string,
        expectedPayload?: ConfirmationPayload,
    ): Promise<ConsumedLegacyChatConfirmationIntent> {
        this.assertActorContext(context);
        if (!token.intentId || !token.nonce) {
            throw new ConflictException("Confirmation intent is required");
        }

        const intent = await this.prisma.legacy_chat_confirmation_intent.findFirst({
            where: {
                id: token.intentId,
                userId: context.userId,
                branchId: context.branchId,
            },
        });

        if (!intent) {
            throw new NotFoundException("Confirmation intent not found");
        }

        const now = new Date();
        if (intent.consumedAt) {
            throw new ConflictException("Confirmation intent has already been used");
        }
        if (intent.expiresAt <= now) {
            throw new ConflictException("Confirmation intent has expired");
        }
        if (!constantTimeDigestEqual(intent.nonceHash, hashNonce(token.nonce))) {
            throw new ConflictException("Confirmation intent does not match");
        }
        if (expectedToolName && intent.toolName !== expectedToolName) {
            throw new ConflictException("Confirmation action does not match");
        }
        if (expectedPayload && intent.payloadHash !== hashLegacyChatPayload(expectedPayload)) {
            throw new ConflictException("Confirmation payload does not match");
        }
        if (context.sessionId && intent.sessionId !== context.sessionId) {
            throw new ConflictException("Confirmation session does not match");
        }

        // The conditional update is the one-time-use gate. Any concurrent
        // consumer can observe the intent, but only one can claim it before
        // the external/mutation callback runs.
        const claimed = await this.prisma.legacy_chat_confirmation_intent.updateMany({
            where: {
                id: intent.id,
                userId: context.userId,
                branchId: context.branchId,
                nonceHash: intent.nonceHash,
                consumedAt: null,
                expiresAt: { gt: now },
            },
            data: { consumedAt: now },
        });
        if (claimed.count !== 1) {
            throw new ConflictException("Confirmation intent has already been used or expired");
        }

        const consumed: ConsumedLegacyChatConfirmationIntent = {
            id: intent.id,
            userId: intent.userId,
            branchId: intent.branchId,
            sessionId: intent.sessionId,
            toolName: intent.toolName,
            payload: sanitizeLegacyChatToolPayload(intent.payload as ConfirmationPayload),
            payloadHash: intent.payloadHash,
        };
        consumedIntentObjects.add(consumed);
        return consumed;
    }

    async consumeAndExecute<T>(
        context: Omit<LegacyChatConfirmationContext, "sessionId"> & { sessionId?: string },
        token: LegacyChatConfirmationToken,
        callback: (intent: ConsumedLegacyChatConfirmationIntent) => Promise<T>,
    ): Promise<T> {
        const intent = await this.consumeIntent(context, token);
        return callback(intent);
    }

    private assertContext(context: LegacyChatConfirmationContext): void {
        this.assertActorContext(context);
        if (!context.sessionId) {
            throw new ConflictException("Authenticated session-bound chat context is required");
        }
    }

    private assertActorContext(context: Pick<LegacyChatConfirmationContext, "userId" | "branchId">): void {
        if (!context.userId || !context.branchId) {
            throw new ConflictException("Authenticated branch-bound chat context is required");
        }
    }
}
