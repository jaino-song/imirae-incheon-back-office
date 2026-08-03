import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpException, Optional, Param, Patch, Post, Req, Res, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { pipeUIMessageStreamToResponse } from "ai";

import { AgentFlagsService } from "application/agent/agent-flags.service";
import { AgentRateLimitService } from "application/agent/agent-rate-limit.service";
import { AgentRuntimeService } from "application/agent/agent-runtime.service";
import { AgentSessionService } from "application/agent/agent-session.service";
import { CapabilityRegistryService } from "application/agent/capability-registry.service";
import { AGENT_VERSION } from "application/agent/agent-runtime.service";
import { AgentModelFactory } from "infrastructure/agent/agent-model.factory";
import { ActionCoordinatorService } from "application/agent/action-coordinator.service";
import { AgentIntelligenceService } from "application/agent/agent-intelligence.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { TenantGuard } from "infrastructure/tenant";
import { AgentChatDto, AgentChatMessagesSchema, AgentFeedbackDto, AgentFlagsPatchDto, AgentSessionPatchDto } from "interface/dto/agent.dto";
import type { BjjUIMessage } from "@babyjamjam/shared";
import { AgentReleaseEvidenceService } from "application/agent/agent-release-evidence.service";
import { CAPABILITY_CATALOG_BY_NAME } from "application/agent/capability-catalog";
import { AgentFeedbackService } from "application/agent/agent-feedback.service";

type AgentRequest = Request & { tenant?: VerifiedTenantPrincipal };

export function abortWhenResponseCloses(response: Response, controller: AbortController): () => void {
    const onClose = () => {
        cleanup();
        if (!response.writableFinished) controller.abort();
    };
    const cleanup = () => {
        response.off("close", onClose);
        response.off("finish", cleanup);
    };
    response.once("close", onClose);
    response.once("finish", cleanup);
    if (response.destroyed || response.closed) onClose();
    return cleanup;
}

@Controller("ai")
@UseGuards(JwtGuard, TenantGuard)
export class AgentController {
    constructor(
        private readonly runtime: AgentRuntimeService,
        private readonly sessions: AgentSessionService,
        private readonly registry: CapabilityRegistryService,
        private readonly flags: AgentFlagsService,
        private readonly rateLimit: AgentRateLimitService,
        private readonly models: AgentModelFactory,
        @Optional() private readonly actions?: ActionCoordinatorService,
        @Optional() private readonly intelligence?: AgentIntelligenceService,
        @Optional() private readonly releaseEvidence?: AgentReleaseEvidenceService,
        @Optional() private readonly feedback?: AgentFeedbackService,
    ) {}

    @Post("agent/chat")
    async chat(@Body() dto: AgentChatDto, @Req() request: AgentRequest, @Res() response: Response) {
        const principal = this.requirePrincipal(request);
        const controller = new AbortController();
        const detachAbortListener = abortWhenResponseCloses(response, controller);
        try {
            await this.rateLimit.check(principal.userId, principal.branchId);
        } catch (error) {
            detachAbortListener();
            throw error;
        }
        if (controller.signal.aborted) return;
        let messages: BjjUIMessage[];
        try {
            messages = AgentChatMessagesSchema.parse(dto.messages) as unknown as BjjUIMessage[];
        } catch {
            throw new BadRequestException("Invalid agent messages");
        }

        let result: Awaited<ReturnType<AgentRuntimeService["stream"]>>;
        try {
            result = await this.runtime.stream({
                principal,
                sessionId: dto.sessionId,
                locale: dto.locale,
                messages,
                signal: controller.signal,
            });
        } catch (error) {
            detachAbortListener();
            if (error instanceof HttpException) throw error;
            throw new ServiceUnavailableException("Agent request unavailable");
        }
        response.setHeader("X-Agent-Session-Id", result.sessionId);
        pipeUIMessageStreamToResponse({ response, stream: result.stream });
    }

    @Get("agent/sessions")
    list(@Req() request: AgentRequest) {
        return this.sessions.list(this.owner(request));
    }

    @Get("agent/sessions/:id")
    get(@Param("id") id: string, @Req() request: AgentRequest) {
        return this.sessions.get(id, this.owner(request));
    }

    @Patch("agent/sessions/:id")
    update(@Param("id") id: string, @Body() dto: AgentSessionPatchDto, @Req() request: AgentRequest) {
        const { archived, ...patch } = dto;
        const owner = this.owner(request);
        if (archived !== undefined) {
            const archiveOperation = archived ? this.sessions.archive(id, owner) : this.sessions.unarchive(id, owner);
            if (Object.keys(patch).length === 0) return archiveOperation;
            return archiveOperation.then(() => this.sessions.update(id, owner, patch));
        }
        return this.sessions.update(id, owner, patch);
    }

