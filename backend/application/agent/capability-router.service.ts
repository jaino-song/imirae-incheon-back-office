import { Injectable, Optional } from "@nestjs/common";
import { generateText } from "ai";

import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { AgentModelFactory } from "infrastructure/agent/agent-model.factory";
import { AgentFlagsService } from "./agent-flags.service";
import { CapabilityRegistryService } from "./capability-registry.service";
import { redactFreeText } from "./agent-model-redaction";

const DOMAIN_TERMS: Record<string, RegExp> = {
    clients: /(산모|고객|client|mother)/i,
    employees: /(관리사|직원|employee|caregiver)/i,
    schedules: /(일정|스케줄|schedule|calendar)/i,
    dashboard: /(대시보드|요약|dashboard|summary)/i,
    vouchers: /(바우처|voucher|가격|price)/i,
    bank: /(계좌|은행|bank|account)/i,
    contracts: /(계약|서명|contract|document)/i,
    consultations: /(상담|문의|consultation|inquiry)/i,
    calls: /(통화|녹취|전화 기록|call|transcript)/i,
    drafts: /(초안|draft|통화 추출)/i,
    automation: /(자동화|트리거|automation|trigger)/i,
    files: /(파일|문서 파일|첨부|file|attachment)/i,
    policy: /(정책|규정|승인 원칙|보안 원칙|policy|rule|compliance)/i,
    "service-records": /(제공기록|서비스 기록|service[ -]?record)/i,
    analytics: /(분석|통계|analytics|metric|funnel)/i,
    settings: /(설정|환경설정|setting|configuration)/i,
    website: /(웹사이트|홈페이지|website|homepage)/i,
    messages: /(문자|메시지|템플릿|sms|message|template)/i,
    notifications: /(알림|notification|push)/i,
    admin: /(관리자|지점 생성|admin|branch creation)/i,
};

export function minimizeClassifierText(text: string): string {
    return redactFreeText(text).slice(0, 240);
}

@Injectable()
export class CapabilityRouterService {
    constructor(
        private readonly registry: CapabilityRegistryService,
        private readonly flags: AgentFlagsService,
        @Optional() private readonly models?: AgentModelFactory,
    ) {}

    async route(text: string, principal: VerifiedTenantPrincipal, max = 12) {
        const snapshot = await this.flags.getSnapshot();
        const enabledCapabilities = this.registry.list().filter((capability) => (
            this.flags.isCapabilityEnabledFromSnapshot(capability.meta, principal, snapshot)
        ));
        const enabledDomains = new Set(enabledCapabilities.map((capability) => capability.meta.domain));
        const matched = Object.entries(DOMAIN_TERMS)
            .filter(([, pattern]) => pattern.test(text))
            .map(([domain]) => domain)
            .filter((domain) => enabledDomains.has(domain));
        const domains = matched.length === 1
            ? matched
            : await this.classifyAmbiguous(text, [...enabledDomains]);
        const selectedDomains = domains.length > 0 ? domains : (enabledDomains.has("clients") ? ["clients"] : []);
        const offered = [];
        for (const capability of enabledCapabilities) {
            if (!selectedDomains.includes(capability.meta.domain)) continue;
            offered.push(capability);
            if (offered.length >= max) break;
        }
        return { domains: selectedDomains, capabilities: offered };
    }

    private async classifyAmbiguous(text: string, enabledDomains: string[]): Promise<string[]> {
        if (!this.models || enabledDomains.length === 0 || process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] === "false") return [];
        const prompt = minimizeClassifierText(text);
        try {
            const result = await generateText({
                model: this.models.create(),
                system: `Classify the request into at most two domains from: ${enabledDomains.join(", ")}. Return JSON only: {"domains":["domain"]}. Never include personal data.`,
                prompt,
                maxOutputTokens: 64,
            });
            const json = result.text.match(/\{[\s\S]*\}/)?.[0];
            if (!json) return [];
            const parsed = JSON.parse(json) as { domains?: unknown };
            return Array.isArray(parsed.domains)
                ? [...new Set(parsed.domains.filter((domain): domain is string => typeof domain === "string" && enabledDomains.includes(domain)))].slice(0, 2)
                : [];
        } catch {
            return [];
        }
    }
}
