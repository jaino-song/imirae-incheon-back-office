import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

export interface AgentContext {
    principal: VerifiedTenantPrincipal;
    sessionId: string;
    traceId: string;
    locale: string;
    /** Present only while executing an approved durable action. */
    actionId?: string;
}