    @Delete("agent/sessions/:id")
    @HttpCode(204)
    remove(@Param("id") id: string, @Req() request: AgentRequest) {
        return this.sessions.remove(id, this.owner(request));
    }

    @Post("agent/sessions/:id/compact")
    async compact(@Param("id") id: string, @Req() request: AgentRequest) {
        if (!this.intelligence) throw new ServiceUnavailableException("Agent intelligence unavailable");
        return this.intelligence.compact(id, this.owner(request));
    }

    @Post("agent/feedback")
    submitFeedback(@Body() dto: AgentFeedbackDto, @Req() request: AgentRequest) {
        if (!this.feedback) throw new ServiceUnavailableException("Agent feedback unavailable");
        return this.feedback.submit(dto, this.owner(request));
    }

    @Get("agent/policy")
    policy(@Req() request: AgentRequest) {
        if (!this.intelligence) throw new ServiceUnavailableException("Agent intelligence unavailable");
        const query = typeof request.query["query"] === "string" ? request.query["query"] : "general";
        return this.intelligence.retrievePolicy(query, typeof request.query["locale"] === "string" ? request.query["locale"] : "ko");
    }

    @Get("capabilities")
    async capabilities(@Req() request: AgentRequest) {
        const principal = this.requirePrincipal(request);
        const snapshot = await this.flags.getSnapshot();
        return this.registry.list()
            .filter((capability) => this.flags.isCapabilityEnabledFromSnapshot(capability.meta, principal, snapshot))
            .map((capability) => capability.meta);
    }

    @Get("agent/diagnostics")
    @UseGuards(OwnerGuard)
    async diagnostics() {
        const config = await this.flags.getConfig();
        const actions = this.actions ? await this.actions.diagnostics() : { pending: 0, uncertain: 0, succeeded: 0, failed: 0 };
        const capabilities = this.registry.list();
        const manifestFresh = capabilities.length === CAPABILITY_CATALOG_BY_NAME.size && capabilities.every((capability) => {
            const expected = CAPABILITY_CATALOG_BY_NAME.get(capability.meta.name);
            return expected?.version === capability.meta.version;
        });
        const evaluation = this.releaseEvidence?.evaluation(AGENT_VERSION, this.models.modelId) ?? { status: "missing", reason: "Release evidence service unavailable" };
        return {
            agentVersion: AGENT_VERSION,
            model: this.models.modelId,
            releaseCommitSha: process.env["AGENT_RELEASE_COMMIT_SHA"]
                ?? process.env["RAILWAY_GIT_COMMIT_SHA"]
                ?? process.env["GITHUB_SHA"]
                ?? null,
            capabilityCount: capabilities.length,
            capabilityVersions: Object.fromEntries(capabilities.map((capability) => [capability.meta.name, capability.meta.version])),
            manifestFresh,
            drift: { status: manifestFresh ? "runtime-validated" : "failed", inventory: capabilities.length },
            evals: { suite: "full-program", requiredCases: 200, evidence: evaluation },
            enabled: config.enabled,
            rolloutStage: config.rolloutStage,
            allowlists: { branches: config.branchAllowlist.length, users: config.userAllowlist.length },
            effectiveFlags: {
                domains: config.domains,
                capabilities: config.capabilities,
                branchAllowlist: config.branchAllowlist,
                userAllowlist: config.userAllowlist,
            },
            readEnabled: config.risks["read"] !== false,
            writeEnabled: config.risks["reversible-write"] === true,
            externalEnabled: config.risks["external-side-effect"] === true,
            privilegedEnabled: config.risks["privileged-administration"] === true,
            actions,
        };
    }

    @Get("agent/diagnostics/actions")
    @UseGuards(OwnerGuard)
    diagnosticsActions() {
        if (!this.actions) throw new ServiceUnavailableException("Agent actions unavailable");
        return this.actions.diagnosticsActions();
    }

    @Patch("agent/flags")
    @UseGuards(OwnerGuard)
    updateFlags(@Body() dto: AgentFlagsPatchDto) {
        return this.flags.updateConfig(dto.flags);
    }

    @Post("agent/emergency-disable")
    @UseGuards(OwnerGuard)
    async emergencyDisable() {
        const config = await this.flags.getConfig();
        return this.flags.updateConfig({ ...config, enabled: false });
    }

    private owner(request: AgentRequest) {
        const principal = this.requirePrincipal(request);
        return { userId: principal.userId, branchId: principal.branchId };
    }

    private requirePrincipal(request: AgentRequest): VerifiedTenantPrincipal {
        if (!request.tenant?.userId || !request.tenant.branchId) {
            throw new ForbiddenException("Verified tenant principal missing");
        }
        return request.tenant;
    }
}
