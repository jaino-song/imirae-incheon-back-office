import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { BjjUIMessage } from "@babyjamjam/shared";
import type { AgentSessionOwner } from "domain/entities/agent-session.entity";
import { ActionCoordinatorService } from "./action-coordinator.service";
import { AgentSessionService } from "./agent-session.service";
import { AGENT_POLICY_CATALOG, AGENT_POLICY_CATALOG_VERSION, agentPolicyChecksum } from "./agent-policy-catalog";
import { redactFreeText, redactModelValue } from "./agent-model-redaction";

const SUMMARY_VERSION = "summary-v3";
export const MAX_CONVERSATION_DIGEST_CHARS = 4_000;
export const MAX_SUMMARY_CHARS = 12_000;
const MAX_CONVERSATION_DIGEST_MESSAGES = 12;
const MAX_CONVERSATION_DIGEST_TEXT_CHARS = 600;
const MAX_SELECTED_ENTITIES_CHARS = 2_000;
type ConversationMessage = Omit<BjjUIMessage, "role"> & { role: "user" | "assistant" };

const ConversationDigestMessageSchema = z.object({
    id: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    text: z.string().min(1).max(MAX_CONVERSATION_DIGEST_TEXT_CHARS),
});
const UnresolvedActionSummarySchema = z.object({
    id: z.string(),
    capability: z.string(),
    status: z.string(),
    expiresAt: z.iso.datetime(),
});

export const AgentSessionSummarySchema = z.object({
    version: z.literal(SUMMARY_VERSION),
    generatedAt: z.iso.datetime(),
    sourceMessageCount: z.number().int().nonnegative(),
    sourceMessageIds: z.array(z.string()).max(20),
    unresolvedActions: z.array(UnresolvedActionSummarySchema).max(20),
    selectedEntities: z.record(z.string(), z.unknown()),
    goals: z.array(z.string()).max(5),
    policyCatalogVersion: z.string(),
    conversationDigest: z.array(ConversationDigestMessageSchema).max(MAX_CONVERSATION_DIGEST_MESSAGES),
});

/**
 * Older summaries are still valid context. They intentionally accept a
 * smaller, permissive shape so a version bump does not discard the covered
 * message count and replay already-summarized history.
 */
export const LegacyAgentSessionSummarySchema = z.object({
    version: z.string().min(1).default("summary-legacy"),
    generatedAt: z.iso.datetime().optional(),
    sourceMessageCount: z.number().int().nonnegative().default(0),
    sourceMessageIds: z.array(z.string()).max(20).default([]),
    unresolvedActions: z.array(UnresolvedActionSummarySchema).default([]),
    selectedEntities: z.record(z.string(), z.unknown()).default({}),
    goals: z.array(z.string()).max(5).default([]),
    policyCatalogVersion: z.string().default("legacy"),
}).strip();

function minimizeGoal(value: string): string {
    return redactFreeText(value).slice(0, 500);
}

function buildConversationDigest(messages: BjjUIMessage[]) {
    const candidates = messages
        .filter((message): message is ConversationMessage => message.role === "user" || message.role === "assistant")
        .map((message) => {
            const text = message.parts
                .filter((part): part is Extract<BjjUIMessage["parts"][number], { type: "text" }> => part.type === "text")
                .map((part) => part.text.trim())
                .filter(Boolean)
                .join(" ");
            return {
                id: message.id.slice(0, 256),
                role: message.role,
                text: redactFreeText(text).slice(0, MAX_CONVERSATION_DIGEST_TEXT_CHARS),
            };
        })
        .filter((message) => message.text.length > 0)
        .slice(-MAX_CONVERSATION_DIGEST_MESSAGES);

    while (candidates.length > 1 && JSON.stringify(candidates).length > MAX_CONVERSATION_DIGEST_CHARS) {
        candidates.shift();
    }
    return candidates;
}

function boundedSelectedEntities(value: Record<string, unknown>): Record<string, unknown> {
    const redacted = redactModelValue(value);
    if (!redacted || typeof redacted !== "object" || Array.isArray(redacted)) return {};
    return JSON.stringify(redacted).length <= MAX_SELECTED_ENTITIES_CHARS
        ? redacted as Record<string, unknown>
        : {};
}

