import { createHash } from "node:crypto";

export type AgentPolicyEntry = {
    id: string;
    version: string;
    effectiveAt: string;
    source: string;
    locales: Record<"ko" | "en", string>;
    keywords: string[];
};

export const AGENT_POLICY_CATALOG_VERSION = "policy-catalog-v2";
export const AGENT_POLICY_CATALOG: AgentPolicyEntry[] = [
    {
        id: "approval-boundary",
        version: "2.0.0",
        effectiveAt: "2026-08-03",
        source: "Operational Copilot ADR - immutable proposals",
        locales: {
            ko: "모든 쓰기 작업은 변경값과 대상을 고정한 제안을 먼저 만들고, 같은 지점의 권한 있는 사용자가 만료 전에 명시적으로 승인해야 합니다.",
            en: "Every write requires an immutable proposal and explicit approval by an authorized user in the same branch before expiry.",
        },
        keywords: ["승인", "approval", "write", "변경", "proposal"],
    },
    {
        id: "tenant-boundary",
        version: "2.0.0",
        effectiveAt: "2026-08-03",
        source: "ADR-001 auth session and tenant principal",
        locales: {
            ko: "모든 조회와 작업은 서버가 검증한 사용자와 현재 지점에 제한되며, 다른 사용자나 지점의 데이터는 사용할 수 없습니다.",
            en: "Every read and action is limited to the server-verified user and current branch; cross-user and cross-branch access is denied.",
        },
        keywords: ["branch", "지점", "tenant", "권한", "authorization"],
    },
    {
        id: "external-uncertainty",
        version: "2.0.0",
        effectiveAt: "2026-08-03",
        source: "Operational Copilot ADR - external side effects",
        locales: {
            ko: "외부 제공자의 결과가 불확실하면 같은 작업을 다시 실행하지 않고, 서버의 상태 조회 또는 운영자 확인으로만 조정합니다.",
            en: "When an external result is uncertain, the action is never replayed; only trusted provider lookup or operator review may reconcile it.",
        },
        keywords: ["external", "provider", "uncertain", "불확실", "재시도", "reconcile", "sms", "계약"],
    },
    {
        id: "data-minimization",
        version: "2.0.0",
        effectiveAt: "2026-08-03",
        source: "Operational Copilot PRD - privacy and retention",
        locales: {
            ko: "모델과 일반 로그에는 기능 수행에 필요한 최소 필드만 전달하며 전화번호, 주소, 토큰, 서명 URL, 문서 본문을 포함하지 않습니다.",
            en: "Models and general logs receive only fields required for the capability and exclude phone numbers, addresses, tokens, signed URLs, and document bodies.",
        },
        keywords: ["privacy", "retention", "개인정보", "보관", "log", "model"],
    },
];

export function agentPolicyChecksum(entry: AgentPolicyEntry): string {
    return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}
