import { Injectable } from "@nestjs/common";

import type { AgentSessionOwner } from "domain/entities/agent-session.entity";
import { ActionCoordinatorService } from "./action-coordinator.service";
import { AgentSessionService } from "./agent-session.service";
import { AGENT_POLICY_CATALOG, AGENT_POLICY_CATALOG_VERSION, agentPolicyChecksum } from "./agent-policy-catalog";
import { createHash } from "node:crypto";
import { z } from "zod";

const SUMMARY_VERSION = "summary-v2";
export const AgentSessionSummarySchema = z.object({
    version: z.literal(SUMMARY_VERSION),
    generatedAt: z.iso.datetime(),
    sourceMessageCount: z.number().int().nonnegative(),
    sourceMessageIds: z.array(z.string()).max(20),
    unresolvedActions: z.array(z.object({ id: z.string(), capability: z.string(), status: z.string(), expiresAt: z.iso.datetime() })),
    selectedEntities: z.record(z.string(), z.unknown()),
    goals: z.array(z.string()).max(5),
    policyCatalogVersion: z.string(),
});

function minimizeGoal(value: string): string {
    return value
        .replace(/\b01[016789][\s-]?\d{3,4}[\s-]?\d{4}\b/g, "[전화번호]")
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일]")
        .replace(/\b(?:bearer|token|password|secret)\s*[:=]\s*\S+/gi, "[비공개]")
        .slice(0, 500);
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
        const summary = JSON.stringify(AgentSessionSummarySchema.parse({
            version: SUMMARY_VERSION,
            generatedAt: new Date().toISOString(),
            sourceMessageCount: session.messages.length,
            sourceMessageIds: session.messages.slice(-20).map((message) => message.id),
            unresolvedActions: actions.map((action) => ({ id: action.id, capability: action.capability, status: action.status, expiresAt: action.expiresAt.toISOString() })),
            selectedEntities: session.selectedEntities,
            goals: userGoals,
            policyCatalogVersion: AGENT_POLICY_CATALOG_VERSION,
        }));
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