function serializeBoundedSummary(input: z.input<typeof AgentSessionSummarySchema>): string {
    let parsed = AgentSessionSummarySchema.parse(input);
    let summary = JSON.stringify(parsed);
    while (summary.length > MAX_SUMMARY_CHARS && parsed.conversationDigest.length > 0) {
        parsed = { ...parsed, conversationDigest: parsed.conversationDigest.slice(1) };
        summary = JSON.stringify(parsed);
    }
    while (summary.length > MAX_SUMMARY_CHARS && parsed.goals.length > 0) {
        parsed = { ...parsed, goals: parsed.goals.slice(1) };
        summary = JSON.stringify(parsed);
    }
    if (summary.length > MAX_SUMMARY_CHARS) {
        parsed = {
            ...parsed,
            sourceMessageIds: parsed.sourceMessageIds.slice(-10),
            unresolvedActions: parsed.unresolvedActions.slice(-5),
            selectedEntities: {},
        };
        summary = JSON.stringify(parsed);
    }
    if (summary.length > MAX_SUMMARY_CHARS) {
        parsed = {
            ...parsed,
            sourceMessageIds: [],
            unresolvedActions: [],
            goals: [],
            conversationDigest: [],
        };
        summary = JSON.stringify(parsed);
    }
    return summary;
}

@Injectable()
export class AgentIntelligenceService {
    constructor(
        private readonly sessions: AgentSessionService,
        private readonly actions: ActionCoordinatorService,
    ) {}

    async compact(sessionId: string, owner: AgentSessionOwner): Promise<{ version: string; summary: string; checksum: string }> {
        const session = await this.sessions.get(sessionId, owner);
        const actionItems = await this.actions.list(owner);
        const actions = actionItems.filter((item) => item.sessionId === sessionId && ["proposed", "approved", "executing", "uncertain"].includes(item.status));
        const userGoals = session.messages
            .filter((message) => message.role === "user")
            .flatMap((message) => message.parts.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => minimizeGoal(part.text.trim())))
            .filter(Boolean)
            .slice(-5);
        const summary = serializeBoundedSummary({
            version: SUMMARY_VERSION,
            generatedAt: new Date().toISOString(),
            sourceMessageCount: session.messages.length,
            sourceMessageIds: session.messages.slice(-20).map((message) => message.id.slice(0, 256)),
            unresolvedActions: actions.slice(-20).map((action) => ({
                id: action.id.slice(0, 256),
                capability: action.capability.slice(0, 256),
                status: action.status.slice(0, 64),
                expiresAt: action.expiresAt.toISOString(),
            })),
            selectedEntities: boundedSelectedEntities(session.selectedEntities),
            goals: userGoals,
            policyCatalogVersion: AGENT_POLICY_CATALOG_VERSION,
            // Build this from text parts only, before the covered message count
            // is advanced, so assistant continuity survives compaction without
            // carrying tool, action, or document payloads into the summary.
            conversationDigest: buildConversationDigest(session.messages),
        });
        await this.sessions.update(sessionId, owner, { summary });
        return { version: SUMMARY_VERSION, summary, checksum: createHash("sha256").update(summary).digest("hex") };
    }

    retrievePolicy(query: string, locale = "ko") {
        const normalized = query.toLocaleLowerCase();
        const selectedLocale = locale.toLowerCase().startsWith("en") ? "en" : "ko";
        const ranked = AGENT_POLICY_CATALOG
            .map((entry) => ({ entry, score: entry.keywords.filter((keyword) => normalized.includes(keyword.toLocaleLowerCase())).length }))
            .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));
        const selected = ranked.some((item) => item.score > 0) ? ranked.filter((item) => item.score > 0).slice(0, 3) : ranked.slice(0, 2);
        return {
            catalogVersion: AGENT_POLICY_CATALOG_VERSION,
            query,
            locale: selectedLocale,
            retrievedAt: new Date().toISOString(),
            matches: selected.map(({ entry, score }) => ({
                id: entry.id,
                version: entry.version,
                effectiveAt: entry.effectiveAt,
                source: entry.source,
                checksum: agentPolicyChecksum(entry),
                score,
                policy: entry.locales[selectedLocale],
            })),
        };
    }
}
